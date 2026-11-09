-- 0005 지도 검색 2차 (existing data): 평당가 vs. 법정동 평균, 거래량, 비교 근거.
--
-- * kr_lot_stats: per complex (lot = 시군구 + 법정동 + 지번) the uncancelled deals of the last
--   12 and 3 months. kr_umd_stats: per 법정동 the median 평당가 (원/3.3m²) and deal count
--   of the last 12 months. Both are recomputed with the discounts (kr_refresh_area_stats is
--   called by kr_refresh_due_signals); lots without deals any more are set to 0, not removed.
-- * kr_map_search(): kr_search (0004) plus 거래량 and 평당가 columns, a minimum 12-month
--   거래량 filter, a "평당가 below the 법정동 median" filter and a 'volume' sort. A new name
--   because the result columns change; kr_search stays for older clients.
-- * kr_comparables(): the deals behind a market value, for "비교 근거" in the UI.
-- * kr_search(): same as 0004 but up to 5000 rows (kr_map_search filters and pages them).

create table public.kr_lot_stats (
  lawd_cd text not null,
  umd_name text not null,
  jibun text not null,
  deals_12m integer not null default 0,
  deals_3m integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (lawd_cd, umd_name, jibun)
);
alter table public.kr_lot_stats enable row level security;
create policy kr_lot_stats_select_all on public.kr_lot_stats for select using (true);
revoke insert, update, delete on public.kr_lot_stats from anon, authenticated;

create table public.kr_umd_stats (
  lawd_cd text not null,
  umd_name text not null,
  median_pyeong_krw bigint,
  deals_12m integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (lawd_cd, umd_name)
);
alter table public.kr_umd_stats enable row level security;
create policy kr_umd_stats_select_all on public.kr_umd_stats for select using (true);
revoke insert, update, delete on public.kr_umd_stats from anon, authenticated;

create or replace function public.kr_refresh_area_stats(p_lawd_cd text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  started timestamptz := now();
begin
  insert into public.kr_lot_stats (lawd_cd, umd_name, jibun, deals_12m, deals_3m, computed_at)
  select t.lawd_cd, t.umd_name, t.jibun, count(*)::integer,
         (count(*) filter (where t.deal_date >= (current_date - interval '3 months')::date))::integer, started
  from public.kr_apt_trades t
  where t.lawd_cd = p_lawd_cd and not t.cancelled and t.jibun is not null and t.umd_name <> ''
    and t.deal_date >= (current_date - interval '12 months')::date
  group by t.lawd_cd, t.umd_name, t.jibun
  on conflict (lawd_cd, umd_name, jibun) do update set
    deals_12m = excluded.deals_12m, deals_3m = excluded.deals_3m, computed_at = excluded.computed_at;
  update public.kr_lot_stats s set deals_12m = 0, deals_3m = 0, computed_at = started
  where s.lawd_cd = p_lawd_cd and s.computed_at < started;

  insert into public.kr_umd_stats (lawd_cd, umd_name, median_pyeong_krw, deals_12m, computed_at)
  select t.lawd_cd, t.umd_name,
         round(percentile_cont(0.5) within group (order by t.price_krw / t.exclusive_area_m2 * 3.305785))::bigint,
         count(*)::integer, started
  from public.kr_apt_trades t
  where t.lawd_cd = p_lawd_cd and not t.cancelled and t.umd_name <> ''
    and t.deal_date >= (current_date - interval '12 months')::date
  group by t.lawd_cd, t.umd_name
  on conflict (lawd_cd, umd_name) do update set
    median_pyeong_krw = excluded.median_pyeong_krw, deals_12m = excluded.deals_12m, computed_at = excluded.computed_at;
  update public.kr_umd_stats s set deals_12m = 0, median_pyeong_krw = null, computed_at = started
  where s.lawd_cd = p_lawd_cd and s.computed_at < started;
end;
$$;
revoke execute on function public.kr_refresh_area_stats(text) from public, anon, authenticated;

create or replace function public.kr_refresh_due_signals(p_budget_seconds integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  started timestamptz := clock_timestamp();
begin
  for r in
    with changed as (
      select split_part(s.key, ':', 1) as lawd_cd, max(s.fetched_at) as at
      from public.kr_sync_state s
      where s.job = 'trades' and s.fetched_at is not null
      group by 1
      union all
      select i.lawd_cd, max(i.last_seen_at)
      from public.kr_auction_items i
      where i.lawd_cd is not null
      group by 1
    )
    select c.lawd_cd, max(c.at) as at, st.computed_at
    from changed c
    left join public.kr_signal_state st on st.lawd_cd = c.lawd_cd
    where c.lawd_cd ~ '^\d{5}$'
    group by c.lawd_cd, st.computed_at
    having st.computed_at is null or max(c.at) > st.computed_at or st.computed_at < now() - interval '1 day'
    order by st.computed_at nulls first, max(c.at)
  loop
    exit when clock_timestamp() > started + make_interval(secs => least(greatest(coalesce(p_budget_seconds, 50), 1), 240));
    perform public.kr_refresh_signals(r.lawd_cd);
    perform public.kr_refresh_area_stats(r.lawd_cd);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.kr_refresh_due_signals(integer) from public, anon, authenticated;

-- kr_search: the row cap goes from 500 to 5000 so kr_map_search can filter the full set.
create or replace function public.kr_search(
  p_lawd_codes text[],
  p_types text[] default array['flagship', 'lowdeal', 'auction'],
  p_umd text default null,
  p_apt text default null,
  p_price_min bigint default null,
  p_price_max bigint default null,
  p_discount_min numeric default 0.15,
  p_area_min numeric default null,
  p_area_max numeric default null,
  p_built_after integer default null,
  p_days integer default 90,
  p_bounds double precision[] default null,
  p_sort text default 'discount',
  p_limit integer default 300
)
returns table (
  kind text,
  id text,
  name text,
  lawd_cd text,
  umd_name text,
  jibun text,
  area_m2 numeric,
  floor integer,
  price_krw bigint,
  estimate_krw bigint,
  discount numeric,
  event_date date,
  bid_end timestamptz,
  comparable_count integer,
  window_months integer,
  area_tolerance numeric,
  latest_comp_date date,
  dealing_type text,
  build_year integer,
  eviction_by text,
  private_contract boolean,
  fail_count integer,
  detail_url text,
  computed_at timestamptz,
  lat double precision,
  lng double precision,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with deals as (
    select
      case when s.is_flagship then 'flagship' else 'lowdeal' end as kind,
      t.source_key as id, t.apt_name as name, t.lawd_cd, t.umd_name, t.jibun,
      t.exclusive_area_m2::numeric as area_m2, t.floor, t.price_krw, s.estimate_krw, s.discount::numeric,
      t.deal_date as event_date, null::timestamptz as bid_end,
      s.comparable_count, s.window_months, s.area_tolerance::numeric, s.latest_comp_date,
      t.dealing_type, t.build_year, null::text as eviction_by, null::boolean as private_contract, null::integer as fail_count,
      null::text as detail_url, s.computed_at
    from public.kr_trade_signals s
    join public.kr_apt_trades t on t.id = s.trade_id
    where s.lawd_cd = any (p_lawd_codes[1:60])
      and not t.cancelled
      and t.deal_date >= (current_date - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 366)))::date
      and (case when s.is_flagship then 'flagship' else 'lowdeal' end) = any (p_types)
      and (p_built_after is null or t.build_year >= p_built_after)
  ),
  auctions as (
    select
      'auction'::text, i.source_key, i.name, i.lawd_cd, i.emd, i.jibun,
      i.building_area_m2::numeric, i.floor_guess, i.min_bid_krw, s.estimate_krw, s.discount::numeric,
      null::date, i.bid_end,
      coalesce(s.comparable_count, 0), s.window_months, s.area_tolerance::numeric, s.latest_comp_date,
      null::text, null::integer, i.eviction_by, i.private_contract, i.fail_count,
      i.detail_url, s.computed_at
    from public.kr_auction_items i
    left join public.kr_auction_signals s on s.item_id = i.id
    where 'auction' = any (p_types)
      and p_built_after is null
      and i.lawd_cd = any (p_lawd_codes[1:60])
      and i.usage_small ilike '%아파트%'
      and not i.share_only
      and i.last_seen_at >= now() - interval '3 days'
      and (i.bid_end is null or i.bid_end >= now())
  ),
  u as (
    select * from deals
    union all
    select * from auctions
  ),
  f as (
    select u.*, g.lat, g.lng
    from u
    left join public.kr_geo g on g.key = u.lawd_cd || '|' || u.umd_name || '|' || u.jibun and g.status = 'ok'
    where (p_umd is null or u.umd_name = p_umd)
      and (p_apt is null or u.name ilike '%' || replace(replace(replace(p_apt, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_price_min is null or u.price_krw >= p_price_min)
      and (p_price_max is null or u.price_krw <= p_price_max)
      and (p_discount_min is null or u.discount >= p_discount_min)
      and (p_area_min is null or u.area_m2 >= p_area_min)
      and (p_area_max is null or u.area_m2 < p_area_max)
      and (p_bounds is null or (g.lat between p_bounds[1] and p_bounds[3] and g.lng between p_bounds[2] and p_bounds[4]))
  )
  select f.*, count(*) over ()
  from f
  order by
    case when p_sort = 'price' then f.price_krw end asc nulls last,
    case when p_sort = 'newest' then coalesce(f.event_date, f.bid_end::date) end desc nulls last,
    f.discount desc nulls last,
    f.id
  limit least(greatest(coalesce(p_limit, 300), 1), 5000);
$$;
grant execute on function public.kr_search(text[], text[], text, text, bigint, bigint, numeric, numeric, numeric, integer, integer, double precision[], text, integer) to anon, authenticated;

create or replace function public.kr_map_search(
  p_lawd_codes text[],
  p_types text[] default array['flagship', 'lowdeal', 'auction'],
  p_umd text default null,
  p_apt text default null,
  p_price_min bigint default null,
  p_price_max bigint default null,
  p_discount_min numeric default 0.15,
  p_area_min numeric default null,
  p_area_max numeric default null,
  p_built_after integer default null,
  p_days integer default 90,
  p_bounds double precision[] default null,
  p_sort text default 'discount',
  p_limit integer default 300,
  p_volume_min integer default null,
  p_below_umd_avg boolean default false
)
returns table (
  kind text,
  id text,
  name text,
  lawd_cd text,
  umd_name text,
  jibun text,
  area_m2 numeric,
  floor integer,
  price_krw bigint,
  estimate_krw bigint,
  discount numeric,
  event_date date,
  bid_end timestamptz,
  comparable_count integer,
  window_months integer,
  area_tolerance numeric,
  latest_comp_date date,
  dealing_type text,
  build_year integer,
  eviction_by text,
  private_contract boolean,
  fail_count integer,
  detail_url text,
  computed_at timestamptz,
  lat double precision,
  lng double precision,
  deals_12m integer,
  deals_3m integer,
  pyeong_krw bigint,
  umd_median_pyeong_krw bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select * from public.kr_search(
      p_lawd_codes, p_types, p_umd, p_apt, p_price_min, p_price_max, p_discount_min,
      p_area_min, p_area_max, p_built_after, p_days, p_bounds, 'discount', 5000
    )
  ),
  f as (
    select
      b.kind, b.id, b.name, b.lawd_cd, b.umd_name, b.jibun, b.area_m2, b.floor, b.price_krw, b.estimate_krw, b.discount,
      b.event_date, b.bid_end, b.comparable_count, b.window_months, b.area_tolerance, b.latest_comp_date, b.dealing_type,
      b.build_year, b.eviction_by, b.private_contract, b.fail_count, b.detail_url, b.computed_at, b.lat, b.lng,
      coalesce(ls.deals_12m, 0) as deals_12m,
      coalesce(ls.deals_3m, 0) as deals_3m,
      case when b.area_m2 > 0 and b.price_krw is not null then round(b.price_krw / b.area_m2 * 3.305785)::bigint end as pyeong_krw,
      us.median_pyeong_krw as umd_median_pyeong_krw
    from base b
    left join public.kr_lot_stats ls on ls.lawd_cd = b.lawd_cd and ls.umd_name = b.umd_name and ls.jibun = b.jibun
    left join public.kr_umd_stats us on us.lawd_cd = b.lawd_cd and us.umd_name = b.umd_name
  ),
  g as (
    select f.* from f
    where (p_volume_min is null or f.deals_12m >= p_volume_min)
      and (not coalesce(p_below_umd_avg, false) or (f.pyeong_krw is not null and f.umd_median_pyeong_krw is not null and f.pyeong_krw < f.umd_median_pyeong_krw))
  )
  select g.*, count(*) over ()
  from g
  order by
    case when p_sort = 'price' then g.price_krw end asc nulls last,
    case when p_sort = 'newest' then coalesce(g.event_date, g.bid_end::date) end desc nulls last,
    case when p_sort = 'volume' then g.deals_12m end desc nulls last,
    g.discount desc nulls last,
    g.id
  limit least(greatest(coalesce(p_limit, 300), 1), 500);
$$;
grant execute on function public.kr_map_search(text[], text[], text, text, bigint, bigint, numeric, numeric, numeric, integer, integer, double precision[], text, integer, integer, boolean) to anon, authenticated;

-- The deals behind one market value: same lot, 전용면적 within p_tol, last p_months,
-- uncancelled, without the valued deal itself. Newest first.
create or replace function public.kr_comparables(
  p_lawd_cd text,
  p_umd text,
  p_jibun text,
  p_area numeric,
  p_tol numeric,
  p_months integer,
  p_exclude text default null
)
returns table (deal_date date, apt_name text, exclusive_area_m2 numeric, floor integer, price_krw bigint, dealing_type text)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.deal_date, t.apt_name, t.exclusive_area_m2, t.floor, t.price_krw, t.dealing_type
  from public.kr_apt_trades t
  where t.lawd_cd = p_lawd_cd and t.umd_name = p_umd and t.jibun = replace(p_jibun, ' ', '')
    and not t.cancelled
    and t.deal_date >= (current_date - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 24)))::date
    and t.deal_date <= current_date
    and abs(t.exclusive_area_m2 - p_area) <= p_area * least(greatest(coalesce(p_tol, 0.08), 0), 0.2)
    and (p_exclude is null or t.source_key <> p_exclude)
  order by t.deal_date desc
  limit 50;
$$;
grant execute on function public.kr_comparables(text, text, text, numeric, numeric, integer, text) to anon, authenticated;

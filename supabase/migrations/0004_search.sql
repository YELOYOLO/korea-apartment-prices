-- 0004 지도 검색 (Mydream 지도 검색 개선 명세 1차).
--
-- The 실거래가 API this project is approved for has no aptSeq (all rows have apt_seq null),
-- so a complex is identified by its lot: 시군구 + 법정동 + 지번, the same key kr_geo and the
-- 공매 items use. kr_flagships() now ranks lots (its apt_seq column carries the lot key
-- "<LAWD_CD>|<법정동>|<지번>").
--
-- Discounts are precomputed per 시군구 so the map can filter, sort and page on the server:
-- * kr_trade_signals: every uncancelled deal of the last 12 months valued against the
--   other deals of its complex, exactly like valueListing() in _shared/kr/valuation.ts:
--   same complex, 전용면적 ±3% then ±8%, last 6 then 12 months, at least 3 deals, median
--   floor-normalized 원/m², scaled to the deal's area and floor, rounded to 만원.
--   discount = 1 - price / estimate; null = 비교 불가 (fewer than 3 comparables).
-- * kr_auction_signals: the same for current residential 공매 items (minimum bid vs.
--   the deals at the item's 법정동 + 지번); 지분 items are not valued.
-- * kr_refresh_signals(lawd) recomputes one 시군구 (upsert; rows of deleted trades/items go
--   with them by cascade, rows of older or cancelled deals are filtered out by kr_search); kr_refresh_due_signals() recomputes
--   those whose trades or 공매 changed since (pg_cron).
-- * kr_search(): the map/list search (region, 법정동, 단지명, type, price, discount, area,
--   준공 연도, period, map bounds, sort, limit).
-- * kr_umd_list(): 법정동 of a 시군구 with deals, for the 3-level region picker.

create or replace function public.kr_floor_factor(p_floor integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (case when p_floor is null then 1 when p_floor <= 1 then 0.93 when p_floor = 2 then 0.97 else 1 end)::numeric;
$$;

create or replace function public.kr_flagships(
  p_lawd_codes text[],
  p_per_region integer default 3,
  p_min_deals integer default 5,
  p_months integer default 12
)
returns table (
  lawd_cd text,
  apt_seq text,
  apt_name text,
  umd_name text,
  jibun text,
  build_year integer,
  deal_count bigint,
  median_price_per_m2 numeric,
  last_deal_date date,
  rank integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select
      t.lawd_cd,
      t.umd_name,
      t.jibun,
      t.apt_name,
      t.build_year,
      t.deal_date,
      t.price_krw / t.exclusive_area_m2 / public.kr_floor_factor(t.floor) as ppm2
    from public.kr_apt_trades t
    where t.lawd_cd = any (p_lawd_codes[1:60])
      and t.jibun is not null
      and t.umd_name <> ''
      and not t.cancelled
      and t.deal_date >= (current_date - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36)))::date
  ),
  c as (
    select
      t.lawd_cd,
      t.umd_name,
      t.jibun,
      mode() within group (order by t.apt_name) as apt_name,
      max(t.build_year) as build_year,
      count(*) as deal_count,
      round(percentile_cont(0.5) within group (order by t.ppm2)::numeric) as median_price_per_m2,
      max(t.deal_date) as last_deal_date
    from t
    group by t.lawd_cd, t.umd_name, t.jibun
    having count(*) >= greatest(coalesce(p_min_deals, 5), 1)
  ),
  r as (
    select c.*, row_number() over (partition by c.lawd_cd order by c.median_price_per_m2 desc, c.deal_count desc)::integer as rank
    from c
  )
  select r.lawd_cd, r.lawd_cd || '|' || r.umd_name || '|' || r.jibun, r.apt_name, r.umd_name, r.jibun, r.build_year, r.deal_count,
         r.median_price_per_m2, r.last_deal_date, r.rank
  from r
  where r.rank <= least(greatest(coalesce(p_per_region, 3), 1), 10)
  order by r.lawd_cd, r.rank;
$$;

create table public.kr_trade_signals (
  trade_id bigint primary key references public.kr_apt_trades (id) on delete cascade,
  lawd_cd text not null,
  estimate_krw bigint,
  discount numeric(8, 4),
  comparable_count integer not null default 0,
  window_months integer,
  area_tolerance numeric(4, 3),
  latest_comp_date date,
  is_flagship boolean not null default false,
  computed_at timestamptz not null default now()
);
create index kr_trade_signals_lawd_idx on public.kr_trade_signals (lawd_cd, discount desc nulls last);
alter table public.kr_trade_signals enable row level security;
create policy kr_trade_signals_select_all on public.kr_trade_signals for select using (true);
revoke insert, update, delete on public.kr_trade_signals from anon, authenticated;

create table public.kr_auction_signals (
  item_id bigint primary key references public.kr_auction_items (id) on delete cascade,
  lawd_cd text not null,
  estimate_krw bigint,
  discount numeric(8, 4),
  comparable_count integer not null default 0,
  window_months integer,
  area_tolerance numeric(4, 3),
  latest_comp_date date,
  computed_at timestamptz not null default now()
);
create index kr_auction_signals_lawd_idx on public.kr_auction_signals (lawd_cd);
alter table public.kr_auction_signals enable row level security;
create policy kr_auction_signals_select_all on public.kr_auction_signals for select using (true);
revoke insert, update, delete on public.kr_auction_signals from anon, authenticated;

create table public.kr_signal_state (
  lawd_cd text primary key check (lawd_cd ~ '^\d{5}$'),
  computed_at timestamptz not null,
  trade_rows integer not null default 0,
  auction_rows integer not null default 0
);
alter table public.kr_signal_state enable row level security;
create policy kr_signal_state_select_all on public.kr_signal_state for select using (true);
revoke insert, update, delete on public.kr_signal_state from anon, authenticated;

create or replace function public.kr_refresh_signals(p_lawd_cd text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trades integer;
  v_auctions integer;
begin
  insert into public.kr_trade_signals (trade_id, lawd_cd, estimate_krw, discount, comparable_count, window_months, area_tolerance, latest_comp_date, is_flagship)
  with t as (
    select
      x.id,
      coalesce(x.umd_name || '|' || x.jibun, 'n:' || x.umd_name || ':' || x.apt_name) as ck,
      x.exclusive_area_m2 as a,
      x.price_krw as p,
      x.floor as f,
      x.deal_date as d,
      x.price_krw / x.exclusive_area_m2 / public.kr_floor_factor(x.floor) as ppm2
    from public.kr_apt_trades x
    where x.lawd_cd = p_lawd_cd
      and not x.cancelled
      and x.deal_date >= (current_date - interval '12 months')::date
      and x.deal_date <= current_date
  ),
  flags as (select f.apt_seq as lot from public.kr_flagships(array[p_lawd_cd]) f),
  v as (
    select x.id, x.ck, x.p, w.cnt, w.months, w.tol, w.latest, c.cnt as widest,
           nullif(round(w.med::numeric * x.a * public.kr_floor_factor(x.f) / 10000) * 10000, 0) as est
    from t x
    left join lateral (
      select m.months, m.tol, count(*)::integer as cnt, percentile_cont(0.5) within group (order by y.ppm2) as med, max(y.d) as latest
      from (values (6, 0.03, 1), (6, 0.08, 2), (12, 0.03, 3), (12, 0.08, 4)) as m (months, tol, ord)
      join t y on y.ck = x.ck and y.id <> x.id
        and y.d >= (current_date - make_interval(months => m.months))::date
        and abs(y.a - x.a) <= x.a * m.tol
      group by m.months, m.tol, m.ord
      having count(*) >= 3
      order by m.ord
      limit 1
    ) w on true
    left join lateral (
      select count(*)::integer as cnt from t y where y.ck = x.ck and y.id <> x.id and abs(y.a - x.a) <= x.a * 0.08
    ) c on true
  )
  select v.id, p_lawd_cd, v.est::bigint, case when v.est is null then null else round(1 - v.p / v.est, 4) end,
         coalesce(v.cnt, v.widest, 0), v.months, v.tol, v.latest,
         exists (select 1 from flags where flags.lot = p_lawd_cd || '|' || v.ck)
  from v
  on conflict (trade_id) do update set
    estimate_krw = excluded.estimate_krw, discount = excluded.discount, comparable_count = excluded.comparable_count,
    window_months = excluded.window_months, area_tolerance = excluded.area_tolerance, latest_comp_date = excluded.latest_comp_date,
    is_flagship = excluded.is_flagship, computed_at = now();
  get diagnostics v_trades = row_count;

  insert into public.kr_auction_signals (item_id, lawd_cd, estimate_krw, discount, comparable_count, window_months, area_tolerance, latest_comp_date)
  with t as (
    select x.id, x.umd_name || '|' || x.jibun as ck, x.exclusive_area_m2 as a, x.deal_date as d,
           x.price_krw / x.exclusive_area_m2 / public.kr_floor_factor(x.floor) as ppm2
    from public.kr_apt_trades x
    where x.lawd_cd = p_lawd_cd and x.jibun is not null and not x.cancelled
      and x.deal_date >= (current_date - interval '12 months')::date and x.deal_date <= current_date
  ),
  a as (
    select i.id, i.emd || '|' || replace(i.jibun, ' ', '') as ck, i.building_area_m2 as a, i.min_bid_krw as p, i.floor_guess as f
    from public.kr_auction_items i
    where i.lawd_cd = p_lawd_cd and not i.share_only and i.min_bid_krw is not null and i.building_area_m2 > 0
      and i.jibun is not null and i.emd <> '' and i.last_seen_at >= now() - interval '3 days'
  ),
  v as (
    select x.id, x.p, w.cnt, w.months, w.tol, w.latest, c.cnt as widest,
           nullif(round(w.med::numeric * x.a * public.kr_floor_factor(x.f) / 10000) * 10000, 0) as est
    from a x
    left join lateral (
      select m.months, m.tol, count(*)::integer as cnt, percentile_cont(0.5) within group (order by y.ppm2) as med, max(y.d) as latest
      from (values (6, 0.03, 1), (6, 0.08, 2), (12, 0.03, 3), (12, 0.08, 4)) as m (months, tol, ord)
      join t y on y.ck = x.ck
        and y.d >= (current_date - make_interval(months => m.months))::date
        and abs(y.a - x.a) <= x.a * m.tol
      group by m.months, m.tol, m.ord
      having count(*) >= 3
      order by m.ord
      limit 1
    ) w on true
    left join lateral (select count(*)::integer as cnt from t y where y.ck = x.ck and abs(y.a - x.a) <= x.a * 0.08) c on true
  )
  select v.id, p_lawd_cd, v.est::bigint, case when v.est is null then null else round(1 - v.p / v.est, 4) end,
         coalesce(v.cnt, v.widest, 0), v.months, v.tol, v.latest
  from v
  on conflict (item_id) do update set
    estimate_krw = excluded.estimate_krw, discount = excluded.discount, comparable_count = excluded.comparable_count,
    window_months = excluded.window_months, area_tolerance = excluded.area_tolerance, latest_comp_date = excluded.latest_comp_date,
    computed_at = now();
  get diagnostics v_auctions = row_count;

  insert into public.kr_signal_state (lawd_cd, computed_at, trade_rows, auction_rows)
  values (p_lawd_cd, now(), v_trades, v_auctions)
  on conflict (lawd_cd) do update set computed_at = excluded.computed_at, trade_rows = excluded.trade_rows, auction_rows = excluded.auction_rows;
  return v_trades + v_auctions;
end;
$$;
revoke execute on function public.kr_refresh_signals(text) from public, anon, authenticated;

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
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.kr_refresh_due_signals(integer) from public, anon, authenticated;

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
  limit least(greatest(coalesce(p_limit, 300), 1), 500);
$$;
grant execute on function public.kr_search(text[], text[], text, text, bigint, bigint, numeric, numeric, numeric, integer, integer, double precision[], text, integer) to anon, authenticated;

create or replace function public.kr_umd_list(p_lawd_cd text)
returns table (umd_name text, trade_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.umd_name, count(*)
  from public.kr_apt_trades t
  where t.lawd_cd = p_lawd_cd and t.umd_name <> '' and t.deal_date >= (current_date - interval '12 months')::date
  group by t.umd_name
  order by t.umd_name;
$$;
grant execute on function public.kr_umd_list(text) to anon, authenticated;

-- Map pins also for complexes with deals at least 5% below market.
create or replace function public.kr_geo_todo(p_limit integer default 300)
returns table (key text, lawd_cd text, umd_name text, jibun text, kind text)
language sql
stable
security invoker
set search_path = ''
as $$
  with codes as (
    select array_agg(distinct t.lawd_cd order by t.lawd_cd) as a
    from public.kr_apt_trades t
    where t.deal_date >= (current_date - interval '12 months')::date
  ),
  chunks as (
    select codes.a[i:i + 59] as c from codes, generate_series(1, coalesce(array_length(codes.a, 1), 0), 60) as i
  ),
  f as (
    select f.lawd_cd, f.umd_name, f.jibun, 'flagship'::text as kind, 0 as pri
    from chunks, lateral public.kr_flagships(chunks.c) f
    where f.jibun is not null and f.umd_name <> ''
  ),
  a as (
    select distinct i.lawd_cd, i.emd as umd_name, i.jibun, 'auction'::text as kind, 1 as pri
    from public.kr_auction_items i
    where i.lawd_cd is not null and i.jibun is not null and i.emd <> ''
      and i.usage_small ilike '%아파트%'
      and i.last_seen_at >= now() - interval '3 days'
  ),
  d as (
    select distinct t.lawd_cd, t.umd_name, t.jibun, 'deal'::text as kind, 2 as pri
    from public.kr_trade_signals s
    join public.kr_apt_trades t on t.id = s.trade_id
    where s.discount >= 0.05 and t.jibun is not null and t.umd_name <> ''
  ),
  u as (
    select x.lawd_cd || '|' || x.umd_name || '|' || x.jibun as key, x.lawd_cd, x.umd_name, x.jibun, x.kind, x.pri
    from (select * from f union all select * from a union all select * from d) x
  )
  select d.key, d.lawd_cd, d.umd_name, d.jibun, d.kind
  from (
    select distinct on (u.key) u.key, u.lawd_cd, u.umd_name, u.jibun, u.kind, u.pri
    from u
    where not exists (select 1 from public.kr_geo g where g.key = u.key)
    order by u.key, u.pri
  ) d
  order by d.pri, d.key
  limit least(greatest(coalesce(p_limit, 300), 1), 2000);
$$;
revoke execute on function public.kr_geo_todo(integer) from public, anon, authenticated;

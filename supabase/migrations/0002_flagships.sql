-- 0002 대장 아파트: per 시군구, the complexes with the highest floor-normalized median
-- 원/m² over the last p_months, among those with at least p_min_deals deals.
-- Only complexes with a MOLIT apt_seq are ranked (it identifies the complex reliably).
-- The floor factors match floorFactor() in _shared/kr/valuation.ts (1층 0.93, 2층 0.97).

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
      t.apt_seq,
      t.apt_name,
      t.umd_name,
      t.jibun,
      t.build_year,
      t.deal_date,
      t.price_krw / t.exclusive_area_m2
        / case when t.floor <= 1 then 0.93 when t.floor = 2 then 0.97 else 1 end as ppm2
    from public.kr_apt_trades t
    where t.lawd_cd = any (p_lawd_codes[1:60])
      and t.apt_seq is not null
      and not t.cancelled
      and t.deal_date >= (current_date - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36)))::date
  ),
  c as (
    select
      t.lawd_cd,
      t.apt_seq,
      mode() within group (order by t.apt_name) as apt_name,
      mode() within group (order by t.umd_name) as umd_name,
      mode() within group (order by t.jibun) as jibun,
      max(t.build_year) as build_year,
      count(*) as deal_count,
      round(percentile_cont(0.5) within group (order by t.ppm2)::numeric) as median_price_per_m2,
      max(t.deal_date) as last_deal_date
    from t
    group by t.lawd_cd, t.apt_seq
    having count(*) >= greatest(coalesce(p_min_deals, 5), 1)
  ),
  r as (
    select c.*, row_number() over (partition by c.lawd_cd order by c.median_price_per_m2 desc, c.deal_count desc)::integer as rank
    from c
  )
  select r.lawd_cd, r.apt_seq, r.apt_name, r.umd_name, r.jibun, r.build_year, r.deal_count, r.median_price_per_m2, r.last_deal_date, r.rank
  from r
  where r.rank <= least(greatest(coalesce(p_per_region, 3), 1), 10)
  order by r.lawd_cd, r.rank;
$$;
grant execute on function public.kr_flagships(text[], integer, integer, integer) to anon, authenticated;

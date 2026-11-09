-- 0003 Map coordinates (네이버 지도).
--
-- * kr_geo: coordinates of an address, keyed "<LAWD_CD>|<법정동>|<지번>" so flagship
--   complexes (kr_flagships) and 공매 items (kr_auction_items) share one row per lot.
--   Filled by the geocode Edge Function with the NCP Geocoding API.
--   status 'not_found' rows are kept so the address is not looked up again.
-- * kr_geo_todo(): lots shown on the map that have no kr_geo row yet: flagships
--   of every 시군구 first, then current residential 공매 items. Service role only.

create table public.kr_geo (
  key text primary key check (char_length(key) between 7 and 120),
  address text not null check (char_length(address) <= 200),
  lat double precision check (lat is null or lat between 33 and 39),
  lng double precision check (lng is null or lng between 124 and 132),
  status text not null check (status in ('ok', 'not_found')),
  geocoded_at timestamptz not null default now(),
  check ((status = 'ok') = (lat is not null and lng is not null))
);
alter table public.kr_geo enable row level security;
create policy kr_geo_select_all on public.kr_geo for select using (true);
revoke insert, update, delete on public.kr_geo from anon, authenticated;

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
  u as (
    select x.lawd_cd || '|' || x.umd_name || '|' || x.jibun as key, x.lawd_cd, x.umd_name, x.jibun, x.kind, x.pri
    from (select * from f union all select * from a) x
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

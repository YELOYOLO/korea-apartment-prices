-- 0001 Mydream: Korean apartment prices (실거래가) and public auctions (온비드) vs. market.
-- Separate project from HomePick. Tables keep the kr_ names used by the shared code.
--
-- * app_settings: sync configuration (service role only).
-- * kr_apt_trades: 국토교통부 아파트 매매 실거래가, one row per reported deal (public read).
-- * kr_auction_items: 온비드 공매 residential items (public read).
-- * kr_sync_state: per-unit progress of the batched nationwide syncs (public read).
-- * kr_watch_listings: each member's own asking-price list (owner only, 200 per member).
-- * kr_complexes(): complexes with deals in a 시군구, for the add form.
-- Writes to the public-data tables come only from the sync Edge Function (service role).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value, description) values
  ('kr.trade_sync', '{"lawd_codes": "all", "months": 3, "backfill_months": 12, "calls_per_run": 60, "refresh_hours": 20}'::jsonb,
   '실거래가 sync: 시군구 codes ("all" or a list), months refreshed, months back-filled once, API calls per run, hours before a month is refetched'),
  ('kr.auction_sync', '{"sido": "all", "usage_mid": ["주거용건물"], "sido_per_run": 4, "refresh_hours": 20}'::jsonb,
   '온비드 sync: 시도 ("all" or a list), 용도 중분류 kept, 시도 per run, hours before a 시도 is refetched');

create table public.kr_apt_trades (
  id bigint generated always as identity primary key,
  source_key text not null unique check (char_length(source_key) between 1 and 300),
  lawd_cd text not null check (lawd_cd ~ '^\d{5}$'),
  apt_seq text,
  apt_name text not null check (char_length(apt_name) between 1 and 200),
  umd_name text not null default '',
  jibun text,
  apt_dong text,
  exclusive_area_m2 numeric(8, 2) not null check (exclusive_area_m2 > 0),
  price_krw bigint not null check (price_krw > 0),
  deal_date date not null,
  floor integer,
  build_year integer,
  dealing_type text,
  cancelled boolean not null default false,
  cancel_date date,
  fetched_at timestamptz not null default now()
);
create index kr_apt_trades_complex_idx on public.kr_apt_trades (lawd_cd, apt_seq, deal_date desc);
create index kr_apt_trades_name_idx on public.kr_apt_trades (lawd_cd, apt_name, deal_date desc);
create index kr_apt_trades_recent_idx on public.kr_apt_trades (lawd_cd, deal_date desc);
alter table public.kr_apt_trades enable row level security;
create policy kr_apt_trades_select_all on public.kr_apt_trades for select using (true);
revoke insert, update, delete on public.kr_apt_trades from anon, authenticated;

create table public.kr_auction_items (
  id bigint generated always as identity primary key,
  source_key text not null unique check (char_length(source_key) between 3 and 120),
  cltr_mng_no text not null,
  pbct_cdtn_no text not null,
  onbid_cltrno text not null default '',
  name text not null check (char_length(name) between 1 and 500),
  sido text not null default '',
  sgg text not null default '',
  emd text not null default '',
  jibun text,
  lawd_cd text check (lawd_cd is null or lawd_cd ~ '^\d{5}$'),
  usage_mid text,
  usage_small text,
  property_type text,
  appraisal_krw bigint check (appraisal_krw is null or appraisal_krw >= 0),
  min_bid_krw bigint check (min_bid_krw is null or min_bid_krw >= 0),
  min_bid_text text,
  fail_count integer not null default 0,
  bid_start timestamptz,
  bid_end timestamptz,
  status_code text,
  status_name text,
  private_contract boolean not null default false,
  building_area_m2 numeric(10, 2),
  land_area_m2 numeric(12, 3),
  eviction_by text,
  share_only boolean not null default false,
  floor_guess integer,
  thumbnail_url text check (thumbnail_url is null or thumbnail_url like 'https://www.onbid.co.kr/%'),
  detail_url text check (detail_url is null or detail_url like 'https://www.onbid.co.kr/%'),
  modified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index kr_auction_items_region_idx on public.kr_auction_items (sido, sgg, last_seen_at desc);
alter table public.kr_auction_items enable row level security;
create policy kr_auction_items_select_all on public.kr_auction_items for select using (true);
revoke insert, update, delete on public.kr_auction_items from anon, authenticated;

create table public.kr_sync_state (
  job text not null check (job in ('trades', 'auctions')),
  key text not null check (char_length(key) between 1 and 60),
  fetched_at timestamptz,
  row_count integer not null default 0,
  error text check (error is null or char_length(error) <= 500),
  attempted_at timestamptz not null default now(),
  primary key (job, key)
);
alter table public.kr_sync_state enable row level security;
create policy kr_sync_state_select_all on public.kr_sync_state for select using (true);
revoke insert, update, delete on public.kr_sync_state from anon, authenticated;

create table public.kr_watch_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lawd_cd text not null check (lawd_cd ~ '^\d{5}$'),
  complex_name text not null check (char_length(btrim(complex_name)) between 1 and 100),
  apt_seq text check (apt_seq is null or char_length(apt_seq) <= 40),
  umd_name text check (umd_name is null or char_length(umd_name) <= 40),
  exclusive_area_m2 numeric(8, 2) not null check (exclusive_area_m2 > 0 and exclusive_area_m2 < 1000),
  asking_price_krw bigint not null check (asking_price_krw between 1000000 and 1000000000000),
  floor integer check (floor is null or floor between -5 and 150),
  total_floors integer check (total_floors is null or total_floors between 1 and 150),
  title text check (title is null or char_length(title) <= 100),
  url text check (url is null or (char_length(url) <= 500 and url ~* '^https?://')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (floor is null or total_floors is null or floor <= total_floors)
);
create index kr_watch_listings_user_idx on public.kr_watch_listings (user_id, created_at desc);
create trigger kr_watch_listings_set_updated_at before update on public.kr_watch_listings
  for each row execute function public.set_updated_at();
alter table public.kr_watch_listings enable row level security;
create policy kr_watch_listings_select_own on public.kr_watch_listings for select to authenticated
  using (user_id = (select auth.uid()));
create policy kr_watch_listings_insert_own on public.kr_watch_listings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy kr_watch_listings_update_own on public.kr_watch_listings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy kr_watch_listings_delete_own on public.kr_watch_listings for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.kr_watch_listings from anon;

create or replace function public.kr_watch_listings_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.kr_watch_listings where user_id = new.user_id) >= 200 then
    raise exception 'kr.watchlistFull' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.kr_watch_listings_limit() from public, anon, authenticated;
create trigger kr_watch_listings_limit before insert on public.kr_watch_listings
  for each row execute function public.kr_watch_listings_limit();

create or replace function public.kr_complexes(p_lawd_cd text, p_months integer default 12)
returns table (
  apt_seq text,
  apt_name text,
  umd_name text,
  build_year integer,
  areas numeric[],
  trade_count bigint,
  last_deal_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.apt_seq,
    min(t.apt_name),
    min(t.umd_name),
    max(t.build_year),
    array_agg(distinct t.exclusive_area_m2 order by t.exclusive_area_m2),
    count(*),
    max(t.deal_date)
  from public.kr_apt_trades t
  where t.lawd_cd = p_lawd_cd
    and not t.cancelled
    and t.deal_date >= (current_date - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36)))::date
  group by t.apt_seq, case when t.apt_seq is null then t.umd_name || ':' || t.apt_name end
  order by count(*) desc, min(t.apt_name);
$$;
grant execute on function public.kr_complexes(text, integer) to anon, authenticated;

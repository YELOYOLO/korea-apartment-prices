-- 0006 AI 검색 사용량 제한.
-- kr_ai_take() counts one AI request for a client (a salted hash of its IP, never the IP
-- itself) and for the whole site, and says whether both are within their limits
-- (per client per hour, site-wide per day). Called by the ai-search Edge Function with
-- the service role; when it returns false the function answers with the rule-based
-- parser instead of calling the model. No policies: service role only.

create table public.kr_ai_usage (
  bucket text not null check (char_length(bucket) between 1 and 80),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.kr_ai_usage enable row level security;
revoke all on public.kr_ai_usage from anon, authenticated;

create or replace function public.kr_ai_take(p_client text, p_per_hour integer default 30, p_per_day integer default 1000)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_client integer;
  c_site integer;
begin
  insert into public.kr_ai_usage (bucket, window_start, count)
  values ('client:' || left(p_client, 64), date_trunc('hour', now()), 1)
  on conflict (bucket, window_start) do update set count = public.kr_ai_usage.count + 1
  returning count into c_client;
  insert into public.kr_ai_usage (bucket, window_start, count)
  values ('site', date_trunc('day', now()), 1)
  on conflict (bucket, window_start) do update set count = public.kr_ai_usage.count + 1
  returning count into c_site;
  return c_client <= p_per_hour and c_site <= p_per_day;
end;
$$;
revoke execute on function public.kr_ai_take(text, integer, integer) from public, anon, authenticated;

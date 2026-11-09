// kr_trades_sync: fetches 국토교통부 아파트 매매 실거래가 nationwide in bounded batches.
// Each run plans the most urgent (시군구, month) units from kr_sync_state (0001) with
// planTradeSync, fetches them until the call budget or time budget is used, upserts
// kr_apt_trades and records each unit. An hourly schedule covers all 시군구.
// Needs MOLIT_SERVICE_KEY (data.go.kr, decoded key); without it: configured: false.
// No Deno globals and no value imports (the MOLIT client and planner are passed in),
// so the root vitest/tsc can load it.
import type { AptTrade } from "./kr/molit.ts";
import type { SyncStateRow, TradeSyncConfig, TradeUnit } from "./kr/sync.ts";

interface DbError {
  code?: string;
  message: string;
}
type Res<T> = PromiseLike<{ data: T; error: DbError | null }>;
/** The part of the Supabase client the Korea syncs use. */
export interface KrTradesDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): Res<unknown[] | null> & { maybeSingle(): Res<{ value: unknown } | null> };
    };
    upsert(rows: object[], options: { onConflict: string }): PromiseLike<{ error: DbError | null }>;
  };
}
export interface MolitClient {
  fetchMolitAptTrades(p: { serviceKey: string; lawdCd: string; dealYmd: string }): Promise<AptTrade[]>;
  planTradeSync(cfg: TradeSyncConfig, state: SyncStateRow[], now: Date): TradeUnit[];
}

/** Errors that mean the key or service is wrong: stop instead of failing every unit. */
const FATAL = /MOLIT API error (12|20|22|30|31|32|33)\b/;

function toRow(t: AptTrade, fetchedAt: string) {
  return {
    source_key: t.sourceKey,
    lawd_cd: t.lawdCd,
    apt_seq: t.aptSeq,
    apt_name: t.aptName,
    umd_name: t.umdName,
    jibun: t.jibun,
    apt_dong: t.aptDong,
    exclusive_area_m2: t.exclusiveAreaM2,
    price_krw: t.priceKrw,
    deal_date: t.dealDate,
    floor: t.floor,
    build_year: t.buildYear,
    dealing_type: t.dealingType,
    cancelled: t.cancelled,
    cancel_date: t.cancelDate,
    fetched_at: fetchedAt,
  };
}

export async function readSyncState(db: KrTradesDb, job: "trades" | "auctions"): Promise<SyncStateRow[]> {
  const { data, error } = await db.from("kr_sync_state").select("key, fetched_at").eq("job", job);
  if (error) throw new Error(`kr_sync_state read failed: ${error.message}`);
  return ((data ?? []) as Array<{ key: string; fetched_at: string | null }>).map((r) => ({ key: r.key, fetchedAt: r.fetched_at }));
}

export async function readSetting<T>(db: KrTradesDb, key: string): Promise<T> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`${key} read failed: ${error.message}`);
  return (data?.value ?? {}) as T;
}

export async function syncKrTrades(
  db: KrTradesDb,
  molit: MolitClient,
  opts: { serviceKey: string | undefined; now?: Date; timeBudgetMs?: number; clock?: () => number },
) {
  const { serviceKey } = opts;
  if (!serviceKey) return { configured: false, upserted: 0 };
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? (() => Date.now());
  const deadline = clock() + (opts.timeBudgetMs ?? 110_000);
  const raw = await readSetting<Record<string, unknown>>(db, "kr.trade_sync");
  const cfg: TradeSyncConfig = {
    lawdCodes: raw.lawd_codes as TradeSyncConfig["lawdCodes"],
    months: raw.months as number | undefined,
    backfillMonths: raw.backfill_months as number | undefined,
    callsPerRun: raw.calls_per_run as number | undefined,
    refreshHours: raw.refresh_hours as number | undefined,
  };
  const plan = molit.planTradeSync(cfg, await readSyncState(db, "trades"), now);
  let upserted = 0;
  let done = 0;
  const failed: string[] = [];
  let streak = 0;
  for (const unit of plan) {
    if (clock() > deadline) break;
    const attemptedAt = new Date(clock()).toISOString();
    try {
      // One upsert may not touch the same key twice; identical reports collapse into one row.
      const trades = [...new Map((await molit.fetchMolitAptTrades({ serviceKey, lawdCd: unit.lawdCd, dealYmd: unit.dealYmd })).map((t) => [t.sourceKey, t])).values()];
      for (let i = 0; i < trades.length; i += 500) {
        const rows = trades.slice(i, i + 500).map((t) => toRow(t, attemptedAt));
        const { error: upErr } = await db.from("kr_apt_trades").upsert(rows, { onConflict: "source_key" });
        if (upErr) throw new Error(`kr_apt_trades upsert failed: ${upErr.code ?? ""} ${upErr.message}`);
      }
      const st = await db
        .from("kr_sync_state")
        .upsert([{ job: "trades", key: unit.key, fetched_at: attemptedAt, row_count: trades.length, error: null, attempted_at: attemptedAt }], { onConflict: "job,key" });
      if (st.error) throw new Error(`kr_sync_state write failed: ${st.error.message}`);
      upserted += trades.length;
      done++;
      streak = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (FATAL.test(message) || /kr_sync_state write failed|upsert failed/.test(message)) throw err;
      failed.push(unit.key);
      // fetched_at is left as it was, so the unit stays due.
      await db.from("kr_sync_state").upsert([{ job: "trades", key: unit.key, error: message.slice(0, 500), attempted_at: attemptedAt }], { onConflict: "job,key" });
      if (++streak >= 3) throw new Error(`stopped after 3 failures in a row; last: ${message}`);
    }
  }
  return { configured: true, planned: plan.length, done, failed, upserted };
}

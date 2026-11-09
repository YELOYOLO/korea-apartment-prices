import { recentDealMonths } from "./molit.ts";
import { KR_REGIONS, KR_SIDO } from "./regions.ts";

/**
 * Work planning for the nationwide syncs. One Edge Function run can't fetch
 * 256 시군구 x N months, so each run takes the most urgent units from the
 * recorded state (kr_sync_state) and an hourly schedule covers the country.
 * Pure TypeScript, used by the Next.js app and the Edge Functions.
 */

export interface SyncStateRow {
  key: string;
  fetchedAt: string | null;
}

export interface TradeSyncConfig {
  lawdCodes?: "all" | string[];
  /** Recent months refreshed every refreshHours (they still receive late reports). */
  months?: number;
  /** Older months fetched once. */
  backfillMonths?: number;
  callsPerRun?: number;
  refreshHours?: number;
}

export interface TradeUnit {
  key: string;
  lawdCd: string;
  dealYmd: string;
  reason: "new" | "refresh" | "backfill";
}

export function tradeSyncCodes(cfg: TradeSyncConfig): string[] {
  const codes = cfg.lawdCodes === undefined || cfg.lawdCodes === "all" ? KR_REGIONS.map((r) => r.code) : cfg.lawdCodes;
  return [...new Set(codes.filter((c) => /^\d{5}$/.test(c)))];
}

/**
 * Order: recent months never fetched, then recent months older than
 * refreshHours (stalest first), then back-fill months never fetched (newest
 * month first). At most callsPerRun units.
 */
export function planTradeSync(cfg: TradeSyncConfig, state: SyncStateRow[], now: Date): TradeUnit[] {
  const months = clamp(cfg.months ?? 3, 1, 12);
  const backfill = clamp(Math.max(cfg.backfillMonths ?? 12, months), months, 36);
  const limit = clamp(cfg.callsPerRun ?? 60, 1, 1000);
  const staleBefore = now.getTime() - clamp(cfg.refreshHours ?? 20, 1, 24 * 30) * 3600_000;
  const fetched = new Map(state.map((s) => [s.key, s.fetchedAt ? Date.parse(s.fetchedAt) : null]));
  const allMonths = recentDealMonths(now, backfill);
  const codes = tradeSyncCodes(cfg);
  const fresh: TradeUnit[] = [];
  const stale: Array<{ unit: TradeUnit; at: number }> = [];
  const old: TradeUnit[] = [];
  allMonths.forEach((ym, i) => {
    for (const lawdCd of codes) {
      const key = `${lawdCd}:${ym}`;
      const at = fetched.get(key) ?? null;
      if (i < months) {
        if (at === null) fresh.push({ key, lawdCd, dealYmd: ym, reason: "new" });
        else if (at < staleBefore) stale.push({ unit: { key, lawdCd, dealYmd: ym, reason: "refresh" }, at });
      } else if (at === null) {
        old.push({ key, lawdCd, dealYmd: ym, reason: "backfill" });
      }
    }
  });
  stale.sort((a, b) => a.at - b.at);
  return [...fresh, ...stale.map((x) => x.unit), ...old].slice(0, limit);
}

export interface AuctionSyncConfig {
  sido?: "all" | string[];
  usageMid?: string[];
  sidoPerRun?: number;
  refreshHours?: number;
}

/** 시도 never fetched first, then those older than refreshHours, stalest first. */
export function planAuctionSync(cfg: AuctionSyncConfig, state: SyncStateRow[], now: Date): string[] {
  const all = cfg.sido === undefined || cfg.sido === "all" ? [...KR_SIDO] : cfg.sido;
  const staleBefore = now.getTime() - clamp(cfg.refreshHours ?? 20, 1, 24 * 30) * 3600_000;
  const fetched = new Map(state.map((s) => [s.key, s.fetchedAt ? Date.parse(s.fetchedAt) : null]));
  const due = all
    .map((sido) => ({ sido, at: fetched.get(sido) ?? null }))
    .filter((x) => x.at === null || x.at < staleBefore)
    .sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
  return due.slice(0, clamp(cfg.sidoPerRun ?? 4, 1, 20)).map((x) => x.sido);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : lo, lo), hi);
}

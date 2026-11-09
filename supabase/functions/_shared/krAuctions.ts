// kr_auctions_sync: fetches 온비드 공매 부동산 items nationwide, a few 시도 per run
// (planAuctionSync over kr_sync_state), keeps the configured 용도 중분류
// (주거용건물) and upserts public.kr_auction_items. Readers treat a 시도's rows as current
// when they were seen by that 시도's latest sync.
// Uses ONBID_SERVICE_KEY, else MOLIT_SERVICE_KEY. Without a key: configured: false.
// No Deno globals and no value imports, so the root vitest/tsc can load it.
import type { OnbidItem } from "./kr/onbid.ts";
import type { AuctionSyncConfig, SyncStateRow } from "./kr/sync.ts";
import { readSetting, readSyncState, type KrTradesDb } from "./krTrades.ts";

export interface OnbidClient {
  fetchOnbidSido(p: { serviceKey: string; sido: string }): Promise<OnbidItem[]>;
  planAuctionSync(cfg: AuctionSyncConfig, state: SyncStateRow[], now: Date): string[];
}

const FATAL = /Onbid API error (12|20|22|30|31|32|33)\b/;

function toRow(i: OnbidItem, seenAt: string) {
  return {
    source_key: i.sourceKey,
    cltr_mng_no: i.cltrMngNo,
    pbct_cdtn_no: i.pbctCdtnNo,
    onbid_cltrno: i.onbidCltrno,
    name: i.name,
    sido: i.sido,
    sgg: i.sgg,
    emd: i.emd,
    jibun: i.jibun,
    lawd_cd: i.lawdCd,
    usage_mid: i.usageMid,
    usage_small: i.usageSmall,
    property_type: i.propertyType,
    appraisal_krw: i.appraisalKrw,
    min_bid_krw: i.minBidKrw,
    min_bid_text: i.minBidText,
    fail_count: i.failCount,
    bid_start: i.bidStart,
    bid_end: i.bidEnd,
    status_code: i.statusCode,
    status_name: i.statusName,
    private_contract: i.privateContract,
    building_area_m2: i.buildingAreaM2,
    land_area_m2: i.landAreaM2,
    eviction_by: i.evictionBy,
    share_only: i.shareOnly,
    floor_guess: i.floorGuess,
    thumbnail_url: i.thumbnailUrl,
    detail_url: i.detailUrl,
    modified_at: i.modifiedAt,
    last_seen_at: seenAt,
  };
}

export async function syncKrAuctions(
  db: KrTradesDb,
  onbid: OnbidClient,
  opts: { serviceKey: string | undefined; now?: Date; timeBudgetMs?: number; clock?: () => number },
) {
  const { serviceKey } = opts;
  if (!serviceKey) return { configured: false, upserted: 0 };
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? (() => Date.now());
  const deadline = clock() + (opts.timeBudgetMs ?? 110_000);
  const raw = await readSetting<Record<string, unknown>>(db, "kr.auction_sync");
  const cfg: AuctionSyncConfig = {
    sido: raw.sido as AuctionSyncConfig["sido"],
    usageMid: raw.usage_mid as string[] | undefined,
    sidoPerRun: raw.sido_per_run as number | undefined,
    refreshHours: raw.refresh_hours as number | undefined,
  };
  const keep = new Set(cfg.usageMid ?? ["주거용건물"]);
  const plan = onbid.planAuctionSync(cfg, await readSyncState(db, "auctions"), now);
  const result: Record<string, { fetched: number; kept: number } | { error: string }> = {};
  let upserted = 0;
  for (const sido of plan) {
    if (clock() > deadline) break;
    const seenAt = new Date(clock()).toISOString();
    try {
      const all = await onbid.fetchOnbidSido({ serviceKey, sido });
      const kept = all.filter((i) => keep.has(i.usageMid ?? ""));
      for (let k = 0; k < kept.length; k += 500) {
        const { error } = await db.from("kr_auction_items").upsert(kept.slice(k, k + 500).map((i) => toRow(i, seenAt)), { onConflict: "source_key" });
        if (error) throw new Error(`kr_auction_items upsert failed: ${error.code ?? ""} ${error.message}`);
      }
      const st = await db
        .from("kr_sync_state")
        .upsert([{ job: "auctions", key: sido, fetched_at: seenAt, row_count: kept.length, error: null, attempted_at: seenAt }], { onConflict: "job,key" });
      if (st.error) throw new Error(`kr_sync_state write failed: ${st.error.message}`);
      result[sido] = { fetched: all.length, kept: kept.length };
      upserted += kept.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (FATAL.test(message) || /kr_sync_state write failed|upsert failed/.test(message)) throw err;
      result[sido] = { error: message };
      await db.from("kr_sync_state").upsert([{ job: "auctions", key: sido, error: message.slice(0, 500), attempted_at: seenAt }], { onConflict: "job,key" });
    }
  }
  return { configured: true, planned: plan, result, upserted };
}

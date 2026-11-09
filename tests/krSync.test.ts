import { describe, expect, it } from "vitest";
import { KR_REGIONS, KR_SIDO } from "../supabase/functions/_shared/kr/regions.ts";
import { planAuctionSync, planTradeSync, tradeSyncCodes } from "../supabase/functions/_shared/kr/sync.ts";

const NOW = new Date("2026-11-09T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("planTradeSync", () => {
  it("covers every 시군구 by default", () => {
    expect(tradeSyncCodes({})).toHaveLength(KR_REGIONS.length);
    expect(tradeSyncCodes({ lawdCodes: ["11440", "11440", "bad"] })).toEqual(["11440"]);
  });

  it("new recent months first, then stale ones, then back-fill, within the call budget", () => {
    const cfg = { lawdCodes: ["11440", "11680"], months: 2, backfillMonths: 3, callsPerRun: 10, refreshHours: 20 };
    const state = [
      { key: "11440:202611", fetchedAt: hoursAgo(1) }, // fresh: skip
      { key: "11680:202611", fetchedAt: hoursAgo(30) }, // stale
      { key: "11440:202610", fetchedAt: hoursAgo(50) }, // staler
      { key: "11440:202609", fetchedAt: hoursAgo(500) }, // back-fill done: never refetched
    ];
    const plan = planTradeSync(cfg, state, NOW);
    expect(plan.map((u) => `${u.reason} ${u.key}`)).toEqual(["new 11680:202610", "refresh 11440:202610", "refresh 11680:202611", "backfill 11680:202609"]);
    expect(planTradeSync({ ...cfg, callsPerRun: 2 }, state, NOW)).toHaveLength(2);
  });

  it("is empty when everything is fresh", () => {
    const cfg = { lawdCodes: ["11440"], months: 1, backfillMonths: 1 };
    expect(planTradeSync(cfg, [{ key: "11440:202611", fetchedAt: hoursAgo(2) }], NOW)).toEqual([]);
  });
});

describe("planAuctionSync", () => {
  it("never-fetched 시도 first, then stalest, skipping fresh ones", () => {
    const state = KR_SIDO.map((s, i) => ({ key: s, fetchedAt: i < 2 ? null : hoursAgo(i === 2 ? 1 : 100 - i) }));
    const plan = planAuctionSync({ sidoPerRun: 4 }, state, NOW);
    expect(plan.slice(0, 2)).toEqual([KR_SIDO[0], KR_SIDO[1]]);
    expect(plan).not.toContain(KR_SIDO[2]);
    expect(plan[2]).toBe(KR_SIDO[3]); // 97 hours old: stalest of the rest
    expect(planAuctionSync({ sido: ["서울특별시"] }, [], NOW)).toEqual(["서울특별시"]);
  });
});

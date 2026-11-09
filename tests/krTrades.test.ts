import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchMolitAptTrades } from "../supabase/functions/_shared/kr/molit.ts";
import { planTradeSync } from "../supabase/functions/_shared/kr/sync.ts";
import { syncKrTrades } from "../supabase/functions/_shared/krTrades.ts";
import { fakeDb } from "./krFakeDb.ts";

const fixture = readFileSync(new URL("./fixtures/molit-apt-trade-mapo.xml", import.meta.url), "utf8");
type Fetch = Parameters<typeof fetchMolitAptTrades>[1];
const molit = (fetchFn: Fetch) => ({ fetchMolitAptTrades: (p: Parameters<typeof fetchMolitAptTrades>[0]) => fetchMolitAptTrades(p, fetchFn), planTradeSync });
const ok: Fetch = async () => ({ ok: true, status: 200, text: async () => fixture });
const NOW = new Date("2026-11-05T00:00:00Z");
const SETTINGS = { "kr.trade_sync": { lawd_codes: ["11440", "11680"], months: 2, backfill_months: 2, calls_per_run: 3 } };

describe("kr_trades_sync job", () => {
  it("does nothing without a service key", async () => {
    const { db, upserts } = fakeDb(SETTINGS);
    expect(await syncKrTrades(db, molit(ok), { serviceKey: undefined })).toEqual({ configured: false, upserted: 0 });
    expect(upserts).toHaveLength(0);
  });

  it("fetches the planned units within the call budget and records each one", async () => {
    const { db, of } = fakeDb(SETTINGS, [{ job: "trades", key: "11440:202611", fetched_at: "2026-11-04T23:00:00Z" }]);
    const urls: string[] = [];
    const r = await syncKrTrades(db, molit(async (u) => (urls.push(u), ok(u))), { serviceKey: "k", now: NOW });
    expect(urls.map((u) => `${new URL(u).searchParams.get("LAWD_CD")}:${new URL(u).searchParams.get("DEAL_YMD")}`)).toEqual(["11680:202611", "11440:202610", "11680:202610"]);
    expect(r).toMatchObject({ configured: true, planned: 3, done: 3, failed: [], upserted: 6 });
    expect(of("kr_apt_trades")[0]).toMatchObject({ apt_name: "마포테스트파크", price_krw: 1_700_000_000, cancelled: false });
    expect(of("kr_sync_state").map((s) => [s.key, s.row_count, s.error])).toEqual([["11680:202611", 2, null], ["11440:202610", 2, null], ["11680:202610", 2, null]]);
  });

  it("stops at the time budget", async () => {
    const { db } = fakeDb(SETTINGS);
    let t = 0;
    const r = await syncKrTrades(db, molit(ok), { serviceKey: "k", now: NOW, timeBudgetMs: 1000, clock: () => (t += 600) });
    expect(r).toMatchObject({ planned: 3, done: 1 });
  });

  it("records a failing unit and goes on, but stops on key errors", async () => {
    const { db, of } = fakeDb(SETTINGS);
    let n = 0;
    const flaky: Fetch = async (u) => (n++ === 0 ? { ok: false, status: 500, text: async () => "<resultCode>99</resultCode><resultMsg>SERVICE ERROR</resultMsg>" } : ok(u));
    const r = await syncKrTrades(db, molit(flaky), { serviceKey: "k", now: NOW });
    expect(r).toMatchObject({ done: 2, failed: ["11440:202611"] });
    expect(of("kr_sync_state")[0]).toMatchObject({ key: "11440:202611", error: expect.stringMatching(/99/) });
    expect(of("kr_sync_state")[0]).not.toHaveProperty("fetched_at");
    await expect(
      syncKrTrades(fakeDb(SETTINGS).db, molit(async () => ({ ok: false, status: 401, text: async () => "<returnReasonCode>30</returnReasonCode>" })), { serviceKey: "bad", now: NOW }),
    ).rejects.toThrow(/MOLIT API error 30/);
  });
});

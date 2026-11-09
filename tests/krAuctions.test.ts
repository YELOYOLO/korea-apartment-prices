import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchOnbidSido } from "../supabase/functions/_shared/kr/onbid.ts";
import { planAuctionSync } from "../supabase/functions/_shared/kr/sync.ts";
import { syncKrAuctions } from "../supabase/functions/_shared/krAuctions.ts";
import { fakeDb } from "./krFakeDb.ts";

const fixture = readFileSync(new URL("./fixtures/onbid-rlst-seoul.json", import.meta.url), "utf8");
const onbid = (body: string | ((sido: string) => string), status = 200) => ({
  fetchOnbidSido: (p: { serviceKey: string; sido: string }) =>
    fetchOnbidSido(p, async () => ({ status, text: async () => (typeof body === "function" ? body(p.sido) : body) })),
  planAuctionSync,
});
const SETTINGS = { "kr.auction_sync": { sido: ["서울특별시", "부산광역시"], usage_mid: ["주거용건물"], sido_per_run: 4 } };

describe("kr_auctions_sync job", () => {
  it("does nothing without a key", async () => {
    const { db, upserts } = fakeDb(SETTINGS);
    expect(await syncKrAuctions(db, onbid(fixture), { serviceKey: undefined })).toEqual({ configured: false, upserted: 0 });
    expect(upserts).toHaveLength(0);
  });

  it("fetches each planned 시도, keeps residential items with lawd_cd, and records the 시도", async () => {
    const { db, of } = fakeDb(SETTINGS);
    const r = await syncKrAuctions(db, onbid(fixture), { serviceKey: "k", now: new Date("2026-11-09T01:00:00Z"), clock: () => Date.parse("2026-11-09T01:00:00Z") });
    expect(r).toMatchObject({ configured: true, planned: ["서울특별시", "부산광역시"], upserted: 2 });
    expect(r.result).toEqual({ 서울특별시: { fetched: 2, kept: 1 }, 부산광역시: { fetched: 2, kept: 1 } });
    expect(of("kr_auction_items")[0]).toMatchObject({ source_key: "2026-0100-000001|5000001", lawd_cd: "11440", jibun: "1", last_seen_at: "2026-11-09T01:00:00.000Z" });
    expect(of("kr_auction_items")[0]).not.toHaveProperty("first_seen_at");
    expect(of("kr_sync_state").map((s) => [s.key, s.row_count])).toEqual([["서울특별시", 1], ["부산광역시", 1]]);
  });

  it("records a 시도 that fails and goes on; stops on key errors", async () => {
    const { db, of } = fakeDb(SETTINGS);
    const r = await syncKrAuctions(db, onbid((sido) => (sido === "서울특별시" ? '{"header":{"resultCode":"99","resultMsg":"ERR"}}' : fixture)), { serviceKey: "k" });
    expect(r.result).toMatchObject({ 서울특별시: { error: expect.stringMatching(/99/) }, 부산광역시: { kept: 1 } });
    expect(of("kr_sync_state")[0]).not.toHaveProperty("fetched_at");
    await expect(syncKrAuctions(fakeDb(SETTINGS).db, onbid('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"30"}}}', 401), { serviceKey: "bad" })).rejects.toThrow(/Onbid API error 30/);
  });
});

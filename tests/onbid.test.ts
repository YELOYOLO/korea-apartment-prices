import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AptTrade } from "../supabase/functions/_shared/kr/molit.ts";
import { fetchOnbidSido, floorFromName, isApartment, jibunFromPnu, onbidDate, onbidListUrl, parseOnbidList, type OnbidItem } from "../supabase/functions/_shared/kr/onbid.ts";
import { auctionTier, sortAuctionValuations, valueAuctionItem } from "../supabase/functions/_shared/kr/auction.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/onbid-rlst-seoul.json", import.meta.url), "utf8"));

describe("Onbid list parsing", () => {
  it("maps rows, computes 지번 and dates, keeps text prices and drops rows without keys", () => {
    const r = parseOnbidList(fixture);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.skipped).toBe(1);
    const [apt, shop] = r.items as [OnbidItem, OnbidItem];
    expect(apt).toMatchObject({
      sourceKey: "2026-0100-000001|5000001", sgg: "마포구", emd: "아현동", jibun: "1", lawdCd: "11440", usageSmall: "아파트",
      appraisalKrw: 1_600_000_000, minBidKrw: 1_120_000_000, minBidText: null, failCount: 2,
      bidEnd: "2026-11-11T17:00:00+09:00", privateContract: false, buildingAreaM2: 84.59, evictionBy: "매수자", shareOnly: false, floorGuess: 12,
      thumbnailUrl: "https://www.onbid.co.kr/op/cm/syc/filemng/x.jpg", modifiedAt: "2026-11-05T10:14:19+09:00",
    });
    expect(apt.detailUrl).toBe("https://www.onbid.co.kr/op/cltrpbancinf/cltrdtl/CltrDtlController/mvmnCltrDtl.do?onbidCltrno=1800001&onbidPbancNo=760001&pbctNo=9800001&pbctCdtnNo=5000001");
    expect(isApartment(apt)).toBe(true);
    expect(shop).toMatchObject({ jibun: "산5-3", appraisalKrw: null, minBidKrw: null, minBidText: "비공개", bidStart: null, bidEnd: null, shareOnly: true, privateContract: true, thumbnailUrl: null });
    expect(parseOnbidList({ header: { resultCode: "00" }, body: { items: [{ ...fixture.body.items.item[0], pbctNo: "" }] } }).items[0]?.detailUrl).toBeNull();
    expect(isApartment(shop)).toBe(false);
  });

  it("accepts a single object in items.item and reads both error envelopes", () => {
    const one = { header: { resultCode: "00" }, body: { items: { item: fixture.body.items.item[0] }, totalCount: 1 } };
    expect(parseOnbidList(one).items).toHaveLength(1);
    const svc = parseOnbidList({ header: { resultCode: "03", resultMsg: "NODATA_ERROR" }, body: {} });
    expect(svc).toMatchObject({ ok: false, resultCode: "03", resultMsg: "NODATA_ERROR" });
    const gw = parseOnbidList({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnReasonCode: "30" } } });
    expect(gw).toMatchObject({ ok: false, resultCode: "30" });
  });

  it("helpers", () => {
    expect(jibunFromPnu("1144010100100720022")).toBe("72-22");
    expect(jibunFromPnu("123")).toBeNull();
    expect(onbidDate("299901021000")).toBeNull();
    expect(onbidDate("202611111700")).toBe("2026-11-11T17:00:00+09:00");
    expect(floorFromName("서울 마포구 아현동 1 101동 제12층 제1203호")).toBe(12);
    expect(floorFromName("… 101동 803호")).toBe(8);
    expect(floorFromName("… B01호")).toBeNull();
    const url = onbidListUrl({ serviceKey: "a+b", pvct: "N", sido: "서울특별시" });
    expect(url).toContain("/OnbidRlstListSrvc2/getRlstCltrList2?serviceKey=a%2Bb&");
    expect(new URL(url).searchParams.get("lctnSdnm")).toBe("서울특별시");
    expect(new URL(url).searchParams.get("pvctTrgtYn")).toBe("N");
  });

  it("fetches both 수의계약 groups and fails on errors", async () => {
    const seen: string[] = [];
    const items = await fetchOnbidSido({ serviceKey: "k", sido: "서울특별시" }, async (u) => {
      seen.push(new URL(u).searchParams.get("pvctTrgtYn") as string);
      return { status: 200, text: async () => JSON.stringify(fixture) };
    });
    expect(seen).toEqual(["N", "Y"]);
    expect(items).toHaveLength(2); // same rows in both groups collapse by key
    await expect(fetchOnbidSido({ serviceKey: "k", sido: "서울특별시" }, async () => ({ status: 401, text: async () => '{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"30"}}}' }))).rejects.toThrow(/30/);
    await expect(fetchOnbidSido({ serviceKey: "k", sido: "서울특별시" }, async () => ({ status: 500, text: async () => "<html>" }))).rejects.toThrow(/non-JSON/);
  });
});

const NOW = new Date("2026-11-09T00:00:00Z");
let n = 0;
const trade = (over: Partial<AptTrade>): AptTrade => ({
  sourceKey: `k${n++}`, lawdCd: "11440", aptSeq: "11440-1", aptName: "마포테스트파크", umdName: "아현동", jibun: "1", aptDong: null,
  exclusiveAreaM2: 84.59, priceKrw: 1_700_000_000, dealDate: "2026-10-01", floor: 10, buildYear: 2014, dealingType: "중개거래",
  cancelled: false, cancelDate: null, ...over,
});
const trades = [trade({}), trade({ priceKrw: 1_680_000_000 }), trade({ priceKrw: 1_720_000_000 }), trade({ jibun: "2", priceKrw: 900_000_000 })];

describe("auction valuation", () => {
  const apt = parseOnbidList(fixture).items[0] as OnbidItem;

  it("finds the complex by 법정동 + 지번 and compares the minimum bid", () => {
    const v = valueAuctionItem(apt, trades, { now: NOW });
    expect(v.estimate?.comparables).toHaveLength(3);
    expect(v.estimate?.estimatedValueKrw).toBe(1_700_000_000);
    expect(v.ratio).toBeCloseTo(1_120 / 1_700, 4);
    expect(v.tier).toBe("DEEP");
    expect(v.appraisalRatio).toBeCloseTo(0.7, 4);
    expect(v.warnings).toEqual(["evictionByBuyer", "failedBefore"]);
  });

  it("gives no value without area, price, 지번 or deals", () => {
    expect(valueAuctionItem({ ...apt, minBidKrw: null }, trades, { now: NOW }).tier).toBe("NO_DATA");
    expect(valueAuctionItem({ ...apt, jibun: "9" }, trades, { now: NOW })).toMatchObject({ tier: "NO_DATA", comparableCount: 0 });
    // A share's price is not comparable with whole-unit deals.
    expect(valueAuctionItem({ ...apt, shareOnly: true }, trades, { now: NOW })).toMatchObject({ tier: "SHARE", ratio: null, estimate: null });
  });

  it("tiers and sorting", () => {
    expect([0.6, 0.7, 0.8, 0.95, 1.1].map(auctionTier)).toEqual(["DEEP", "DEEP", "BELOW", "NEAR", "ABOVE"]);
    const a = valueAuctionItem({ ...apt, sourceKey: "a", minBidKrw: 1_500_000_000, bidEnd: "2026-11-20T17:00:00+09:00" }, trades, { now: NOW });
    const b = valueAuctionItem({ ...apt, sourceKey: "b", bidEnd: "2026-11-30T17:00:00+09:00", failCount: 5 }, trades, { now: NOW });
    const c = valueAuctionItem({ ...apt, sourceKey: "c", jibun: "9", bidEnd: "2026-11-10T17:00:00+09:00" }, trades, { now: NOW });
    expect(sortAuctionValuations([a, b, c], "ratio").map((v) => v.item.sourceKey)).toEqual(["b", "a", "c"]);
    expect(sortAuctionValuations([a, b, c], "bidEnd").map((v) => v.item.sourceKey)).toEqual(["c", "a", "b"]);
    expect(sortAuctionValuations([a, b, c], "failCount").map((v) => v.item.sourceKey)).toEqual(["b", "a", "c"]);
  });
});

describe("regions", () => {
  it("lists every 시군구 once, by 일반구 where a 시 has them", async () => {
    const { KR_REGIONS, KR_SIDO, krRegionLabel } = await import("../supabase/functions/_shared/kr/regions.ts");
    expect(new Set(KR_REGIONS.map((r) => r.code)).size).toBe(KR_REGIONS.length);
    expect(KR_REGIONS.every((r) => /^\d{5}$/.test(r.code) && KR_SIDO.includes(r.sido))).toBe(true);
    expect(krRegionLabel("11440")).toBe("서울특별시 마포구");
    expect(krRegionLabel("36110")).toBe("세종특별자치시");
    expect(KR_REGIONS.some((r) => r.code === "41110")).toBe(false); // 수원시: its 구 instead
    expect(KR_REGIONS.some((r) => r.code === "41111")).toBe(true);
  });
});

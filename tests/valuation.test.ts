import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fetchMolitAptTrades,
  molitAptTradeUrl,
  parseMolitAptTradeXml,
  parseMolitDate,
  recentDealMonths,
  type AptTrade,
} from "../supabase/functions/_shared/kr/molit.ts";
import {
  discountTier,
  estimateMarketValue,
  floorFactor,
  formatKrwShort,
  normalizeComplexName,
  recommendBelowMarket,
  sortKrValuations,
  valueListing,
  type KrSaleListing,
} from "../supabase/functions/_shared/kr/valuation.ts";

const fixture = readFileSync(new URL("./fixtures/molit-apt-trade-mapo.xml", import.meta.url), "utf8");

describe("MOLIT apartment trade parsing", () => {
  it("reads deals, prices in 만원, cancellations and skips unreadable items", () => {
    const r = parseMolitAptTradeXml(fixture);
    expect(r.ok).toBe(true);
    expect(r.totalCount).toBe(3);
    expect(r.items).toHaveLength(2);
    expect(r.skipped).toBe(1);
    const [a, b] = r.items as [AptTrade, AptTrade];
    expect(a).toMatchObject({
      aptName: "마포테스트파크", aptSeq: "11440-1001", umdName: "아현동", lawdCd: "11440", aptDong: "101",
      exclusiveAreaM2: 84.59, priceKrw: 1_700_000_000, dealDate: "2026-09-03", floor: 12, buildYear: 2014,
      dealingType: "중개거래", cancelled: false, cancelDate: null,
    });
    expect(b.cancelled).toBe(true);
    expect(b.cancelDate).toBe("2026-09-20");
    expect(a.sourceKey).not.toBe(b.sourceKey);
  });

  it("keeps the same source key when a deal is re-fetched after being cancelled", () => {
    const before = parseMolitAptTradeXml(fixture).items[1] as AptTrade;
    const after = parseMolitAptTradeXml(fixture.replace("<cdealType>O</cdealType>", "<cdealType> </cdealType>")).items[1] as AptTrade;
    expect(after.cancelled).toBe(false);
    expect(after.sourceKey).toBe(before.sourceKey);
  });

  it("reports an unregistered key as an error, not as zero deals", () => {
    const r = parseMolitAptTradeXml(
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg><returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
    );
    expect(r.ok).toBe(false);
    expect(r.resultCode).toBe("30");
    expect(r.items).toEqual([]);
  });

  it("builds the request URL and month list", () => {
    const url = molitAptTradeUrl({ serviceKey: "a+b/c=", lawdCd: "11440", dealYmd: "202609" });
    expect(url).toContain("serviceKey=a%2Bb%2Fc%3D");
    expect(url).toContain("LAWD_CD=11440&DEAL_YMD=202609");
    expect(() => molitAptTradeUrl({ serviceKey: "k", lawdCd: "1144", dealYmd: "202609" })).toThrow();
    // 2026-01-31 20:00 UTC is already February 1st in Seoul.
    expect(recentDealMonths(new Date("2026-01-31T20:00:00Z"), 3)).toEqual(["202602", "202601", "202512"]);
    expect(parseMolitDate("2026.01.05")).toBe("2026-01-05");
  });

  it("pages through results and throws on API errors", async () => {
    const calls: string[] = [];
    const items = await fetchMolitAptTrades({ serviceKey: "k", lawdCd: "11440", dealYmd: "202609" }, async (u) => {
      calls.push(u);
      return { ok: true, status: 200, text: async () => fixture };
    });
    expect(items).toHaveLength(2);
    expect(calls).toHaveLength(1);
    await expect(
      fetchMolitAptTrades({ serviceKey: "k", lawdCd: "11440", dealYmd: "202609" }, async () => ({
        ok: false, status: 403, text: async () => "<returnReasonCode>30</returnReasonCode><returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg>",
      })),
    ).rejects.toThrow(/30/);
  });
});

const NOW = new Date("2026-11-01T00:00:00Z");
let n = 0;
const trade = (over: Partial<AptTrade>): AptTrade => ({
  sourceKey: `k${n++}`, lawdCd: "11440", aptSeq: "11440-1", aptName: "마포테스트파크", umdName: "아현동", jibun: "1", aptDong: null,
  exclusiveAreaM2: 84.9, priceKrw: 1_500_000_000, dealDate: "2026-10-01", floor: 10, buildYear: 2014, dealingType: "중개거래",
  cancelled: false, cancelDate: null, ...over,
});
const listing = (over: Partial<KrSaleListing>): KrSaleListing => ({
  id: "L1", complexName: "마포 테스트 파크 아파트", umdName: "아현동", exclusiveAreaM2: 84.9, askingPriceKrw: 1_350_000_000, floor: 10, totalFloors: 25, ...over,
});
const comps = [
  trade({ priceKrw: 1_480_000_000, dealDate: "2026-10-10" }),
  trade({ priceKrw: 1_500_000_000, dealDate: "2026-09-10" }),
  trade({ priceKrw: 1_520_000_000, dealDate: "2026-08-10" }),
];

describe("market value from 실거래가", () => {
  it("normalizes complex names", () => {
    expect(normalizeComplexName("마포 테스트 파크 아파트")).toBe(normalizeComplexName("마포테스트파크"));
    expect(normalizeComplexName("e편한세상(1단지)")).toBe("e편한세상1단지");
  });

  it("uses the median of same-complex, same-size, recent, uncancelled deals", () => {
    const pool = [
      ...comps,
      trade({ priceKrw: 3_000_000_000, cancelled: true }), // cancelled
      trade({ priceKrw: 900_000_000, exclusiveAreaM2: 59.9 }), // other size
      trade({ priceKrw: 1_000_000_000, aptName: "다른단지", aptSeq: "11440-2" }), // other complex
      trade({ priceKrw: 1_000_000_000, dealDate: "2025-01-01" }), // too old
    ];
    const { estimate } = estimateMarketValue(listing({}), pool, { now: NOW });
    expect(estimate?.comparables).toHaveLength(3);
    expect(estimate?.estimatedValueKrw).toBe(1_500_000_000);
    expect(estimate?.windowMonths).toBe(6);
    expect(estimate?.latestDealDate).toBe("2026-10-10");
  });

  it("matches by aptSeq when both sides have it, even if the names differ", () => {
    const { estimate } = estimateMarketValue(listing({ complexName: "광고용 이름", aptSeq: "11440-1" }), comps, { now: NOW });
    expect(estimate?.comparables).toHaveLength(3);
  });

  it("widens to 12 months, and gives no value under 3 deals", () => {
    const older = comps.map((t, i) => ({ ...t, dealDate: `2026-0${i + 1}-15` }));
    const v = valueListing(listing({}), older, { now: NOW });
    expect(v.estimate?.windowMonths).toBe(12);
    expect(v.reasons.map((r) => r.code)).toContain("staleComparables");
    const few = valueListing(listing({}), comps.slice(0, 2), { now: NOW });
    expect(few.tier).toBe("INSUFFICIENT_DATA");
    expect(few.comparableCount).toBe(2);
  });

  it("adjusts for floors on both sides", () => {
    expect(floorFactor(1)).toBe(0.93);
    expect(floorFactor(25, 25)).toBe(0.97);
    expect(floorFactor(null)).toBe(1);
    // A 1st-floor listing is compared with a 1st-floor value: 1.5억 x 0.93.
    const v = valueListing(listing({ floor: 1, askingPriceKrw: 1_395_000_000 }), comps, { now: NOW });
    expect(v.estimate?.estimatedValueKrw).toBe(1_395_000_000);
    expect(v.tier).toBe("AT_MARKET");
    expect(v.reasons.map((r) => r.code)).toContain("lowFloor");
  });

  it("assigns tiers at the documented thresholds", () => {
    expect(discountTier(0.3)).toBe("SUSPICIOUS");
    expect(discountTier(0.2)).toBe("CHECK_REASON");
    expect(discountTier(0.1)).toBe("RECOMMENDED");
    expect(discountTier(0.05)).toBe("RECOMMENDED");
    expect(discountTier(0)).toBe("AT_MARKET");
    expect(discountTier(-0.1)).toBe("ABOVE_MARKET");
  });
});

describe("recommendBelowMarket", () => {
  it("ranks plausible discounts first, flags large ones, and holds back suspicious ones", () => {
    const r = recommendBelowMarket(
      [
        listing({ id: "at", askingPriceKrw: 1_500_000_000 }),
        listing({ id: "ten", askingPriceKrw: 1_350_000_000 }),
        listing({ id: "six", askingPriceKrw: 1_410_000_000 }),
        listing({ id: "twenty", askingPriceKrw: 1_200_000_000 }),
        listing({ id: "bait", askingPriceKrw: 900_000_000 }),
        listing({ id: "above", askingPriceKrw: 1_700_000_000 }),
        listing({ id: "nodata", complexName: "없는단지" }),
      ],
      comps,
      { now: NOW },
    );
    expect(r.recommended.map((v) => v.listing.id)).toEqual(["ten", "six", "twenty"]);
    expect(r.recommended[0]?.reasons[0]).toEqual({ code: "belowMarket", params: { pct: 10, count: 3 } });
    expect(r.recommended[2]?.reasons.map((x) => x.code)).toContain("checkWhyCheap");
    expect(r.others.map((v) => v.listing.id)).toEqual(["at", "above", "nodata"]);
    expect(r.review.map((v) => v.listing.id)).toEqual(["bait"]);
    expect(r.limitations).toContain("kr.limitation.registryNotChecked");
  });

  it("formats KRW in 억/만", () => {
    expect(formatKrwShort(1_250_000_000)).toBe("12억 5,000만");
    expect(formatKrwShort(1_500_000_000)).toBe("15억");
    expect(formatKrwShort(80_000_000)).toBe("8,000만");
  });
});

describe("sortKrValuations", () => {
  const vals = [
    listing({ id: "above", askingPriceKrw: 1_700_000_000 }),
    listing({ id: "bait", askingPriceKrw: 900_000_000 }),
    listing({ id: "twenty", askingPriceKrw: 1_200_000_000 }),
    listing({ id: "ten", askingPriceKrw: 1_350_000_000, exclusiveAreaM2: 84.9 }),
    listing({ id: "small", askingPriceKrw: 1_000_000_000, exclusiveAreaM2: 59.9 }),
  ].map((l) => valueListing(l, comps, { now: NOW }));
  const ids = (s: Parameters<typeof sortKrValuations>[1], created?: (v: (typeof vals)[number]) => string) =>
    sortKrValuations(vals, s, created).map((v) => v.listing.id);

  it("orders by tier, by discount (suspicious last), by asking 원/m² and by creation time", () => {
    expect(ids("recommended")).toEqual(["ten", "twenty", "above", "small", "bait"]);
    expect(ids("discount")).toEqual(["twenty", "ten", "above", "small", "bait"]);
    expect(ids("pricePerM2")).toEqual(["bait", "twenty", "ten", "small", "above"]);
    const order = ["bait", "ten", "small", "above", "twenty"];
    expect(ids("newest", (v) => String(order.indexOf(v.listing.id)))).toEqual(["twenty", "above", "small", "ten", "bait"]);
  });
});

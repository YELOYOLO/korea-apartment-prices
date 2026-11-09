import { describe, expect, it } from "vitest";
import type { AptTrade } from "../supabase/functions/_shared/kr/molit.ts";
import { findBargainDeals, listingSearchLinks } from "../supabase/functions/_shared/kr/bargains.ts";

const now = new Date("2026-11-09T00:00:00Z");
let n = 0;
function deal(p: Partial<AptTrade> & { priceKrw: number; dealDate: string }): AptTrade {
  n++;
  return {
    sourceKey: `k${n}`,
    lawdCd: "11680",
    aptSeq: "11680-1",
    aptName: "대장파크",
    umdName: "대치동",
    jibun: "1",
    aptDong: null,
    exclusiveAreaM2: 84.9,
    floor: 10,
    buildYear: 2015,
    dealingType: "중개거래",
    cancelled: false,
    cancelDate: null,
    ...p,
  };
}

const market = [
  deal({ priceKrw: 3_000_000_000, dealDate: "2026-08-10" }),
  deal({ priceKrw: 3_050_000_000, dealDate: "2026-09-02" }),
  deal({ priceKrw: 2_950_000_000, dealDate: "2026-09-20" }),
  deal({ priceKrw: 3_000_000_000, dealDate: "2026-10-05" }),
];

describe("findBargainDeals", () => {
  it("keeps a recent deal 15%+ below the other deals of its complex", () => {
    const cheap = deal({ priceKrw: 2_400_000_000, dealDate: "2026-10-28" });
    const r = findBargainDeals([...market, cheap], { now });
    expect(r).toHaveLength(1);
    expect(r[0]!.trade.sourceKey).toBe(cheap.sourceKey);
    expect(r[0]!.discount).toBeCloseTo(0.2, 2);
    expect(r[0]!.warnings).toEqual([]);
    // the cheap deal is not one of its own comparables
    expect(r[0]!.estimate.comparables.map((c) => c.sourceKey)).not.toContain(cheap.sourceKey);
  });

  it("ignores deals near market, old deals, cancelled deals and other areas", () => {
    const r = findBargainDeals(
      [
        ...market,
        deal({ priceKrw: 2_700_000_000, dealDate: "2026-10-28" }), // 10% below
        deal({ priceKrw: 2_000_000_000, dealDate: "2026-06-01" }), // older than 90 days
        deal({ priceKrw: 2_000_000_000, dealDate: "2026-10-30", cancelled: true }),
        deal({ priceKrw: 1_500_000_000, dealDate: "2026-10-30", exclusiveAreaM2: 59.9 }), // no comparables
      ],
      { now },
    );
    expect(r).toEqual([]);
  });

  it("warns about 직거래, very large discounts and low floors", () => {
    const r = findBargainDeals([...market, deal({ priceKrw: 1_800_000_000, dealDate: "2026-11-01", dealingType: "직거래", floor: 1 })], { now });
    expect(r[0]!.warnings).toEqual(["directDeal", "veryCheap", "lowFloor"]);
  });

  it("does not compare deals of different complexes", () => {
    const other = deal({ aptSeq: "11680-2", aptName: "옆단지", priceKrw: 1_000_000_000, dealDate: "2026-10-28" });
    expect(findBargainDeals([...market, other], { now })).toEqual([]);
  });
});

describe("listingSearchLinks", () => {
  it("builds Naver and KB search links", () => {
    const l = listingSearchLinks({ aptName: "래미안 대치팰리스", umdName: "대치동" }, "강남구");
    expect(l.naver).toBe(`https://search.naver.com/search.naver?query=${encodeURIComponent("강남구 대치동 래미안 대치팰리스 매매")}`);
    expect(l.kb).toContain("kbland.kr");
  });
});

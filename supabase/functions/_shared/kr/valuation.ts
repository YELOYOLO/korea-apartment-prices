import type { AptTrade } from "./molit.ts";

/**
 * "시세 대비 저렴한 매물" for Korean apartment sales, based on 국토교통부 실거래가.
 *
 * For each listing (asking price) we pick comparable reported deals:
 *   same complex (MOLIT aptSeq, or the normalized complex name + 법정동),
 *   similar 전용면적 (±3%, widened to ±8%), recent (6 months, widened to 12),
 *   not cancelled. At least 3 deals are needed or no market value is given.
 * Each deal's 원/m² is normalized for its floor, the median is taken, scaled
 * to the listing's area and adjusted for the listing's floor. Then
 *   discount = 1 - asking / estimated value
 * decides the tier. A very large discount is treated as a listing to check
 * (bait listing or a defect), not as the best recommendation.
 */

export interface KrSaleListing {
  id: string;
  /** 단지명 as the listing shows it ("마포래미안푸르지오"). */
  complexName: string;
  /** MOLIT complex id when known; it matches more reliably than the name. */
  aptSeq?: string | null;
  /** 법정동 ("아현동"); narrows name matches. */
  umdName?: string | null;
  /** 지번 ("72-22"); with umdName it identifies the complex when there is no aptSeq (auction items). */
  jibun?: string | null;
  /** 전용면적, m². */
  exclusiveAreaM2: number;
  /** 호가, KRW. */
  askingPriceKrw: number;
  floor?: number | null;
  totalFloors?: number | null;
  title?: string | null;
  url?: string | null;
}

export type DiscountTier =
  | "RECOMMENDED" // 5-15% below market
  | "CHECK_REASON" // 15-25% below: recommend, but ask why it is cheap
  | "AT_MARKET" // within ±5%
  | "ABOVE_MARKET" // more than 5% above
  | "SUSPICIOUS" // more than 25% below: send to review, do not recommend
  | "INSUFFICIENT_DATA"; // fewer than 3 comparable deals

export const DISCOUNT_THRESHOLDS = { atMarket: 0.05, checkReason: 0.15, suspicious: 0.25 } as const;

export interface ValuationOptions {
  now?: Date;
  /** Tried in order until enough comparables are found. */
  windowsMonths?: number[];
  /** Relative 전용면적 tolerance, tried in order. */
  areaTolerances?: number[];
  minComparables?: number;
}

export interface MarketEstimate {
  comparables: AptTrade[];
  windowMonths: number;
  areaTolerance: number;
  /** Median floor-normalized 원/m² of the comparables. */
  medianPricePerM2: number;
  /** Value for the listing's area and floor, KRW. */
  estimatedValueKrw: number;
  floorFactor: number;
  minPriceKrw: number;
  maxPriceKrw: number;
  latestDealDate: string;
}

export type KrReasonCode = "belowMarket" | "checkWhyCheap" | "suspiciousDiscount" | "aboveMarket" | "fewComparables" | "lowFloor" | "topFloor" | "staleComparables";

export interface KrReason {
  code: KrReasonCode;
  params?: Record<string, string | number>;
}

export interface KrValuation {
  listing: KrSaleListing;
  tier: DiscountTier;
  /** 1 - asking / estimate; positive = cheaper than market. Null without an estimate. */
  discount: number | null;
  estimate: MarketEstimate | null;
  /** Comparables found in the widest window, even when too few to value. */
  comparableCount: number;
  reasons: KrReason[];
}

export interface KrRecommendationResult {
  /** RECOMMENDED then CHECK_REASON, largest discount first. */
  recommended: KrValuation[];
  /** Everything else, in display order: AT_MARKET, ABOVE_MARKET, INSUFFICIENT_DATA. */
  others: KrValuation[];
  /** SUSPICIOUS: hidden from recommendations, listed for review. */
  review: KrValuation[];
  generatedAt: string;
  /** Codes for what this does NOT consider (show them to the user). */
  limitations: string[];
}

export const KR_LIMITATIONS = [
  "kr.limitation.registryNotChecked", // 등기부등본(근저당, 압류) 미확인
  "kr.limitation.noTimeAdjustment", // 기간 내 시세 변동 미반영
  "kr.limitation.viewAndDirection", // 향, 조망, 동 위치, 수리 상태 미반영
  "kr.limitation.notInvestmentAdvice",
] as const;

export const M2_PER_PYEONG = 3.305785;

export function normalizeComplexName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/아파트$/u, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/아파트$/u, "");
}

/** Relative price of a floor vs. a middle floor. Rough market convention, not a statistic. */
export function floorFactor(floor: number | null | undefined, totalFloors?: number | null): number {
  if (floor === null || floor === undefined) return 1;
  if (floor <= 1) return 0.93;
  if (floor === 2) return 0.97;
  if (totalFloors && totalFloors >= 5 && floor >= totalFloors) return 0.97;
  return 1;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function monthsBefore(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

const compact = (s: string) => s.replace(/\s/g, "");

export function sameComplex(listing: KrSaleListing, t: AptTrade): boolean {
  if (listing.aptSeq && t.aptSeq) return listing.aptSeq === t.aptSeq;
  if (listing.jibun && listing.umdName && t.jibun) return compact(listing.jibun) === compact(t.jibun) && compact(listing.umdName) === compact(t.umdName);
  if (normalizeComplexName(listing.complexName) !== normalizeComplexName(t.aptName)) return false;
  if (listing.umdName && t.umdName) return compact(listing.umdName) === compact(t.umdName);
  return true;
}

export function estimateMarketValue(listing: KrSaleListing, trades: AptTrade[], opts: ValuationOptions = {}): { estimate: MarketEstimate | null; comparableCount: number } {
  const now = opts.now ?? new Date();
  const windows = opts.windowsMonths ?? [6, 12];
  const tolerances = opts.areaTolerances ?? [0.03, 0.08];
  const minComparables = opts.minComparables ?? 3;
  const today = now.toISOString().slice(0, 10);
  const pool = trades.filter((t) => !t.cancelled && t.dealDate <= today && sameComplex(listing, t));
  let widest = 0;
  for (const months of windows) {
    const since = monthsBefore(now, months);
    for (const tol of tolerances) {
      const comps = pool.filter((t) => t.dealDate >= since && Math.abs(t.exclusiveAreaM2 - listing.exclusiveAreaM2) <= listing.exclusiveAreaM2 * tol);
      widest = Math.max(widest, comps.length);
      if (comps.length < minComparables) continue;
      const perM2 = median(comps.map((t) => t.priceKrw / t.exclusiveAreaM2 / floorFactor(t.floor)));
      const factor = floorFactor(listing.floor, listing.totalFloors);
      const prices = comps.map((t) => t.priceKrw);
      return {
        comparableCount: comps.length,
        estimate: {
          comparables: [...comps].sort((a, b) => b.dealDate.localeCompare(a.dealDate)),
          windowMonths: months,
          areaTolerance: tol,
          medianPricePerM2: Math.round(perM2),
          estimatedValueKrw: Math.round((perM2 * listing.exclusiveAreaM2 * factor) / 10_000) * 10_000,
          floorFactor: factor,
          minPriceKrw: Math.min(...prices),
          maxPriceKrw: Math.max(...prices),
          latestDealDate: comps.reduce((d, t) => (t.dealDate > d ? t.dealDate : d), ""),
        },
      };
    }
  }
  return { estimate: null, comparableCount: widest };
}

export function discountTier(discount: number): Exclude<DiscountTier, "INSUFFICIENT_DATA"> {
  const { atMarket, checkReason, suspicious } = DISCOUNT_THRESHOLDS;
  if (discount > suspicious) return "SUSPICIOUS";
  if (discount > checkReason) return "CHECK_REASON";
  if (discount >= atMarket) return "RECOMMENDED";
  if (discount > -atMarket) return "AT_MARKET";
  return "ABOVE_MARKET";
}

export function valueListing(listing: KrSaleListing, trades: AptTrade[], opts: ValuationOptions = {}): KrValuation {
  const { estimate, comparableCount } = estimateMarketValue(listing, trades, opts);
  const reasons: KrReason[] = [];
  if (!estimate) {
    reasons.push({ code: "fewComparables", params: { count: comparableCount } });
    return { listing, tier: "INSUFFICIENT_DATA", discount: null, estimate: null, comparableCount, reasons };
  }
  const discount = 1 - listing.askingPriceKrw / estimate.estimatedValueKrw;
  const tier = discountTier(discount);
  const pct = Math.round(Math.abs(discount) * 1000) / 10;
  const count = estimate.comparables.length;
  if (tier === "RECOMMENDED") reasons.push({ code: "belowMarket", params: { pct, count } });
  if (tier === "CHECK_REASON") reasons.push({ code: "belowMarket", params: { pct, count } }, { code: "checkWhyCheap" });
  if (tier === "SUSPICIOUS") reasons.push({ code: "suspiciousDiscount", params: { pct } });
  if (tier === "ABOVE_MARKET") reasons.push({ code: "aboveMarket", params: { pct } });
  if (estimate.floorFactor < 1) reasons.push({ code: listing.floor !== null && listing.floor !== undefined && listing.floor <= 2 ? "lowFloor" : "topFloor" });
  if (estimate.windowMonths > 6) reasons.push({ code: "staleComparables", params: { months: estimate.windowMonths } });
  return { listing, tier, discount, estimate, comparableCount, reasons };
}

const ORDER: DiscountTier[] = ["RECOMMENDED", "CHECK_REASON", "AT_MARKET", "ABOVE_MARKET", "INSUFFICIENT_DATA", "SUSPICIOUS"];

/** Values every listing and sorts: cheapest vs. market first, more comparables breaking ties. */
export function recommendBelowMarket(listings: KrSaleListing[], trades: AptTrade[], opts: ValuationOptions = {}): KrRecommendationResult {
  const now = opts.now ?? new Date();
  const all = listings.map((l) => valueListing(l, trades, { ...opts, now }));
  all.sort(
    (a, b) =>
      ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier) ||
      (b.discount ?? -Infinity) - (a.discount ?? -Infinity) ||
      b.comparableCount - a.comparableCount,
  );
  // RECOMMENDED ranks above CHECK_REASON on purpose: a plausible 5-15% discount comes before a
  // 15-25% one whose cheapness still needs explaining.
  return {
    recommended: all.filter((v) => v.tier === "RECOMMENDED" || v.tier === "CHECK_REASON"),
    others: all.filter((v) => v.tier === "AT_MARKET" || v.tier === "ABOVE_MARKET" || v.tier === "INSUFFICIENT_DATA"),
    review: all.filter((v) => v.tier === "SUSPICIOUS"),
    generatedAt: now.toISOString(),
    limitations: [...KR_LIMITATIONS],
  };
}

/** 1250000000 -> "12억 5,000만", 950000000 -> "9억 5,000만", 80000000 -> "8,000만" */
export function formatKrwShort(won: number): string {
  const manwon = Math.round(won / 10_000);
  const eok = Math.floor(manwon / 10_000);
  const rest = manwon % 10_000;
  const restText = rest ? `${rest.toLocaleString("en-US")}만` : "";
  if (!eok) return restText || "0원";
  return rest ? `${eok}억 ${restText}` : `${eok}억`;
}

export function pricePerPyeong(won: number, areaM2: number): number {
  return (won / areaM2) * M2_PER_PYEONG;
}

export const KR_SORTS = ["recommended", "discount", "pricePerM2", "newest"] as const;
export type KrSort = (typeof KR_SORTS)[number];

/**
 * Display order for a valued list. "recommended" is the tier order of
 * recommendBelowMarket (SUSPICIOUS last); "discount" puts the largest discount
 * first but still keeps SUSPICIOUS at the end; "pricePerM2" is the cheapest
 * asking 원/m²; "newest" uses `createdAt` on the listing when present.
 */
export function sortKrValuations<T extends KrValuation>(vals: T[], sort: KrSort, createdAt: (v: T) => string = () => ""): T[] {
  const out = [...vals];
  const suspiciousLast = (a: T, b: T) => Number(a.tier === "SUSPICIOUS") - Number(b.tier === "SUSPICIOUS");
  const byDiscount = (a: T, b: T) => (b.discount ?? -Infinity) - (a.discount ?? -Infinity);
  const perM2 = (v: T) => v.listing.askingPriceKrw / v.listing.exclusiveAreaM2;
  switch (sort) {
    case "recommended":
      return out.sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier) || byDiscount(a, b) || b.comparableCount - a.comparableCount);
    case "discount":
      return out.sort((a, b) => suspiciousLast(a, b) || byDiscount(a, b));
    case "pricePerM2":
      return out.sort((a, b) => perM2(a) - perM2(b));
    case "newest":
      return out.sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
  }
}

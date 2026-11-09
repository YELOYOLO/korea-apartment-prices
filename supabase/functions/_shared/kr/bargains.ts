import type { AptTrade } from "./molit.ts";
import { estimateMarketValue, type MarketEstimate, type ValuationOptions } from "./valuation.ts";

/**
 * 대장 아파트 급매: reported deals in a region's flagship complexes that closed well
 * below that complex's market value.
 *
 * Listings on 네이버/KB are not collected (no public API, and their terms forbid
 * automated collection), so this works from 국토교통부 실거래가: each recent deal is
 * valued like a listing against the *other* deals of the same complex (same area
 * band and window as valueListing), and kept when it is at least `threshold`
 * below. A 직거래 far below market is often a transfer between relatives, so it
 * carries a warning rather than being dropped.
 * Pure TypeScript, used by the Next.js app.
 */

export const BARGAIN_THRESHOLD = 0.15;
/** Above this a deal is shown, but flagged as unusually cheap. */
export const BARGAIN_VERY_CHEAP = 0.25;

/** One flagship (대장) complex of a 시군구, as kr_flagships() returns it. */
export interface Flagship {
  lawdCd: string;
  aptSeq: string;
  aptName: string;
  umdName: string;
  jibun: string | null;
  buildYear: number | null;
  dealCount: number;
  /** Median floor-normalized 원/m² over the last 12 months. */
  medianPricePerM2: number;
  lastDealDate: string;
  /** 1 = highest 원/m² in its 시군구. */
  rank: number;
}

export type BargainWarning = "directDeal" | "veryCheap" | "lowFloor" | "staleComparables";

export interface BargainDeal {
  trade: AptTrade;
  /** 1 - price / estimated value; at least the threshold. */
  discount: number;
  estimate: MarketEstimate;
  warnings: BargainWarning[];
}

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Deals of the last `recentDays` that closed at least `threshold` below the market
 * value of their complex, largest discount first. `trades` should hold the complexes'
 * deals for the comparison window (12 months).
 */
export function findBargainDeals(
  trades: AptTrade[],
  opts: ValuationOptions & { recentDays?: number; threshold?: number } = {},
): BargainDeal[] {
  const now = opts.now ?? new Date();
  const threshold = opts.threshold ?? BARGAIN_THRESHOLD;
  const since = daysBefore(now, opts.recentDays ?? 90);
  const today = now.toISOString().slice(0, 10);
  const out: BargainDeal[] = [];
  for (const t of trades) {
    if (t.cancelled || t.dealDate < since || t.dealDate > today) continue;
    const others = trades.filter((o) => o.sourceKey !== t.sourceKey);
    const { estimate } = estimateMarketValue(
      { id: t.sourceKey, complexName: t.aptName, aptSeq: t.aptSeq, umdName: t.umdName, exclusiveAreaM2: t.exclusiveAreaM2, askingPriceKrw: t.priceKrw, floor: t.floor },
      others,
      { ...opts, now },
    );
    if (!estimate) continue;
    const discount = 1 - t.priceKrw / estimate.estimatedValueKrw;
    if (discount < threshold) continue;
    const warnings: BargainWarning[] = [];
    if ((t.dealingType ?? "").includes("직거래")) warnings.push("directDeal");
    if (discount > BARGAIN_VERY_CHEAP) warnings.push("veryCheap");
    if (t.floor !== null && t.floor <= 2) warnings.push("lowFloor");
    if (estimate.windowMonths > 6) warnings.push("staleComparables");
    out.push({ trade: t, discount, estimate, warnings });
  }
  return out.sort((a, b) => b.discount - a.discount || b.trade.dealDate.localeCompare(a.trade.dealDate));
}

/** Search links for checking the complex's current listings by hand. */
export function listingSearchLinks(f: Pick<Flagship, "aptName" | "umdName">, sggName?: string): { naver: string; kb: string } {
  const q = [sggName, f.umdName, f.aptName].filter(Boolean).join(" ");
  return {
    naver: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${q} 매매`)}`,
    kb: `https://kbland.kr/search?keyword=${encodeURIComponent(f.aptName)}`,
  };
}

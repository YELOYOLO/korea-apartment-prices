import type { AptTrade } from "./molit.ts";
import type { OnbidItem } from "./onbid.ts";
import { estimateMarketValue, type MarketEstimate, type ValuationOptions } from "./valuation.ts";

/**
 * 공매 (Onbid) apartments vs. 국토교통부 실거래가.
 *
 * The comparable deals are found by 법정동 + 지번 (from the item's PNU), which
 * pins the complex without relying on names. 건물면적 stands in for 전용면적;
 * the floor comes from the item name ("1203호" -> 12) when it can be read.
 *
 * Unlike ordinary listings, a big discount is normal here: the price reflects
 * eviction, prior rights and a sale that failed before. So instead of hiding
 * large discounts as suspicious, every item carries its risks explicitly, and
 * the ratio uses the *minimum* bid: the winning bid is usually higher.
 */

/** SHARE: only a share is sold, so its price can't be compared with whole-unit deals. */
export type AuctionTier = "DEEP" | "BELOW" | "NEAR" | "ABOVE" | "SHARE" | "NO_DATA";

/** min bid / estimated market value */
export const AUCTION_THRESHOLDS = { deep: 0.7, below: 0.9, near: 1.05 } as const;

export type AuctionWarning =
  | "evictionByBuyer" // 명도(인도) 책임이 매수자
  | "shareOnly" // 지분물건
  | "privateContract" // 수의계약 대상 (입찰이 아닌 계약)
  | "priceNotPublic" // 최저가 비공개
  | "dateTbd" // 입찰일 미정
  | "floorUnknown" // 층을 이름에서 못 읽어 층 보정 없음
  | "failedBefore"; // 유찰 이력

export interface AuctionValuation {
  item: OnbidItem;
  tier: AuctionTier;
  /** minBid / estimated value; null without both. */
  ratio: number | null;
  /** minBid / 감정가 */
  appraisalRatio: number | null;
  estimate: MarketEstimate | null;
  comparableCount: number;
  warnings: AuctionWarning[];
}

export function auctionTier(ratio: number): Exclude<AuctionTier, "NO_DATA" | "SHARE"> {
  if (ratio <= AUCTION_THRESHOLDS.deep) return "DEEP";
  if (ratio <= AUCTION_THRESHOLDS.below) return "BELOW";
  if (ratio <= AUCTION_THRESHOLDS.near) return "NEAR";
  return "ABOVE";
}

export function auctionWarnings(i: OnbidItem): AuctionWarning[] {
  const w: AuctionWarning[] = [];
  if ((i.evictionBy ?? "").includes("매수")) w.push("evictionByBuyer");
  if (i.shareOnly) w.push("shareOnly");
  if (i.privateContract) w.push("privateContract");
  if (i.minBidKrw === null) w.push("priceNotPublic");
  if (!i.bidEnd && !i.privateContract) w.push("dateTbd");
  if (i.floorGuess === null) w.push("floorUnknown");
  if (i.failCount > 0) w.push("failedBefore");
  return w;
}

export function valueAuctionItem(item: OnbidItem, trades: AptTrade[], opts: ValuationOptions = {}): AuctionValuation {
  const warnings = auctionWarnings(item);
  const appraisalRatio = item.minBidKrw !== null && item.appraisalKrw ? item.minBidKrw / item.appraisalKrw : null;
  if (item.shareOnly) return { item, tier: "SHARE", ratio: null, appraisalRatio, estimate: null, comparableCount: 0, warnings };
  if (!item.jibun || !item.emd || !item.buildingAreaM2 || item.minBidKrw === null) {
    return { item, tier: "NO_DATA", ratio: null, appraisalRatio, estimate: null, comparableCount: 0, warnings };
  }
  const { estimate, comparableCount } = estimateMarketValue(
    {
      id: item.sourceKey,
      complexName: item.name,
      umdName: item.emd,
      jibun: item.jibun,
      exclusiveAreaM2: item.buildingAreaM2,
      askingPriceKrw: item.minBidKrw,
      floor: item.floorGuess,
    },
    trades,
    opts,
  );
  if (!estimate) return { item, tier: "NO_DATA", ratio: null, appraisalRatio, estimate: null, comparableCount, warnings };
  const ratio = item.minBidKrw / estimate.estimatedValueKrw;
  return { item, tier: auctionTier(ratio), ratio, appraisalRatio, estimate, comparableCount, warnings };
}

export const AUCTION_SORTS = ["ratio", "bidEnd", "failCount"] as const;
export type AuctionSort = (typeof AUCTION_SORTS)[number];

/** "ratio": cheapest vs. market first (unvalued last); "bidEnd": soonest deadline first (unscheduled last). */
export function sortAuctionValuations(vals: AuctionValuation[], sort: AuctionSort): AuctionValuation[] {
  const out = [...vals];
  const end = (v: AuctionValuation) => v.item.bidEnd ?? "9999";
  if (sort === "ratio") return out.sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || end(a).localeCompare(end(b)));
  if (sort === "bidEnd") return out.sort((a, b) => end(a).localeCompare(end(b)) || (a.ratio ?? Infinity) - (b.ratio ?? Infinity));
  return out.sort((a, b) => b.item.failCount - a.item.failCount || (a.ratio ?? Infinity) - (b.ratio ?? Infinity));
}

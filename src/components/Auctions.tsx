"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AUCTION_SORTS, sortAuctionValuations, valueAuctionItem, type AuctionSort, type AuctionValuation, type AuctionWarning } from "@kr/auction.ts";
import { formatKrwShort } from "@kr/valuation.ts";
import * as api from "@/lib/api";
import { formatKst, monthsAgo, relativeKo } from "@/lib/format";
import { getClient } from "@/lib/supabase";
import { RegionPicker, readStoredRegion, storeRegion, type Region } from "./RegionPicker";
import { Badge, Button, EmptyState, ErrorState, Loading, SelectField } from "./ui";

const SORT_KEY = "md.auctionSort";
const REGION_KEY = "md.auctionRegion";

const SORT_LABEL: Record<AuctionSort, string> = { ratio: "시세 대비 싼 순", bidEnd: "입찰 마감 임박순", failCount: "유찰 많은 순" };

const TIER: Record<AuctionValuation["tier"], { tone: "good" | "neutral" | "info" | "danger"; label: (pct: number) => string }> = {
  DEEP: { tone: "good", label: (p) => `최저가 = 시세의 ${p}%` },
  BELOW: { tone: "good", label: (p) => `최저가 = 시세의 ${p}%` },
  NEAR: { tone: "neutral", label: (p) => `최저가가 시세 수준 (${p}%)` },
  ABOVE: { tone: "info", label: (p) => `최저가가 시세보다 높음 (${p}%)` },
  SHARE: { tone: "danger", label: () => "지분 물건: 시세 비교 제외" },
  NO_DATA: { tone: "neutral", label: () => "비교할 실거래 부족" },
};

const WARN: Record<AuctionWarning, string> = {
  evictionByBuyer: "점유자 명도(인도) 책임이 매수자에게 있습니다.",
  shareOnly: "지분물건: 소유권 일부만 매각됩니다.",
  privateContract: "유찰 후 수의계약으로 나온 물건입니다.",
  priceNotPublic: "최저입찰가가 공개되지 않았습니다.",
  dateTbd: "입찰일이 아직 정해지지 않았습니다.",
  floorUnknown: "층을 알 수 없어 층 보정을 하지 않았습니다.",
  failedBefore: "유찰 이력이 있습니다. 안 팔린 이유를 확인하세요.",
};
// Warnings that change what the buyer takes on, shown in red.
const SERIOUS = new Set<AuctionWarning>(["evictionByBuyer", "shareOnly", "priceNotPublic"]);

function readSort(): AuctionSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return (AUCTION_SORTS as readonly string[]).includes(v ?? "") ? (v as AuctionSort) : "ratio";
  } catch {
    return "ratio";
  }
}

const pct = (r: number | null) => (r === null ? 0 : Math.round(r * 1000) / 10);

function Card({ v }: { v: AuctionValuation }) {
  const [open, setOpen] = useState(false);
  const i = v.item;
  const e = v.estimate;
  const tier = TIER[v.tier];
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="auction-item" data-tier={v.tier}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{i.name}</p>
          <p className="text-sm text-muted">
            {[i.propertyType, i.statusName, i.buildingAreaM2 ? `건물면적 ${i.buildingAreaM2}㎡ (전용면적으로 간주)` : null, i.floorGuess !== null ? `${i.floorGuess}층 (물건명에서 추정)` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Badge tone={tier.tone}>{tier.label(pct(v.ratio))}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">최저입찰가</dt>
          <dd className="text-base font-bold">{i.minBidKrw !== null ? formatKrwShort(i.minBidKrw) : (i.minBidText ?? "—")}</dd>
          {v.appraisalRatio !== null && <dd className="text-xs text-muted">감정가의 {pct(v.appraisalRatio)}%</dd>}
        </div>
        <div>
          <dt className="text-muted">추정 시세</dt>
          <dd className="text-base font-bold">{e ? formatKrwShort(e.estimatedValueKrw) : "—"}</dd>
          <dd className="text-xs text-muted">
            {e
              ? `실거래 ${e.comparables.length}건 · ${formatKrwShort(e.minPriceKrw)}~${formatKrwShort(e.maxPriceKrw)} · 최근 ${e.latestDealDate}`
              : v.tier === "NO_DATA"
                ? `최근 12개월 이 주소·면적의 실거래가 3건 미만입니다 (${v.comparableCount}건).`
                : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted">감정가</dt>
          <dd className="text-base font-bold">{i.appraisalKrw !== null ? formatKrwShort(i.appraisalKrw) : "—"}</dd>
        </div>
      </dl>
      <ul className="flex flex-wrap gap-1">
        <li>
          <Badge tone={i.bidEnd ? "info" : "neutral"}>{i.bidEnd ? `${formatKst(i.bidEnd)} 입찰 마감` : "입찰일 미정"}</Badge>
        </li>
        {i.failCount > 0 && (
          <li>
            <Badge>유찰 {i.failCount}회</Badge>
          </li>
        )}
      </ul>
      {v.warnings.some((w) => w !== "dateTbd") && (
        <ul className="space-y-0.5 text-xs" aria-label="주의 사항">
          {v.warnings
            .filter((w) => w !== "dateTbd")
            .map((w) => (
              <li key={w} className={SERIOUS.has(w) ? "font-semibold text-danger" : "text-text-secondary"}>
                • {WARN[w]}
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {e && (
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "비교 거래 숨기기" : "비교 거래 보기"}
          </Button>
        )}
        {i.detailUrl && (
          <a href={i.detailUrl} target="_blank" rel="noopener noreferrer" className="min-h-11 content-center px-3 text-sm font-semibold text-brand-text">
            온비드에서 보기
          </a>
        )}
      </div>
      {open && e && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {e.comparables.map((c) => (
                <tr key={c.sourceKey} className="border-t border-border">
                  <td className="py-1 pr-2">{c.dealDate}</td>
                  <td className="py-1 pr-2">{c.aptName}</td>
                  <td className="py-1 pr-2">{c.exclusiveAreaM2}㎡</td>
                  <td className="py-1 pr-2">{c.floor ?? "—"}층</td>
                  <td className="py-1">{formatKrwShort(c.priceKrw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

export default function Auctions() {
  const [sort, setSortState] = useState<AuctionSort>(readSort);
  const [region, setRegionState] = useState<Region>(() => {
    const r = readStoredRegion(REGION_KEY);
    return r.sido ? r : { sido: "서울특별시", lawdCd: null };
  });
  const setSort = (s: AuctionSort) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* per-device convenience only */
    }
  };
  const setRegion = (r: Region) => {
    setRegionState(r);
    storeRegion(REGION_KEY, r);
  };
  const list = useQuery({
    queryKey: ["auctions", region.sido, region.lawdCd],
    enabled: Boolean(region.sido),
    queryFn: () => api.auctionApartments(getClient(), { sido: region.sido as string, lawdCd: region.lawdCd }),
  });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const key = items.map((i) => `${i.lawdCd}:${i.emd}:${i.jibun}`).sort().join("|");
  const trades = useQuery({ queryKey: ["auctionTrades", key], enabled: items.length > 0, queryFn: () => api.tradesForAuctionItems(getClient(), items, monthsAgo(13)) });
  const valued = useMemo(() => {
    if (!trades.data) return null;
    const now = new Date();
    return sortAuctionValuations(
      items.map((i) => valueAuctionItem(i, trades.data, { now })),
      sort,
    );
  }, [items, trades.data, sort]);

  return (
    <div className="space-y-4">
      <RegionPicker idPrefix="auction" value={region} onChange={setRegion} allowWholeSido />
      <p className="rounded-lg border border-warning bg-warning-soft p-3 text-xs" role="note">
        실제 낙찰가는 보통 최저입찰가보다 높아 실제 할인 폭은 표시보다 작습니다. 입찰 전에 등기부등본, 선순위 권리, 임차인 대항력, 체납 관리비, 점유자를 직접 또는 전문가와 확인하세요. Mydream은
        공공데이터를 보여줄 뿐 공매의 당사자가 아닙니다.
      </p>
      {list.isSuccess && list.data.syncedAt && <p className="text-xs text-muted">온비드 목록 {relativeKo(list.data.syncedAt)} 기준</p>}
      <section aria-labelledby="auction-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="auction-title" className="text-lg font-bold">
            {items.length}건
          </h2>
          <div className="w-56">
            <SelectField label="정렬" value={sort} onChange={(e) => setSort(e.target.value as AuctionSort)}>
              {AUCTION_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        {!region.sido ? (
          <EmptyState title="먼저 지역을 선택하세요." />
        ) : list.isLoading || (items.length > 0 && trades.isLoading) ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : trades.isError ? (
          <ErrorState error={trades.error} onRetry={() => trades.refetch()} />
        ) : !list.data?.syncedAt ? (
          <EmptyState title="아직 공매 데이터가 없습니다" description="이 시도의 온비드 공매 목록을 아직 받지 못했습니다. 매시간 차례로 받고 있습니다." />
        ) : !items.length ? (
          <EmptyState title="이 지역에 지금 진행 중인 아파트 공매가 없습니다." />
        ) : (
          <ul className="space-y-3">
            {(valued ?? []).map((v) => (
              <Card key={v.item.sourceKey} v={v} />
            ))}
          </ul>
        )}
      </section>
      <p className="rounded-lg bg-surface-muted p-3 text-xs text-text-secondary">
        비교 거래 = 같은 법정동·지번(물건 PNU 기준), 비슷한 면적, 최근 6~12개월 실거래 3건 이상. 비율 = 최저입찰가 ÷ 추정 시세.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { AuctionValuation } from "@kr/auction.ts";
import { BARGAIN_THRESHOLD, listingSearchLinks, type BargainDeal, type BargainWarning, type Flagship } from "@kr/bargains.ts";
import { formatKrwShort, M2_PER_PYEONG } from "@kr/valuation.ts";
import { formatKst } from "@/lib/format";
import { sggName, useBargainData } from "@/lib/useBargainData";
import { RegionPicker } from "./RegionPicker";
import { Badge, EmptyState, ErrorState, Loading } from "./ui";

const WARN: Record<BargainWarning, string> = {
  directDeal: "직거래: 가족 간 거래 등 특수한 거래일 수 있습니다.",
  veryCheap: "시세보다 25% 넘게 쌉니다. 거래 사정을 꼭 확인하세요.",
  lowFloor: "저층(1~2층) 거래입니다. 층 보정은 했지만 차이가 클 수 있습니다.",
  staleComparables: "최근 6개월 비교 거래가 부족해 12개월 거래로 비교했습니다.",
};

const pct = (r: number) => Math.round(r * 1000) / 10;
const pyeong = (m2: number) => Math.round(m2 / M2_PER_PYEONG);

export function Links({ f }: { f: Pick<Flagship, "aptName" | "umdName" | "lawdCd"> }) {
  const l = listingSearchLinks(f, sggName(f.lawdCd));
  const cls = "min-h-11 content-center rounded-lg border border-border px-3 text-sm font-semibold text-brand-text hover:bg-surface-muted";
  return (
    <div className="flex flex-wrap gap-2">
      <a href={l.naver} target="_blank" rel="noopener noreferrer" className={cls}>
        네이버 매물 보기
      </a>
      <a href={l.kb} target="_blank" rel="noopener noreferrer" className={cls}>
        KB부동산에서 찾기
      </a>
    </div>
  );
}

export function DealCard({ d }: { d: BargainDeal }) {
  const [open, setOpen] = useState(false);
  const t = d.trade;
  const e = d.estimate;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="bargain-deal">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{t.aptName}</p>
          <p className="text-sm text-muted">
            {sggName(t.lawdCd)} {t.umdName} · 전용 {t.exclusiveAreaM2}㎡ ({pyeong(t.exclusiveAreaM2)}평) · {t.floor ?? "—"}층 · {t.dealingType ?? "거래유형 미상"}
          </p>
        </div>
        <Badge tone={d.warnings.includes("veryCheap") || d.warnings.includes("directDeal") ? "danger" : "good"}>시세보다 {pct(d.discount)}% 싸게 거래</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">거래가</dt>
          <dd className="text-base font-bold">{formatKrwShort(t.priceKrw)}</dd>
          <dd className="text-xs text-muted">{t.dealDate} 계약</dd>
        </div>
        <div>
          <dt className="text-muted">추정 시세</dt>
          <dd className="text-base font-bold">{formatKrwShort(e.estimatedValueKrw)}</dd>
          <dd className="text-xs text-muted">
            같은 단지 실거래 {e.comparables.length}건 · {formatKrwShort(e.minPriceKrw)}~{formatKrwShort(e.maxPriceKrw)}
          </dd>
        </div>
      </dl>
      {d.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs" aria-label="주의 사항">
          {d.warnings.map((w) => (
            <li key={w} className={w === "directDeal" || w === "veryCheap" ? "font-semibold text-danger" : "text-text-secondary"}>
              • {WARN[w]}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Links f={t} />
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-11 px-3 text-sm font-semibold text-text-secondary">
          {open ? "비교 거래 숨기기" : "비교 거래 보기"}
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {e.comparables.map((c) => (
                <tr key={c.sourceKey} className="border-t border-border">
                  <td className="py-1 pr-2">{c.dealDate}</td>
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

export function AuctionCard({ v }: { v: AuctionValuation }) {
  const i = v.item;
  return (
    <li className="space-y-1 rounded-xl border border-border bg-surface p-4" data-testid="bargain-auction">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-bold">{i.name}</p>
        <Badge tone="good">최저가 = 시세의 {pct(v.ratio ?? 0)}%</Badge>
      </div>
      <p className="text-sm text-muted">
        최저입찰가 {i.minBidKrw !== null ? formatKrwShort(i.minBidKrw) : "—"} · 추정 시세 {v.estimate ? formatKrwShort(v.estimate.estimatedValueKrw) : "—"} ·{" "}
        {i.bidEnd ? `${formatKst(i.bidEnd)} 마감` : "입찰일 미정"}
      </p>
      {i.detailUrl && (
        <a href={i.detailUrl} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 content-center text-sm font-semibold text-brand-text">
          온비드에서 보기
        </a>
      )}
    </li>
  );
}

function FlagshipRow({ f, deals }: { f: Flagship; deals: number }) {
  return (
    <li className="space-y-2 border-t border-border py-3 first:border-t-0" data-testid="flagship">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold">
          <span className="mr-1 text-brand-text">{f.rank}위</span>
          {f.aptName}
          <span className="ml-1 text-sm font-normal text-muted">
            {f.umdName}
            {f.buildYear ? ` · ${f.buildYear}년` : ""}
          </span>
        </p>
        {deals > 0 && <Badge tone="good">급매 거래 {deals}건</Badge>}
      </div>
      <p className="text-sm text-text-secondary">
        평당 {formatKrwShort(f.medianPricePerM2 * M2_PER_PYEONG)} (㎡당 {formatKrwShort(f.medianPricePerM2)}) · 최근 1년 거래 {f.dealCount}건 · 마지막 {f.lastDealDate}
      </p>
      <Links f={f} />
    </li>
  );
}

export default function Bargains() {
  const { region, setRegion, list, deals, dealsByLot, cheapAuctions, byRegion, loading, error, retry } = useBargainData();

  return (
    <div className="space-y-6">
      <RegionPicker idPrefix="bargain" value={region} onChange={setRegion} allowWholeSido />
      <p className="rounded-lg border border-warning bg-warning-soft p-3 text-xs" role="note">
        네이버·KB의 매물 목록은 자동으로 가져오지 않습니다(공개 API가 없고 약관상 자동 수집이 금지되어 있습니다). 대신 국토교통부 실거래가로 대장 아파트를 고르고, 최근 90일 안에 시세보다{" "}
        {pct(BARGAIN_THRESHOLD)}% 이상 싸게 거래된 건을 보여 줍니다. 지금 나와 있는 매물은 단지마다 있는 링크로 직접 확인하세요.
      </p>
      {!region.sido ? (
        <EmptyState title="먼저 지역을 선택하세요." />
      ) : loading ? (
        <Loading rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : !list.length ? (
        <EmptyState
          title="아직 대장 아파트를 고를 실거래가 부족합니다"
          description="최근 1년 거래가 5건 이상인 단지가 있어야 합니다. 실거래가를 전국에서 차례로 받고 있으니 잠시 뒤 다시 확인하세요."
        />
      ) : (
        <>
          <section aria-labelledby="deals-title" className="space-y-3">
            <h2 id="deals-title" className="text-lg font-bold">
              {pct(BARGAIN_THRESHOLD)}% 이상 싸게 거래된 대장 아파트 <span className="text-muted">{deals.length}건</span>
            </h2>
            {deals.length ? (
              <ul className="space-y-3">
                {deals.map((d) => (
                  <DealCard key={d.trade.sourceKey} d={d} />
                ))}
              </ul>
            ) : (
              <EmptyState title="최근 90일 동안 시세보다 15% 이상 싸게 거래된 건이 없습니다." />
            )}
          </section>
          {cheapAuctions.length > 0 && (
            <section aria-labelledby="auction-title" className="space-y-3">
              <h2 id="auction-title" className="text-lg font-bold">
                대장 아파트 공매 <span className="text-muted">{cheapAuctions.length}건</span>
              </h2>
              <ul className="space-y-3">
                {cheapAuctions.map((v) => (
                  <AuctionCard key={v.item.sourceKey} v={v} />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="flag-title" className="space-y-3">
            <h2 id="flag-title" className="text-lg font-bold">
              대장 아파트 <span className="text-muted">{list.length}곳</span>
            </h2>
            <p className="text-xs text-muted">시군구마다 최근 1년 실거래가 5건 이상인 단지 중 ㎡당 가격(층 보정 중위값)이 가장 높은 3곳입니다.</p>
            {byRegion.map(([code, fs]) => (
              <div key={code} className="rounded-xl border border-border bg-surface px-4 py-1">
                <h3 className="pt-3 text-sm font-bold text-text-secondary">{sggName(code)}</h3>
                <ul>
                  {fs.map((f) => (
                    <FlagshipRow key={f.key} f={f} deals={dealsByLot.get(f.key)?.length ?? 0} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

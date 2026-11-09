"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { krRegionLabel } from "@kr/regions.ts";
import { formatKrwShort, KR_SORTS, M2_PER_PYEONG, sortKrValuations, valueListing, type KrSort, type KrValuation } from "@kr/valuation.ts";
import * as api from "@/lib/api";
import type { KrComplex, KrWatchListing } from "@/lib/api";
import { monthsAgo, relativeKo } from "@/lib/format";
import { getClient } from "@/lib/supabase";
import { RegionPicker, readStoredRegion, storeRegion, type Region } from "./RegionPicker";
import { Badge, Button, EmptyState, ErrorState, Loading, SelectField, TextField } from "./ui";

const SORT_KEY = "md.sort";
const REGION_KEY = "md.region";

type Valued = KrValuation & { listing: KrWatchListing };

const SORT_LABEL: Record<KrSort, string> = { recommended: "추천순", discount: "저렴한 순 (할인율)", pricePerM2: "㎡당 호가 낮은 순", newest: "최근 추가순" };

const TIER: Record<Valued["tier"], { tone: "good" | "warning" | "danger" | "neutral" | "info"; label: (pct: number) => string; help?: string }> = {
  RECOMMENDED: { tone: "good", label: (p) => `시세보다 ${p}% 저렴` },
  CHECK_REASON: { tone: "warning", label: (p) => `시세보다 ${p}% 저렴 · 이유 확인`, help: "최근 실거래보다 15~25% 쌉니다. 저층, 조망, 수리 상태, 세입자 승계, 지분 매물 여부 등 싼 이유를 확인하세요." },
  SUSPICIOUS: { tone: "danger", label: (p) => `시세보다 ${p}% 저렴 · 먼저 확인 필요`, help: "최근 실거래보다 25% 넘게 쌉니다. 미끼매물이거나 가격을 잘못 적은 경우가 많으니 중개사에게 먼저 확인하세요. 추천에서는 제외됩니다." },
  AT_MARKET: { tone: "neutral", label: () => "시세 수준" },
  ABOVE_MARKET: { tone: "info", label: (p) => `시세보다 ${p}% 비쌈` },
  INSUFFICIENT_DATA: { tone: "neutral", label: () => "비교 거래 부족" },
};

function readSort(): KrSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return (KR_SORTS as readonly string[]).includes(v ?? "") ? (v as KrSort) : "recommended";
  } catch {
    return "recommended";
  }
}

const complexLabel = (c: KrComplex) => `${c.aptName} (${c.umdName})`;

function AddForm({ complexes, region, onRegion, onAdded }: { complexes: KrComplex[]; region: Region; onRegion: (r: Region) => void; onAdded: () => void }) {
  const [complex, setComplex] = useState("");
  const [area, setArea] = useState("");
  const [floor, setFloor] = useState("");
  const [totalFloors, setTotalFloors] = useState("");
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const picked = complexes.find((c) => complexLabel(c) === complex.trim());
  const manwon = Number(price.replace(/[,\s]/g, ""));
  const add = useMutation({
    mutationFn: () => {
      const name = picked?.aptName ?? complex.trim();
      const areaM2 = Number(area);
      const fl = floor.trim() ? Number(floor) : null;
      const top = totalFloors.trim() ? Number(totalFloors) : null;
      if (!region.lawdCd) throw new Error("시도와 시군구를 선택하세요.");
      if (!name) throw new Error("단지명을 입력하세요.");
      if (!Number.isFinite(areaM2) || areaM2 <= 0 || areaM2 >= 1000) throw new Error("전용면적을 ㎡로 입력하세요.");
      if (!Number.isInteger(manwon) || manwon < 100) throw new Error("호가를 만원 단위로 입력하세요.");
      if (fl !== null && top !== null && fl > top) throw new Error("층이 건물 최고층보다 높을 수 없습니다.");
      if (url.trim() && !/^https?:\/\//i.test(url.trim())) throw new Error("http:// 또는 https://로 시작하는 링크를 입력하세요.");
      return api.addWatchListing(getClient(), {
        lawdCd: region.lawdCd,
        complexName: name,
        aptSeq: picked?.aptSeq ?? null,
        umdName: picked?.umdName ?? null,
        exclusiveAreaM2: areaM2,
        askingPriceKrw: manwon * 10_000,
        floor: fl !== null && Number.isFinite(fl) ? fl : null,
        totalFloors: top !== null && Number.isFinite(top) ? top : null,
        title,
        url,
      });
    },
    onSuccess: () => {
      setError(null);
      setArea("");
      setFloor("");
      setPrice("");
      setTitle("");
      setUrl("");
      onAdded();
    },
    onError: (e) => setError(e instanceof Error && /watchlistFull/.test(e.message) ? "매물은 200개까지 저장할 수 있습니다. 일부를 먼저 삭제하세요." : e instanceof Error ? e.message : String(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-labelledby="add-title" noValidate>
      <h2 id="add-title" className="text-lg font-bold">
        매물 추가
      </h2>
      <RegionPicker
        idPrefix="add"
        value={region}
        onChange={(r) => {
          setComplex("");
          setArea("");
          onRegion(r);
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <TextField
            label="단지"
            required
            list="complexes"
            value={complex}
            onChange={(e) => setComplex(e.target.value)}
            placeholder="단지명 입력"
            hint="목록에서 고르면 실거래 기록과 단지명이 정확히 맞습니다. 최근 12개월 거래가 있는 단지가 나옵니다."
            autoComplete="off"
          />
          <datalist id="complexes">
            {complexes.map((c) => (
              <option key={`${c.aptSeq ?? ""}${complexLabel(c)}`} value={complexLabel(c)}>
                {`${c.aptName} (${c.umdName}) · 거래 ${c.tradeCount}건`}
              </option>
            ))}
          </datalist>
        </div>
        <div>
          <TextField
            label="전용면적 (㎡)"
            required
            inputMode="decimal"
            list="areas"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            hint={picked?.areas.length ? `공급면적이 아닌 전용면적. 이 단지에서 거래된 면적: ${picked.areas.join(", ")}` : "공급면적이 아닌 전용면적을 입력하세요."}
          />
          <datalist id="areas">
            {picked?.areas.map((a) => <option key={a} value={a} />)}
          </datalist>
        </div>
        <TextField
          label="호가 (만원)"
          required
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          hint={Number.isInteger(manwon) && manwon >= 100 ? `= ${formatKrwShort(manwon * 10_000)}` : "예: 155000 = 15억 5,000만"}
        />
        <TextField label="층" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value)} />
        <TextField label="건물 최고층" inputMode="numeric" value={totalFloors} onChange={(e) => setTotalFloors(e.target.value)} />
        <TextField label="메모 제목" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        <TextField label="매물 링크" type="url" inputMode="url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={add.isPending}>
        {add.isPending ? "추가 중…" : "추가"}
      </Button>
    </form>
  );
}

function Card({ v, onRemove, removing }: { v: Valued; onRemove: () => void; removing: boolean }) {
  const [open, setOpen] = useState(false);
  const l = v.listing;
  const e = v.estimate;
  const pct = v.discount === null ? 0 : Math.round(Math.abs(v.discount) * 1000) / 10;
  const tier = TIER[v.tier];
  const codes = new Set(v.reasons.map((r) => r.code));
  const help = v.tier === "INSUFFICIENT_DATA" ? `최근 12개월 이 단지·면적의 거래가 3건 미만입니다 (${v.comparableCount}건).` : tier.help;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="watch-item" data-tier={v.tier}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{l.title || l.complexName}</p>
          <p className="text-sm text-muted">
            {krRegionLabel(l.lawdCd)} {l.complexName}
            {l.umdName ? ` · ${l.umdName}` : ""} · {l.exclusiveAreaM2}㎡ ({(l.exclusiveAreaM2 / M2_PER_PYEONG).toFixed(1)}평)
            {l.floor !== null && l.floor !== undefined ? ` · ${l.floor}${l.totalFloors ? `/${l.totalFloors}` : ""}층` : ""}
          </p>
        </div>
        <Badge tone={tier.tone}>{tier.label(pct)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted">호가</dt>
          <dd className="text-base font-bold">{formatKrwShort(l.askingPriceKrw)}</dd>
          <dd className="text-xs text-muted">평당 {formatKrwShort((l.askingPriceKrw / l.exclusiveAreaM2) * M2_PER_PYEONG)}</dd>
        </div>
        <div>
          <dt className="text-muted">추정 시세</dt>
          <dd className="text-base font-bold">{e ? formatKrwShort(e.estimatedValueKrw) : "—"}</dd>
          {e && (
            <dd className="text-xs text-muted">
              실거래 {e.comparables.length}건 · {formatKrwShort(e.minPriceKrw)}~{formatKrwShort(e.maxPriceKrw)} · 최근 {e.latestDealDate}
            </dd>
          )}
        </div>
      </dl>
      {(codes.has("lowFloor") || codes.has("topFloor") || codes.has("staleComparables")) && (
        <ul className="flex flex-wrap gap-1">
          {codes.has("lowFloor") && <li><Badge>저층 보정</Badge></li>}
          {codes.has("topFloor") && <li><Badge>탑층 보정</Badge></li>}
          {codes.has("staleComparables") && <li><Badge>12개월 거래로 계산</Badge></li>}
        </ul>
      )}
      {help && <p className="text-xs text-text-secondary">{help}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {e && (
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "비교 거래 숨기기" : "비교 거래 보기"}
          </Button>
        )}
        {l.url && (
          <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-h-11 content-center px-3 text-sm font-semibold text-brand-text">
            매물 보기
          </a>
        )}
        <Button variant="ghost" className="ml-auto" disabled={removing} onClick={onRemove}>
          삭제
        </Button>
      </div>
      {open && e && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">계약일</th>
                <th className="py-1 pr-2 font-medium">전용면적</th>
                <th className="py-1 pr-2 font-medium">층</th>
                <th className="py-1 font-medium">거래가</th>
              </tr>
            </thead>
            <tbody>
              {e.comparables.map((c) => (
                <tr key={c.sourceKey} className="border-t border-border">
                  <td className="py-1 pr-2">{c.dealDate}</td>
                  <td className="py-1 pr-2">{c.exclusiveAreaM2}㎡</td>
                  <td className="py-1 pr-2">{c.floor ?? "—"}</td>
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

export default function WatchList() {
  const qc = useQueryClient();
  const [sort, setSortState] = useState<KrSort>(readSort);
  const [region, setRegionState] = useState<Region>(() => readStoredRegion(REGION_KEY));
  const setSort = (s: KrSort) => {
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
  const lawdCd = region.lawdCd;
  const status = useQuery({ queryKey: ["status", lawdCd], enabled: Boolean(lawdCd), queryFn: () => api.tradeDataStatus(getClient(), lawdCd as string) });
  const complexes = useQuery({ queryKey: ["complexes", lawdCd], enabled: Boolean(lawdCd), queryFn: () => api.complexes(getClient(), lawdCd as string, 12), staleTime: 3600_000 });
  const watch = useQuery({ queryKey: ["watch"], queryFn: () => api.myWatchListings(getClient()) });
  const listings = useMemo(() => watch.data ?? [], [watch.data]);
  const tradeKey = listings.map((l) => `${l.lawdCd}:${l.aptSeq ?? ""}:${l.complexName}`).sort().join("|");
  const trades = useQuery({ queryKey: ["trades", tradeKey], enabled: watch.isSuccess && listings.length > 0, queryFn: () => api.tradesForListings(getClient(), listings, monthsAgo(13)) });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteWatchListing(getClient(), id), onSuccess: () => qc.invalidateQueries({ queryKey: ["watch"] }) });
  const valued = useMemo(() => {
    if (!trades.data && listings.length) return null;
    const now = new Date();
    return sortKrValuations(
      listings.map((l) => valueListing(l, trades.data ?? [], { now }) as Valued),
      sort,
      (v) => v.listing.createdAt,
    );
  }, [listings, trades.data, sort]);

  return (
    <div className="space-y-4">
      {status.isSuccess && status.data && (
        <p className="text-xs text-muted" data-testid="data-status">
          실거래 {status.data.lastDealDate ?? "—"}까지 반영 · 이 지역 {relativeKo(status.data.fetchedAt)} 갱신
        </p>
      )}
      {lawdCd && status.isSuccess && !status.data && (
        <div className="rounded-lg border border-warning bg-warning-soft p-3 text-sm" role="note">
          <p className="font-semibold">이 지역의 실거래 데이터가 아직 없습니다</p>
          <p className="mt-1">전국 데이터를 매시간 차례로 받고 있습니다. 매물은 미리 추가해 둘 수 있고, 데이터가 들어오면 자동으로 계산됩니다.</p>
        </div>
      )}
      <AddForm complexes={complexes.data ?? []} region={region} onRegion={setRegion} onAdded={() => qc.invalidateQueries({ queryKey: ["watch"] })} />
      <section aria-labelledby="list-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="list-title" className="text-lg font-bold">
            {listings.length}개 매물
          </h2>
          <div className="w-56">
            <SelectField label="정렬" value={sort} onChange={(e) => setSort(e.target.value as KrSort)}>
              {KR_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        {watch.isLoading || (trades.isLoading && trades.fetchStatus !== "idle") ? (
          <Loading />
        ) : watch.isError ? (
          <ErrorState error={watch.error} onRetry={() => watch.refetch()} />
        ) : trades.isError ? (
          <ErrorState error={trades.error} onRetry={() => trades.refetch()} />
        ) : !listings.length ? (
          <EmptyState title="추가한 매물이 없습니다" description="부동산 사이트에서 찾은 호가를 추가하면 실거래가와 비교해 드립니다." />
        ) : (
          <ul className="space-y-3">
            {(valued ?? []).map((v) => (
              <Card key={v.listing.id} v={v} removing={remove.isPending && remove.variables === v.listing.id} onRemove={() => remove.mutate(v.listing.id)} />
            ))}
          </ul>
        )}
      </section>
      <div className="space-y-1 rounded-lg bg-surface-muted p-3 text-xs text-text-secondary">
        <p>
          추정 시세 = 같은 단지, 비슷한 전용면적(±3%, 부족하면 ±8%), 최근 6개월(부족하면 12개월) 실거래의 ㎡당 중위가 × 전용면적, 층 보정(1층 −7%, 2층·탑층 −3%). 비교 거래가 3건
          이상일 때만 계산합니다.
        </p>
        <p>
          <span className="font-semibold">반영하지 않는 것: </span>등기부등본(근저당, 압류), 기간 중 시세 변동, 향·조망·동 위치·수리 상태. 투자 조언이 아닙니다.
        </p>
      </div>
    </div>
  );
}

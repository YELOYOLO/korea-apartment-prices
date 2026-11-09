"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { listingSearchLinks } from "@kr/bargains.ts";
import { krRegion } from "@kr/regions.ts";
import { formatKrwShort, M2_PER_PYEONG } from "@kr/valuation.ts";
import * as api from "@/lib/api";
import type { SearchItem } from "@/lib/api";
import { formatKst, relativeKo } from "@/lib/format";
import { loadNaverMaps, type NaverMap, type NaverMaps, type NaverMarker } from "@/lib/naverMaps";
import {
  activeChips,
  AREA_BANDS,
  BUILT_OPTIONS,
  clusterItems,
  DAYS_OPTIONS,
  daysLabel,
  DEFAULT_FILTERS,
  DISCOUNT_OPTIONS,
  KIND_COLOR,
  KIND_LABEL,
  KINDS,
  markerLabel,
  parseFilters,
  PRICE_PRESETS,
  priceRangeLabel,
  regionCodes,
  serializeFilters,
  SORTS,
  toSearchArgs,
  VOLUME_OPTIONS,
  type AreaBand,
  type Cluster,
  type Kind,
  type SearchFilters,
  type Sort,
} from "@/lib/search";
import { getClient } from "@/lib/supabase";
import { RegionPicker } from "./RegionPicker";
import { Badge, Button, EmptyState, ErrorState, Loading, SelectField, TextField } from "./ui";

type GeoSearchItem = SearchItem & { lat: number; lng: number };

const SOURCE: Record<Kind, string> = { flagship: "국토교통부 실거래가", lowdeal: "국토교통부 실거래가", auction: "한국자산관리공사 온비드" };
const pct = (d: number) => Math.round(d * 1000) / 10;
const sggName = (code: string) => krRegion(code)?.name ?? code;

/** Filters live in the URL (share, back/forward, reload keep them). */
function useUrlFilters(onChange: (f: SearchFilters) => void) {
  const [filters, setFilters] = useState<SearchFilters>(() => parseFilters(window.location.search));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    const onPop = () => {
      const f = parseFilters(window.location.search);
      onChangeRef.current(f);
      setFilters(f);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const apply = useCallback((f: SearchFilters, replace = false) => {
    const qs = serializeFilters(f);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    onChangeRef.current(f);
    setFilters(f);
  }, []);
  return [filters, apply] as const;
}

function priceKey(f: Pick<SearchFilters, "priceMin" | "priceMax">): string {
  const i = PRICE_PRESETS.findIndex((p) => p.min === f.priceMin && p.max === f.priceMax);
  if (i >= 0) return String(i);
  return f.priceMin === null && f.priceMax === null ? "all" : "custom";
}

function method(i: SearchItem): string {
  const target = i.kind === "auction" ? "물건 주소(법정동·지번)" : "같은 단지(법정동·지번)";
  if (i.discount === null || i.estimateKrw === null) return `비교 불가: ${target}의 비슷한 면적 실거래가 ${i.comparableCount}건뿐입니다 (3건 이상 필요).`;
  return `${target}, 전용 ±${Math.round((i.areaTolerance ?? 0) * 100)}%, 최근 ${i.windowMonths}개월 실거래 ${i.comparableCount}건의 ㎡당 중위가에 면적·층 보정${
    i.kind === "auction" ? " (건물면적을 전용면적으로 간주)" : ""
  }. 마지막 비교 거래 ${i.latestCompDate ?? "—"}.`;
}

function warnings(i: SearchItem): Array<{ text: string; serious: boolean }> {
  const w: Array<{ text: string; serious: boolean }> = [];
  if (i.kind === "auction") {
    w.push({ text: "권리분석 필요: 등기부등본, 선순위 권리, 임차인을 직접 확인하세요.", serious: true });
    if (i.discount !== null && i.discount > 0.5)
      w.push({ text: "시세의 절반 이하입니다. 지분 매각, 대지권 미등기, 선순위 권리 등 가격이 낮은 이유가 있을 가능성이 큽니다.", serious: true });
    if ((i.evictionBy ?? "").includes("매수")) w.push({ text: "점유자 명도(인도) 책임이 매수자에게 있습니다.", serious: true });
    if (i.privateContract) w.push({ text: "유찰 후 수의계약으로 나온 물건입니다.", serious: false });
    if ((i.failCount ?? 0) > 0) w.push({ text: `유찰 ${i.failCount}회: 안 팔린 이유를 확인하세요.`, serious: false });
    w.push({ text: "실제 낙찰가는 보통 최저입찰가보다 높습니다.", serious: false });
  } else {
    if ((i.dealingType ?? "").includes("직거래")) w.push({ text: "직거래: 가족 간 거래 등 특수관계 거래일 수 있습니다.", serious: true });
    if (i.discount !== null && i.discount > 0.25) w.push({ text: "시세보다 25% 넘게 쌉니다. 거래 사정을 꼭 확인하세요.", serious: true });
    if (i.floor !== null && i.floor <= 2) w.push({ text: "저층(1~2층) 거래: 층 보정을 했지만 차이가 클 수 있습니다.", serious: false });
    if ((i.windowMonths ?? 0) > 6) w.push({ text: "최근 6개월 비교 거래가 부족해 12개월로 비교했습니다.", serious: false });
    w.push({ text: "이미 계약이 끝난 실거래입니다. 지금 나와 있는 매물(호가)이 아닙니다.", serious: false });
  }
  return w;
}

function Comparables({ i }: { i: SearchItem }) {
  const q = useQuery({ queryKey: ["comparables", i.id], queryFn: () => api.comparables(getClient(), i), staleTime: 600_000 });
  if (q.isLoading) return <Loading rows={1} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <p className="text-xs text-muted">비교 거래를 불러오지 못했습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="pb-1 text-left text-muted">
          비교 시세에 쓴 실거래 (같은 단지, 전용 ±{Math.round((i.areaTolerance ?? 0) * 100)}%, 최근 {i.windowMonths}개월)
        </caption>
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-2 font-normal">계약일</th>
            <th className="py-1 pr-2 font-normal">전용</th>
            <th className="py-1 pr-2 font-normal">층</th>
            <th className="py-1 pr-2 font-normal">거래가</th>
            <th className="py-1 font-normal">유형</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c, k) => (
            <tr key={`${c.dealDate}-${k}`} className="border-t border-border">
              <td className="py-1 pr-2">{c.dealDate}</td>
              <td className="py-1 pr-2">{c.areaM2}㎡</td>
              <td className="py-1 pr-2">{c.floor ?? "—"}</td>
              <td className="py-1 pr-2">{formatKrwShort(c.priceKrw)}</td>
              <td className="py-1">{c.dealingType ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemCard({ i }: { i: SearchItem }) {
  const [showComps, setShowComps] = useState(false);
  const vsUmd = i.pyeongKrw !== null && i.umdMedianPyeongKrw ? i.pyeongKrw / i.umdMedianPyeongKrw - 1 : null;
  const links = i.kind === "auction" ? null : listingSearchLinks({ aptName: i.name, umdName: i.umdName }, sggName(i.lawdCd));
  const linkCls = "min-h-11 content-center rounded-lg border border-border px-3 text-sm font-semibold text-brand-text hover:bg-surface-muted";
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-4" data-testid="search-item" data-kind={i.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: KIND_COLOR[i.kind] }}>
              {KIND_LABEL[i.kind]}
            </span>
            <span className="min-w-0 break-words">{i.name}</span>
          </p>
          <p className="text-sm text-muted">
            {sggName(i.lawdCd)} {i.umdName} {i.jibun ?? ""}
            {i.areaM2 !== null ? ` · ${i.kind === "auction" ? "건물" : "전용"} ${i.areaM2}㎡ (${Math.round(i.areaM2 / M2_PER_PYEONG)}평)` : ""}
            {i.floor !== null ? ` · ${i.floor}층${i.kind === "auction" ? "(추정)" : ""}` : ""}
            {i.buildYear ? ` · ${i.buildYear}년 준공` : ""}
          </p>
        </div>
        {i.discount === null ? <Badge>비교 불가</Badge> : <Badge tone={i.discount >= 0 ? "good" : "info"}>{i.discount >= 0 ? `시세보다 ${pct(i.discount)}% 쌈` : `시세보다 ${pct(-i.discount)}% 비쌈`}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">{i.kind === "auction" ? "공매 최저입찰가" : "실거래가 (계약 완료)"}</dt>
          <dd className="text-base font-bold">{i.priceKrw !== null ? formatKrwShort(i.priceKrw) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">비교 시세 (추정)</dt>
          <dd className="text-base font-bold">{i.estimateKrw !== null ? formatKrwShort(i.estimateKrw) : "비교 불가"}</dd>
        </div>
        <div>
          <dt className="text-muted">{i.kind === "auction" ? "입찰 마감" : "계약일"}</dt>
          <dd>{i.kind === "auction" ? (i.bidEnd ? formatKst(i.bidEnd) : "미정") : (i.eventDate ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-muted">출처 · 갱신</dt>
          <dd>
            {SOURCE[i.kind]}
            {i.computedAt ? ` · ${relativeKo(i.computedAt)}` : ""}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-text-secondary">
        {i.pyeongKrw !== null && <>평당 {formatKrwShort(i.pyeongKrw)}</>}
        {vsUmd !== null && (
          <>
            {" "}
            (법정동 평균 {formatKrwShort(i.umdMedianPyeongKrw!)} 대비 {vsUmd < 0 ? `${pct(-vsUmd)}% 낮음` : `${pct(vsUmd)}% 높음`})
          </>
        )}
        {" · "}이 단지 거래량 최근 1년 {i.deals12m}건 (3개월 {i.deals3m}건)
      </p>
      <p className="text-xs text-text-secondary">산정 방법: {method(i)}</p>
      <ul className="space-y-0.5 text-xs" aria-label="주의 사항">
        {warnings(i).map((w) => (
          <li key={w.text} className={w.serious ? "font-semibold text-danger" : "text-text-secondary"}>
            • {w.text}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {links && (
          <>
            <a href={links.naver} target="_blank" rel="noopener noreferrer" className={linkCls}>
              네이버 매물 보기
            </a>
            <a href={links.kb} target="_blank" rel="noopener noreferrer" className={linkCls}>
              KB부동산에서 찾기
            </a>
          </>
        )}
        {i.detailUrl && (
          <a href={i.detailUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
            온비드 상세 보기
          </a>
        )}
        {i.estimateKrw !== null && (
          <button type="button" aria-expanded={showComps} onClick={() => setShowComps((v) => !v)} className="min-h-11 px-3 text-sm font-semibold text-text-secondary">
            {showComps ? "비교 거래 숨기기" : `비교 거래 ${i.comparableCount}건 보기`}
          </button>
        )}
      </div>
      {showComps && <Comparables i={i} />}
    </li>
  );
}

function clusterHtml(c: Cluster<GeoSearchItem>): string {
  const base =
    "display:inline-block;white-space:nowrap;padding:3px 8px;border-radius:999px;font:700 12px/1.3 system-ui,sans-serif;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff;transform:translate(-50%,-100%);cursor:pointer";
  if (c.items.length === 1) {
    const i = c.items[0]!;
    return `<div style="${base};background:${KIND_COLOR[i.kind]}">${markerLabel(i.priceKrw ?? 0, i.discount)}</div>`;
  }
  const kinds = new Set(c.items.map((i) => i.kind));
  const color = kinds.size === 1 ? KIND_COLOR[c.items[0]!.kind] : "#334155";
  const best = Math.max(...c.items.map((i) => i.discount ?? -1));
  return `<div style="${base};background:${color}">${c.items.length}건${best >= 0 ? ` · 최대 -${Math.round(best * 100)}%` : ""}</div>`;
}

function FilterSheet({ draft, setDraft, onApply, onClose }: { draft: SearchFilters; setDraft: (f: SearchFilters) => void; onApply: () => void; onClose: () => void }) {
  const umds = useQuery({ queryKey: ["umds", draft.sgg], enabled: Boolean(draft.sgg), queryFn: () => api.umdList(getClient(), draft.sgg as string), staleTime: 3_600_000 });
  const complexes = useQuery({ queryKey: ["complexes", draft.sgg], enabled: Boolean(draft.sgg), queryFn: () => api.complexes(getClient(), draft.sgg as string), staleTime: 3_600_000 });
  const names = useMemo(
    () => [...new Set((complexes.data ?? []).filter((c) => !draft.umd || c.umdName === draft.umd).map((c) => c.aptName))].sort((a, b) => a.localeCompare(b, "ko")),
    [complexes.data, draft.umd],
  );
  const toMan = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v) * 10_000));
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="max-h-[85vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="sheet-title" className="text-lg font-bold">
            상세 필터
          </h2>
          <button type="button" className="min-h-11 px-3 text-sm text-muted" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="읍면동" value={draft.umd ?? ""} disabled={!draft.sgg} hint={!draft.sgg ? "시군구를 먼저 고르세요" : undefined} onChange={(e) => setDraft({ ...draft, umd: e.target.value || null })}>
            <option value="">전체</option>
            {(umds.data ?? []).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectField>
          <TextField label="단지명" value={draft.apt} maxLength={60} list="apt-names" placeholder="예: 래미안" onChange={(e) => setDraft({ ...draft, apt: e.target.value })} hint={draft.sgg ? undefined : "시군구를 고르면 자동완성됩니다"} />
          <datalist id="apt-names">
            {names.slice(0, 300).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">매매가격 직접 입력 (억 원)</legend>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="최소" inputMode="decimal" value={draft.priceMin === null ? "" : String(draft.priceMin / 10_000)} onChange={(e) => setDraft({ ...draft, priceMin: toMan(e.target.value) })} />
            <TextField label="최대" inputMode="decimal" value={draft.priceMax === null ? "" : String(draft.priceMax / 10_000)} onChange={(e) => setDraft({ ...draft, priceMax: toMan(e.target.value) })} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">전용면적</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(AREA_BANDS) as AreaBand[]).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={draft.area === a}
                onClick={() => setDraft({ ...draft, area: a })}
                className={`min-h-11 rounded-full border px-3 text-sm ${draft.area === a ? "border-brand bg-brand text-white" : "border-border"}`}
              >
                {AREA_BANDS[a].label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="준공 연도" value={draft.built ?? ""} onChange={(e) => setDraft({ ...draft, built: e.target.value ? Number(e.target.value) : null })} hint="공매에는 준공 연도가 없어 이 조건을 쓰면 공매가 빠집니다">
            <option value="">전체</option>
            {BUILT_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}년 이내
              </option>
            ))}
          </SelectField>
          <SelectField label="거래 기간 (실거래)" value={draft.days} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}>
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                최근 {daysLabel(d)}
              </option>
            ))}
          </SelectField>
          <SelectField label="거래량 (이 단지 최근 1년)" value={draft.volumeMin ?? ""} onChange={(e) => setDraft({ ...draft, volumeMin: e.target.value ? Number(e.target.value) : null })}>
            <option value="">전체</option>
            {VOLUME_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}건 이상
              </option>
            ))}
          </SelectField>
          <SelectField label="정렬" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as Sort })}>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s]}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={draft.belowAvg} onChange={(e) => setDraft({ ...draft, belowAvg: e.target.checked })} />
          평당가가 법정동 평균(최근 1년 중위값)보다 낮은 것만
        </label>
        <fieldset disabled className="space-y-1 rounded-lg bg-surface-muted p-3">
          <legend className="sr-only">준비 중인 필터</legend>
          <p className="text-sm font-semibold text-muted">준비 중 (데이터 확보 후 제공)</p>
          <p className="text-xs text-muted">세대수 · 전세가율 · 갭투자금 (공공데이터 활용 승인 대기) · 역세권 (역 위치 데이터 확보 필요) · 투자 위험 지표 (3차)</p>
        </fieldset>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setDraft({ ...draft, umd: null, apt: "", priceMin: null, priceMax: null, area: "all", built: null, days: DEFAULT_FILTERS.days, volumeMin: null, belowAvg: false, sort: DEFAULT_FILTERS.sort })}
          >
            초기화
          </Button>
          <Button className="flex-1" onClick={onApply}>
            적용
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SearchMap() {
  const mapRef = useRef<{ maps: NaverMaps; map: NaverMap } | null>(null);
  const markers = useRef<NaverMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [draft, setDraft] = useState<SearchFilters>(() => parseFilters(window.location.search));
  const [filters, apply] = useUrlFilters((f) => {
    setDraft(f);
    if (f.view !== "map") {
      // the map element unmounts in the list view
      mapRef.current = null;
      markers.current = [];
      setMapReady(false);
    }
  });
  const [sheet, setSheet] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [listCount, setListCount] = useState(30);

  const codes = regionCodes(filters);
  const args = useMemo(() => toSearchArgs(filters), [filters]);
  const result = useQuery({
    queryKey: ["search", serializeFilters({ ...filters, view: "map" })],
    enabled: codes.length > 0,
    queryFn: () => api.search(getClient(), args),
  });
  const items = useMemo(() => result.data?.items ?? [], [result.data]);
  const geoItems = useMemo(() => items.filter((i): i is GeoSearchItem => i.lat !== null && i.lng !== null), [items]);
  const newest = useMemo(() => items.reduce<string | null>((m, i) => (i.computedAt && (!m || i.computedAt > m) ? i.computedAt : m), null), [items]);

  // ---- map
  const clientId = useQuery({ queryKey: ["naverMapClientId"], queryFn: api.naverMapClientId, staleTime: Infinity });
  const [authFailed, setAuthFailed] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const [zoom, setZoom] = useState(11);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (filters.view !== "map" || !clientId.data || !mapEl.current || mapRef.current) return;
    let cancelled = false;
    loadNaverMaps(clientId.data, () => setAuthFailed(true))
      .then((maps) => {
        if (cancelled || !mapEl.current) return;
        programmatic.current = true; // the first idle is the initial view, not a user move
        const map = new maps.Map(mapEl.current, { center: new maps.LatLng(37.5665, 126.978), zoom: 11, zoomControl: true });
        maps.Event.addListener(map, "idle", () => {
          setZoom(map.getZoom());
          if (programmatic.current) programmatic.current = false;
          else setMoved(true);
        });
        mapRef.current = { maps, map };
        setMapReady(true);
      })
      .catch(() => setAuthFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId.data, filters.view]);

  // Fit the view to new results (not when the search was "this map area").
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady || filters.bounds || !geoItems.length) return;
    programmatic.current = true;
    setMoved(false);
    if (geoItems.length === 1) {
      m.map.setCenter(new m.maps.LatLng(geoItems[0]!.lat, geoItems[0]!.lng));
      m.map.setZoom(15);
    } else {
      const b = new m.maps.LatLngBounds(new m.maps.LatLng(geoItems[0]!.lat, geoItems[0]!.lng), new m.maps.LatLng(geoItems[0]!.lat, geoItems[0]!.lng));
      for (const i of geoItems) b.extend(new m.maps.LatLng(i.lat, i.lng));
      m.map.fitBounds(b, { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }, [geoItems, mapReady, filters.bounds]);

  const clusters = useMemo(() => clusterItems(geoItems, zoom), [geoItems, zoom]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady) return;
    for (const mk of markers.current) mk.setMap(null);
    markers.current = clusters.map((c) => {
      const mk = new m.maps.Marker({
        position: new m.maps.LatLng(c.lat, c.lng),
        map: m.map,
        title: c.items.length === 1 ? c.items[0]!.name : `${c.items.length}건`,
        icon: { content: clusterHtml(c) },
        zIndex: Math.round((c.items[0]!.discount ?? 0) * 1000),
      });
      m.maps.Event.addListener(mk, "click", () => {
        const sameSpot = c.items.every((i) => i.lat === c.items[0]!.lat && i.lng === c.items[0]!.lng);
        if (c.items.length > 1 && !sameSpot && zoom < 14) {
          programmatic.current = true;
          m.map.setCenter(new m.maps.LatLng(c.lat, c.lng));
          m.map.setZoom(Math.min(zoom + 2, 16));
        } else setSelected(c.key);
      });
      return mk;
    });
  }, [clusters, mapReady, zoom]);

  const selectedItems = clusters.find((c) => c.key === selected)?.items ?? null;

  const searchHere = () => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.map.getBounds();
    const sw = b.getSW();
    const ne = b.getNE();
    setMoved(false);
    apply({ ...filters, sgg: null, umd: null, bounds: [sw.lat(), sw.lng(), ne.lat(), ne.lng()] });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSelected(null);
    setListCount(30);
    apply({ ...draft, bounds: draft.sido === filters.sido && draft.sgg === filters.sgg ? draft.bounds : null });
  };

  const chips = activeChips(filters);
  const pKey = priceKey(draft);
  const notConfigured = clientId.isSuccess && !clientId.data;

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="sticky top-14 z-20 -mx-4 space-y-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur" aria-label="지도 검색">
        <RegionPicker idPrefix="search" value={{ sido: draft.sido, lawdCd: draft.sgg }} onChange={(r) => setDraft({ ...draft, sido: r.sido, sgg: r.lawdCd, umd: null, apt: "", bounds: null })} allowWholeSido />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="매물 유형">
          {(["all", ...KINDS] as const).map((k) => {
            const on = k === "all" ? draft.types.length === 0 : draft.types.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (k === "all") return setDraft({ ...draft, types: [] });
                  const next = draft.types.includes(k) ? draft.types.filter((t) => t !== k) : [...draft.types, k];
                  setDraft({ ...draft, types: next.length === KINDS.length ? [] : next });
                }}
                className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${on ? "border-transparent text-white" : "border-border text-text-secondary"}`}
                style={on ? { background: k === "all" ? "#4f46e5" : KIND_COLOR[k] } : undefined}
              >
                {k === "all" ? "전체" : KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
          <SelectField
            label="가격"
            value={pKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") return setSheet(true);
              const p = v === "all" ? { min: null, max: null } : PRICE_PRESETS[Number(v)]!;
              setDraft({ ...draft, priceMin: p.min, priceMax: p.max });
            }}
          >
            <option value="all">전체</option>
            {PRICE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
            <option value="custom">{pKey === "custom" ? priceRangeLabel(draft.priceMin, draft.priceMax) : "직접 입력…"}</option>
          </SelectField>
          <SelectField label="시세 대비 할인율" value={draft.discountMin ?? ""} onChange={(e) => setDraft({ ...draft, discountMin: e.target.value ? Number(e.target.value) : null })}>
            <option value="">제한 없음 (비교 불가 포함)</option>
            {DISCOUNT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}% 이상
              </option>
            ))}
          </SelectField>
          <Button variant="secondary" onClick={() => setSheet(true)} aria-haspopup="dialog">
            상세
          </Button>
          <Button type="submit">검색</Button>
        </div>
      </form>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="적용된 필터">
          {chips.map((c) => (
            <li key={c.key}>
              <button type="button" onClick={() => apply({ ...filters, ...c.clear })} className="min-h-9 rounded-full bg-surface-muted px-3 text-xs font-semibold" aria-label={`${c.label} 필터 해제`}>
                {c.label} ✕
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => apply({ ...DEFAULT_FILTERS, sido: filters.sido, sgg: filters.sgg, view: filters.view })} className="min-h-9 px-2 text-xs font-semibold text-brand-text">
              전체 초기화
            </button>
          </li>
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="보기 방식" className="inline-flex rounded-lg border border-border p-0.5">
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={filters.view === v}
              onClick={() => apply({ ...filters, view: v }, true)}
              className={`min-h-10 rounded-md px-4 text-sm font-semibold ${filters.view === v ? "bg-brand text-white" : "text-text-secondary"}`}
            >
              {v === "map" ? "지도" : "목록"}
            </button>
          ))}
        </div>
        {result.isSuccess && (
          <p className="text-xs text-muted" aria-live="polite">
            {result.data.total.toLocaleString("ko-KR")}건{result.data.total > items.length ? ` 중 ${items.length}건 표시` : ""}
            {filters.view === "map" && items.length > geoItems.length ? ` · 좌표 준비 중 ${items.length - geoItems.length}건은 목록에서만 보입니다` : ""}
            {newest ? ` · 할인율 계산 ${relativeKo(newest)}` : ""}
          </p>
        )}
      </div>

      {filters.view === "map" &&
        (notConfigured || authFailed ? (
          <ErrorState error={new Error(authFailed ? "네이버 지도를 불러오지 못했습니다 (인증 또는 네트워크 문제). 목록 보기를 이용하거나 잠시 후 다시 시도해 주세요." : "지도가 아직 설정되지 않았습니다. 목록 보기를 이용하세요.")} />
        ) : clientId.isError ? (
          <ErrorState error={clientId.error} onRetry={() => clientId.refetch()} />
        ) : (
          <div className="relative">
            <div ref={mapEl} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-border bg-surface-muted" role="application" aria-label="검색 결과 지도" />
            {moved && (
              <button type="button" onClick={searchHere} className="absolute left-1/2 top-3 z-10 min-h-11 -translate-x-1/2 rounded-full bg-surface px-4 text-sm font-semibold shadow-lg">
                현재 지도 영역에서 검색
              </button>
            )}
            <ul className="pointer-events-none absolute bottom-2 left-2 z-10 space-y-0.5 rounded-lg bg-surface/90 p-2 text-xs" aria-label="범례">
              {KINDS.map((k) => (
                <li key={k}>
                  <span className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: KIND_COLOR[k] }} />
                  {KIND_LABEL[k]}
                </li>
              ))}
            </ul>
          </div>
        ))}

      {!codes.length ? (
        <EmptyState title="시도를 먼저 선택하세요." />
      ) : result.isLoading ? (
        <Loading rows={3} />
      ) : result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : !items.length ? (
        <EmptyState
          title="조건에 맞는 결과가 없습니다"
          description="할인율이나 가격 조건을 넓히거나 지역을 바꿔 보세요. 실거래가는 전국에서 차례로 받고 있어 아직 비교 시세가 없는 단지도 있습니다."
          action={
            <Button variant="secondary" onClick={() => apply({ ...DEFAULT_FILTERS, sido: filters.sido, sgg: filters.sgg, view: filters.view })}>
              조건 초기화
            </Button>
          }
        />
      ) : filters.view === "map" ? (
        selectedItems ? (
          <section aria-label="선택한 위치" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">선택한 위치 {selectedItems.length}건</h2>
              <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={() => setSelected(null)}>
                닫기
              </button>
            </div>
            <ul className="space-y-3">
              {selectedItems.map((i) => (
                <ItemCard key={i.id} i={i} />
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-text-secondary">지도의 마커를 누르면 거래·공매 상세(비교 시세, 산정 방법, 출처)가 여기에 나옵니다. 묶음 마커는 누르면 확대됩니다.</p>
        )
      ) : (
        <section aria-label="검색 결과 목록" className="space-y-3">
          <ul className="space-y-3">
            {items.slice(0, listCount).map((i) => (
              <ItemCard key={i.id} i={i} />
            ))}
          </ul>
          {listCount < items.length && (
            <Button variant="secondary" className="w-full" onClick={() => setListCount((n) => n + 30)}>
              더 보기 ({items.length - listCount}건 남음)
            </Button>
          )}
        </section>
      )}

      <p className="rounded-lg bg-surface-muted p-3 text-xs text-text-secondary">
        할인율 = (비교 시세 − 대상 가격) ÷ 비교 시세. 비교 시세는 같은 단지(법정동·지번), 비슷한 전용면적(±3%, 부족하면 ±8%), 최근 6개월(부족하면 12개월) 실거래 3건 이상의 ㎡당 중위가에 면적과 층을
        보정한 값입니다. 3건 미만이면 &lsquo;비교 불가&rsquo;로 표시하고 할인율을 만들지 않습니다. 실거래는 이미 계약이 끝난 거래이며, 지금 나와 있는 매물(호가)은 네이버·KB 링크에서 확인하세요. 투자 조언이
        아닙니다.
      </p>
      {sheet && (
        <FilterSheet
          draft={draft}
          setDraft={setDraft}
          onClose={() => setSheet(false)}
          onApply={() => {
            setSheet(false);
            setSelected(null);
            setListCount(30);
            apply({ ...draft, bounds: draft.sido === filters.sido && draft.sgg === filters.sgg ? draft.bounds : null });
          }}
        />
      )}
    </div>
  );
}

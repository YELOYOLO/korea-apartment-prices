"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuctionValuation } from "@kr/auction.ts";
import type { BargainDeal, Flagship } from "@kr/bargains.ts";
import { formatKrwShort, M2_PER_PYEONG } from "@kr/valuation.ts";
import * as api from "@/lib/api";
import { getClient } from "@/lib/supabase";
import { sggName, useBargainData } from "@/lib/useBargainData";
import { AuctionCard, DealCard, Links } from "./Bargains";
import { RegionPicker } from "./RegionPicker";
import { EmptyState, ErrorState, Loading } from "./ui";

/* Minimal typing of the parts of the Naver Maps JS API v3 used here. */
type LatLng = object;
interface NaverMaps {
  Map: new (el: HTMLElement, opts: { center: LatLng; zoom: number; zoomControl?: boolean }) => NaverMap;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => { extend(p: LatLng): void };
  Marker: new (opts: { position: LatLng; map: NaverMap; icon?: { content: string; anchor?: object }; zIndex?: number; title?: string }) => NaverMarker;
  Point: new (x: number, y: number) => object;
  Event: { addListener(target: object, name: string, fn: () => void): object };
}
interface NaverMap {
  fitBounds(b: object, margin?: object): void;
  setCenter(p: LatLng): void;
  setZoom(z: number): void;
}
interface NaverMarker {
  setMap(m: NaverMap | null): void;
}
declare global {
  interface Window {
    naver?: { maps: NaverMaps };
    navermap_authFailure?: () => void;
  }
}

let scriptPromise: Promise<NaverMaps> | null = null;
function loadNaverMaps(clientId: string, onAuthFailure: () => void): Promise<NaverMaps> {
  window.navermap_authFailure = onAuthFailure;
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    s.async = true;
    s.onload = () => (window.naver?.maps ? resolve(window.naver.maps) : reject(new Error("네이버 지도를 불러오지 못했습니다.")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("네이버 지도 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

type Pin =
  | { kind: "flagship"; key: string; lat: number; lng: number; flagship: Flagship; deals: BargainDeal[] }
  | { kind: "auction"; key: string; lat: number; lng: number; auction: AuctionValuation };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pinHtml(p: Pin): string {
  const base =
    "display:inline-block;white-space:nowrap;padding:3px 8px;border-radius:999px;font:600 12px/1.3 system-ui,sans-serif;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff;transform:translate(-50%,-100%);cursor:pointer";
  if (p.kind === "auction") return `<div style="${base};background:#d97706">공매 ${Math.round((p.auction.ratio ?? 0) * 100)}%</div>`;
  const f = p.flagship;
  if (p.deals.length) return `<div style="${base};background:#dc2626">급매 ${p.deals.length} · ${esc(f.aptName)}</div>`;
  return `<div style="${base};background:#4f46e5">${f.rank}위 ${esc(f.aptName)}</div>`;
}

function Detail({ pin }: { pin: Pin }) {
  if (pin.kind === "auction") {
    return (
      <ul>
        <AuctionCard v={pin.auction} />
      </ul>
    );
  }
  const f = pin.flagship;
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
        <p className="font-bold">
          <span className="mr-1 text-brand-text">
            {sggName(f.lawdCd)} {f.rank}위
          </span>
          {f.aptName}
          <span className="ml-1 text-sm font-normal text-muted">
            {f.umdName}
            {f.buildYear ? ` · ${f.buildYear}년` : ""}
          </span>
        </p>
        <p className="text-sm text-text-secondary">
          평당 {formatKrwShort(f.medianPricePerM2 * M2_PER_PYEONG)} · 최근 1년 거래 {f.dealCount}건 · 마지막 {f.lastDealDate}
        </p>
        <Links f={f} />
      </div>
      {pin.deals.length > 0 && (
        <ul className="space-y-3">
          {pin.deals.map((d) => (
            <DealCard key={d.trade.sourceKey} d={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MapView() {
  const { region, setRegion, list, dealsBySeq, cheapAuctions, loading, error, retry } = useBargainData();
  const [authFailed, setAuthFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ maps: NaverMaps; map: NaverMap } | null>(null);
  const markers = useRef<NaverMarker[]>([]);

  const clientId = useQuery({ queryKey: ["naverMapClientId"], queryFn: api.naverMapClientId, staleTime: Infinity });
  const lotKeys = useMemo(
    () => [...list.map((f) => `${f.lawdCd}|${f.umdName}|${f.jibun}`), ...cheapAuctions.map((a) => `${a.item.lawdCd}|${a.item.emd}|${a.item.jibun}`)],
    [list, cheapAuctions],
  );
  const geo = useQuery({ queryKey: ["geo", lotKeys.join(",")], enabled: lotKeys.length > 0, queryFn: () => api.geoPoints(getClient(), lotKeys) });

  const pins: Pin[] = useMemo(() => {
    if (!geo.data) return [];
    const out: Pin[] = [];
    for (const f of list) {
      const key = `${f.lawdCd}|${f.umdName}|${f.jibun}`;
      const p = geo.data.get(key);
      if (p) out.push({ kind: "flagship", key: `f:${f.aptSeq}`, ...p, flagship: f, deals: dealsBySeq.get(f.aptSeq) ?? [] });
    }
    for (const a of cheapAuctions) {
      const p = geo.data.get(`${a.item.lawdCd}|${a.item.emd}|${a.item.jibun}`);
      // offset a little so it does not hide the complex's own pin
      if (p) out.push({ kind: "auction", key: `a:${a.item.sourceKey}`, lat: p.lat - 0.0004, lng: p.lng + 0.0004, auction: a });
    }
    return out;
  }, [geo.data, list, dealsBySeq, cheapAuctions]);
  const missing = list.length + cheapAuctions.length - pins.length;

  // Create the map once the key is known.
  useEffect(() => {
    if (!clientId.data || !mapEl.current || mapRef.current) return;
    let cancelled = false;
    loadNaverMaps(clientId.data, () => setAuthFailed(true))
      .then((maps) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = { maps, map: new maps.Map(mapEl.current, { center: new maps.LatLng(37.5665, 126.978), zoom: 11, zoomControl: true }) };
        setMapReady(true);
      })
      .catch(() => setAuthFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId.data]);

  // Draw the pins and fit the view to them.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady) return;
    for (const mk of markers.current) mk.setMap(null);
    markers.current = [];
    if (!pins.length) return;
    let bounds: { extend(p: LatLng): void } | null = null;
    for (const p of pins) {
      const pos = new m.maps.LatLng(p.lat, p.lng);
      const mk = new m.maps.Marker({
        position: pos,
        map: m.map,
        title: p.kind === "flagship" ? p.flagship.aptName : p.auction.item.name,
        icon: { content: pinHtml(p) },
        zIndex: p.kind === "auction" ? 300 : p.deals.length ? 200 : 100,
      });
      m.maps.Event.addListener(mk, "click", () => setSelected(p.key));
      markers.current.push(mk);
      if (!bounds) bounds = new m.maps.LatLngBounds(pos, pos);
      else bounds.extend(pos);
    }
    if (pins.length === 1) {
      m.map.setCenter(new m.maps.LatLng(pins[0]!.lat, pins[0]!.lng));
      m.map.setZoom(15);
    } else if (bounds) {
      m.map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    }
  }, [pins, mapReady]);

  const pin = pins.find((p) => p.key === selected) ?? null;
  const notConfigured = clientId.isSuccess && !clientId.data;

  return (
    <div className="space-y-4">
      <RegionPicker idPrefix="map" value={region} onChange={(r) => (setSelected(null), setRegion(r))} allowWholeSido />
      <ul className="flex flex-wrap gap-3 text-xs text-text-secondary" aria-label="범례">
        <li>
          <span className="mr-1 inline-block size-3 rounded-full bg-[#4f46e5] align-middle" />
          대장 아파트
        </li>
        <li>
          <span className="mr-1 inline-block size-3 rounded-full bg-[#dc2626] align-middle" />
          최근 90일 15% 이상 싸게 거래
        </li>
        <li>
          <span className="mr-1 inline-block size-3 rounded-full bg-[#d97706] align-middle" />
          공매 (최저가 시세 85% 이하)
        </li>
      </ul>
      {notConfigured || authFailed ? (
        <ErrorState error={new Error(authFailed ? "네이버 지도 인증에 실패했습니다. NCP 콘솔의 Client ID와 Web 서비스 URL을 확인해 주세요." : "지도가 아직 설정되지 않았습니다.")} />
      ) : clientId.isError ? (
        <ErrorState error={clientId.error} onRetry={() => clientId.refetch()} />
      ) : (
        <div ref={mapEl} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-border bg-surface-muted" role="application" aria-label="대장 아파트 지도" />
      )}
      {loading || geo.isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : !list.length ? (
        <EmptyState title="아직 대장 아파트를 고를 실거래가 부족합니다" description="실거래가를 전국에서 차례로 받고 있으니 잠시 뒤 다시 확인하세요." />
      ) : (
        <>
          {missing > 0 && <p className="text-xs text-muted">{missing}곳은 아직 좌표를 준비 중이라 지도에 없습니다 (매시간 추가됩니다).</p>}
          {pin ? <Detail pin={pin} /> : <p className="text-sm text-text-secondary">지도의 핀을 누르면 단지 정보와 급매 거래, 매물 링크가 여기에 나옵니다.</p>}
        </>
      )}
    </div>
  );
}

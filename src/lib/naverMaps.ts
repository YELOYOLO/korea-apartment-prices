"use client";

/* Loader and minimal typing for the Naver Maps JS API v3 (NCP Maps, ncpKeyId). */
export type LatLng = object;
export interface NaverMap {
  fitBounds(b: object, margin?: object): void;
  setCenter(p: LatLng): void;
  setZoom(z: number): void;
  getZoom(): number;
  getBounds(): { getSW(): { lat(): number; lng(): number }; getNE(): { lat(): number; lng(): number } };
}
export interface NaverMarker {
  setMap(m: NaverMap | null): void;
}
export interface NaverMaps {
  Map: new (el: HTMLElement, opts: { center: LatLng; zoom: number; zoomControl?: boolean; zoomControlOptions?: object }) => NaverMap;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => { extend(p: LatLng): void };
  Marker: new (opts: { position: LatLng; map: NaverMap; icon?: { content: string }; zIndex?: number; title?: string }) => NaverMarker;
  Event: { addListener(target: object, name: string, fn: () => void): object; removeListener(l: object): void };
}
declare global {
  interface Window {
    naver?: { maps: NaverMaps };
    navermap_authFailure?: () => void;
  }
}

let scriptPromise: Promise<NaverMaps> | null = null;

export function loadNaverMaps(clientId: string, onAuthFailure: () => void): Promise<NaverMaps> {
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

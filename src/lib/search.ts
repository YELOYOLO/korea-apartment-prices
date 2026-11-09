/**
 * 지도 검색 filters: defaults, URL query round trip, RPC arguments for kr_search (0004),
 * marker labels and marker clustering. Pure functions (tested in tests/search.test.ts).
 */
import { KR_REGIONS, KR_SIDO, krRegion } from "@kr/regions.ts";

export const KINDS = ["flagship", "lowdeal", "auction"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { flagship: "대장 급매", lowdeal: "저가 실거래", auction: "공매" };
/** Marker colors: 대장 = purple, 저가 실거래 = red, 공매 = orange (spec 5). */
export const KIND_COLOR: Record<Kind, string> = { flagship: "#7c3aed", lowdeal: "#dc2626", auction: "#d97706" };

export const AREA_BANDS = {
  all: { label: "전체 면적", min: null, max: null },
  s: { label: "59㎡ 이하", min: null, max: 60 },
  m: { label: "59~84㎡", min: 60, max: 85 },
  l: { label: "84~114㎡", min: 85, max: 115 },
  xl: { label: "114㎡ 초과", min: 115, max: null },
} as const;
export type AreaBand = keyof typeof AREA_BANDS;

/** 만원 bounds. */
export const PRICE_PRESETS = [
  { label: "3억 이하", min: null, max: 30_000 },
  { label: "3~6억", min: 30_000, max: 60_000 },
  { label: "6~9억", min: 60_000, max: 90_000 },
  { label: "9~15억", min: 90_000, max: 150_000 },
  { label: "15억 이상", min: 150_000, max: null },
] as const;

export const DISCOUNT_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40] as const;
export const BUILT_OPTIONS = [5, 10, 20, 30] as const;
export const DAYS_OPTIONS = [30, 90, 180, 365] as const;
export const SORTS = { discount: "할인율 높은 순", price: "가격 낮은 순", newest: "최신 순" } as const;
export type Sort = keyof typeof SORTS;

export interface SearchFilters {
  sido: string | null;
  sgg: string | null;
  umd: string | null;
  apt: string;
  /** Empty = every kind. */
  types: Kind[];
  /** 만원. */
  priceMin: number | null;
  priceMax: number | null;
  /** Percent; null = no limit (also shows 비교 불가 items). */
  discountMin: number | null;
  area: AreaBand;
  /** 준공 N년 이내. */
  built: number | null;
  days: number;
  sort: Sort;
  view: "map" | "list";
  /** [south, west, north, east] when searching the current map area. */
  bounds: [number, number, number, number] | null;
}

export const DEFAULT_FILTERS: SearchFilters = {
  sido: "서울특별시",
  sgg: null,
  umd: null,
  apt: "",
  types: [],
  priceMin: null,
  priceMax: null,
  discountMin: 15,
  area: "all",
  built: null,
  days: 90,
  sort: "discount",
  view: "map",
  bounds: null,
};

const int = (v: string | null, lo: number, hi: number): number | null => {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};

export function parseFilters(qs: string): SearchFilters {
  const p = new URLSearchParams(qs);
  const f: SearchFilters = { ...DEFAULT_FILTERS };
  const sido = p.get("sido");
  if (sido !== null) f.sido = KR_SIDO.includes(sido) ? sido : null;
  const sgg = p.get("sgg");
  if (sgg && krRegion(sgg) && (sido === null || krRegion(sgg)!.sido === f.sido)) {
    f.sgg = sgg;
    f.sido = krRegion(sgg)!.sido;
  }
  const umd = p.get("umd");
  if (f.sgg && umd && umd.length <= 40) f.umd = umd;
  f.apt = (p.get("apt") ?? "").slice(0, 60);
  const types = (p.get("type") ?? "").split(",").filter((t): t is Kind => (KINDS as readonly string[]).includes(t));
  f.types = types.length === KINDS.length ? [] : [...new Set(types)];
  f.priceMin = int(p.get("pmin"), 0, 10_000_000);
  f.priceMax = int(p.get("pmax"), 0, 10_000_000);
  if (p.has("dmin")) {
    const d = int(p.get("dmin"), 0, 90);
    f.discountMin = d === null || d === 0 ? null : d;
  }
  const area = p.get("area");
  if (area && area in AREA_BANDS) f.area = area as AreaBand;
  f.built = int(p.get("built"), 1, 100);
  const days = int(p.get("days"), 1, 366);
  if (days) f.days = days;
  const sort = p.get("sort");
  if (sort && sort in SORTS) f.sort = sort as Sort;
  if (p.get("view") === "list") f.view = "list";
  const b = (p.get("b") ?? "").split(",").map(Number);
  if (b.length === 4 && b.every(Number.isFinite) && b[0]! < b[2]! && b[1]! < b[3]!) f.bounds = b as [number, number, number, number];
  return f;
}

/** Only values that differ from the defaults, so shared links stay short. */
export function serializeFilters(f: SearchFilters): string {
  const p = new URLSearchParams();
  if (f.sido !== DEFAULT_FILTERS.sido) p.set("sido", f.sido ?? "");
  if (f.sgg) p.set("sgg", f.sgg);
  if (f.sgg && f.umd) p.set("umd", f.umd);
  if (f.apt.trim()) p.set("apt", f.apt.trim());
  if (f.types.length && f.types.length < KINDS.length) p.set("type", f.types.join(","));
  if (f.priceMin !== null) p.set("pmin", String(f.priceMin));
  if (f.priceMax !== null) p.set("pmax", String(f.priceMax));
  if (f.discountMin !== DEFAULT_FILTERS.discountMin) p.set("dmin", String(f.discountMin ?? 0));
  if (f.area !== "all") p.set("area", f.area);
  if (f.built !== null) p.set("built", String(f.built));
  if (f.days !== DEFAULT_FILTERS.days) p.set("days", String(f.days));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.view !== "map") p.set("view", f.view);
  if (f.bounds) p.set("b", f.bounds.map((x) => x.toFixed(5)).join(","));
  return p.toString();
}

/** 시군구 codes searched: the chosen one, else every one of the 시도. */
export function regionCodes(f: Pick<SearchFilters, "sido" | "sgg">): string[] {
  if (f.sgg) return [f.sgg];
  return f.sido ? KR_REGIONS.filter((r) => r.sido === f.sido).map((r) => r.code) : [];
}

export function toSearchArgs(f: SearchFilters, now = new Date()) {
  const band = AREA_BANDS[f.area];
  return {
    p_lawd_codes: regionCodes(f),
    p_types: f.types.length ? f.types : [...KINDS],
    p_umd: f.sgg && f.umd ? f.umd : null,
    p_apt: f.apt.trim() || null,
    p_price_min: f.priceMin === null ? null : f.priceMin * 10_000,
    p_price_max: f.priceMax === null ? null : f.priceMax * 10_000,
    p_discount_min: f.discountMin === null ? null : f.discountMin / 100,
    p_area_min: band.min,
    p_area_max: band.max,
    p_built_after: f.built === null ? null : now.getFullYear() - f.built,
    p_days: f.days,
    p_bounds: f.bounds,
    p_sort: f.sort,
    p_limit: 500,
  };
}

/** Removable chips for the active (non-default) filters. */
export function activeChips(f: SearchFilters): Array<{ key: string; label: string; clear: Partial<SearchFilters> }> {
  const chips: Array<{ key: string; label: string; clear: Partial<SearchFilters> }> = [];
  if (f.umd) chips.push({ key: "umd", label: f.umd, clear: { umd: null } });
  if (f.apt.trim()) chips.push({ key: "apt", label: `단지명: ${f.apt.trim()}`, clear: { apt: "" } });
  if (f.types.length) chips.push({ key: "type", label: f.types.map((t) => KIND_LABEL[t]).join("·"), clear: { types: [] } });
  if (f.priceMin !== null || f.priceMax !== null) chips.push({ key: "price", label: priceRangeLabel(f.priceMin, f.priceMax), clear: { priceMin: null, priceMax: null } });
  if (f.discountMin !== DEFAULT_FILTERS.discountMin)
    chips.push({ key: "dmin", label: f.discountMin === null ? "할인율 제한 없음" : `할인율 ${f.discountMin}% 이상`, clear: { discountMin: DEFAULT_FILTERS.discountMin } });
  if (f.area !== "all") chips.push({ key: "area", label: AREA_BANDS[f.area].label, clear: { area: "all" } });
  if (f.built !== null) chips.push({ key: "built", label: `준공 ${f.built}년 이내`, clear: { built: null } });
  if (f.days !== DEFAULT_FILTERS.days) chips.push({ key: "days", label: `최근 ${daysLabel(f.days)}`, clear: { days: DEFAULT_FILTERS.days } });
  if (f.bounds) chips.push({ key: "b", label: "지도 영역", clear: { bounds: null } });
  return chips;
}

export function daysLabel(d: number): string {
  return d % 30 === 0 && d < 365 ? `${d / 30}개월` : d >= 365 ? "12개월" : `${d}일`;
}

/** 만원 -> "3억", "3.5억", "9,500만". */
export function manwonLabel(m: number): string {
  if (m >= 10_000) {
    const eok = m / 10_000;
    return `${Number.isInteger(eok) ? eok : eok.toFixed(1).replace(/\.0$/, "")}억`;
  }
  return `${m.toLocaleString("en-US")}만`;
}

export function priceRangeLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return min >= 10_000 && max >= 10_000 ? `${manwonLabel(min).replace(/억$/, "")}~${manwonLabel(max)}` : `${manwonLabel(min)}~${manwonLabel(max)}`;
  }
  if (min !== null) return `${manwonLabel(min)} 이상`;
  if (max !== null) return `${manwonLabel(max)} 이하`;
  return "가격 전체";
}

/** Marker text, e.g. "8.5억 · -22%" (or "· 비교 불가" without a market value). */
export function markerLabel(priceKrw: number, discount: number | null): string {
  const m = Math.round(priceKrw / 10_000);
  const price = m >= 10_000 ? `${(m / 10_000).toFixed(m >= 1_000_000 ? 0 : 1).replace(/\.0$/, "")}억` : `${m.toLocaleString("en-US")}만`;
  if (discount === null) return `${price} · 비교 불가`;
  const pct = Math.round(discount * 100);
  return `${price} · ${pct >= 0 ? `-${pct}` : `+${-pct}`}%`;
}

export interface GeoItem {
  id: string;
  lat: number;
  lng: number;
}

export interface Cluster<T extends GeoItem> {
  key: string;
  lat: number;
  lng: number;
  items: T[];
}

/**
 * Groups items for the map. Items at the same spot are always one marker; below
 * zoom 14 items are also grouped by a grid that halves with each zoom level.
 */
export function clusterItems<T extends GeoItem>(items: T[], zoom: number): Cluster<T>[] {
  const cell = zoom >= 14 ? 0 : 0.6 / 2 ** Math.max(zoom - 8, 0);
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = cell ? `${Math.floor(it.lat / cell)}:${Math.floor(it.lng / cell)}` : `${it.lat.toFixed(6)}:${it.lng.toFixed(6)}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return [...groups.entries()].map(([key, g]) => ({
    key: `${key}:${g.length}:${g[0]!.id}`,
    lat: g.reduce((s, x) => s + x.lat, 0) / g.length,
    lng: g.reduce((s, x) => s + x.lng, 0) / g.length,
    items: g,
  }));
}

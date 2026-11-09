/**
 * 자연어(음성) 검색 -> 지도 검색 조건.
 *
 * NlFilters has the shape of the map search filters (src/lib/search.ts SearchFilters
 * without the map bounds). normalizeFilters() validates anything that claims to be
 * filters (the AI's JSON included) against the allowed values; ruleParse() is a
 * keyword parser used when the AI is not available, so basic requests ("강남구 15억
 * 이하 84㎡ 20% 싼 공매") still work.
 * Pure TypeScript, used by the Next.js app tests and the ai-search Edge Function.
 */
import { KR_REGIONS, KR_SIDO, krRegion } from "./regions.ts";

export const NL_KINDS = ["flagship", "lowdeal", "auction"] as const;
export type NlKind = (typeof NL_KINDS)[number];
export const NL_AREAS = ["all", "s", "m", "l", "xl"] as const;
export const NL_SORTS = ["discount", "price", "newest", "volume"] as const;
export const NL_DAYS = [30, 90, 180, 365] as const;
export const NL_DISCOUNTS = [5, 10, 15, 20, 25, 30, 35, 40] as const;
export const NL_BUILT = [5, 10, 20, 30] as const;
export const NL_VOLUME = [3, 5, 10, 20] as const;

export interface NlFilters {
  sido: string | null;
  sgg: string | null;
  umd: string | null;
  apt: string;
  types: NlKind[];
  /** 만원 */
  priceMin: number | null;
  priceMax: number | null;
  /** percent, null = no limit */
  discountMin: number | null;
  area: (typeof NL_AREAS)[number];
  built: number | null;
  days: number;
  volumeMin: number | null;
  belowAvg: boolean;
  sort: (typeof NL_SORTS)[number];
  view: "map" | "list";
}

export const NL_DEFAULTS: NlFilters = {
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
  volumeMin: null,
  belowAvg: false,
  sort: "discount",
  view: "map",
};

/** Things people ask for that the site can't filter yet. */
export const NL_UNSUPPORTED: Array<{ re: RegExp; label: string }> = [
  { re: /역세권|역\s*근처|역에서|지하철/, label: "역세권" },
  { re: /전세가율|전세가|갭\s*투자|갭투자금|갭/, label: "전세가율·갭투자금" },
  { re: /세대수|\d+\s*세대|대단지/, label: "세대수" },
];

const nearest = (v: number, opts: readonly number[]) => opts.reduce((b, o) => (Math.abs(o - v) < Math.abs(b - v) ? o : b), opts[0]!);
const intOrNull = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

/** Anything (e.g. model JSON) -> valid filters; unknown or invalid fields keep `base`'s value. */
export function normalizeFilters(raw: unknown, base: NlFilters = NL_DEFAULTS): NlFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f: NlFilters = { ...base, types: [...base.types] };
  if ("sido" in r) f.sido = typeof r.sido === "string" && KR_SIDO.includes(r.sido) ? r.sido : r.sido === null ? null : f.sido;
  if ("sgg" in r) {
    const reg = typeof r.sgg === "string" ? krRegion(r.sgg) : undefined;
    if (reg) {
      f.sgg = reg.code;
      f.sido = reg.sido;
    } else if (r.sgg === null) f.sgg = null;
  }
  if (f.sgg && f.sido && krRegion(f.sgg)?.sido !== f.sido) f.sgg = null;
  if ("umd" in r) f.umd = typeof r.umd === "string" && r.umd.trim() && r.umd.length <= 40 ? r.umd.trim() : null;
  if (!f.sgg) f.umd = null;
  if ("apt" in r) f.apt = typeof r.apt === "string" ? r.apt.trim().slice(0, 60) : "";
  if ("types" in r && Array.isArray(r.types)) {
    const t = [...new Set(r.types.filter((x): x is NlKind => (NL_KINDS as readonly string[]).includes(x as string)))];
    f.types = t.length === NL_KINDS.length ? [] : t;
  }
  if ("priceMin" in r) f.priceMin = intOrNull(r.priceMin, 0, 10_000_000);
  if ("priceMax" in r) f.priceMax = intOrNull(r.priceMax, 0, 10_000_000);
  if (f.priceMin !== null && f.priceMax !== null && f.priceMin > f.priceMax) [f.priceMin, f.priceMax] = [f.priceMax, f.priceMin];
  if ("discountMin" in r) {
    const d = intOrNull(r.discountMin, 0, 100);
    f.discountMin = d === null || d === 0 ? null : nearest(d, NL_DISCOUNTS);
  }
  if ("area" in r && (NL_AREAS as readonly string[]).includes(r.area as string)) f.area = r.area as NlFilters["area"];
  if ("built" in r) {
    const b = intOrNull(r.built, 1, 100);
    f.built = b === null ? null : nearest(b, NL_BUILT);
  }
  if ("days" in r) {
    const d = intOrNull(r.days, 1, 3650);
    if (d !== null) f.days = nearest(d, NL_DAYS);
  }
  if ("volumeMin" in r) {
    const v = intOrNull(r.volumeMin, 1, 1000);
    f.volumeMin = v === null ? null : nearest(v, NL_VOLUME);
  }
  if ("belowAvg" in r && typeof r.belowAvg === "boolean") f.belowAvg = r.belowAvg;
  if ("sort" in r && (NL_SORTS as readonly string[]).includes(r.sort as string)) f.sort = r.sort as NlFilters["sort"];
  if ("view" in r && (r.view === "map" || r.view === "list")) f.view = r.view;
  return f;
}

const SIDO_ALIASES: Array<[RegExp, string]> = [
  [/서울/, "서울특별시"],
  [/부산/, "부산광역시"],
  [/대구/, "대구광역시"],
  [/인천/, "인천광역시"],
  [/대전/, "대전광역시"],
  [/울산/, "울산광역시"],
  [/세종/, "세종특별자치시"],
  [/경기/, "경기도"],
  [/충북|충청북/, "충청북도"],
  [/충남|충청남/, "충청남도"],
  [/경북|경상북/, "경상북도"],
  [/경남|경상남/, "경상남도"],
  [/제주/, "제주특별자치도"],
  [/강원/, "강원특별자치도"],
  [/전북|전라북/, "전북특별자치도"],
  [/광주|전남|전라남/, "전남광주통합특별시"],
];

/** 시군구 names people say: "강남구", "분당구", "수원시 장안구" -> "장안구", "수원시". */
function regionCandidates(): Array<{ word: string; code: string; sido: string }> {
  const out: Array<{ word: string; code: string; sido: string }> = [];
  for (const r of KR_REGIONS) {
    if (r.name === r.sido) continue;
    const parts = r.name.split(" ");
    out.push({ word: r.name.replace(/\s/g, ""), code: r.code, sido: r.sido });
    if (parts.length > 1) out.push({ word: parts[parts.length - 1]!, code: r.code, sido: r.sido });
  }
  return out.sort((a, b) => b.word.length - a.word.length);
}
const CANDIDATES = regionCandidates();

/** "15억", "15억5천", "9억 5000만", "8000만" -> 만원 */
function manwon(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*억(?:\s*(\d+(?:\.\d+)?)\s*(천|만)?)?|(\d[\d,]*)\s*만/);
  if (!m) return null;
  if (m[1]) {
    let v = parseFloat(m[1]) * 10_000;
    if (m[2]) v += m[3] === "천" ? parseFloat(m[2]) * 1_000 : parseFloat(m[2]);
    return Math.round(v);
  }
  return parseInt(m[4]!.replace(/,/g, ""), 10);
}

export interface RuleParseResult {
  filters: NlFilters;
  /** Short Korean labels of what was understood. */
  understood: string[];
  unsupported: string[];
}

export function ruleParse(input: string, current: NlFilters = NL_DEFAULTS): RuleParseResult {
  const text = input.replace(/\s+/g, " ").trim();
  const compact = text.replace(/\s/g, "");
  const reset = /초기화|처음부터|새로\s*검색|조건\s*(다\s*)?(지워|없애)/.test(text);
  const f: NlFilters = reset ? { ...NL_DEFAULTS, view: current.view } : { ...current, types: [...current.types] };
  const understood: string[] = reset ? ["조건 초기화"] : [];

  // region
  let sidoSaid: string | null = null;
  for (const [re, sido] of SIDO_ALIASES) {
    if (re.test(text)) {
      sidoSaid = sido;
      break;
    }
  }
  const hits = CANDIDATES.filter((c) => compact.includes(c.word) && c.word.length >= 2);
  const sggHit = hits.find((c) => c.sido === (sidoSaid ?? f.sido)) ?? hits[0];
  if (sggHit && /[구군시]$/.test(sggHit.word)) {
    f.sido = sggHit.sido;
    f.sgg = sggHit.code;
    f.umd = null;
    understood.push(`${krRegion(sggHit.code)!.name}`);
  } else if (sidoSaid) {
    f.sido = sidoSaid;
    f.sgg = null;
    f.umd = null;
    understood.push(sidoSaid);
  }
  const dong = text.match(/([가-힣]{1,5}\d?(?:동|읍|면|가))(?=\s|$|에|의|쪽|근처)/);
  if (dong && f.sgg && !/[구군시]$/.test(dong[1]!)) {
    f.umd = dong[1]!;
    understood.push(dong[1]!);
  }

  // types
  const types = new Set<NlKind>();
  if (/공매|경매/.test(text)) types.add("auction");
  if (/대장/.test(text)) types.add("flagship");
  if (/저가\s*실거래|실거래/.test(text)) types.add("lowdeal");
  if (/급매/.test(text) && !types.has("flagship")) {
    types.add("flagship");
    types.add("lowdeal");
  }
  if (/전체\s*유형|모든\s*유형|다\s*보여/.test(text)) types.clear();
  if (types.size || /전체\s*유형|모든\s*유형/.test(text)) {
    f.types = types.size === NL_KINDS.length ? [] : [...types];
    understood.push(f.types.length ? f.types.map((t) => ({ flagship: "대장 급매", lowdeal: "저가 실거래", auction: "공매" })[t]).join("·") : "전체 유형");
  }

  // price
  const range = text.match(/(\d+(?:\.\d+)?\s*억[^~\-에]*?)\s*(?:~|-|에서|부터)\s*(\d+(?:\.\d+)?\s*억[\d\s천만]*)/);
  const band = text.match(/(\d+(?:\.\d+)?)\s*억\s*대/);
  if (range) {
    f.priceMin = manwon(range[1]!);
    f.priceMax = manwon(range[2]!);
  } else if (band) {
    const v = parseFloat(band[1]!) * 10_000;
    f.priceMin = v;
    f.priceMax = v + 9_999;
  } else {
    const p = text.match(/((?:\d+(?:\.\d+)?\s*억(?:\s*\d+(?:\.\d+)?\s*(?:천|만)?)?)|\d[\d,]*\s*만)\s*(원)?\s*(이하|미만|까지|아래|안쪽|밑|이내|이상|초과|넘는|넘게|정도|쯤|내외|안팎)?/);
    if (p && /억|만/.test(p[1]!)) {
      const v = manwon(p[1]!);
      const q = p[3] ?? "";
      if (v !== null) {
        if (/이상|초과|넘/.test(q)) f.priceMin = v;
        else if (/정도|쯤|내외|안팎/.test(q)) {
          f.priceMin = Math.round(v * 0.9);
          f.priceMax = Math.round(v * 1.1);
        } else f.priceMax = v;
      }
    }
  }
  if (range || band || /억|만\s*원?/.test(text)) {
    if (f.priceMin !== null || f.priceMax !== null) understood.push("가격");
  }

  // discount
  const pct = text.match(/(\d{1,2})\s*(?:%|퍼센트|프로)/);
  if (pct) {
    f.discountMin = nearest(parseInt(pct[1]!, 10), NL_DISCOUNTS);
    understood.push(`할인율 ${f.discountMin}% 이상`);
  } else if (/반값/.test(text)) {
    f.discountMin = 40;
    understood.push("할인율 40% 이상");
  } else if (/할인율\s*(상관\s*없|제한\s*없|무관)/.test(text)) {
    f.discountMin = null;
    understood.push("할인율 제한 없음");
  }

  // area
  const py = text.match(/(\d{2})\s*평/);
  const m2 = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:㎡|제곱|m2|평방|형)/);
  if (/국평|국민\s*평형/.test(text)) f.area = "m";
  else if (py) {
    const n = parseInt(py[1]!, 10);
    f.area = n <= 25 ? "s" : n <= 35 ? "m" : n <= 45 ? "l" : "xl";
  } else if (m2) {
    const n = parseFloat(m2[1]!);
    f.area = n < 60 ? "s" : n < 85 ? "m" : n < 115 ? "l" : "xl";
  } else if (/소형/.test(text)) f.area = "s";
  else if (/중대형/.test(text)) f.area = "l";
  else if (/중형/.test(text)) f.area = "m";
  else if (/대형/.test(text)) f.area = "xl";
  if (/국평|국민\s*평형|평|㎡|제곱|m2|형|소형|중형|대형/.test(text) && f.area !== current.area) understood.push("면적");

  // built
  const by = text.match(/(\d{1,2})\s*년\s*(?:이내|이하|안\s*된|미만)/);
  if (/신축|새\s*아파트/.test(text) && !/준신축/.test(text)) f.built = 5;
  else if (/준신축/.test(text)) f.built = 10;
  else if (by && /준공|지은|된|연식|건축/.test(text)) f.built = nearest(parseInt(by[1]!, 10), NL_BUILT);
  if (f.built !== current.built && f.built !== null) understood.push(`준공 ${f.built}년 이내`);

  // period
  const per = text.match(/최근\s*(\d{1,2})\s*(개월|달|년)/);
  if (per) {
    const n = parseInt(per[1]!, 10) * (per[2] === "년" ? 12 : 1);
    f.days = nearest(n * 30, NL_DAYS);
    understood.push("거래 기간");
  }

  // volume / average
  const vol = text.match(/거래\s*(?:가|량이?)?\s*(\d{1,3})\s*건\s*이상/);
  if (vol) {
    f.volumeMin = nearest(parseInt(vol[1]!, 10), NL_VOLUME);
    understood.push(`거래 ${f.volumeMin}건 이상`);
  }
  if (/평당\s*가?\s*(가\s*)?(낮|싼|저렴)|평균\s*(보다|이하)/.test(text)) {
    f.belowAvg = true;
    understood.push("평당가 평균 이하");
  }

  // sort / view
  if (/싼\s*순|가격\s*(낮은|싼)\s*순|저렴한\s*순/.test(text)) f.sort = "price";
  else if (/최신\s*순|최근\s*순/.test(text)) f.sort = "newest";
  else if (/거래\s*(많은|량)\s*순|거래량/.test(text)) f.sort = "volume";
  else if (/할인율?\s*(높은|큰)\s*순|많이\s*싼\s*순/.test(text)) f.sort = "discount";
  if (f.sort !== current.sort) understood.push("정렬");
  if (/목록|리스트/.test(text)) f.view = "list";
  else if (/지도/.test(text)) f.view = "map";

  // 단지명: "OO아파트", "래미안" like words that are not regions
  const apt = text.match(/([가-힣A-Za-z0-9]{2,20})\s*(?:아파트|단지)/);
  if (apt && !/(대장|공매|저가|급매|싼|전체)/.test(apt[1]!)) {
    f.apt = apt[1]!;
    understood.push(`단지명 ${f.apt}`);
  }

  const unsupported = NL_UNSUPPORTED.filter((u) => u.re.test(text)).map((u) => u.label);
  return { filters: normalizeFilters(f, current), understood, unsupported };
}

/** One-line Korean summary of filters, for the agent's reply. */
export function describeFilters(f: NlFilters): string {
  const region = f.sgg ? `${krRegion(f.sgg)?.sido ?? ""} ${krRegion(f.sgg)?.name ?? ""}${f.umd ? ` ${f.umd}` : ""}`.trim() : (f.sido ?? "지역 미선택");
  const kinds = f.types.length ? f.types.map((t) => ({ flagship: "대장 급매", lowdeal: "저가 실거래", auction: "공매" })[t]).join("·") : "전체 유형";
  const man = (m: number) => (m >= 10_000 ? `${Number((m / 10_000).toFixed(1))}억` : `${m.toLocaleString("en-US")}만`);
  const price = f.priceMin !== null && f.priceMax !== null ? `${man(f.priceMin)}~${man(f.priceMax)}` : f.priceMin !== null ? `${man(f.priceMin)} 이상` : f.priceMax !== null ? `${man(f.priceMax)} 이하` : null;
  const area = { all: null, s: "59㎡ 이하", m: "59~84㎡", l: "84~114㎡", xl: "114㎡ 초과" }[f.area];
  return [
    region,
    kinds,
    price,
    f.discountMin === null ? "할인율 제한 없음" : `할인율 ${f.discountMin}% 이상`,
    area,
    f.built ? `준공 ${f.built}년 이내` : null,
    f.apt ? `단지명 "${f.apt}"` : null,
    f.volumeMin ? `거래 ${f.volumeMin}건 이상` : null,
    f.belowAvg ? "평당가 평균 이하" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

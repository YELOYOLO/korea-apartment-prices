/**
 * 국토교통부 아파트 매매 실거래가 (data.go.kr, "국토교통부_아파트 매매 실거래가 자료").
 *
 * Endpoint: GET https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade
 *   serviceKey  data.go.kr key (decoded form; it is URL-encoded here)
 *   LAWD_CD     5-digit 시군구 code from the 법정동코드 (마포구 = 11440)
 *   DEAL_YMD    deal month, YYYYMM
 *   pageNo, numOfRows
 *
 * The response is XML. Each <item> is one reported deal; dealAmount is in 만원
 * with thousands separators ("125,000" = 12.5억). A deal that was later
 * cancelled keeps its row with cdealType "O" and the cancellation date.
 *
 * Pure TypeScript with no dependencies: used by the Next.js app and the Edge Functions.
 */

export const MOLIT_APT_TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

/** 시군구 codes (LAWD_CD) supported so far. */
export const KR_LAWD_CODES = {
  MAPO: "11440",
} as const;

export interface AptTrade {
  /** Stable key for upserts: the same deal re-fetched later (e.g. after a cancellation) gets the same key. */
  sourceKey: string;
  lawdCd: string;
  /** MOLIT complex id (e.g. "11440-123"); empty in rows from before the field existed. */
  aptSeq: string | null;
  aptName: string;
  umdName: string;
  jibun: string | null;
  aptDong: string | null;
  /** 전용면적, m². */
  exclusiveAreaM2: number;
  /** Deal price in KRW (원). */
  priceKrw: number;
  /** YYYY-MM-DD */
  dealDate: string;
  floor: number | null;
  buildYear: number | null;
  /** 중개거래 / 직거래, as reported. */
  dealingType: string | null;
  cancelled: boolean;
  cancelDate: string | null;
}

export interface MolitParseResult {
  ok: boolean;
  /** "000" (or "00" in older responses) on success. */
  resultCode: string | null;
  resultMsg: string | null;
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  items: AptTrade[];
  /** Items that could not be read (missing price, area or date). */
  skipped: number;
}

export function molitAptTradeUrl(p: { serviceKey: string; lawdCd: string; dealYmd: string; pageNo?: number; numOfRows?: number }): string {
  if (!/^\d{5}$/.test(p.lawdCd)) throw new Error("LAWD_CD must be 5 digits");
  if (!/^\d{6}$/.test(p.dealYmd)) throw new Error("DEAL_YMD must be YYYYMM");
  const qs = [
    `serviceKey=${encodeURIComponent(p.serviceKey)}`,
    `LAWD_CD=${p.lawdCd}`,
    `DEAL_YMD=${p.dealYmd}`,
    `pageNo=${p.pageNo ?? 1}`,
    `numOfRows=${p.numOfRows ?? 1000}`,
  ].join("&");
  return `${MOLIT_APT_TRADE_URL}?${qs}`;
}

/** The last `count` deal months ending with the month of `now` (Asia/Seoul), newest first. */
export function recentDealMonths(now: Date, count: number): string[] {
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000);
  let y = seoul.getUTCFullYear();
  let m = seoul.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  const v = decodeXml(m[1] ?? "");
  return v === "" ? null : v;
}

function int(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = parseFloat(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "25.09.15" / "2025.09.15" / "20250915" -> "2025-09-15" */
export function parseMolitDate(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length === 6) return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return null;
}

export function parseMolitAptTradeXml(xml: string, lawdCdHint?: string): MolitParseResult {
  const resultCode = tag(xml, "resultCode") ?? tag(xml, "returnReasonCode");
  const resultMsg = tag(xml, "resultMsg") ?? tag(xml, "returnAuthMsg") ?? tag(xml, "errMsg");
  const ok = resultCode === "000" || resultCode === "00";
  const items: AptTrade[] = [];
  let skipped = 0;
  if (ok) {
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const it = m[1] ?? "";
      const year = int(tag(it, "dealYear"));
      const month = int(tag(it, "dealMonth"));
      const day = int(tag(it, "dealDay"));
      const manwon = int(tag(it, "dealAmount"));
      const area = num(tag(it, "excluUseAr"));
      const aptName = tag(it, "aptNm");
      if (!year || !month || !day || !manwon || !area || !aptName) {
        skipped++;
        continue;
      }
      const lawdCd = tag(it, "sggCd") ?? lawdCdHint ?? "";
      const dealDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const aptSeq = tag(it, "aptSeq");
      const umdName = tag(it, "umdNm") ?? "";
      const jibun = tag(it, "jibun");
      const aptDong = tag(it, "aptDong");
      const floor = int(tag(it, "floor"));
      const cdeal = tag(it, "cdealType");
      items.push({
        sourceKey: [lawdCd, aptSeq ?? `${umdName}:${jibun ?? ""}:${aptName}`, dealDate, area.toFixed(2), floor ?? "", aptDong ?? "", manwon].join("|"),
        lawdCd,
        aptSeq,
        aptName,
        umdName,
        jibun,
        aptDong,
        exclusiveAreaM2: area,
        priceKrw: manwon * 10_000,
        dealDate,
        floor,
        buildYear: int(tag(it, "buildYear")),
        dealingType: tag(it, "dealingGbn"),
        cancelled: cdeal !== null && cdeal.toUpperCase() === "O",
        cancelDate: parseMolitDate(tag(it, "cdealDay")),
      });
    }
  }
  return {
    ok,
    resultCode,
    resultMsg,
    totalCount: int(tag(xml, "totalCount")) ?? items.length,
    pageNo: int(tag(xml, "pageNo")) ?? 1,
    numOfRows: int(tag(xml, "numOfRows")) ?? items.length,
    items,
    skipped,
  };
}

/** Error text for a failed response, e.g. an unregistered service key. */
export function describeMolitError(r: MolitParseResult): string {
  return `MOLIT API error ${r.resultCode ?? "?"}: ${r.resultMsg ?? "unknown"}`;
}

/**
 * Fetches every page of one 시군구 / month. `fetchFn` is injectable for tests
 * and for runtimes without a global fetch.
 */
export async function fetchMolitAptTrades(
  p: { serviceKey: string; lawdCd: string; dealYmd: string },
  fetchFn: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = (u) => fetch(u),
): Promise<AptTrade[]> {
  const out: AptTrade[] = [];
  const numOfRows = 1000;
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const res = await fetchFn(molitAptTradeUrl({ ...p, pageNo, numOfRows }));
    const body = await res.text();
    const parsed = parseMolitAptTradeXml(body, p.lawdCd);
    if (!parsed.ok) throw new Error(`${describeMolitError(parsed)} (HTTP ${res.status}, ${p.lawdCd} ${p.dealYmd})`);
    out.push(...parsed.items);
    if (pageNo * numOfRows >= parsed.totalCount || parsed.items.length + parsed.skipped === 0) break;
  }
  return out;
}

/**
 * 한국자산관리공사 차세대 온비드 부동산 물건목록 조회서비스 (data.go.kr).
 *
 * GET https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
 *   serviceKey, resultType=json, pageNo, numOfRows (5000 works),
 *   pvctTrgtYn  Y|N, required and single-valued: fetch both for everything
 *   dspsMthodCd 0001 = 매각
 *   prptDivCd   comma list of 재산유형 codes
 *   lctnSdnm    시도 name ("서울특별시"); 시군구 is filtered here, client side
 *
 * Field notes (measured by others against the live API, not the guide):
 *   - the guide's operation name without the trailing "2" does not exist;
 *   - errors come either as {header:{resultCode}} with HTTP 200 or as the
 *     gateway's {OpenAPI_ServiceResponse:{cmmMsgHeader}} with HTTP 4xx;
 *   - items.item is an object instead of an array when there is one row;
 *   - lowstBidPrcIndctCont (최저입찰가) is text and can be "비공개";
 *   - bid dates are yyyyMMddHHmm KST, with 2999… meaning "not scheduled";
 *   - the ratio fields of the guide are always empty: compute min/appraisal;
 *   - alcYn is 지분물건 (a share of the property), not "awarded".
 *
 * Pure TypeScript, used by the Next.js app and the Edge Functions.
 */

export const ONBID_RLST_LIST_URL = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";
/** 재산유형 codes, all of them (압류재산 0007 and 기타일반재산 0005 are almost everything). */
export const ONBID_PRPT_DIV_ALL = "0002,0003,0004,0005,0006,0007,0008,0010,0011,0013";

export interface OnbidItem {
  /** cltrMngNo + pbctCdtnNo: one row per item and sale condition. */
  sourceKey: string;
  cltrMngNo: string;
  pbctCdtnNo: string;
  onbidCltrno: string;
  name: string;
  sido: string;
  sgg: string;
  emd: string;
  /** 지번 from the 19-digit PNU ("123" or "123-4"), null without one. */
  jibun: string | null;
  /** 시군구 code (LAWD_CD) = first 5 digits of the PNU, null without one. */
  lawdCd: string | null;
  usageMid: string | null;
  usageSmall: string | null;
  propertyType: string | null;
  appraisalKrw: number | null;
  minBidKrw: number | null;
  /** The raw 최저입찰가 text when it is not a number ("비공개"). */
  minBidText: string | null;
  failCount: number;
  /** ISO timestamps (KST), null when the date is not scheduled (2999…). */
  bidStart: string | null;
  bidEnd: string | null;
  statusCode: string | null;
  statusName: string | null;
  privateContract: boolean;
  buildingAreaM2: number | null;
  landAreaM2: number | null;
  /** 인도·명도 책임 ("매수자"). */
  evictionBy: string | null;
  /** 지분물건: only a share of the property is sold. */
  shareOnly: boolean;
  floorGuess: number | null;
  thumbnailUrl: string | null;
  detailUrl: string | null;
  modifiedAt: string | null;
}

export interface OnbidParseResult {
  ok: boolean;
  resultCode: string | null;
  resultMsg: string | null;
  totalCount: number;
  items: OnbidItem[];
  skipped: number;
}

export function onbidListUrl(p: { serviceKey: string; pvct: "Y" | "N"; sido: string; pageNo?: number; numOfRows?: number }): string {
  const qs = new URLSearchParams({
    resultType: "json",
    pageNo: String(p.pageNo ?? 1),
    numOfRows: String(p.numOfRows ?? 5000),
    prptDivCd: ONBID_PRPT_DIV_ALL,
    pvctTrgtYn: p.pvct,
    dspsMthodCd: "0001",
    lctnSdnm: p.sido,
  });
  return `${ONBID_RLST_LIST_URL}?serviceKey=${encodeURIComponent(p.serviceKey)}&${qs.toString()}`;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
};

const num = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/[,\s원]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "1141011600100720022" -> "72-22"; 산 (11th digit 2) -> "산72-22". */
export function jibunFromPnu(pnu: string | null): string | null {
  if (!pnu || !/^\d{19}$/.test(pnu)) return null;
  const main = parseInt(pnu.slice(11, 15), 10);
  const sub = parseInt(pnu.slice(15, 19), 10);
  if (!main) return null;
  return `${pnu[10] === "2" ? "산" : ""}${main}${sub ? `-${sub}` : ""}`;
}

/** First 5 digits (시군구) of a 19-digit 지번 PNU or 25-digit 도로명 PNU. */
export function lawdFromPnu(pnu: string | null): string | null {
  return pnu && /^\d{19}(\d{6})?$/.test(pnu) ? pnu.slice(0, 5) : null;
}

/** yyyyMMddHHmm (KST) -> ISO; null for 2999 sentinels and bad input. */
export function onbidDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{12}(\d{2})?$/.test(s) || s.startsWith("2999")) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`;
}

/** "… 101동 12층 1203호" -> 12; "… 1203호" -> 12; "B101호" / none -> null. */
export function floorFromName(name: string): number | null {
  const fl = name.match(/(?:^|\s|제)(\d{1,3})층/);
  if (fl) return parseInt(fl[1] as string, 10);
  const ho = name.match(/(?:^|\s|제)(\d{3,4})호/);
  if (ho) {
    const n = parseInt(ho[1] as string, 10);
    return n >= 100 ? Math.floor(n / 100) : null;
  }
  return null;
}

export function onbidDetailUrl(r: { onbidCltrno?: unknown; onbidPbancNo?: unknown; pbctNo?: unknown; pbctCdtnNo?: unknown }): string | null {
  const ids = [str(r.onbidCltrno), str(r.onbidPbancNo), str(r.pbctNo), str(r.pbctCdtnNo)];
  // All four are needed: a partial URL answers HTTP 500.
  if (ids.some((x) => x === null || !/^\d+$/.test(x))) return null;
  const [c, a, p, d] = ids as string[];
  return `https://www.onbid.co.kr/op/cltrpbancinf/cltrdtl/CltrDtlController/mvmnCltrDtl.do?onbidCltrno=${c}&onbidPbancNo=${a}&pbctNo=${p}&pbctCdtnNo=${d}`;
}

export function mapOnbidItem(r: Raw): OnbidItem | null {
  const cltrMngNo = str(r.cltrMngNo);
  const pbctCdtnNo = str(r.pbctCdtnNo);
  const name = str(r.onbidCltrNm);
  if (!cltrMngNo || !pbctCdtnNo || !name) return null;
  const minText = str(r.lowstBidPrcIndctCont);
  const minBid = num(minText);
  const md = str(r.mdfcnDt);
  const thumb = str(r.thnlImgUrlAdr);
  return {
    sourceKey: `${cltrMngNo}|${pbctCdtnNo}`,
    cltrMngNo,
    pbctCdtnNo,
    onbidCltrno: str(r.onbidCltrno) ?? "",
    name,
    sido: str(r.lctnSdnm) ?? "",
    sgg: str(r.lctnSggnm) ?? "",
    emd: str(r.lctnEmdNm) ?? "",
    jibun: jibunFromPnu(str(r.ltnoPnu)),
    lawdCd: lawdFromPnu(str(r.ltnoPnu)) ?? lawdFromPnu(str(r.rdnmPnu)),
    usageMid: str(r.cltrUsgMclsCtgrNm),
    usageSmall: str(r.cltrUsgSclsCtgrNm),
    propertyType: str(r.prptDivNm),
    appraisalKrw: num(r.apslEvlAmt),
    minBidKrw: minBid,
    minBidText: minBid === null ? minText : null,
    failCount: num(r.usbdNft) ?? 0,
    bidStart: onbidDate(r.cltrBidBgngDt),
    bidEnd: onbidDate(r.cltrBidEndDt),
    statusCode: str(r.pbctStatCd),
    statusName: str(r.pbctStatNm),
    privateContract: str(r.pvctTrgtYn) === "Y",
    buildingAreaM2: num(r.bldSqms),
    landAreaM2: num(r.landSqms),
    evictionBy: str(r.evcRsbyTrgtCont),
    shareOnly: str(r.alcYn) === "Y",
    floorGuess: floorFromName(name),
    thumbnailUrl: thumb && /^https:\/\/www\.onbid\.co\.kr\//.test(thumb) ? thumb : null,
    detailUrl: onbidDetailUrl(r),
    modifiedAt: md && /^\d{14}$/.test(md) ? `${md.slice(0, 4)}-${md.slice(4, 6)}-${md.slice(6, 8)}T${md.slice(8, 10)}:${md.slice(10, 12)}:${md.slice(12, 14)}+09:00` : null,
  };
}

export function parseOnbidList(payload: unknown): OnbidParseResult {
  const p = (payload ?? {}) as Raw;
  const gw = p.OpenAPI_ServiceResponse as Raw | undefined;
  if (gw) {
    const h = (gw.cmmMsgHeader ?? {}) as Raw;
    return { ok: false, resultCode: str(h.returnReasonCode), resultMsg: str(h.returnAuthMsg) ?? str(h.errMsg), totalCount: 0, items: [], skipped: 0 };
  }
  const header = ((p.header ?? (p.response as Raw | undefined)?.header) ?? {}) as Raw;
  const body = ((p.body ?? (p.response as Raw | undefined)?.body) ?? {}) as Raw;
  const resultCode = str(header.resultCode);
  const ok = resultCode === "00" || resultCode === "000";
  let raw: unknown = body.items;
  if (raw && !Array.isArray(raw) && typeof raw === "object") raw = (raw as Raw).item;
  if (raw && !Array.isArray(raw) && typeof raw === "object") raw = [raw];
  const list = Array.isArray(raw) ? (raw as Raw[]) : [];
  const items: OnbidItem[] = [];
  let skipped = 0;
  if (ok) {
    for (const r of list) {
      const m = mapOnbidItem(r);
      if (m) items.push(m);
      else skipped++;
    }
  }
  return { ok, resultCode, resultMsg: str(header.resultMsg), totalCount: num(body.totalCount) ?? items.length, items, skipped };
}

export function isApartment(i: Pick<OnbidItem, "usageSmall" | "name">): boolean {
  return (i.usageSmall ?? "").includes("아파트");
}

/**
 * Every item of one 시도 (both pvctTrgtYn groups, all pages). Throws on API
 * errors, including the "OK with an error inside" HTTP 200 form.
 */
export async function fetchOnbidSido(
  p: { serviceKey: string; sido: string },
  fetchFn: (url: string) => Promise<{ status: number; text(): Promise<string> }> = (u) => fetch(u, { headers: { Accept: "application/json" } }),
): Promise<OnbidItem[]> {
  const out = new Map<string, OnbidItem>();
  const numOfRows = 5000;
  for (const pvct of ["N", "Y"] as const) {
    for (let pageNo = 1; pageNo <= 20; pageNo++) {
      const res = await fetchFn(onbidListUrl({ ...p, pvct, pageNo, numOfRows }));
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Onbid API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
      }
      const parsed = parseOnbidList(json);
      if (!parsed.ok) throw new Error(`Onbid API error ${parsed.resultCode ?? "?"}: ${parsed.resultMsg ?? "unknown"} (HTTP ${res.status})`);
      for (const it of parsed.items) out.set(it.sourceKey, it);
      if (pageNo * numOfRows >= parsed.totalCount || parsed.items.length + parsed.skipped === 0) break;
    }
  }
  return [...out.values()];
}

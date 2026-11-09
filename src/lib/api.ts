import type { SupabaseClient } from "@supabase/supabase-js";
import type { AptTrade } from "@kr/molit.ts";
import type { OnbidItem } from "@kr/onbid.ts";
import type { Flagship } from "@kr/bargains.ts";
import type { KrSaleListing } from "@kr/valuation.ts";

type Client = SupabaseClient;

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

type Result<T> = { data: T; error: { message: string; code?: string } | null };

function unwrap<T>(res: Result<T>): NonNullable<T> {
  if (res.error) throw new ApiError(res.error.message, res.error.code);
  return res.data as NonNullable<T>;
}

async function requireUserId(client: Client): Promise<string> {
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ApiError("로그인이 필요합니다.", "28000");
  return id;
}

/**
 * Data access for Mydream (supabase/migrations/0001_init.sql). The valuation
 * itself runs in the browser with @kr/valuation.ts and @kr/auction.ts.
 */

export interface KrComplex {
  aptSeq: string | null;
  aptName: string;
  umdName: string;
  buildYear: number | null;
  /** 전용면적 values with deals in the period, ascending. */
  areas: number[];
  tradeCount: number;
  lastDealDate: string;
}

export interface KrWatchListing extends KrSaleListing {
  lawdCd: string;
  note: string | null;
  createdAt: string;
}

export interface KrWatchInput {
  lawdCd?: string;
  complexName: string;
  aptSeq?: string | null;
  umdName?: string | null;
  exclusiveAreaM2: number;
  askingPriceKrw: number;
  floor?: number | null;
  totalFloors?: number | null;
  title?: string | null;
  url?: string | null;
  note?: string | null;
}

export async function complexes(client: Client, lawdCd: string, months = 12): Promise<KrComplex[]> {
  type Row = { apt_seq: string | null; apt_name: string; umd_name: string; build_year: number | null; areas: Array<number | string> | null; trade_count: number | string; last_deal_date: string };
  const rows = unwrap(await client.rpc("kr_complexes", { p_lawd_cd: lawdCd, p_months: months })) as Row[];
  return rows.map((r) => ({
    aptSeq: r.apt_seq,
    aptName: r.apt_name,
    umdName: r.umd_name,
    buildYear: r.build_year,
    areas: (r.areas ?? []).map(Number),
    tradeCount: Number(r.trade_count),
    lastDealDate: r.last_deal_date,
  }));
}

/**
 * For one 시군구: newest stored deal date and when it was last synced (kr_sync_state),
 * or null when nothing has been stored for it yet.
 */
export async function tradeDataStatus(client: Client, lawdCd: string): Promise<{ lastDealDate: string | null; fetchedAt: string } | null> {
  const synced = unwrap(
    await client.from("kr_sync_state").select("fetched_at").eq("job", "trades").like("key", `${lawdCd}:%`).not("fetched_at", "is", null).order("fetched_at", { ascending: false }).limit(1),
  );
  if (!synced[0]?.fetched_at) return null;
  const latestDeal = unwrap(await client.from("kr_apt_trades").select("deal_date").eq("lawd_cd", lawdCd).order("deal_date", { ascending: false }).limit(1));
  return { lastDealDate: latestDeal[0]?.deal_date ?? null, fetchedAt: synced[0].fetched_at };
}

type TradeRow = {
  source_key: string;
  lawd_cd: string;
  apt_seq: string | null;
  apt_name: string;
  umd_name: string;
  jibun: string | null;
  apt_dong: string | null;
  exclusive_area_m2: number;
  price_krw: number;
  deal_date: string;
  floor: number | null;
  build_year: number | null;
  dealing_type: string | null;
  cancelled: boolean;
  cancel_date: string | null;
};

export function mapTrade(r: TradeRow): AptTrade {
  return {
    sourceKey: r.source_key,
    lawdCd: r.lawd_cd,
    aptSeq: r.apt_seq,
    aptName: r.apt_name,
    umdName: r.umd_name,
    jibun: r.jibun,
    aptDong: r.apt_dong,
    exclusiveAreaM2: Number(r.exclusive_area_m2),
    priceKrw: Number(r.price_krw),
    dealDate: r.deal_date,
    floor: r.floor,
    buildYear: r.build_year,
    dealingType: r.dealing_type,
    cancelled: r.cancelled,
    cancelDate: r.cancel_date,
  };
}

const TRADE_COLUMNS = "source_key, lawd_cd, apt_seq, apt_name, umd_name, jibun, apt_dong, exclusive_area_m2, price_krw, deal_date, floor, build_year, dealing_type, cancelled, cancel_date";
const quote = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;

/**
 * Uncancelled deals since `sinceDate` for the complexes of the given listings, per
 * listing 시군구 (by aptSeq, and by name for listings without one). Paged past
 * PostgREST's row cap.
 */
export async function tradesForListings(
  client: Client,
  listings: Array<KrSaleListing & { lawdCd?: string | null }>,
  sinceDate: string,
  defaultLawdCd?: string,
): Promise<AptTrade[]> {
  const byLawd = new Map<string, Array<KrSaleListing>>();
  for (const l of listings) {
    const code = l.lawdCd ?? defaultLawdCd;
    if (!code) continue;
    byLawd.set(code, [...(byLawd.get(code) ?? []), l]);
  }
  const out: AptTrade[] = [];
  for (const [lawdCd, group] of byLawd) {
    const seqs = [...new Set(group.map((l) => l.aptSeq).filter((s): s is string => Boolean(s)))];
    const names = [...new Set(group.filter((l) => !l.aptSeq).map((l) => l.complexName.trim()))];
    if (!seqs.length && !names.length) continue;
    const ors = [seqs.length ? `apt_seq.in.(${seqs.map(quote).join(",")})` : null, names.length ? `apt_name.in.(${names.map(quote).join(",")})` : null]
      .filter(Boolean)
      .join(",");
    const page = 1000;
    for (let from = 0; from < 50_000; from += page) {
      const rows = unwrap(
        await client.from("kr_apt_trades").select(TRADE_COLUMNS).eq("lawd_cd", lawdCd).eq("cancelled", false).gte("deal_date", sinceDate).or(ors).order("id").range(from, from + page - 1),
      );
      out.push(...rows.map((r) => mapTrade(r as TradeRow)));
      if (rows.length < page) break;
    }
  }
  return out;
}

type WatchRow = {
  id: string;
  lawd_cd: string;
  complex_name: string;
  apt_seq: string | null;
  umd_name: string | null;
  exclusive_area_m2: number;
  asking_price_krw: number;
  floor: number | null;
  total_floors: number | null;
  title: string | null;
  url: string | null;
  note: string | null;
  created_at: string;
};

export function mapWatch(r: WatchRow): KrWatchListing {
  return {
    id: r.id,
    lawdCd: r.lawd_cd,
    complexName: r.complex_name,
    aptSeq: r.apt_seq,
    umdName: r.umd_name,
    exclusiveAreaM2: Number(r.exclusive_area_m2),
    askingPriceKrw: Number(r.asking_price_krw),
    floor: r.floor,
    totalFloors: r.total_floors,
    title: r.title,
    url: r.url,
    note: r.note,
    createdAt: r.created_at,
  };
}

export async function myWatchListings(client: Client): Promise<KrWatchListing[]> {
  const uid = await requireUserId(client);
  const rows = unwrap(await client.from("kr_watch_listings").select("*").eq("user_id", uid).order("created_at", { ascending: false }));
  return rows.map((r) => mapWatch(r as WatchRow));
}

export async function addWatchListing(client: Client, input: KrWatchInput): Promise<KrWatchListing> {
  const row = unwrap(
    await client
      .from("kr_watch_listings")
      .insert({
        lawd_cd: input.lawdCd ?? "11440",
        complex_name: input.complexName.trim(),
        apt_seq: input.aptSeq ?? null,
        umd_name: input.umdName ?? null,
        exclusive_area_m2: input.exclusiveAreaM2,
        asking_price_krw: input.askingPriceKrw,
        floor: input.floor ?? null,
        total_floors: input.totalFloors ?? null,
        title: input.title?.trim() || null,
        url: input.url?.trim() || null,
        note: input.note?.trim() || null,
      })
      .select("*")
      .single(),
  );
  return mapWatch(row as WatchRow);
}

export async function deleteWatchListing(client: Client, id: string): Promise<void> {
  unwrap(await client.from("kr_watch_listings").delete().eq("id", id));
}

type AuctionRow = {
  source_key: string;
  cltr_mng_no: string;
  pbct_cdtn_no: string;
  onbid_cltrno: string;
  name: string;
  sido: string;
  sgg: string;
  emd: string;
  jibun: string | null;
  lawd_cd: string | null;
  usage_mid: string | null;
  usage_small: string | null;
  property_type: string | null;
  appraisal_krw: number | null;
  min_bid_krw: number | null;
  min_bid_text: string | null;
  fail_count: number;
  bid_start: string | null;
  bid_end: string | null;
  status_code: string | null;
  status_name: string | null;
  private_contract: boolean;
  building_area_m2: number | null;
  land_area_m2: number | null;
  eviction_by: string | null;
  share_only: boolean;
  floor_guess: number | null;
  thumbnail_url: string | null;
  detail_url: string | null;
  modified_at: string | null;
  last_seen_at: string;
};

const nOrNull = (v: number | string | null) => (v === null ? null : Number(v));

export function mapAuction(r: AuctionRow): OnbidItem {
  return {
    sourceKey: r.source_key,
    cltrMngNo: r.cltr_mng_no,
    pbctCdtnNo: r.pbct_cdtn_no,
    onbidCltrno: r.onbid_cltrno,
    name: r.name,
    sido: r.sido,
    sgg: r.sgg,
    emd: r.emd,
    jibun: r.jibun,
    lawdCd: r.lawd_cd,
    usageMid: r.usage_mid,
    usageSmall: r.usage_small,
    propertyType: r.property_type,
    appraisalKrw: nOrNull(r.appraisal_krw),
    minBidKrw: nOrNull(r.min_bid_krw),
    minBidText: r.min_bid_text,
    failCount: r.fail_count,
    bidStart: r.bid_start,
    bidEnd: r.bid_end,
    statusCode: r.status_code,
    statusName: r.status_name,
    privateContract: r.private_contract,
    buildingAreaM2: nOrNull(r.building_area_m2),
    landAreaM2: nOrNull(r.land_area_m2),
    evictionBy: r.eviction_by,
    shareOnly: r.share_only,
    floorGuess: r.floor_guess,
    thumbnailUrl: r.thumbnail_url,
    detailUrl: r.detail_url,
    modifiedAt: r.modified_at,
  };
}

/**
 * Open 공매 apartments in a 시도 (optionally one 시군구, by LAWD_CD from the item PNU): rows
 * that the 시도's latest sync still returned (the list API drops finished items),
 * without past deadlines, soonest deadline first.
 */
export async function auctionApartments(
  client: Client,
  area: { sido: string; lawdCd?: string | null },
  now = new Date(),
): Promise<{ items: OnbidItem[]; syncedAt: string | null }> {
  const st = unwrap(await client.from("kr_sync_state").select("fetched_at").eq("job", "auctions").eq("key", area.sido).limit(1));
  const syncedAt = st[0]?.fetched_at ?? null;
  if (!syncedAt) return { items: [], syncedAt: null };
  const since = new Date(new Date(syncedAt).getTime() - 36 * 3600_000).toISOString();
  let q = client
    .from("kr_auction_items")
    .select("*")
    .eq("sido", area.sido)
    .ilike("usage_small", "%아파트%")
    .gte("last_seen_at", since)
    .or(`bid_end.is.null,bid_end.gte.${now.toISOString()}`);
  if (area.lawdCd) q = q.eq("lawd_cd", area.lawdCd);
  const rows = unwrap(await q.order("bid_end", { ascending: true, nullsFirst: false }).limit(1000));
  return { items: rows.map((r) => mapAuction(r as AuctionRow)), syncedAt };
}

/** Uncancelled deals since `sinceDate` at the 시군구 + 법정동 + 지번 of the given auction items. */
export async function tradesForAuctionItems(client: Client, items: OnbidItem[], sinceDate: string): Promise<AptTrade[]> {
  const byLawd = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.lawdCd || !i.jibun || !i.emd) continue;
    const set = byLawd.get(i.lawdCd) ?? new Set<string>();
    set.add(`and(umd_name.eq.${quote(i.emd)},jibun.eq.${quote(i.jibun)})`);
    byLawd.set(i.lawdCd, set);
  }
  const out: AptTrade[] = [];
  for (const [lawdCd, set] of byLawd) {
    const keys = [...set];
    for (let k = 0; k < keys.length; k += 40) {
      const rows = unwrap(
        await client.from("kr_apt_trades").select(TRADE_COLUMNS).eq("lawd_cd", lawdCd).eq("cancelled", false).gte("deal_date", sinceDate).or(keys.slice(k, k + 40).join(",")).limit(5000),
      );
      out.push(...rows.map((r) => mapTrade(r as TradeRow)));
    }
  }
  return out;
}

/** 대장 아파트: the top complexes by 원/m² of each 시군구 (kr_flagships, 0002). At most 60 codes. */
export async function flagships(client: Client, lawdCodes: string[], perRegion = 3): Promise<Flagship[]> {
  type Row = {
    lawd_cd: string;
    apt_seq: string;
    apt_name: string;
    umd_name: string;
    jibun: string | null;
    build_year: number | null;
    deal_count: number | string;
    median_price_per_m2: number | string;
    last_deal_date: string;
    rank: number;
  };
  const rows = unwrap(await client.rpc("kr_flagships", { p_lawd_codes: lawdCodes.slice(0, 60), p_per_region: perRegion })) as Row[];
  return rows.map((r) => ({
    lawdCd: r.lawd_cd,
    aptSeq: r.apt_seq,
    aptName: r.apt_name,
    umdName: r.umd_name,
    jibun: r.jibun,
    buildYear: r.build_year,
    dealCount: Number(r.deal_count),
    medianPricePerM2: Number(r.median_price_per_m2),
    lastDealDate: r.last_deal_date,
    rank: r.rank,
  }));
}

/** Uncancelled deals since `sinceDate` of the given flagship complexes, paged past the row cap. */
export async function tradesForFlagships(client: Client, list: Flagship[], sinceDate: string): Promise<AptTrade[]> {
  const seqs = [...new Set(list.map((f) => f.aptSeq))];
  const lawds = [...new Set(list.map((f) => f.lawdCd))]; // leading column of kr_apt_trades_complex_idx
  const out: AptTrade[] = [];
  for (let k = 0; k < seqs.length; k += 50) {
    const chunk = seqs.slice(k, k + 50);
    const page = 1000;
    for (let from = 0; from < 50_000; from += page) {
      const rows = unwrap(
        await client.from("kr_apt_trades").select(TRADE_COLUMNS).in("lawd_cd", lawds).in("apt_seq", chunk).eq("cancelled", false).gte("deal_date", sinceDate).order("id").range(from, from + page - 1),
      );
      out.push(...rows.map((r) => mapTrade(r as TradeRow)));
      if (rows.length < page) break;
    }
  }
  return out;
}

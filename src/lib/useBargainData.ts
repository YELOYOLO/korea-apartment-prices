"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { valueAuctionItem, type AuctionValuation } from "@kr/auction.ts";
import { BARGAIN_THRESHOLD, findBargainDeals, type BargainDeal, type Flagship } from "@kr/bargains.ts";
import { KR_REGIONS, krRegion } from "@kr/regions.ts";
import { readStoredRegion, storeRegion, type Region } from "@/components/RegionPicker";
import * as api from "./api";
import { monthsAgo } from "./format";
import { getClient } from "./supabase";

const REGION_KEY = "md.bargainRegion";
/** A 공매 counts as a bargain when the minimum bid is at most this share of market value. */
export const AUCTION_MAX_RATIO = 1 - BARGAIN_THRESHOLD;

export const sggName = (code: string) => krRegion(code)?.name ?? code;

/** Flagships, their 급매 deals and cheap 공매 for the chosen region; shared by /bargains and /map. */
export function useBargainData() {
  const [region, setRegionState] = useState<Region>(() => {
    const r = readStoredRegion(REGION_KEY);
    return r.sido ? r : { sido: "서울특별시", lawdCd: null };
  });
  const setRegion = (r: Region) => {
    setRegionState(r);
    storeRegion(REGION_KEY, r);
  };
  const codes = useMemo(
    () => (region.lawdCd ? [region.lawdCd] : region.sido ? KR_REGIONS.filter((r) => r.sido === region.sido).map((r) => r.code) : []),
    [region.sido, region.lawdCd],
  );
  const flags = useQuery({ queryKey: ["flagships", codes], enabled: codes.length > 0, queryFn: () => api.flagships(getClient(), codes) });
  const list = useMemo(() => flags.data ?? [], [flags.data]);
  const trades = useQuery({
    queryKey: ["flagshipTrades", list.map((f) => f.aptSeq).join(",")],
    enabled: list.length > 0,
    queryFn: () => api.tradesForFlagships(getClient(), list, monthsAgo(13)),
  });
  const auctions = useQuery({
    queryKey: ["auctions", region.sido, region.lawdCd],
    enabled: Boolean(region.sido) && list.length > 0,
    queryFn: () => api.auctionApartments(getClient(), { sido: region.sido as string, lawdCd: region.lawdCd }),
  });

  const deals: BargainDeal[] = useMemo(() => (trades.data ? findBargainDeals(trades.data) : []), [trades.data]);
  const dealsBySeq = useMemo(() => {
    const m = new Map<string, BargainDeal[]>();
    for (const d of deals) if (d.trade.aptSeq) m.set(d.trade.aptSeq, [...(m.get(d.trade.aptSeq) ?? []), d]);
    return m;
  }, [deals]);
  const cheapAuctions: AuctionValuation[] = useMemo(() => {
    if (!trades.data || !auctions.data) return [];
    const spots = new Set(list.map((f) => `${f.lawdCd}|${f.umdName}|${f.jibun}`));
    return auctions.data.items
      .filter((i) => spots.has(`${i.lawdCd}|${i.emd}|${i.jibun}`))
      .map((i) => valueAuctionItem(i, trades.data))
      .filter((v) => v.ratio !== null && v.ratio <= AUCTION_MAX_RATIO)
      .sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1));
  }, [list, trades.data, auctions.data]);
  const byRegion = useMemo(() => {
    const m = new Map<string, Flagship[]>();
    for (const f of list) m.set(f.lawdCd, [...(m.get(f.lawdCd) ?? []), f]);
    return [...m.entries()].sort((a, b) => sggName(a[0]).localeCompare(sggName(b[0]), "ko"));
  }, [list]);

  return {
    region,
    setRegion,
    list,
    deals,
    dealsBySeq,
    cheapAuctions,
    byRegion,
    loading: flags.isLoading || (list.length > 0 && trades.isLoading),
    error: flags.error ?? trades.error,
    retry: () => (flags.isError ? flags.refetch() : trades.refetch()),
  };
}

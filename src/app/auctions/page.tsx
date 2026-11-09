"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";

const Auctions = dynamic(() => import("@/components/Auctions"), { ssr: false, loading: () => <Loading /> });

export default function AuctionsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold">공매 물건 (온비드)</h1>
        <p className="text-sm text-text-secondary">캠코 온비드에 지금 공매로 나와 있는 아파트입니다. 최저입찰가를 같은 주소(법정동·지번)의 최근 실거래가와 비교합니다.</p>
      </header>
      <Auctions />
    </div>
  );
}

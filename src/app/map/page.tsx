"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <Loading /> });

export default function MapPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold">지도</h1>
        <p className="text-sm text-text-secondary">네이버 지도 위에 대장 아파트, 시세보다 15% 이상 싸게 거래된 단지, 싼 공매 물건을 표시합니다.</p>
      </header>
      <MapView />
    </div>
  );
}

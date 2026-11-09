"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";

const SearchMap = dynamic(() => import("@/components/SearchMap"), { ssr: false, loading: () => <Loading /> });

export default function MapPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold">지도 검색</h1>
        <p className="text-sm text-text-secondary">대장 급매, 저가 실거래, 공매를 시세 대비 할인율로 찾습니다. 조건은 주소에 저장되어 공유·새로고침해도 유지됩니다.</p>
      </header>
      <SearchMap />
    </div>
  );
}

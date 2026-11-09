"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { buttonClass, Loading } from "@/components/ui";

// Reads per-device preferences from localStorage, so it renders in the browser only.
const WatchList = dynamic(() => import("@/components/WatchList"), { ssr: false, loading: () => <Loading /> });

export default function WatchPage() {
  const { session, loading } = useAuth();
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold">내 관심 매물</h1>
        <p className="text-sm text-text-secondary">찾아본 매물의 호가를 입력하면 같은 단지·같은 면적의 최근 실거래가와 비교해 줍니다.</p>
      </header>
      {loading ? (
        <Loading />
      ) : session ? (
        <WatchList />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="font-semibold">관심 매물은 로그인 후 저장할 수 있습니다.</p>
          <p className="mt-1 text-sm text-muted">저장한 매물은 본인만 볼 수 있습니다.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/login?next=/watch" className={buttonClass("primary")}>
              로그인
            </Link>
            <Link href="/signup" className={buttonClass("secondary")}>
              회원가입
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

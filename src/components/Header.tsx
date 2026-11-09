"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getClient } from "@/lib/supabase";

const NAV = [
  { href: "/bargains", label: "대장 급매" },
  { href: "/map", label: "지도" },
  { href: "/watch", label: "내 관심 매물" },
  { href: "/auctions", label: "공매 물건" },
];

export default function Header() {
  const { session, loading } = useAuth();
  const path = usePathname();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="min-h-14 content-center text-lg font-extrabold tracking-tight text-brand-text">
          Mydream
        </Link>
        <nav aria-label="주요 메뉴" className="flex flex-1 gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path === n.href ? "page" : undefined}
              className={`min-h-14 shrink-0 content-center border-b-2 px-2 text-sm font-semibold ${path === n.href ? "border-brand text-brand-text" : "border-transparent text-text-secondary hover:text-text"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {!loading &&
          (session ? (
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-lg px-2 text-sm text-muted hover:text-text"
              onClick={async () => {
                await getClient().auth.signOut();
                router.push("/");
              }}
            >
              로그아웃
            </button>
          ) : (
            <Link href="/login" className="min-h-11 shrink-0 content-center rounded-lg px-2 text-sm font-semibold text-brand-text">
              로그인
            </Link>
          ))}
      </div>
    </header>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "Mydream · 아파트 시세 비교",
  description: "찾아본 아파트 호가와 온비드 공매 물건을 국토교통부 실거래가와 비교해 시세보다 싼 매물을 찾습니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#3b4cca" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">
        <Providers>
          <Header />
          <main>{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-muted">
            <p>Mydream은 국토교통부 실거래가와 한국자산관리공사 온비드의 공공데이터를 보여줍니다. 투자 조언이 아니며, 거래 전에는 등기부등본과 권리관계를 직접 확인하세요.</p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "대외활동 셋리스트 투표";
const DESCRIPTION = "후보곡을 듣고, 공연하고 싶은 12곡을 골라 주세요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", locale: "ko_KR" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#f8f7f3",
};

// 저장된 테마(page.tsx의 THEME_KEY)를 첫 화면이 그려지기 전에 적용해서 깜빡임을 막는다.
const themeScript = `(function(){try{if(localStorage.getItem("daeoe-theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

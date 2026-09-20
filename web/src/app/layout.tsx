import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마인드팀",
  description: "마음속 감정들이 서로 대화하고, 당신은 그 대화에 끼어듭니다.",
};

export const viewport: Viewport = {
  themeColor: "#07090F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

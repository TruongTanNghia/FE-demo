import { Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Traffic Monitor — Giám sát giao thông trong trình duyệt",
  description:
    "Bài 9 giáo trình Supervision: phát hiện, tracking, đếm xe qua vạch, vùng polygon, đo tốc độ và chụp xe vi phạm — chạy 100% trong trình duyệt bằng YOLOv8 + ONNX Runtime Web.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

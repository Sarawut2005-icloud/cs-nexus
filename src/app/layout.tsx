import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist ไม่มีอักขระไทย — UI ทั้งระบบเป็นภาษาไทย จึงต้องมีฟอนต์ที่ครอบคลุม
// ไม่งั้นเบราว์เซอร์จะเลือกฟอนต์ระบบมาแทนเอง ซึ่งควบคุมหน้าตาไม่ได้
const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "CS Nexus",
    template: "%s · CS Nexus",
  },
  description:
    "ศูนย์กลางสังคมออนไลน์ วิดีโอสั้น ห้องคอลเสียง และแชทแลกเปลี่ยนไฟล์ประจำสาขาวิทยาการคอมพิวเตอร์",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

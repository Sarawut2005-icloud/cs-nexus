import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // มี package.json/package-lock.json หลงอยู่ที่ C:\Users\User ทำให้ Turbopack
    // เดา root ของโปรเจกต์ผิดและเตือนทุกครั้งที่ build — ระบุให้ชัดเจนไปเลย
    root: __dirname,
  },
};

export default nextConfig;

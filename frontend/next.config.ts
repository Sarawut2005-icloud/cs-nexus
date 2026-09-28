import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /// รากของ workspace ไม่ใช่โฟลเดอร์ของหน้าบ้าน
    ///
    /// Turbopack ใช้ค่านี้เป็นขอบเขตการหา module และ **ไม่คอมไพล์ไฟล์ที่อยู่
    /// นอกราก** ในโครงแบบ pnpm workspace ตัว `next` จริงอยู่ที่
    /// `<ราก>/node_modules/.pnpm/…` ซึ่งอยู่เหนือโฟลเดอร์นี้ขึ้นไปหนึ่งชั้น
    ///
    /// เดิมตั้งเป็น `__dirname` ตอนที่หน้าบ้านยังอยู่ที่รากของ repo พอย้าย
    /// เข้ามาใน `frontend/` ตาม repo-structure.md ค่านั้นกลายเป็นการขังตัวเอง
    /// ไว้ใต้ `frontend/` แล้ว build ล้มด้วย "Could not find the Next.js package"
    ///
    /// ปกติ Next หารากเองได้จาก `pnpm-lock.yaml` (ดู docs `turbopack.md`
    /// หัวข้อ root directory) แต่ระบุให้ชัดไว้ดีกว่า เพราะเครื่องพัฒนาบางเครื่อง
    /// มี `package.json` หลงอยู่ใน `C:\Users\<ชื่อ>` ซึ่งทำให้เดารากผิด
    root: join(__dirname, ".."),
  },
};

export default nextConfig;

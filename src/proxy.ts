import { NextResponse, type NextRequest } from 'next/server';

/// Proxy (ชื่อใหม่ของ Middleware ตั้งแต่ Next.js 16)
///
/// **ที่นี่ไม่มีการตรวจสิทธิ์ และต้องไม่มี** — Blueprint หน้า 8 และ 9:
///
///   "ห้ามระบบย่อยทำหน้า Login เอง และห้ามเขียนโค้ด Verify ลายเซ็น JWT เอง
///    เด็ดขาด! (ให้เชื่อใจ Header จาก Gateway)"
///
/// เดิมไฟล์นี้เรียก `supabase.auth.getUser()` แล้วเด้งทุกหน้าไป /login
/// ซึ่งเป็นทั้งการทำหน้า login ของตัวเอง (ผิดหน้า 8) และการตรวจ session เอง
/// อาการที่ตามมาคือทุก route ตอบ 307 ไป /login — แอปเปิดไม่ได้เลย
///
/// ของจริงเป็นแบบนี้: ผู้ใช้ล็อกอินที่ Core → API Gateway ตรวจ token แล้วแนบ
/// X-User-Id / X-Layer1-Role / X-Faculty มาให้ทุก request → หลังบ้านของเรา
/// เชื่อ header นั้น (ดู backend/src/common/auth/gateway-auth.guard.ts
/// ซึ่งไม่มีโค้ดถอดรหัส JWT แม้แต่บรรทัดเดียว)
///
/// หน้าที่เดียวที่เหลือของไฟล์นี้คือพาลิงก์เก่าที่ยังชี้ /login ไปหน้าแรก
/// เพื่อไม่ให้ผู้ใช้เจอหน้าตาย
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /login เปิดให้เข้าได้แล้ว — เป็นหน้าที่ส่งต่อไปล็อกอินที่ Core
  // ไม่ใช่หน้ารับรหัสผ่าน จึงไม่ขัด Blueprint หน้า 8
  //
  // ส่วน /auth/* ยังพากลับหน้าแรกไปก่อน เพราะปลายทางที่ Core จะเรียกกลับ
  // ยังรอ PM ยืนยัน (ดู docs/คำถามถึง-PM.md ข้อ 3)
  if (pathname.startsWith('/auth/')) {
    return NextResponse.redirect(new URL('/feed', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // จับเฉพาะสองเส้นทางที่ต้องพาไปที่อื่น ไม่ต้องวิ่งทุก request
  // (proxy ที่ match ทุกอย่างแต่ไม่ทำอะไร คือค่าใช้จ่ายที่ไม่ได้อะไรกลับมา)
  matcher: ['/auth/:path*'],
};

import { NextResponse, type NextRequest } from 'next/server';

/// Proxy (ชื่อใหม่ของ Middleware ตั้งแต่ Next.js 16)
///
/// **ที่นี่ไม่มีการตรวจตัวตน และต้องไม่มี**
///
/// การตรวจลายเซ็น token เกิดที่หลังบ้านทุก request (JWKS ของ Core Hub)
/// ถ้าหน้าบ้านตรวจเองด้วย จะมีสองแหล่งความจริงที่เพี้ยนจากกันได้ และที่แย่กว่า
/// คือคนอ่านโค้ดจะเข้าใจว่าด่านนี้กันอะไรได้จริง ทั้งที่ใครยิงตรงเข้าหลังบ้าน
/// ก็ข้ามมันไปหมด
///
/// หน้าบ้านรู้ว่าใครล็อกอินอยู่จาก `GET /api/v1/me` เท่านั้น
/// (ดู lib/csmju/session.tsx) — token อยู่ในคุกกี้ httpOnly ที่อ่านไม่ได้
///
/// หน้าที่เดียวที่เหลือของไฟล์นี้คือพาลิงก์เก่าที่ยังชี้ /auth/* ไปหน้าแรก
/// เพื่อไม่ให้ผู้ใช้เจอหน้าตาย — `/auth/callback` ตัวจริงอยู่ที่หลังบ้าน
/// ไม่ใช่ที่นี่ (vocabulary.json `requiredRoutes.ssoCallback`)
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /login เปิดให้เข้าได้แล้ว — เป็นหน้าที่ส่งต่อไปล็อกอินที่ Core
  // ไม่ใช่หน้ารับรหัสผ่าน จึงไม่ขัด Blueprint หน้า 8
  //
  // /auth/* ของหน้าบ้านไม่มีความหมาย — SSO callback ตัวจริงคือ
  // GET /auth/callback ของ **หลังบ้าน** (:4000) ซึ่ง Core Hub ถือ URL นั้นไว้
  // ใน Subsystem Registry ลิงก์เก่าที่ยังชี้มาที่นี่จึงพากลับหน้าแรก
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

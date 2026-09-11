import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { ProfileModel } from "@/generated/prisma/models";

/// ตัวตนที่ผ่านการตรวจแล้ว: session มาจาก Supabase Auth (D1)
/// ส่วนข้อมูลโดเมนมาจาก Profile ใน Postgres
export type Viewer = {
  userId: string;
  email: string | null;
  profile: ProfileModel | null;
};

/// เรียกได้จาก server component และ route handler เท่านั้น
/// ไม่มี session = เด้งไป /login (การเช็คสิทธิ์จริงอยู่ที่นี่ ไม่ใช่ที่ proxy.ts — D8)
export async function requireUser(): Promise<Viewer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Profile ถูกสร้างโดย trigger ตอนมีแถวใหม่ใน auth.users แต่ระหว่างที่ยังไม่ได้
  // ติดตั้ง trigger (หรือบัญชีที่สมัครไว้ก่อนหน้า) แถวอาจยังไม่มี — ให้ UI
  // จัดการกรณีนี้เอง ดีกว่าปล่อยให้หน้าพัง
  const profile = await prisma.profile.findUnique({ where: { id: user.id } });

  return { userId: user.id, email: user.email ?? null, profile };
}

/// สิทธิ์โพสต์ Reels และเข้าห้องเสียงผูกกับรหัสนักศึกษาที่ยืนยันแล้ว
/// ไม่ใช่ผูกกับ "มี session ไหม" — กันปลอมตัวเป็นเพื่อน (D2 · §9-V1)
export async function requireVerifiedStudent(): Promise<
  Viewer & { profile: ProfileModel }
> {
  const viewer = await requireUser();

  if (!viewer.profile?.studentIdVerified) {
    redirect("/reels?needsVerification=1");
  }

  return { ...viewer, profile: viewer.profile };
}

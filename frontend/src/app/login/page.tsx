'use client';

import { useRouter } from 'next/navigation';
import { UserCog } from 'lucide-react';
import AuthSwitch from '@/components/ui/auth-switch';
import {
  DEV_IDENTITIES,
  setIdentity,
  type Identity,
} from '@/lib/csmju/identity';

/// หน้าทางเข้าระบบ — **ไม่ใช่หน้ารับรหัสผ่าน**
///
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า Login เอง และห้ามตรวจ session เอง
/// หน้านี้จึงไม่มีช่องกรอกรหัสผ่านแม้แต่ช่องเดียว — มันทำหน้าที่เดียวคือ
/// **ส่งผู้ใช้ไปล็อกอินที่ CSMJU2030 Core แล้วให้ Core ส่งกลับมา**
///
/// เหตุผลที่ต้องเป็นแบบนี้ ไม่ใช่แค่เรื่องทำตามกฎ:
/// ถ้า 36 ระบบย่อยต่างคนต่างมีช่องกรอกรหัสผ่าน รหัสของนักศึกษาจะไปโผล่อยู่
/// 36 ที่ ระบบย่อยไหนหลุดที่เดียวก็หลุดหมด และการเปลี่ยนรหัสครั้งเดียว
/// ต้องไปเปลี่ยน 36 รอบ — ศูนย์กลางตัวตนจึงต้องมีที่เดียวคือ Core
///
/// TODO(PL): ปลายทางที่ส่งไปยังรอ PM ยืนยัน (ดู docs/คำถามถึง-PM.md ข้อ 3)
/// ตอนนี้อ่านจาก NEXT_PUBLIC_CORE_LOGIN_URL ถ้ายังไม่ตั้ง ปุ่มจะปิดไว้
/// พร้อมบอกเหตุผล แทนที่จะพาไปหน้าตาย

const CORE_LOGIN_URL = process.env.NEXT_PUBLIC_CORE_LOGIN_URL ?? '';
const CORE_SIGNUP_URL = process.env.NEXT_PUBLIC_CORE_SIGNUP_URL ?? '';

/// โหมดพัฒนาเท่านั้น — ของจริงตัวตนมาจาก header ที่ Gateway แนบมา
const IS_DEV = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const router = useRouter();


  function signInAsDevIdentity(identity: Identity) {
    setIdentity(identity);
    router.push('/feed');
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-secondary/40 px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            CS
          </span>

          <h1 className="text-2xl font-semibold">CS Nexus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ศูนย์กลางชุมชนของสาขาวิทยาการคอมพิวเตอร์ · CSMJU2030
          </p>
        </header>

        <AuthSwitch
          signInUrl={CORE_LOGIN_URL || undefined}
          signUpUrl={CORE_SIGNUP_URL || undefined}
          className="max-w-none"
        />

        {IS_DEV && (
          <section className="mt-4 rounded-2xl border border-dashed border-border bg-card/60 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UserCog className="size-4 text-muted-foreground" />
              โหมดพัฒนา — เลือกตัวตนเพื่อทดสอบ
            </h2>

            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              ใช้ระหว่างที่ยังไม่ได้ต่อ Gateway เท่านั้น ของจริงตัวตนมาจาก
              header ที่ Gateway แนบมาให้ ส่วนนี้จะไม่ถูกสร้างตอน build
              สำหรับใช้งานจริง
            </p>

            <ul className="mt-3 space-y-1.5">
              {DEV_IDENTITIES.map((identity) => (
                <li key={identity.username}>
                  <button
                    type="button"
                    onClick={() => signInAsDevIdentity(identity)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {identity.displayName}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {identity.username}
                      </span>
                    </span>

                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                      {identity.layer1Role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

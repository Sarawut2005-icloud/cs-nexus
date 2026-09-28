'use client';

import { LogOut } from 'lucide-react';
import { useMe } from '@/lib/csmju/session';

/// ป้ายบอกว่ากำลังใช้งานในนามใคร + ทางออกจากระบบ
///
/// แทนที่ `IdentitySwitcher` เดิมที่ให้เลือกว่า "จะสวมบทเป็นใคร" จากรายชื่อ
/// ที่ฮาร์ดโค้ดไว้ — ของแบบนั้นทำให้ทดสอบหน้าจอหลายผู้ใช้ได้ แต่มันไม่ใช่
/// การยืนยันตัวตน และถ้าหลุดขึ้น production คือช่องโหว่ที่ร้ายแรงที่สุดเท่าที่
/// ระบบหนึ่งจะมีได้
///
/// ตอนนี้เปลี่ยนตัวตนได้ทางเดียวคือออกจากระบบแล้วล็อกอินใหม่ที่ Core Hub
const CORE_LOGOUT_URL = process.env.NEXT_PUBLIC_CORE_LOGOUT_URL ?? '';

const ROLE_LABEL: Record<string, string> = {
  student: 'นักศึกษา',
  alumni: 'ศิษย์เก่า',
  staff: 'บุคลากร',
  admin: 'ผู้ดูแลระบบ',
};

/// สิทธิ์ในระบบย่อยนี้ — สีบอกระดับโดยไม่ต้องอ่านคำ
const ROLE_TONE: Record<string, string> = {
  ADMIN: 'bg-primary/12 text-primary',
  EDITOR: 'bg-success/12 text-success',
  GUEST: 'bg-muted text-muted-foreground',
};

export function SessionCard() {
  const me = useMe();

  // ตัวอักษรแรกของอีเมลใช้เป็นรูปแทนตัว ระหว่างที่ Core Hub ยังไม่เปิดให้
  // ดึงรูปโปรไฟล์จริง (docs/ถึง-PM-สิ่งที่ต้องเพิ่ม.md ข้อ 1)
  const initial = me.email.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="csmju-surface px-2.5 py-2.5 shadow-csmju-xs">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="csmju-brand grid size-8 shrink-0 place-items-center rounded-lg text-csmju-label font-semibold"
        >
          {initial}
        </span>

        <span className="min-w-0 flex-1 leading-tight">
          <span
            className="block truncate text-csmju-label font-medium"
            title={me.email}
          >
            {me.email}
          </span>
          <span className="block truncate text-csmju-caption text-muted-foreground">
            {ROLE_LABEL[me.coreRole] ?? me.coreRole}
          </span>
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-md px-1.5 py-0.5 text-csmju-caption font-medium ${
            ROLE_TONE[me.subsystemRole] ?? ROLE_TONE.GUEST
          }`}
        >
          {me.subsystemRole}
        </span>

        {CORE_LOGOUT_URL ? (
          <a
            href={CORE_LOGOUT_URL}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-csmju-caption text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut aria-hidden className="size-3" />
            ออกจากระบบ
          </a>
        ) : (
          // Core Hub ยังไม่มีทางออกจากระบบแบบ GET ที่ลิงก์ไปได้
          // (ขอไว้แล้ว — docs/ถึง-PM-สิ่งที่ต้องเพิ่ม.md ข้อ 2)
          // แสดง `sub` แทน เพื่อให้อ้างอิงได้ตอนแจ้งปัญหา
          <span
            className="truncate font-mono text-csmju-caption text-muted-foreground/60"
            title={`รหัสผู้ใช้กลาง: ${me.id}`}
          >
            {me.id}
          </span>
        )}
      </div>
    </div>
  );
}

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

export function SessionCard() {
  const me = useMe();

  return (
    <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5">
      <p className="truncate text-sm font-medium" title={me.email}>
        {me.email}
      </p>

      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {ROLE_LABEL[me.coreRole]} · สิทธิ์ในระบบนี้: {me.subsystemRole}
      </p>

      {/* `id` คือค่า sub จาก token ไม่ใช่รหัสนักศึกษา — แสดงตัวเล็กไว้ให้
          อ้างอิงตอนแจ้งปัญหา ไม่ใช่ให้ผู้ใช้ต้องอ่านทุกวัน */}
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
        {me.id}
      </p>

      {CORE_LOGOUT_URL && (
        <a
          href={CORE_LOGOUT_URL}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut aria-hidden className="size-3" />
          ออกจากระบบ
        </a>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  student: 'นักศึกษา',
  alumni: 'ศิษย์เก่า',
  staff: 'บุคลากร',
  admin: 'ผู้ดูแลระบบ',
};

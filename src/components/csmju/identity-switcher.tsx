'use client';

import { useState, useSyncExternalStore } from 'react';

/// การสลับตัวตนรีโหลดทั้งหน้า จึงไม่มีอะไรต้องติดตามระหว่างที่หน้ายังอยู่
const subscribeIdentity = () => () => {};
import { ChevronDown, ShieldCheck, UserRound } from 'lucide-react';
import {
  DEV_IDENTITIES,
  getIdentity,
  setIdentity,
  type Identity,
} from '@/lib/csmju/identity';
import { disconnectSocket } from '@/lib/csmju/socket';

/// สวิตช์ "สวมบทเป็นใคร" สำหรับช่วงพัฒนา
///
/// **ไม่ใช่หน้า login** — Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า login เอง
/// ตัวนี้มีไว้ทดสอบสิทธิ์หลายระดับในเครื่องเดียว ระหว่างที่ SSO กลางยังไม่พร้อม
/// พอ Core พร้อม ให้ลบ component นี้กับ lib/csmju/identity.ts ทิ้ง
///
/// รีโหลดหน้าเต็มตอนสลับคน ไม่ใช่แค่ setState เพราะข้อมูลที่ค้างในหน้าจอ
/// เป็นของคนเดิมทั้งหมด (ฟีด สิทธิ์ ห้องที่เป็นสมาชิก) ถ้าไม่รีโหลดจะเห็น
/// ข้อมูลปนกันสองคน ซึ่งหลอกกว่าการรอโหลดใหม่หนึ่งวินาที
export function IdentitySwitcher() {
  const [open, setOpen] = useState(false);

  /// อ่านตัวตนจาก localStorage แบบปลอดภัยกับ hydration
  ///
  /// เซิร์ฟเวอร์ไม่มี localStorage ถ้าอ่านตอน render ตรง ๆ ค่าฝั่งเซิร์ฟเวอร์
  /// กับฝั่งเบราว์เซอร์จะไม่ตรงกัน แล้ว React จะเตือน hydration mismatch
  ///
  /// useSyncExternalStore ออกแบบมาสำหรับกรณีนี้โดยเฉพาะ: ใช้ snapshot ของ
  /// เซิร์ฟเวอร์ตอน hydrate แล้วค่อยสลับมาใช้ของเบราว์เซอร์ — ตรงกว่าการ
  /// setState ในเอฟเฟกต์ซึ่งทำให้วาดสองรอบ
  ///
  /// ปลอดภัยเพราะ getIdentity() คืนค่าอ้างอิงคงที่เสมอ (DEFAULT_IDENTITY
  /// หรือสมาชิกของ DEV_IDENTITIES) ถ้ามันสร้าง object ใหม่ทุกครั้ง
  /// useSyncExternalStore จะวนไม่รู้จบ
  const current = useSyncExternalStore(
    subscribeIdentity,
    getIdentity,
    () => null,
  );

  function choose(identity: Identity) {
    setIdentity(identity);
    disconnectSocket();
    window.location.reload();
  }

  if (!current) {
    // ยังไม่ผ่าน useEffect — กันไม่ให้ค่าที่ server เดาไว้กระพริบทับค่าจริง
    return <div className="h-14 rounded-lg bg-muted/60" />;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          {current.layer1Role === 'admin' ? (
            <ShieldCheck className="size-4" />
          ) : (
            <UserRound className="size-4" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {current.displayName}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {current.username}
          </span>
        </span>

        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <p className="border-b border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            โหมดพัฒนา — สวมบทเป็นคนอื่นเพื่อทดสอบสิทธิ์
            <br />
            ของจริงตัวตนมาจาก SSO กลางผ่าน API Gateway
          </p>

          {DEV_IDENTITIES.map((identity) => (
            <button
              key={identity.username}
              type="button"
              onClick={() => choose(identity)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                identity.username === current.username
                  ? 'bg-secondary text-secondary-foreground'
                  : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{identity.displayName}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {identity.username}
                </span>
              </span>

              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                {identity.layer1Role}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

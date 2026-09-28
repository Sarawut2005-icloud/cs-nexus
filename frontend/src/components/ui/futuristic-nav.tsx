'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useModalFocus } from './use-modal-focus';
import { motion } from 'framer-motion';
import {
  Bookmark,
  Compass,
  Film,
  Hash,
  Search,
  Send,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/// แถบนำทางล่างจอสำหรับมือถือ
///
/// จอเล็กใช้ sidebar 240px ไม่ได้ — มันกินครึ่งจอ แถบล่างคือรูปแบบที่
/// Instagram, Discord และ Teams ใช้ทั้งหมดบนมือถือ เพราะนิ้วโป้งเอื้อมถึง
///
/// ตัวชี้หน้าปัจจุบันเลื่อนด้วย layout animation ของ framer-motion
/// (`layoutId`) ไม่ใช่ transition ของ left/width เพราะ layoutId คำนวณ
/// ตำแหน่งจริงให้ ทำให้ไม่ต้อง hardcode ความกว้างของแต่ละปุ่ม —
/// พอเพิ่มหรือลบเมนู มันปรับเอง

const ITEMS = [
  { href: '/feed', label: 'ฟีด', icon: Compass },
  { href: '/reels', label: 'คลิป', icon: Film },
  { href: '/messages', label: 'ข้อความ', icon: Send },
  { href: '/chat', label: 'ห้องแชท', icon: Hash },
  { href: '/voice', label: 'เสียง', icon: Video },
] as const;

/// เมนูที่เหลือ ซ่อนไว้ในแผ่นที่เลื่อนขึ้น — ห้าปุ่มคือจำนวนที่พอดีนิ้ว
const MORE = [
  { href: '/meetings', label: 'นัดประชุม', icon: Users },
  { href: '/search', label: 'ค้นหา', icon: Search },
  { href: '/saved', label: 'ที่บันทึกไว้', icon: Bookmark },
  { href: '/admin', label: 'แผงผู้ดูแล', icon: ShieldCheck },
] as const;

export default function LumaBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // ปิดแผ่นเมนูเมื่อเปลี่ยนหน้า ไม่งั้นมันค้างคาอยู่ทับหน้าใหม่
  //
  // ปรับ state ระหว่าง render ตามรูปแบบที่ React แนะนำ แทนการใช้ effect —
  // effect ทำให้วาดหนึ่งรอบโดยที่เมนูยังเปิดค้างอยู่ก่อน แล้วค่อยวาดซ้ำ
  // เพื่อปิด ซึ่งผู้ใช้เห็นเป็นอาการกะพริบตอนเปลี่ยนหน้า
  // แผ่นเมนูวาดไว้ก่อน <nav> ใน DOM แต่โฟกัสยังอยู่ที่ปุ่ม "เพิ่มเติม"
  // ซึ่งอยู่ถัดไป — คนที่ใช้คีย์บอร์ดจึงต้อง Shift+Tab ย้อนกลับถึงจะเจอลิงก์
  // และไม่มี Escape ให้ปิด ต้องหาปุ่มฉากหลังเอาเอง
  const sheetRef = useModalFocus<HTMLDivElement>(moreOpen, () =>
    setMoreOpen(false),
  );

  const [pathAtOpen, setPathAtOpen] = useState(pathname);

  if (pathname !== pathAtOpen) {
    setPathAtOpen(pathname);
    setMoreOpen(false);
  }

  const activeHref =
    [...ITEMS, ...MORE].find((item) => pathname.startsWith(item.href))?.href ??
    null;

  const inMore = MORE.some((item) => item.href === activeHref);

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-70 bg-black/40 lg:hidden"
            aria-label="ปิดเมนู"
          />

          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="เมนูเพิ่มเติม"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="fixed inset-x-3 bottom-[4.75rem] z-80 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-popover p-2 shadow-xl outline-none lg:hidden"
          >
            {MORE.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-3 text-sm transition-colors',
                  activeHref === href
                    ? 'bg-secondary text-secondary-foreground'
                    : 'hover:bg-accent',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            ))}
          </motion.div>
        </>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-80 lg:hidden"
        aria-label="เมนูหลัก"
      >
        {/* พื้นหลังเบลอให้เนื้อหาที่เลื่อนผ่านด้านหลังยังอ่านออก
            และเว้น safe-area ของ iPhone ไม่ให้ปุ่มไปชนแถบ home */}
        <div className="border-t border-border bg-card/85 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch">
            {ITEMS.map(({ href, label, icon: Icon }) => {
              const active = activeHref === href;

              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2.5"
                >
                  {active && (
                    <motion.span
                      layoutId="luma-active"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      className="absolute inset-x-2 inset-y-1 -z-10 rounded-xl bg-secondary"
                    />
                  )}

                  <Icon
                    className={cn(
                      'size-5 shrink-0 transition-colors',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />

                  <span
                    className={cn(
                      'truncate text-[10px] leading-tight transition-colors',
                      active
                        ? 'font-medium text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={moreOpen}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2.5"
            >
              {inMore && !moreOpen && (
                <motion.span
                  layoutId="luma-active"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="absolute inset-x-2 inset-y-1 -z-10 rounded-xl bg-secondary"
                />
              )}

              <span
                className={cn(
                  'flex size-5 shrink-0 flex-col items-center justify-center gap-[3px] transition-colors',
                  inMore || moreOpen ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span className="h-[2px] w-4 rounded-full bg-current" />
                <span className="h-[2px] w-4 rounded-full bg-current" />
                <span className="h-[2px] w-4 rounded-full bg-current" />
              </span>

              <span
                className={cn(
                  'truncate text-[10px] leading-tight transition-colors',
                  inMore || moreOpen
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground',
                )}
              >
                เพิ่มเติม
              </span>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}

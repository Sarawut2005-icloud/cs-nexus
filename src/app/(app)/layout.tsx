import Link from 'next/link';
import {
  Bell,
  Bookmark,
  Compass,
  Film,
  Hash,
  LayoutDashboard,
  Search,
  Send,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import { CallProvider } from '@/components/csmju/call-provider';
import { IdentitySwitcher } from '@/components/csmju/identity-switcher';
import { NotificationBell } from '@/components/csmju/notification-bell';
import LumaBar from '@/components/ui/futuristic-nav';
import { QueryProvider } from '@/components/csmju/query-provider';
import { MotionProvider } from '@/components/ui/motion-provider';

/// เปลือกของแอป — sidebar ซ้าย เนื้อหาขวา แบบ Discord/Teams
///
/// เป็น Server Component เพราะไม่มีอะไรต้องโต้ตอบ ส่วนที่ต้องโต้ตอบ
/// (สวิตช์ตัวตน กระดิ่ง) แยกเป็น Client Component ชิ้นเล็กสองชิ้น
/// ทำให้ JavaScript ที่ส่งไปเบราว์เซอร์น้อยกว่าการทำทั้งเปลือกเป็น client

const NAV = [
  { href: '/feed', label: 'ฟีดชุมชน', icon: Compass, hint: 'Facebook' },
  { href: '/reels', label: 'คลิปสั้น', icon: Film, hint: 'Instagram' },
  { href: '/messages', label: 'ข้อความ', icon: Send, hint: 'Instagram' },
  { href: '/notifications', label: 'การแจ้งเตือน', icon: Bell, hint: null },
  { href: '/chat', label: 'ห้องแชท', icon: Hash, hint: 'Discord' },
  { href: '/voice', label: 'ห้องเสียง', icon: Video, hint: 'Discord' },
  { href: '/meetings', label: 'นัดประชุม', icon: Users, hint: 'Teams' },
  { href: '/search', label: 'ค้นหา', icon: Search, hint: null },
  { href: '/saved', label: 'ที่บันทึกไว้', icon: Bookmark, hint: null },
  { href: '/admin', label: 'แผงผู้ดูแล', icon: ShieldCheck, hint: null },
] as const;

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    // CallProvider อยู่ที่ layout ไม่ใช่ในหน้าใดหน้าหนึ่ง เพราะเสียงกริ่ง
    // ต้องดังแม้ผู้ใช้กำลังอ่านฟีดอยู่ — ถ้าผูกกับหน้า DM สายจะเข้าเฉพาะ
    // ตอนเปิดหน้านั้นค้างไว้ ซึ่งเท่ากับไม่มีระบบโทรเลย
    <QueryProvider>
      <MotionProvider>
        <CallProvider>
          <div className="flex min-h-dvh">
            <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar max-lg:hidden">
              <div className="flex items-center gap-2 px-4 py-4">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  CS
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold">CS Nexus</span>
                  <span className="block text-[11px] text-muted-foreground">
                    CSMJU2030 · v1.2.0
                  </span>
                </span>
              </div>

              <nav className="flex-1 space-y-0.5 px-2">
                {NAV.map(({ href, label, icon: Icon, hint }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{label}</span>
                    {hint && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {hint}
                      </span>
                    )}
                  </Link>
                ))}

                {/* หน้าตัวอย่างดีไซน์ใช้ข้อมูลปลอม จึงต้องไม่โผล่ในของจริง
                 * ตอนเดโมให้ PM ลิงก์นี้อยู่ในเมนูหลักคือภาระที่ไม่จำเป็น
                 * และเสี่ยงที่คนดูจะเข้าใจว่าเลขในนั้นเป็นข้อมูลจริง */}
                {process.env.NODE_ENV !== 'production' && (
                  <Link
                    href="/mockup"
                    className="mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent"
                  >
                    <LayoutDashboard className="size-4 shrink-0" />
                    <span className="flex-1">ตัวอย่างดีไซน์ (ข้อมูลปลอม)</span>
                  </Link>
                )}
              </nav>

              <div className="p-2">
                <IdentitySwitcher />
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 lg:px-6">
                {/* จอเล็กใช้แถบล่าง (LumaBar) แทนแถบไอคอนบนสุด เพราะนิ้วโป้ง
              เอื้อมถึงและไม่แย่งพื้นที่กับเนื้อหา */}
                <span className="flex items-center gap-2 lg:hidden">
                  <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                    CS
                  </span>
                  <span className="text-sm font-semibold">CS Nexus</span>
                </span>

                <span className="text-sm text-muted-foreground max-lg:hidden">
                  ระบบย่อยภายใต้ CSMJU2030 · ตัวตนมาจาก API Gateway
                </span>

                <NotificationBell />
              </header>

              {/* pb ล่างเว้นที่ให้ LumaBar ไม่ทับเนื้อหาบรรทัดสุดท้าย */}
              <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
            </div>

            <LumaBar />
          </div>
        </CallProvider>
      </MotionProvider>
    </QueryProvider>
  );
}

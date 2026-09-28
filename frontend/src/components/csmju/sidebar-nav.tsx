'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Bookmark,
  Compass,
  Film,
  Hash,
  Search,
  Send,
  ShieldCheck,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

/// เมนูหลักของแอป
///
/// เป็น Client Component เพราะต้องรู้ว่าอยู่หน้าไหนอยู่ (`usePathname`)
/// เพื่อไฮไลต์รายการปัจจุบัน — เดิมเป็น Server Component ที่วาดลิงก์เฉย ๆ
/// ผู้ใช้จึงไม่มีทางรู้จากเมนูเลยว่าตัวเองอยู่ตรงไหน
///
/// **จัดกลุ่มตามหน้าที่จริง ไม่ใช่เพื่อความสวย** — รายการสิบอันเรียงติดกัน
/// เป็นพืดทำให้ต้องอ่านทุกบรรทัดทุกครั้งที่จะหาอะไร พอแบ่งเป็นสี่กลุ่มแล้ว
/// สายตาข้ามไปที่กลุ่มที่ต้องการได้เลย

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /// ระบบที่หน้านี้ทำงานคล้ายกัน — ช่วยให้คนที่เพิ่งเข้ามาเดาได้ว่าคาดหวัง
  /// อะไรได้บ้าง โดยไม่ต้องกดเข้าไปดูทีละหน้า
  hint: string | null;
}

const GROUPS: ReadonlyArray<{ title: string; items: readonly NavItem[] }> = [
  {
    title: 'ชุมชน',
    items: [
      { href: '/feed', label: 'ฟีดชุมชน', icon: Compass, hint: 'Facebook' },
      { href: '/reels', label: 'คลิปสั้น', icon: Film, hint: 'Instagram' },
    ],
  },
  {
    title: 'พูดคุย',
    items: [
      { href: '/messages', label: 'ข้อความ', icon: Send, hint: 'Instagram' },
      { href: '/chat', label: 'ห้องแชท', icon: Hash, hint: 'Discord' },
      { href: '/voice', label: 'ห้องเสียง', icon: Video, hint: 'Discord' },
      { href: '/meetings', label: 'นัดประชุม', icon: Users, hint: 'Teams' },
    ],
  },
  {
    title: 'ของฉัน',
    items: [
      { href: '/notifications', label: 'การแจ้งเตือน', icon: Bell, hint: null },
      { href: '/saved', label: 'ที่บันทึกไว้', icon: Bookmark, hint: null },
      { href: '/search', label: 'ค้นหา', icon: Search, hint: null },
    ],
  },
  {
    title: 'ดูแลระบบ',
    items: [
      { href: '/admin', label: 'แผงผู้ดูแล', icon: ShieldCheck, hint: null },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-4 pb-2">
      {GROUPS.map((group) => (
        <div key={group.title} className="mb-5 last:mb-0">
          <p className="mb-1.5 px-1.5 text-csmju-caption font-medium uppercase text-muted-foreground/70">
            {group.title}
          </p>

          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon, hint }) => {
              // ตรงเป๊ะ หรือเป็นหน้าลูกของเส้นทางนี้ (เช่น /chat/abc)
              const active =
                pathname === href || pathname.startsWith(href + '/');

              return (
                <li key={href}>
                  <Link
                    href={href}
                    data-active={active}
                    aria-current={active ? 'page' : undefined}
                    className={`csmju-nav-item group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-csmju-label ${
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                    }`}
                  >
                    <Icon
                      aria-hidden
                      className={`size-4 shrink-0 transition-colors ${
                        active
                          ? 'text-sidebar-accent-foreground'
                          : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'
                      }`}
                    />

                    <span className="flex-1 truncate">{label}</span>

                    {hint && (
                      // จาง ๆ ไว้ เพราะเป็นข้อมูลประกอบ ไม่ใช่สิ่งที่ต้องอ่าน
                      // ทุกครั้ง — ชัดขึ้นตอนชี้เพื่อให้คนที่อยากรู้หาเจอ
                      <span className="text-csmju-caption text-muted-foreground/50 transition-colors group-hover:text-muted-foreground max-xl:hidden">
                        {hint}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

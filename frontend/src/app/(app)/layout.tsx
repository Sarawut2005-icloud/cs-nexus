import { CallProvider } from '@/components/csmju/call-provider';
import { NotificationBell } from '@/components/csmju/notification-bell';
import { SessionCard } from '@/components/csmju/session-card';
import { SidebarNav } from '@/components/csmju/sidebar-nav';
import { ThemeToggle } from '@/components/csmju/theme-toggle';
import LumaBar from '@/components/ui/futuristic-nav';
import { QueryProvider } from '@/components/csmju/query-provider';
import { MotionProvider } from '@/components/ui/motion-provider';
import { SessionProvider } from '@/lib/csmju/session';

/// เปลือกของแอป — sidebar ซ้าย เนื้อหาขวา แบบ Discord/Teams
///
/// เป็น Server Component เพราะไม่มีอะไรต้องโต้ตอบ ส่วนที่ต้องโต้ตอบ
/// (เมนู ป้ายผู้ใช้ กระดิ่ง สลับธีม) แยกเป็น Client Component ชิ้นเล็ก ๆ
/// ทำให้ JavaScript ที่ส่งไปเบราว์เซอร์น้อยกว่าการทำทั้งเปลือกเป็น client
///
/// `SessionProvider` อยู่ชั้นนอกสุด เพราะทุกหน้าใต้ `(app)` ต้องรู้ว่าผู้ใช้
/// เป็นใครก่อนจะเรนเดอร์อะไรได้ — มันจะถาม `GET /api/v1/me` ครั้งเดียวแล้ว
/// กันไม่ให้ children เรนเดอร์จนกว่าจะได้คำตอบ หน้าจอข้างในจึงเรียก `useMe()`
/// แบบ synchronous ได้โดยไม่ต้องเขียนเคส "ยังไม่รู้ว่าเป็นใคร" ซ้ำทุกหน้า
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    // CallProvider อยู่ที่ layout ไม่ใช่ในหน้าใดหน้าหนึ่ง เพราะเสียงกริ่ง
    // ต้องดังแม้ผู้ใช้กำลังอ่านฟีดอยู่ — ถ้าผูกกับหน้า DM สายจะเข้าเฉพาะ
    // ตอนเปิดหน้านั้นค้างไว้ ซึ่งเท่ากับไม่มีระบบโทรเลย
    <QueryProvider>
      <SessionProvider>
        <MotionProvider>
          <CallProvider>
            {/* h-dvh + overflow-hidden ไม่ใช่ min-h-dvh
                เพราะ sidebar ต้องเลื่อนแยกจากเนื้อหา ถ้าให้ทั้งหน้าเลื่อน
                ด้วยกัน ป้ายผู้ใช้ท้าย sidebar จะถูกดันตกขอบจอจนมองไม่เห็น
                (เป็นอาการที่เกิดขึ้นจริงก่อนแก้) */}
            <div className="flex h-dvh overflow-hidden">
              <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar max-lg:hidden">
                <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
                  <span className="csmju-brand grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold shadow-csmju-glow">
                    CS
                  </span>

                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-csmju-label font-semibold">
                      CS Nexus
                    </span>
                    <span className="block truncate text-csmju-caption text-muted-foreground">
                      วิทยาการคอมพิวเตอร์ · CSMJU2030
                    </span>
                  </span>
                </div>

                <SidebarNav />

                {/* shrink-0 กันไม่ให้ส่วนนี้ถูกบีบจนข้อความถูกตัด
                    ตอน nav ยาวกว่าจอ — ปัญหาเดิมคือทั้งสองส่วนแย่งพื้นที่กัน */}
                <div className="shrink-0 border-t border-sidebar-border p-3">
                  <SessionCard />

                  {/* ชิดขวาเพราะมุมซ้ายล่างเป็นที่ของแถบเครื่องมือนักพัฒนา
                      ของ Next ซึ่งลอยทับทุกอย่างในโหมด dev
                      ไม่มีป้ายกำกับเพราะไอคอนมี title กับ aria-label อยู่แล้ว */}
                  <div className="mt-2.5 flex justify-end">
                    <ThemeToggle />
                  </div>
                </div>
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                {/* sticky + กระจกฝ้า — เนื้อหาเลื่อนผ่านข้างหลังแบบเบลอ
                    ทำให้แถบบนยังอ่านออกโดยไม่ต้องทึบจนตัดหน้าเป็นสองส่วน */}
                <header className="csmju-glass sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5 lg:px-6">
                  {/* จอเล็กใช้แถบล่าง (LumaBar) แทนแถบไอคอนบนสุด เพราะนิ้วโป้ง
                      เอื้อมถึงและไม่แย่งพื้นที่กับเนื้อหา */}
                  <span className="flex items-center gap-2 lg:hidden">
                    <span className="csmju-brand grid size-7 place-items-center rounded-lg text-xs font-bold">
                      CS
                    </span>
                    <span className="text-csmju-label font-semibold">
                      CS Nexus
                    </span>
                  </span>

                  {/* ข้อความเดิมเขียนว่า "ตัวตนมาจาก API Gateway" ซึ่งเป็น
                      สถาปัตยกรรมที่สัญญา v1.0 บอกว่าไม่เคยมีอยู่จริง
                      ตอนนี้ตัวตนมาจาก JWT ของ Core Hub ที่เราตรวจลายเซ็นเอง */}
                  <span className="truncate text-csmju-label text-muted-foreground max-lg:hidden">
                    ระบบย่อยภายใต้ CSMJU2030 · เข้าสู่ระบบด้วยบัญชีกลาง
                  </span>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="lg:hidden">
                      <ThemeToggle />
                    </span>
                    <NotificationBell />
                  </div>
                </header>

                {/* เนื้อหาเลื่อนในตัวมันเอง ไม่ใช่ทั้งหน้าเลื่อน
                    pb ล่างเว้นที่ให้ LumaBar ไม่ทับเนื้อหาบรรทัดสุดท้าย */}
                <main className="min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
                  {children}
                </main>
              </div>

              <LumaBar />
            </div>
          </CallProvider>
        </MotionProvider>
      </SessionProvider>
    </QueryProvider>
  );
}

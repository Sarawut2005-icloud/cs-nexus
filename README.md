# CS Nexus

ศูนย์กลางชุมชนออนไลน์ของสาขาวิทยาการคอมพิวเตอร์ — ผสมสิ่งที่แต่ละแอปทำได้ดี
ไว้ในที่เดียว: ฟีดและกระดานถามตอบแบบ **Facebook** · คลิปสั้นและสตอรี่แบบ
**Instagram** · ห้องแชทและห้องเสียงแบบ **Discord** · นัดประชุมและเธรดแบบ
**Microsoft Teams**

ระบบย่อยภายใต้ **CSMJU2030** · `standards_version 1.2.0`

---

## เริ่มใช้งาน

ต้องเปิดสามอย่าง: ฐานข้อมูล → หลังบ้าน → หน้าบ้าน

```bash
# 1. ฐานข้อมูล (Docker)
cd backend
npm install
cp .env.example .env
npm run db:up            # เปิด PostgreSQL แล้วรอจนพร้อมรับ connection
npx prisma migrate dev   # ลงตาราง

# 2. หลังบ้าน — เปิดค้างไว้ในเทอร์มินัลนี้
npm run start:dev

# 3. หน้าบ้าน — เทอร์มินัลใหม่
cd ..
npm install
npm run dev
```

เปิด **http://localhost:3000** — จะเด้งไปที่ฟีดชุมชน

> **คำสั่งที่พิมพ์ผิดบ่อย:** เป็น `npm run dev` ไม่ใช่ `npm start dev`
> — อย่างหลังจะกลายเป็น `next start dev` แล้ว Next จะหาโฟลเดอร์ชื่อ `dev`
> ส่วนหลังบ้านคือ `npm run start:dev` (ต้องอยู่ในโฟลเดอร์ `backend`)
>
> ถ้าขึ้นว่า `Another next dev server is already running` แปลว่ามีตัวเดิม
> เปิดค้างอยู่แล้ว เข้า http://localhost:3000 ได้เลย ไม่ต้องเปิดใหม่

| ที่อยู่ | คืออะไร |
|---|---|
| http://localhost:3000 | หน้าบ้าน |
| http://localhost:4000/api/v1 | API |
| http://localhost:4000/api/docs | เอกสาร API (Swagger) |
| http://localhost:4000/health | สถานะระบบ |

### ยังไม่มีระบบล็อกอิน — และนั่นถูกต้อง

Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า login เอง ตัวตนต้องมาจาก SSO กลางผ่าน
API Gateway ระหว่างที่ Core ยังไม่พร้อม หน้าบ้านมี **สวิตช์สลับตัวตน**
ที่มุมซ้ายล่าง (นักศึกษา 3 คน / อาจารย์ / ผู้ดูแล) เพื่อทดสอบสิทธิ์แต่ละระดับ

พอ Core พร้อม ให้ลบ `src/lib/csmju/identity.ts` กับ `IdentitySwitcher` ทิ้ง
แล้วอ่านตัวตนจาก `GET /subsystem-members/me` แทน — ที่เหลือไม่ต้องแก้เลย
เพราะทุกหน้าจอเรียกผ่าน `src/lib/csmju/api.ts` อยู่แล้ว

---

## ระบบอัตโนมัติ

ครั้งแรกที่ clone ให้รันหนึ่งครั้ง:

```bash
npm run setup          # เปิดใช้ git hooks
```

หลังจากนั้นจะมีสามด่านทำงานให้เอง:

| เมื่อไหร่ | ตรวจอะไร | ใช้เวลา |
| --- | --- | --- |
|  | ชนิดข้อมูลของฝั่งที่แก้ + ดักไฟล์ความลับ | ~3 วิ |
| [36m› หน้าบ้าน — ชนิดข้อมูล[0m
[36m› หน้าบ้าน — กฎการเขียนโค้ด[0m
[36m› หน้าบ้าน — เทสต์[0m

 RUN  v4.1.11 C:/Users/User/cs-nexus


 Test Files  13 passed (13)
      Tests  134 passed (134)
   Start at  10:13:06
   Duration  8.17s (transform 1.31s, setup 5.61s, import 2.95s, tests 12.82s, environment 22.08s)

[36m› หลังบ้าน — ชนิดข้อมูล[0m
[36m› หลังบ้าน — กฎการเขียนโค้ด[0m
[36m› หลังบ้าน — openapi ตรงกับโค้ด[0m
openapi.json ตรงกับโค้ด · 67 path · 65 schema
[32m✓ ผ่านทุกด่าน — ปลอดภัยที่จะ push[0m | ชุดเดียวกับ CI ทั้งหมด | ~40 วิ |
| ทุกวันจันทร์ | Dependabot เปิด PR อัปเดตแพ็กเกจ (ช่องโหว่เปิดทันที) | — |

ตรวจเองทั้งหมดได้ด้วย `npm run verify`

ถ้าจำเป็นต้องข้ามด่านจริง ๆ ใช้ `--no-verify` แต่ CI จะจับให้อยู่ดี

## ขึ้นระบบจริง

ดู [DEPLOY.md](DEPLOY.md) — ขึ้นทั้งระบบด้วยชั้นใช้ฟรีล้วน ไม่ต้องผูกบัตรเครดิต
(Vercel + Render + Supabase) พร้อมข้อจำกัดจริงของแต่ละเจ้าที่ควรรู้ก่อนตัดสินใจ

## เจอปัญหาบ่อย ๆ

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| หน้าเว็บขึ้น "ติดต่อหลังบ้านไม่ได้" | หลังบ้านไม่ได้รัน | `cd backend && npm run start:dev` |
| `Can't reach database server at 127.0.0.1:55432` | คอนเทนเนอร์ไม่ได้รัน — **ไม่ใช่โค้ดพัง** | `cd backend && npm run db:up` |
| `EADDRINUSE :::4000` | มีเซิร์ฟเวอร์ค้างอยู่ | ดูคำสั่งด้านล่าง |

พอร์ตค้างบน Windows (`kill` กับ `pkill` ใช้ไม่ได้):

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

---

## โครงสร้าง

```
cs-nexus/
├── src/                    หน้าบ้าน — Next.js 16 (App Router) · React 19 · Tailwind v4
│   ├── app/(app)/          หน้าจอทั้งหมด ใต้เปลือกเดียวกัน
│   ├── components/ui/      component ที่ใช้ซ้ำได้ (แบบ shadcn)
│   ├── components/csmju/   component ที่ผูกกับโดเมนของเรา
│   └── lib/csmju/          ชั้นเรียก API · socket · ตัวตน · ชนิดข้อมูล
├── backend/                หลังบ้าน — NestJS 12 (ESM) · Prisma 7 · PostgreSQL 17
├── .github/workflows/      CI Gate
└── subsystem.yaml          คำขอขึ้นทะเบียนระบบย่อย (ยื่นให้ PM)
```

**หน้าบ้านไม่ต่อฐานข้อมูลเอง** (Blueprint หน้า 13) ทุกอย่างผ่าน
`src/lib/csmju/api.ts` — ถ้าเห็น `import` ของ Prisma หรือ `pg` ใน `src/`
นั่นคือการละเมิดข้อห้าม ไม่ใช่ทางลัด

รายละเอียดของหลังบ้านทั้งหมด (สถาปัตยกรรม เหตุผลของแต่ละการตัดสินใจ
ข้อจำกัดที่รู้ตัว) อยู่ที่ [`backend/README.md`](backend/README.md)

---

## หน้าจอ

| หน้า | เทียบกับ | ทำอะไรได้ |
|---|---|---|
| ฟีดชุมชน | Facebook | ตั้งกระทู้ · อิโมจิ 12 แบบ · คอมเมนต์ · บันทึก · แท็กวิชา |
| คลิปสั้น | Instagram | อัปโหลด · เล่น · ไลก์ · คอมเมนต์ · ยอดผู้ชม |
| สตอรี่ | Instagram | โพสต์ · ดูแบบเต็มจอ · หมดอายุ 24 ชั่วโมง · รายชื่อผู้ชม |
| ข้อความ | Instagram | DM หนึ่งต่อหนึ่ง · โทรด้วยเสียง |
| ห้องแชท | Discord · Teams | ข้อความสด · เธรด · ปักหมุด · แก้ข้อความ · `@` เมนชัน |
| ห้องเสียง | Discord | WebRTC mesh · แชร์หน้าจอ · เพดาน 8 ที่นั่ง |
| นัดประชุม | Teams | นัดล่วงหน้า · แจ้งทุกคนในห้อง |
| โปรไฟล์ · ค้นหา · ที่บันทึกไว้ · แผงผู้ดูแล | ทั้งสี่ | ติดตาม · ค้น 4 หมวด · audit log · สิทธิ์ · โควตา |

---

## การทดสอบ

สามชุด แยกตามสิ่งที่แต่ละชุดจับได้จริง — **ไม่มีชุดไหนแทนกันได้**

```bash
npm test                       # หน้าบ้าน — component ในเบราว์เซอร์จำลอง (56 เทสต์)
cd backend && npm run test:e2e # หลังบ้าน — มาตรฐาน API และความปลอดภัย (43 เทสต์)
```

| ชุด | รันที่ไหน | จับอะไรได้ | จับอะไรไม่ได้ |
|---|---|---|---|
| หน้าบ้าน (vitest + jsdom) | เบราว์เซอร์จำลอง | วงจร render · effect ซ้ำ · หน่วยความจำรั่ว | กฎของ API จริง |
| หลังบ้าน (supertest) | โพรเซสเดียวกับ Nest | envelope · สิทธิ์ · การกันเข้าถึงข้ามคน | **CORS** และทุกอย่างที่เบราว์เซอร์บังคับ |
| สคริปต์ยิงจริง | ต่อเซิร์ฟเวอร์ที่รันอยู่ | socket · WebRTC · การต่อใหม่ | — |

### บทเรียนสองข้อที่ได้มาแบบเจ็บตัว

**หนึ่ง: HTTP 200 จาก curl ไม่ได้แปลว่าเบราว์เซอร์ใช้งานได้**

หลังบ้านไม่ได้เปิด CORS เลย เบราว์เซอร์บล็อกทุกคำขอด้วย "Failed to fetch"
แต่เทสต์ 40 ตัวเขียวหมด เพราะ supertest, curl และ node fetch **ไม่บังคับ CORS**
— มันเป็นกฎที่เบราว์เซอร์บังคับฝ่ายเดียว

หน้าเว็บเรนเดอร์ได้ (นั่นคือ SSR shell) แต่ไม่เคยโหลดข้อมูลได้เลยสักครั้ง
ตอนนี้มีเทสต์ที่ตรวจ **header ที่ตอบกลับ** ไม่ใช่แค่ status code

**สอง: การไล่ assert คำเตือนของ React ทีละที่ เชื่อถือไม่ได้**

เดิมเขียนเทสต์ที่ดัก `console.error` แล้ว assert ว่าไม่มี
"Cannot update a component" — **เทสต์นั้นเขียวทั้งที่บั๊กยังอยู่ครบ**
เพราะ React แจ้งคำเตือนแต่ละแบบครั้งเดียวต่อคู่ component เทสต์ก่อนหน้า
ในไฟล์เดียวกันกินคำเตือนไปแล้ว

ตอนนี้ [`vitest.setup.ts`](vitest.setup.ts) ดักที่ระดับชุดทดสอบ:
`console.error` ครั้งแรกที่เกิดในเทสต์ไหนก็ตาม **ทำให้เทสต์นั้นแดงทันที**
เทสต์ที่ตั้งใจให้เกิด error เรียก `expectConsoleError()` เพื่อขออนุญาต

---

## บั๊กที่ชุดทดสอบหน้าบ้านจับได้ (และวิธีพิสูจน์ว่าเทสต์ใช้ได้จริง)

ทั้งสองตัวเป็นบั๊กชนิดเดียวกัน: **ผลข้างเคียงอยู่ใน state updater**
React เรียก updater ระหว่าง render และเรียกซ้ำได้ (StrictMode เรียกสองครั้งเสมอ)
สิ่งที่อยู่ในนั้นต้องเป็นการคำนวณค่าใหม่ล้วน ๆ

### 1. ตัวเล่นสตอรี่ปิดตัวเองไม่ได้

```ts
setIndex((current) => {
  if (current + 1 >= stories.length) {
    onClose();          // ← setState ของ component แม่ ระหว่าง render
    return current;
  }
  return current + 1;
});
```

React ฟ้อง `Cannot update a component (StoryViewer) while rendering a
different component (StoryOverlay)` — แก้โดยอ่าน `index` จาก state ตรง ๆ
แล้วตัดสินใจนอก updater

### 2. blob URL รั่วตอนเลือกรูป

```ts
setPreviewUrl((current) => {
  if (current) URL.revokeObjectURL(current);
  return URL.createObjectURL(picked);   // ← สร้าง URL ใหม่ในทุกครั้งที่ updater ถูกเรียก
});
```

วัดได้: **StrictMode สร้าง 2 URL ต่อไฟล์เดียว · 3 URL รั่ว · 1 URL คืนซ้ำ**
เบราว์เซอร์ถือ blob ไว้จนปิดแท็บ ผู้ใช้ที่ลองเลือกรูปหลายสิบใบจะกินหน่วยความจำ
โดยไม่มีอะไรบอก

แก้โดยให้ ref เป็นเจ้าของ URL ปัจจุบัน และคืนที่เดียวคือใน event handler

### พิสูจน์ว่าเทสต์จับได้จริง

เทสต์ที่ไม่เคยเห็นตัวเองแดง ไม่ต่างจากไม่มีเทสต์ — ทั้งสองข้อจึงยืนยันด้วยการ
**เอาบั๊กกลับเข้าไปแล้วดูว่าแดง** ก่อนเอาโค้ดที่แก้แล้วกลับมา

หลังแก้ยังกวาดทั้ง `src/` ด้วยสคริปต์หา `setX(prev => { ... })` ที่มีผลข้างเคียง
ข้างใน — ไม่พบที่อื่นอีก

---

## CI Gate

`.github/workflows/ci.yml` รันทุก PR — **ต้องตั้ง PL เป็นผู้อนุมัติที่
Settings → Branches** ด้วย เพราะ GitHub ไม่ให้ประกาศ required reviewer
ในไฟล์ workflow

| job | ตรวจอะไร | ต้องมี DB |
|---|---|---|
| `static` | `prisma validate` · lint · typecheck | ไม่ |
| `frontend` | เทสต์ component · typecheck · build | ไม่ |
| `compliance` | migrate · build · `openapi:check` · เทสต์ API | ใช่ |

`openapi:check` เทียบ `openapi.json` ที่ commit ไว้กับโค้ดปัจจุบัน —
จับกรณีที่มีคนเพิ่ม endpoint แล้ว commit โดยไม่ได้บูตเซิร์ฟเวอร์ ซึ่งทำให้
contract ใน repo เก่ากว่าโค้ด แล้วระบบย่อยอื่นเขียนโค้ดผิดตาม

---

## ที่ยังไม่ได้ทำ

| เรื่อง | สถานะ |
|---|---|
| `git init` ใน `cs-nexus` | **รอ PL อนุมัติ** — ตอนนี้ `C:\Users\User` เป็น git repo ครอบ home directory ซึ่งผิดหน้า 15 และเสี่ยงให้ `.ssh/` ขึ้น GitHub |
| ลบ `src/lib/db.ts` และ `src/lib/auth/require.ts` | **รอ PL อนุมัติ** — ไม่มีใครเรียกแล้ว แต่ยังผิดหน้า 13 (หน้าบ้านห้ามถือ DB connection) |
| ยื่น `subsystem.yaml` ให้ PM | มี TODO 4 จุดรอเติม: org/repo · โดเมน callback · Gateway proxy WebSocket ไหม · รูปแบบ user profile API |
| TURN server | ยังไม่มี — ผู้ใช้หลัง NAT ที่เจาะไม่ได้จะเชื่อมเสียงไม่ติด (หน้าจอเตือนแล้ว) |

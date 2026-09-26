# ร่าง issue ถึง `CSMJU2030/csmju2030-standards`

**เขียนถึง:** ทีม DevOps/PM ผู้ดูแล standards repo (ผู้อ่านปลายทาง) · PL ตรวจก่อนส่ง
**สถานะ:** ร่าง — ยังไม่ได้เปิด issue จริง รอ PL อนุมัติ
**ที่มา:** รัน `standards/scripts/run-all-checks.sh` กับ `csmju-social-reels` เมื่อ 2026-09-26 (standards v1.0.0)

คัดลอกแต่ละหัวข้อไปเปิดเป็น issue แยกกัน

---

# Issue 1 — ขอเพิ่ม dependency เข้า whitelist (ARC-02/03)

**ระบบย่อย:** `csmju-social-reels` (AIE 4)
**กฎที่เกี่ยวข้อง:** `ARC-02` / `ARC-03` · `scripts/lib/allowed-deps.json`

ระบบย่อยนี้เป็นสังคมออนไลน์ที่มีแชทเรียลไทม์ ห้องเสียง และการแจ้งเตือนสด
จึงต้องใช้ไลบรารีที่ยังไม่อยู่ใน whitelist ขออนุมัติตามรายการด้านล่าง

**ไม่มีตัวไหนอยู่ใน `forbidden_everywhere`** — ทั้งหมดเป็นของที่ยังไม่ถูกพิจารณา
ไม่ใช่ของที่เคยถูกปฏิเสธ

## 1.1 เรื่องด่วนที่สุด — WebSocket (หลังบ้าน 3 ตัว)

| package | ทำไมต้องใช้ |
| --- | --- |
| `socket.io` | เซิร์ฟเวอร์ WebSocket |
| `@nestjs/websockets` | ตัวเชื่อม NestJS กับ WebSocket gateway |
| `@nestjs/platform-socket.io` | adapter ที่ `@nestjs/websockets` ต้องใช้ |

**4 ฟีเจอร์หลักวางอยู่บนสามตัวนี้ทั้งหมด:** แชทกลุ่ม/รายวิชา · การแจ้งเตือนสด ·
ห้องเสียง WebRTC (ใช้ส่ง signaling) · สายเรียกเข้าแบบ 1:1

**ทำไมใช้ของใน whitelist แทนไม่ได้:** รายการปัจจุบันไม่มีทางเลือกสำหรับ
การสื่อสารสองทางเลย มีแต่ `axios` กับ `@tanstack/react-query` ซึ่งเป็น
request/response ทั้งคู่ การทำแชทด้วยการ poll ทุกวินาทีจะยิง API
หลักหมื่นครั้งต่อชั่วโมงต่อผู้ใช้หนึ่งคน ซึ่งชั้นใช้ฟรีรับไม่ไหว
และยังได้ประสบการณ์ที่แย่กว่ามาก

**ถ้าไม่อนุมัติ** ขอทราบโดยเร็วที่สุด เพราะต้องออกแบบใหม่ทั้ง 4 ฟีเจอร์

ฝั่งหน้าบ้านต้องใช้ `socket.io-client` คู่กัน (อยู่ในข้อ 1.2)

## 1.2 หน้าบ้าน — runtime 14 ตัว

**สื่อสารเรียลไทม์**

| package | เหตุผล |
| --- | --- |
| `socket.io-client` | คู่กับ `socket.io` ฝั่งเซิร์ฟเวอร์ (ข้อ 1.1) |

**ชั้น UI แบบเข้าถึงได้ (accessible primitives)**

| package | เหตุผล |
| --- | --- |
| `@radix-ui/react-tabs` `react-checkbox` `react-label` `react-separator` `react-slot` | component ที่รองรับคีย์บอร์ดและ screen reader ถูกต้องตาม WAI-ARIA |
| `@base-ui/react` | รุ่นต่อของ Radix ใช้กับ component ที่ Radix ยังไม่มี |
| `lucide-react` | ชุดไอคอน SVG |

> `ui-design-system.md` บังคับเรื่อง design token และความเข้าถึงได้ แต่ whitelist
> ยังไม่มีชั้น component ให้ใช้เลย — `@csmju2030/design-system` ที่อ้างถึงใน
> `tech-stack.md` ข้อ 1.2 **ยังไม่มีอยู่จริงบน npm หรือใน org**
> ถ้ามีแผนจะปล่อยเมื่อไหร่ ขอทราบด้วย เราจะได้ย้ายไปใช้แทน

**เครื่องมือจัดการ class ของ Tailwind**

| package | เหตุผล |
| --- | --- |
| `clsx` · `tailwind-merge` | รวม class อย่างปลอดภัย กัน class ชนกันเงียบ ๆ |
| `class-variance-authority` | ผูก variant ของ component เข้ากับ token |
| `shadcn` · `tw-animate-css` | ชุด component ฐานและ keyframe สำเร็จรูป |

**ภาพเคลื่อนไหว**

| package | เหตุผล |
| --- | --- |
| `framer-motion` | ใช้กับสตอรี่ วิดีโอสั้น และการเปลี่ยนหน้า · รองรับ `prefers-reduced-motion` ในตัว ซึ่งเขียนเองให้ถูกต้องได้ยาก |

## 1.3 devDependencies 9 ตัว

| package | เหตุผล |
| --- | --- |
| `@testing-library/jest-dom` · `@testing-library/user-event` | คู่กับ `@testing-library/react` ที่อยู่ใน whitelist แล้ว — แปลกที่ตัวหลักอนุญาตแต่ตัวประกอบไม่อนุญาต |
| `@tailwindcss/postcss` | Tailwind v4 ต้องใช้ตัวนี้แทน plugin เดิม |
| `eslint-config-next` | ชุดกฎ lint ของ Next.js |
| `@vitest/coverage-v8` | รายงาน coverage ของ vitest (ซึ่งอยู่ใน whitelist แล้ว) |
| `oxlint` · `source-map-support` | lint และ stack trace ฝั่งหลังบ้าน |
| `supabase` | CLI ของที่เก็บไฟล์ |

## 1.4 น่าจะเป็นช่องโหว่ของ whitelist เอง — `prisma`

`prisma` อยู่ใน `allowed_backend` แต่**ไม่อยู่ใน `allowed_dev_tooling`**

แต่ `prisma` (ตัว CLI) เป็น **devDependency** ตามปกติของทุกโปรเจกต์ Prisma —
ตัวที่เป็น runtime คือ `@prisma/client` ซึ่งอยู่ใน `allowed_backend` ถูกแล้ว

ผลคือโปรเจกต์ที่ทำตามคู่มือของ Prisma ตรง ๆ จะถูก `ARC-03` ตีตก
ขอให้เพิ่ม `prisma` เข้า `allowed_dev_tooling` ด้วย

---

# Issue 2 — จุดที่มาตรฐานขัดกันเอง 5 จุด

README ของ repo นี้เขียนว่า *"ถ้าสองอย่างขัดกันให้ยึด `contracts/` แล้วแจ้ง PL ทันที"*
และ *"กฎอยู่ใน `scripts/` เอกสารอยู่ใน `docs/` — สองอย่างนี้ต้องตรงกันเสมอ"*

ต่อไปนี้คือจุดที่ไม่ตรงกัน ทุกข้อทำให้ระบบย่อยที่ทำตามเอกสารถูก CI ตีตก

## 2.1 npm หรือ pnpm

| แหล่ง | บอกว่า |
| --- | --- |
| `contracts/vocabulary.json` → `stack.packageManager` | `"npm (ต้อง commit package-lock.json)"` |
| `docs/tech-stack.md` ข้อ 1.1 | **pnpm** · ห้ามมี `package-lock.json` |
| `scripts/check-qa.sh` (QA-05) | ตีตกถ้าพบ `package-lock.json` |

ตามกฎ "ยึด contracts" การใช้ npm ถูกต้อง แต่ CI จะตีตก
**ขอคำตอบเป็นทางการว่ายึดอันไหน** เพราะกระทบ lockfile ทั้ง repo

## 2.2 `username` ห้ามใช้หรือไม่

| แหล่ง | บอกว่า |
| --- | --- |
| `docs/data-dictionary.md` ข้อ 9.2 | `username` **อยู่ในรายชื่อ alias ต้องห้าม** |
| `docs/data-dictionary.md` บล็อก Errata | *"มติ: ยึด `username`"* — ขัดกับข้อ 9.2 ในเอกสารฉบับเดียวกัน |
| `scripts/check-field-aliases.sh` | `FORBIDDEN_ALIASES` **ไม่มี** `username` |
| `schemas/user.schema.json` | `"required": ["username", "layer1_role"]` |

บล็อก Errata ยังอ้าง *"gateway ออก token ด้วยชื่อนี้"* ซึ่งขัดกับ
`auth-contract.md` ที่ระบุว่าไม่มี API Gateway — น่าจะเป็นข้อความค้างจาก
ฉบับก่อนที่ยังไม่ได้ลบตอนเขียน v1.0 ใหม่

## 2.3 `schemas/user.schema.json` ไม่ตรงกับ v1.0

ยังบังคับ `username` · `layer1_role` · `faculty_code` และ enum ของ role
มี `faculty` กับ `guest`

แต่ `data-dictionary.md` ข้อ 1.1/1.3 ระบุว่าฟิลด์จริงคือ `core_user_id` ·
`core_role` และ **`faculty` ยังไม่มีใน Core Hub v1.0** ส่วน `vocabulary.json`
ให้ core role แค่ 4 ค่า (`student` `alumni` `staff` `admin`)

## 2.4 `check-api-conventions.sh` มองหา prefix เฉพาะใน `main.ts`

สคริปต์ตรวจ `API-02` อ่านเฉพาะ `backend/src/main.ts`

ระบบย่อยนี้แยกการตั้งค่า app ออกไปไว้ที่ `backend/src/bootstrap.ts`
(เพื่อให้เทสต์ e2e สร้าง app ด้วยการตั้งค่าชุดเดียวกับของจริงได้)
`app.setGlobalPrefix('api/v1', ...)` จึงอยู่ในไฟล์นั้น **ทำให้ถูกตีตกทั้งที่ตั้ง prefix ถูกต้อง**

เสนอให้ค้นทั้ง `backend/src/` แทนการเจาะจงไฟล์เดียว

## 2.5 `check-no-secrets.sh` สแกนไฟล์ในเครื่อง ไม่ใช่ใน git

`SEC-01` ตีตกเพราะเจอ `DATABASE_URL` ใน `backend/.env`

แต่ไฟล์นั้น **ไม่ได้อยู่ใน git** — ถูก `.gitignore` กันไว้ ยืนยันด้วย `git ls-files`
แล้วว่ามีแต่ `backend/.env.example`

บน CI ที่ checkout ใหม่จะไม่มีไฟล์นี้ ข้อนี้จึงผ่าน แต่ใครก็ตามที่รัน
`run-all-checks.sh` ในเครื่องตัวเอง (ซึ่ง README แนะนำให้ทำก่อนเปิด PR)
จะเห็นเป็นสีแดงเสมอ แล้วเรียนรู้ที่จะเพิกเฉยกับ `SEC-01` — ซึ่งอันตราย
เพราะวันที่มันแดงเพราะของจริง จะไม่มีใครสังเกต

เสนอให้ข้ามไฟล์ที่ `git check-ignore` บอกว่าถูกละเว้น

---

# ขอเพิ่มเติม (ไม่ใช่ issue แต่ขอในนัดเดียวกัน)

1. **สิทธิ์เข้าถึง `demo-student-subsystem`** — `docs/` และข้อความตอน `SEC-04`
   ตีตก ต่างสั่งให้ "คัดลอกชั้น auth จาก reference implementation"
   แต่ repo ตอบ 404 จากบัญชีของเรา
2. **`CORE_HUB_URL` ของจริง พร้อมบัญชีทดสอบ** — ไม่มีก็ทดสอบ SSO
   และ conformance L1 ไม่ได้เลย
3. **`@csmju2030/design-system`** — ยังหาไม่เจอทั้งบน npm และใน org
   ขอทราบว่ามีแผนปล่อยเมื่อไหร่

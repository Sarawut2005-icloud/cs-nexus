# สิ่งที่ `csmju-social-reels` ขอให้เพิ่ม

**จาก:** PL · csmju-social-reels
**วันที่:** 27 ก.ย. 2569
**วิธีได้ข้อมูล:** clone `csmju-core-hub` (commit `88a600f`) มารันจริงที่เครื่อง
ลงทะเบียนระบบย่อยจริง แล้วยิง API ด้วย token จริงของแต่ละบทบาท
ทุกข้อข้างล่างมีรหัส HTTP ที่ได้จริงกำกับ ไม่ได้อ่านจากเอกสารอย่างเดียว

> **สถานะของเรา:** ต่อ Central SSO สำเร็จแล้ว · ตรวจลายเซ็น JWT ด้วย JWKS เอง
> ครบ 8 ขั้น · ย้ายคีย์ตัวตนทั้งระบบเป็น `coreUserId` แล้ว · ไม่มีตัวตนปลอม
> เหลืออยู่ในโค้ดเลย · เทสต์ 263 เคสผ่านหมด รวมชุดที่ยิง Core Hub ตัวจริง

---

## ถึง PM2 (เจ้าของ Core Hub) — เรียงตามความเร่งด่วน

### 1. 🔴 ระบบย่อยแสดง "ชื่อคน" ไม่ได้เลย

**นี่คือข้อเดียวที่ทำให้หน้าจอใช้งานจริงไม่ได้**

token มีแค่ `sub` (เช่น `user-002`) ทุกที่ที่ต้องแสดงชื่อคน — คนโพสต์
คนคอมเมนต์ รายชื่อสมาชิกห้อง คนที่กดติดตาม — เราแสดงได้แค่ `user-002`

ที่ทดสอบมาแล้ว:

| เรียกอะไร | ด้วย token ของ | ผล | หมายเหตุ |
| --- | --- | ---: | --- |
| `GET /api/v1/users/:id` | student | **200** | สิทธิ์ผ่าน แต่ตอบแค่ `id` `email` `role` — **ไม่มีชื่อ** |
| `GET /api/v1/people/me` | student | **404** | สิทธิ์ผ่าน (`master-data:read`) แต่ seed ยังไม่มี `Person` ผูกกับบัญชี |
| `GET /api/v1/people/:personCode` | student | **403** | ต้องมี `people:read` ซึ่ง student/alumni/staff ไม่มี |
| `GET /api/v1/people?limit=1` | student | **403** | เช่นเดียวกัน |

ข้อมูลที่เราต้องการมีอยู่แล้วในตาราง `Person` (`fullNameTh` `academicTitle`
`photoUrl`) และมี `coreUserId` ผูกกับ `sub` อยู่แล้วด้วย — **ติดแค่ว่าเรียกไม่ได้**

**ขอทางใดทางหนึ่ง (เลือกข้อเดียวพอ เรียงตามที่เราคิดว่าง่ายที่สุดสำหรับ Core Hub):**

- **(ก)** เพิ่ม endpoint แบบหลายคนในครั้งเดียว ที่ผู้ใช้ทั่วไปเรียกได้
  ```
  GET /api/v1/people/by-core-user-ids?ids=user-002,user-003,user-007
  → [{ core_user_id, full_name_th, academic_title, photo_url }]
  ```
  คืน**เฉพาะข้อมูลสาธารณะ** ไม่ต้องมีอีเมล เบอร์โทร หรือวันเกิด
  ขอแบบหลายคนเพราะฟีดหนึ่งหน้ามีคนโผล่ 20–50 คน ถ้าต้องยิงทีละคนคือ 50 คำขอ

- **(ข)** ใส่ `name` (และ `picture` ถ้ามี) เข้าไปใน JWT claim
  เป็นมาตรฐาน OIDC อยู่แล้ว และแก้ครั้งเดียวได้ทั้ง 37 ระบบโดยไม่ต้องยิง
  API เพิ่มเลย — **แต่ต้องขึ้น major version ของสัญญา** เพราะรูป token เปลี่ยน

- **(ค)** เพิ่ม `people:read` ให้ role `student`/`alumni`/`staff`
  ทำได้เร็วที่สุด แต่เปิดให้เห็นข้อมูลบุคคลทั้งหมดรวมเบอร์โทรและอีเมล
  ซึ่งกว้างเกินที่เราต้องการ — **เราไม่แนะนำข้อนี้**

> ระหว่างรอ เราทำ `profile_cache` ไว้แล้ว ใส่ endpoint ไหนเข้าไปก็ใช้ได้ทันที
> โดยไม่ต้องแก้หน้าจอ

---

### 2. 🟠 ไม่มีทางออกจากระบบที่ระบบย่อยลิงก์ไปได้

`POST /api/auth/logout` ของหน้าบ้าน Core Hub เป็น **POST เท่านั้น**
ลิงก์ `<a href>` จากระบบย่อยจึงเรียกไม่ได้ ตอนนี้ปุ่ม "ออกจากระบบ" ของเรา
ซ่อนอยู่เพราะไม่รู้จะชี้ไปไหน

**ขอ:** เส้นทางแบบ GET ที่ลิงก์ไปได้ เช่น
```
GET /logout?redirect=<url ของระบบย่อย>
```
ถ้ามี `redirect` ควรตรวจกับ `callbackUrl` ใน Subsystem Registry แบบเดียวกับที่
`SsoService.authorize()` ทำอยู่แล้ว (ซึ่งทำถูกแล้ว — เราทดสอบยิง
`callback_url=http://evil.example.com/steal` ได้ **400** ตามที่ควร)

**คำถามพ่วง:** ออกจากระบบที่ Core Hub แล้วคุกกี้ของระบบย่อยควรถูกล้างด้วยไหม
ถ้าใช่ ต้องมีกลไกอะไร (back-channel logout?) ตอนนี้คุกกี้ของเราอายุ 15 นาที
เท่า token จึงหมดอายุเองอยู่แล้ว แต่ 15 นาทีนั้นยังเข้าถึงได้

---

### 3. 🟠 บัญชีของ PL สำหรับลงทะเบียนระบบย่อย

`POST /api/v1/subsystems` ต้องมี `owner` เป็น `username` ที่มีบัญชีใน Core Hub
ตอนทดสอบเราใช้ `admin` จาก seed ไปก่อน

**ขอ:** สร้างบัญชีให้ PL ของแต่ละระบบ (หรือบอกวิธีขอ) แล้วแจ้ง `username`
ที่ต้องใส่ — และยืนยันว่า `username` ของ PL คืออะไร เพราะ **`username` ไม่ได้
อยู่ใน token** เราจึงไม่มีทางรู้ค่านี้ด้วยตัวเอง

---

### 4. 🟡 `requestedExceptions` ต้องมี `reason`

`RequestedExceptionDto` ใช้ `@MinLength(1)` กับ `reason` แต่
`templates/subsystem.yaml` ของ standards ไม่ได้ใส่ฟิลด์นี้ในตัวอย่าง
ใครคัดลอกเทมเพลตไปตรง ๆ จะโดน **400** โดยไม่รู้สาเหตุ

**ขอ:** เพิ่ม `reason` ลงในเทมเพลต (เราแก้ของเราเองแล้ว)

---

## ถึง DevOps

### 5. 🔴 dependency 18 ตัวรออนุมัติเข้า whitelist (`ARC-02`)

ยื่นไว้นานแล้วยังไม่มีความคืบหน้า ตัวที่**บล็อกฟีเจอร์จริง**คือชุด WebSocket
เพราะห้องแชท ห้องเสียง และการแจ้งเตือนแบบ real-time ใช้ทั้งหมด

**หลังบ้าน (4)**
`@nestjs/websockets` · `@nestjs/platform-socket.io` · `socket.io` · `oxlint`

**หน้าบ้าน (14)**
`socket.io-client` · `@tanstack/react-query` · `@radix-ui/react-label` ·
`@radix-ui/react-slot` · `class-variance-authority` · `clsx` · `tailwind-merge` ·
`lucide-react` · `framer-motion` · `shadcn` · `tw-animate-css` ·
`@tailwindcss/postcss` · `@testing-library/jest-dom` · `@testing-library/user-event` ·
`eslint-config-next`

> 10 ตัวในกลุ่มหน้าบ้านจะหายไปเองถ้าย้ายไปใช้ `@csmju2030/design-system`
> — ดูข้อ 7

---

### 6. 🟡 บั๊กในสคริปต์ตรวจของ standards เอง (กระทบทั้ง 37 ทีม)

| สคริปต์ | ปัญหา | ผลที่เกิด |
| --- | --- | --- |
| `check-authorized-deps.sh` | `jq` บน Windows ออก `\r\n` ทำให้เทียบ `== "true"` ไม่เคยตรง | ฟ้อง dependency **ทุกตัว** รวม `next` `react` `jose` ที่อยู่ใน whitelist แน่ ๆ (ของเราฟ้อง 31 ตัว ทั้งที่จริงมี 18) → เติม `tr -d '\r'` ท้ายทุก `$(jq ...)` |
| `check-openapi-sync.sh` | มองหา script ชื่อ `generate:openapi` | ทีมที่ตั้งชื่อ script ต่างจากนี้จะ **"ข้ามการตรวจ"** แล้วถูกนับเป็นผ่าน — แย่กว่าตกเพราะไม่มีใครรู้ว่าไม่เคยตรวจ (เราเพิ่ง alias เพิ่มให้ตัวเอง) |
| `check-api-conventions.sh` (`API-02`) | grep หาสตริง `'api/v1'` ตรง ๆ ใน `main.ts` | ใช้ค่าคงที่ที่ import มาแทนสตริงจะถูกตีตกทั้งที่ทำงานถูก (เราลองมาแล้ว) |

---

### 7. 🟡 `.github/workflows/compliance.yml` ยิงไม่ติด

เทมเพลตตั้ง `pull_request: branches: [main]` แต่ repo ของเรา (และน่าจะหลายทีม)
branch หลักชื่อ **`master`** — workflow จึงไม่เคยทำงานเลย

**ขอ:** แก้เทมเพลตเป็น `branches: [main, master]`

---

## ถึงเจ้าของ `@csmju2030/design-system`

### 8. 🔴 ติดตั้ง package ไม่ได้

```
npm error code E401
401 Unauthorized - GET https://npm.pkg.github.com/@csmju2030%2fdesign-system
```
package อยู่บน GitHub Packages ต้องมี **PAT ที่มีสิทธิ์ `read:packages`**
ซึ่งยังไม่ได้รับ — ตอนนี้ยังใช้ design system ไม่ได้เลยแม้แต่บรรทัดเดียว

### 9. 🔴 design-system v1.3.0 สร้างตามสัญญาที่ถูกยกเลิกไปแล้ว

| | design-system v1.3.0 (7 ก.ย.) | standards v1.0.0 (11 ก.ย.) |
| --- | --- | --- |
| token endpoint | `POST /oauth/token` + `grant_type` | **ไม่มี** — SSO ผ่าน 302 |
| claim ใน JWT | `username` `layer1_role` `faculty` | `email` `role` `sid` |
| `/api/v1/me` | *"ไม่มีในสัญญา"* | **บังคับ** |
| meta | `{page, per_page, total, total_pages}` | `{total, page, limit, totalPages}` |
| `jose` | อยู่ใน `FORBIDDEN_EVERYWHERE` | **บังคับให้ใช้** (`SEC-04`) |
| Tailwind | v3 | เราอยู่ v4 |

standards CHANGELOG เขียนว่า *"เวอร์ชัน 1.0.0–1.3.0 ก่อนหน้านี้เป็นช่วงเตรียมการ
จึงยกเลิกประวัติเดิมทั้งหมดแล้วเริ่มนับใหม่"*

**ขอ:** ชี้ขาดว่าจะออก v2.0 ตามสัญญา v1.0.0 หรือไม่ และเมื่อไหร่
ถ้าออก เราจะรอแล้วย้ายทีเดียว · ถ้าไม่ออก เราจะใช้เฉพาะชั้น UI
**ข้อนี้กระทบทั้ง 37 ระบบ ไม่ใช่แค่เรา**

### 10. 🟡 `csmju-ui-lint` มีกฎแต่ไม่มีใครบังคับ

PR `feature/design-system/ui-designsystem-check` ยังไม่ถูก merge —
`standards/scripts/` ไม่มี `check-ui-designsystem.sh` และ `VERSION` ยังเป็น 1.0.0
กฎ `DS-01`..`DS-22` จึงไม่ได้ถูกบังคับโดย CI เลย

และตัว lint ตัดสินผิด 3 ข้อ (ตรวจกับคู่มือ Next 16.3.6 แล้ว):

- `DS-08` จับ `next/font/google` ว่าโหลดจาก CDN — จริง ๆ มัน self-host ตอน build
  (build output ของเราไม่มี `fonts.googleapis.com` เลย และมี `.woff2` 14 ไฟล์)
- `SEC-05` จับจากชื่อโฟลเดอร์ `app/login/` — ไฟล์เราไม่มี `<form>` `<input>`
  หรือคำว่า password เลยสักที่
- `DS-02`/`DS-03` บังคับให้ทุกโฟลเดอร์มี `loading.tsx`/`error.tsx` — แต่ Next
  ครอบ segment ลูกให้อยู่แล้ว (*"wraps a route segment **and its nested children**"*)

---

## สรุปสิ่งที่ขอ

| # | ถึง | เรื่อง | บล็อกอะไร |
| ---: | --- | --- | --- |
| 1 | PM2 | endpoint แปลง `sub` → ชื่อคน | **หน้าจอแสดงได้แค่ `user-002`** |
| 2 | PM2 | ทางออกจากระบบแบบ GET | ปุ่มออกจากระบบ |
| 3 | PM2 | บัญชี + `username` ของ PL | ลงทะเบียนจริง |
| 4 | PM2 | `reason` ในเทมเพลต | ทีมอื่นจะเจอ 400 |
| 5 | DevOps | whitelist 18 ตัว | **WebSocket ทั้งหมด** |
| 6 | DevOps | บั๊ก 3 สคริปต์ | ทั้ง 37 ทีม |
| 7 | DevOps | `compliance.yml` branch | CI ไม่เคยรัน |
| 8 | DS | PAT `read:packages` | **ใช้ design system ไม่ได้เลย** |
| 9 | DS | v2.0 ตามสัญญา v1.0.0? | ทั้ง 37 ทีม |
| 10 | DS | merge PR + แก้ 3 กฎ | กฎที่ไม่มีใครบังคับ |

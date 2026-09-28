# ต่อระบบเรากับ Core Hub ตัวจริง

**อ้างอิง:** `github.com/CSMJU2030/csmju-core-hub` commit `88a600f`
**ตรวจและรันจริงเมื่อ:** 27 ก.ย. 2569
**สถานะ:** วิ่งครบวงจรแล้วในเครื่อง — token จริงจาก Core Hub ผ่านตัวตรวจของเราทั้งหมด

---

## 1. Flow จริง — ผู้ใช้เดินทางยังไง

```
                    เบราว์เซอร์ของนักศึกษา
                             │
   ① กดชื่อ "CS Nexus" ในแถบข้างของ Core Hub
      <a href="/api/sso/csmju-social-reels">
                             │
                             ▼
   ┌──────────────────────────────────────────────────┐
   │  Core Hub UI  :3100                              │
   │  app/api/sso/[subsystem]/route.ts                │
   │                                                  │
   │  ยังไม่ล็อกอิน → 302 ไป /login?next=…            │
   │  ล็อกอินแล้ว  → อ่านคุกกี้ csmju_access_token    │
   └───────────────────────┬──────────────────────────┘
                           │ ② GET /auth/sso/handoff?subsystem=…&state=<uuid>
                           │    Authorization: Bearer <คุกกี้ session>
                           ▼
   ┌──────────────────────────────────────────────────┐
   │  Core Hub API  :3000   SsoService.authorize()    │
   │                                                  │
   │  ตรวจ 4 ชั้นก่อนออก token:                       │
   │    • มีใน Subsystem Registry ไหม      → 404      │
   │    • approvalStatus = APPROVED ไหม    → 409      │
   │    • status = ACTIVE ไหม              → 409      │
   │    • core role อยู่ใน key ของ          → 403      │
   │      defaultRoleMapping ไหม                      │
   │                                                  │
   │  เซ็น RS256 · kid=core-hub-2026 · อายุ 15 นาที   │
   │  แล้วต่อ query เข้ากับ callbackUrl ที่ Registry   │
   │  ถือไว้ (**ไม่ใช่ค่าที่ผู้เรียกส่งมา**)            │
   └───────────────────────┬──────────────────────────┘
                           │ ③ 302
                           ▼
   http://localhost:4000/auth/callback
       ?access_token=eyJhbGciOiJSUzI1NiIs…
       &token_type=Bearer
       &expires_in=900
       &state=<uuid>
                           │
                           ▼
   ┌──────────────────────────────────────────────────┐
   │  หลังบ้านเรา :4000  SsoCallbackController        │
   │                                                  │
   │  ④ ดึง JWKS จาก :3000 (แคช 10 นาที)             │
   │  ⑤ ตรวจ 8 ขั้นด้วย jose                          │
   │  ⑥ **ผ่านแล้วค่อยตั้งคุกกี้** ห้ามสลับลำดับ        │
   │  ⑦ 302 ไปหน้าบ้านเรา :4100                       │
   └──────────────────────────────────────────────────┘
```

> **ข้อที่พลาดกันบ่อยที่สุดคือ ⑥** ถ้าตั้งคุกกี้ก่อนตรวจ ใครก็ยิง
> `/auth/callback?access_token=ขยะ` แล้วได้ session ติดมือกลับไป
> เทสต์ `core-hub-live.e2e-spec.ts` ยิงเคสนี้ 10 แบบ และผมทดลองฉีดช่องโหว่นี้
> เข้าไปจริง ๆ เพื่อยืนยันว่าเทสต์จับได้ (แดงทันทีที่ `ลายเซ็นถูกแก้`)

---

## 2. พอร์ตที่ต้องแยกกัน

| พอร์ต | ใคร | ตั้งที่ไหน |
| ---: | --- | --- |
| `3000` | **Core Hub API** | `csmju-core-hub/backend/src/main.ts` → `process.env.PORT \|\| 3000` |
| `3100` | **Core Hub UI** | `csmju-core-hub/frontend/package.json` → `next dev -p 3100` |
| `4000` | หลังบ้านเรา | `backend/.env` → `PORT=4000` |
| `4100` | หน้าบ้านเรา | `frontend/package.json` → `next dev -p 4100` |
| `55432` | PostgreSQL | คนละ database: `core_hub` / `csnexus_social_reels` |

> หน้าบ้านเราเคยเป็น 3000 (ค่าปริยายของ Next) ซึ่ง**ชนกับ Core Hub API ตรง ๆ**
> ย้ายมา 4100 แล้ว

---

## 3. ตั้งเครื่องให้รันได้ทั้งสองระบบ

### 3.1 Core Hub

```bash
git clone https://github.com/CSMJU2030/csmju-core-hub.git
cd csmju-core-hub && pnpm install

cd backend
mkdir -p keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out keys/jwt-private.pem
openssl rsa -in keys/jwt-private.pem -pubout -out keys/jwt-public.pem

cp .env.example .env     # แก้ DATABASE_URL ให้ชี้ฐาน core_hub

pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm run build            # ต้อง build ก่อน seed
node dist/prisma/seed.js
cp -r generated dist/
node dist/src/main.js     # :3000
```

**ข้อควรระวังที่เจอจริงตอนทำ:**

| อาการ | สาเหตุ |
| --- | --- |
| `No seed command configured` | `prisma.config.ts` ไม่ได้ตั้ง `migrations.seed` — ต้องรัน `node dist/prisma/seed.js` เอง |
| `npx ts-node prisma/seed.ts` พัง | README ของเขาเตือนไว้ — Prisma 7 generate client ออกมาเป็น `.ts` ที่ ts-node CJS resolve ไม่ได้ |
| ไม่มีโฟลเดอร์ `keys/` | `jwt-private.pem` ถูก gitignore ตามที่ควร ต้องสร้างเอง |

**บัญชีจาก seed** (development เท่านั้น — `backend/README.md` ข้อ 7):

| email | password | core role | เราแปลงเป็น |
| --- | --- | --- | --- |
| `admin@core.local` | `password1` | `admin` | `ADMIN` |
| `staff@core.local` | `password3` | `staff` | `EDITOR` |
| `student@core.local` | `password2` | `student` | `GUEST` |
| `alumni@core.local` | `password4` | `alumni` | `GUEST` |

### 3.2 ลงทะเบียนระบบเรากับ Subsystem Registry

ต้องใช้ token ของบัญชีที่มี permission `subsystem:create` (admin หรือ staff)

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@core.local","password":"password1"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")

curl -s -X POST http://localhost:3000/api/v1/subsystems \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
    "name": "csmju-social-reels",
    "displayName": "CS Nexus — สังคมออนไลน์ วิดีโอสั้น และห้องคอลประจำสาขา",
    "owner": "admin",
    "repo": "github.com/Sarawut2005-icloud/cs-nexus",
    "standardsVersion": "1.0.0",
    "defaultRoleMapping": {
      "student": "GUEST", "alumni": "GUEST", "staff": "EDITOR", "admin": "ADMIN"
    },
    "callbackUrl": "http://localhost:4000/auth/callback",
    "baseUrl": "http://localhost:4000"
  }'
```

แล้ว **อนุมัติ + เปิดใช้งาน** (ถ้าไม่ทำ `handoff` จะตอบ 409):

```bash
curl -s -X POST http://localhost:3000/api/v1/subsystems/<id>/approve  -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/api/v1/subsystems/<id>/activate -H "Authorization: Bearer $TOKEN"
```

> ทุกค่าตรงกับ `subsystem.yaml` ของเรา ยกเว้น `owner` ที่ตอนนี้ใช้ `admin`
> จาก seed — ของจริงต้องเป็น `username` ของ PL ที่มีบัญชีใน Core Hub

### 3.3 ระบบเรา

```bash
pnpm install
pnpm --filter backend exec prisma migrate deploy
pnpm --filter backend build && node backend/dist/main.js   # :4000
pnpm --filter frontend dev                                 # :4100
```

`backend/.env` ต้องมี (ดู `.env.example`):

```
CORE_HUB_URL=http://localhost:3000
CORE_HUB_JWKS_URL=http://localhost:3000/api/v1/.well-known/jwks.json
CORE_HUB_ISSUER=core-hub
CORE_HUB_AUDIENCE=csmju2030
SUBSYSTEM_ID=csmju-social-reels
FRONTEND_URL=http://localhost:4100
```

`frontend/.env.local`:

```
NEXT_PUBLIC_CORE_LOGIN_URL=http://127.0.0.1:3100/api/sso/csmju-social-reels
```

---

## 4. เทสต์ที่พิสูจน์ว่ามันทำงานจริง

`backend/test/core-hub-live.e2e-spec.ts` — **ข้ามอัตโนมัติถ้าไม่มี Core Hub**
และรายงานว่า `skipped` ไม่ใช่ `passed` (เทสต์เขียวหลอกแย่กว่าไม่มีเทสต์)

```
Core Hub รันอยู่      →  Tests  8 passed (8)
Core Hub ไม่ได้รัน    →  Tests  8 skipped (8)
```

**ทำไมต้องมีไฟล์นี้ทั้งที่มี `auth-sso.e2e-spec.ts` อยู่แล้ว:**
ไฟล์เดิมสร้างคู่กุญแจในเทสต์แล้วเซ็น token เอง ซึ่งพิสูจน์ได้แค่ว่าตัวตรวจ
สอดคล้องกับตัวเซ็นของเราเอง — **ถ้าเราเข้าใจสัญญาผิด ทั้งสองฝั่งจะผิดเหมือนกัน
และเทสต์ยังเขียว** ไฟล์ใหม่ใช้ token ที่ Core Hub เซ็นด้วยกุญแจที่เราไม่เคยเห็น

สิ่งที่ตรวจ:

| หมวด | เคส |
| --- | --- |
| JWKS | เป็น RFC 7517 ดิบไม่ห่อ envelope · `kty/alg/kid/use` ถูก · **ไม่มี `d p q dp dq qi` ติดมา** |
| token จริง | header/payload ตรงสัญญา · อายุ 900 วินาที · claim ครบ 6 ตัว |
| การแปลงบทบาท | `student→GUEST` `staff→EDITOR` `admin→ADMIN` ด้วย token จริงของแต่ละคน |
| `/api/v1/me` | รับทั้งคุกกี้และ `Bearer` และได้ผลเหมือนกัน |
| token ที่ถูกดัดแปลง | 10 แบบ ทุกแบบต้อง **401 และไม่มี `Set-Cookie`** |

10 แบบนั้นคือ: ลายเซ็นถูกแก้ · เลื่อนขั้นเป็น admin · สวมรอยเป็นคนอื่น ·
`alg=none` · `alg=HS256` · `kid` ที่ไม่มีใน JWKS · `iss` ผิด · `aud` ผิด ·
หมดอายุ · ไม่ใช่ JWT

**พิสูจน์ว่าเทสต์จับบั๊กได้จริง:** ลองย้ายบรรทัด `response.cookie(...)` ไปไว้
**ก่อน** `verifier.verify()` แล้วรันใหม่ → แดงทันทีที่เคส `ลายเซ็นถูกแก้`
(`expected [ Array(1) ] to be undefined`) ย้ายกลับ → เขียว

---

## 5. สิ่งที่ยืนยันแล้วว่าตรงกัน

| | Core Hub ของจริง | ของเรา |
| --- | --- | --- |
| claim | `sub` `email` `role` `sid` `iss` `aud` `iat` `exp` | ตรวจครบทุกตัว ✓ |
| `iss` / `aud` | `core-hub` / `csmju2030` | ✓ |
| `kid` / `alg` | `core-hub-2026` / `RS256` | ✓ |
| อายุ | 900 วินาที | คุกกี้ตั้ง `maxAge` จาก `exp` ที่ผ่านลายเซ็น ✓ |
| core role | `student` `alumni` `staff` `admin` | `CORE_ROLES` ตรงเป๊ะทั้งสี่ ✓ |
| JWKS | `GET /api/v1/.well-known/jwks.json` ไม่ห่อ envelope | ✓ |
| callback | `?access_token=&token_type=&expires_in=&state=` | อ่าน `access_token` + `state` ✓ |

**ข้อที่ Core Hub ทำถูกและเราพึ่งพาได้:**
`callbackUrl` มาจาก Registry เสมอ ไม่ใช่จากผู้เรียก — ทดสอบยิง
`callback_url=http://evil.example.com/steal` แล้วได้ **400** ตามที่ควร

---

## 6. ช่องว่างที่ยังเหลือ

1. **`owner` ใน `subsystem.yaml`** — ตอนทดสอบใช้ `admin` จาก seed
   ของจริงต้องเป็น `username` ของ PL ที่มีบัญชีใน Core Hub **ยังไม่มี**
2. **`baseUrl` ต้องเป็น URL ที่ Core Hub เข้าถึงได้** เพราะ Monitor ของ backoffice
   จะยิง `<baseUrl>/api/health` — ตอน deploy จริงต้องเปลี่ยนจาก localhost
3. **`requested_exceptions` ต้องมี `reason`** — `RequestedExceptionDto` ใช้
   `@MinLength(1)` ของเดิมเราไม่มีจึงจะโดน 400 **แก้แล้ว**
4. **WebSocket ยังใช้กลไกเดิม** — `/realtime` ยังยืนยันตัวตนด้วย header + ตั๋ว
   ชั่วคราว ยังไม่ได้ย้ายมาใช้ token ของ Core Hub
5. **68 endpoint ยังใช้ guard เดิมของ Gateway** — ชั้นใหม่ครอบแค่
   `/api/v1/me` กับ `/auth/callback`
6. **คีย์ตัวตนยังเป็น `username`** ทั้งที่ token ส่ง `sub` มา — งานย้าย 84 ไฟล์

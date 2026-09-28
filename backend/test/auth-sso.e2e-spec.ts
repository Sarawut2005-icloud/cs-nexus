import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { CoreHubJwtGuard } from '../src/auth/core-hub-jwt.guard.js';
import { CoreHubTokenVerifier } from '../src/auth/core-hub-token.verifier.js';
import { JwksService } from '../src/auth/jwks.service.js';
import { EnvelopeInterceptor } from '../src/common/http/envelope.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';

/// เทสต์เส้นทางบังคับสองเส้นของสัญญา SSO
///
///   GET /api/v1/me      — conformance L1-08..16
///   GET /auth/callback  — conformance L3-08..14
///
/// **ไม่แตะฐานข้อมูลเลย** จึงรันได้โดยไม่ต้องเปิด docker — ตั้งใจให้เป็นแบบนั้น
/// เพราะชั้นยืนยันตัวตนไม่ควรต้องพึ่งฐานข้อมูล ถ้าวันหนึ่งมันเริ่มพึ่ง
/// แปลว่ามีคนเอาข้อมูลผู้ใช้ไปเก็บซ้ำ ซึ่งผิดข้อ 3 ของ data-dictionary

const ISSUER = 'core-hub';
const AUDIENCE = 'csmju2030';
const KID = 'core-hub-2026';

let app: INestApplication;
let hubKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let foreignKeys: Awaited<ReturnType<typeof generateKeyPair>>;

async function signToken(
  overrides: Record<string, unknown> = {},
  key?: KeyLike | Uint8Array,
) {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: 'staff@core.local',
    role: 'staff',
    sid: 's1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
    .setSubject((overrides.sub as string) ?? 'user-003')
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(key ?? hubKeys.privateKey);
}

beforeAll(async () => {
  hubKeys = await generateKeyPair('RS256');
  foreignKeys = await generateKeyPair('RS256');

  process.env.CORE_HUB_JWKS_URL = 'http://core-hub.test/api/v1/.well-known/jwks.json';
  process.env.CORE_HUB_ISSUER = ISSUER;
  process.env.CORE_HUB_AUDIENCE = AUDIENCE;
  process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '0';
  delete process.env.FRONTEND_URL;

  const jwk = await exportJWK(hubKeys.publicKey);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] }),
    })),
  );

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();

  app = moduleRef.createNestApplication();

  // ชุดเดียวกับของจริง: envelope + exception filter แต่ไม่เอา global guard
  // ของ Gateway มาด้วย เพราะมันต้องใช้ PrismaService

  // ด่านเดียวกับของจริง — `CoreHubJwtGuard` เป็น global guard ใน
  // bootstrap.ts แล้ว ไม่ได้ติดเฉพาะ route อีกต่อไป ถ้าไม่ติดตั้งที่นี่
  // `@CurrentUser()` จะไม่เจอตัวตนแล้วโยน error ออกมาเป็น 500
  //
  // ไม่เอา RolesGuard มาด้วยเพราะมันต้องใช้ PrismaService ซึ่งชุดนี้
  // ตั้งใจไม่ต่อฐานข้อมูล
  app.useGlobalGuards(
    new CoreHubJwtGuard(app.get(Reflector), app.get(CoreHubTokenVerifier)),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1', { exclude: ['api/health', 'auth/callback'] });

  await app.init();
});

beforeEach(() => {
  app.get(JwksService).resetForTesting();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('GET /api/v1/me', () => {
  it('token ถูกต้อง → 200 พร้อมสี่ฟิลด์ตาม contracts/openapi.yaml', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken()}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      id: 'user-003',
      email: 'staff@core.local',
      coreRole: 'staff',
      subsystemRole: 'EDITOR',
    });
  });

  it('role mapping ตรงกับ subsystem.yaml ทั้งสี่ค่า', async () => {
    // ถ้าตารางนี้กับ default_role_mapping ในทะเบียนไม่ตรงกัน ผู้ใช้จะเข้าระบบได้
    // แต่กดอะไรไม่ได้เลย โดยไม่มี error ที่ไหนบอกสาเหตุ
    const expected = {
      student: 'GUEST',
      alumni: 'GUEST',
      staff: 'EDITOR',
      admin: 'ADMIN',
    };

    for (const [coreRole, subsystemRole] of Object.entries(expected)) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('authorization', `Bearer ${await signToken({ role: coreRole })}`)
        .expect(200);

      expect(response.body.data.subsystemRole).toBe(subsystemRole);
    }
  });

  it('ไม่มี token → 401 UNAUTHORIZED', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('scheme ที่ไม่ใช่ Bearer → 401 (conformance L1-16)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('token ที่เซ็นด้วยกุญแจอื่น → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken({}, foreignKeys.privateKey)}`)
      .expect(401);
  });

  it('รับ token ผ่านคุกกี้ได้ด้วย (auth-contract.md ข้อ 6)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', `core_hub_access_token=${await signToken()}`)
      .expect(200);
  });

  it('มีทั้ง header และคุกกี้ → ใช้ header ก่อน', async () => {
    // สัญญาระบุลำดับนี้ไว้ตรง ๆ และสมเหตุสมผล เพราะ header คือสิ่งที่ผู้เรียก
    // ตั้งใจส่งมารอบนี้ ส่วนคุกกี้เบราว์เซอร์แนบให้เองโดยผู้เรียกไม่ได้เลือก
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken({ sub: 'from-header' })}`)
      .set('cookie', `core_hub_access_token=${await signToken({ sub: 'from-cookie' })}`)
      .expect(200);

    expect(response.body.data.id).toBe('from-header');
  });

  it('ไม่มี error ภายในหลุดออกไปกับคำตอบ 401 (conformance L1-30)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', 'Bearer not-a-jwt');

    expect(response.text).not.toMatch(/stack|node_modules|PrismaClient/i);
  });
});

describe('GET /auth/callback', () => {
  it('อยู่นอก prefix /api ตามสัญญา', async () => {
    // ถ้าเผลอให้มันไปอยู่ใต้ /api/v1 จะไม่ตรงกับ callback_url ที่ลงทะเบียนไว้
    // แล้ว Core Hub จะปฏิเสธการ redirect ตั้งแต่ต้นทาง
    await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${await signToken()}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?access_token=${await signToken()}`)
      .expect(404);
  });

  it('token ถูกต้อง → ตั้งคุกกี้ HttpOnly + SameSite=Lax', async () => {
    const response = await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${await signToken()}`)
      .expect(200);

    const cookie = response.headers['set-cookie']?.[0] ?? '';

    expect(cookie).toContain('core_hub_access_token=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('อายุคุกกี้ต้องไม่ยาวกว่า token', async () => {
    // ถ้าคุกกี้อยู่นานกว่า token เบราว์เซอร์จะส่งของที่หมดอายุไปเรื่อย ๆ
    // ผู้ใช้จะเจอ 401 ทั้งที่ "เพิ่งล็อกอิน" และไม่มีอะไรพาเขาไปล็อกอินใหม่
    const response = await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${await signToken()}`)
      .expect(200);

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1] ?? '0');

    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(900);
  });

  it('token ใช้ไม่ได้ → 401 และ **ต้องไม่มี** Set-Cookie', async () => {
    // นี่คือเคสที่สำคัญที่สุดของทั้งไฟล์ (conformance L3-12/13)
    // ถ้าตั้งคุกกี้ก่อนตรวจ ใครก็ยิง ?access_token=อะไรก็ได้ แล้วได้ session ติดมือ
    const response = await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${await signToken({}, foreignKeys.privateKey)}`)
      .expect(401);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('ไม่มี token → 400 และไม่มี Set-Cookie', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/callback')
      .expect(400);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('token ที่ถูกแก้ payload → 401 และไม่มี Set-Cookie', async () => {
    const valid = await signToken({ role: 'student' });
    const [head, , signature] = valid.split('.');
    const escalated = Buffer.from(
      JSON.stringify({
        sub: 'user-003',
        role: 'admin',
        email: 'staff@core.local',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');

    const response = await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${head}.${escalated}.${signature}`)
      .expect(401);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('คุกกี้ที่ได้จาก callback ใช้เข้า /api/v1/me ได้เลย (conformance L3-10)', async () => {
    const callback = await request(app.getHttpServer())
      .get(`/auth/callback?access_token=${await signToken()}`)
      .expect(200);

    const cookie = (callback.headers['set-cookie']?.[0] ?? '').split(';')[0];

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', cookie)
      .expect(200);

    expect(me.body.data.id).toBe('user-003');
  });
});

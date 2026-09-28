import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth/public.decorator.js';
import { CoreHubTokenVerifier } from './core-hub-token.verifier.js';
import { SSO_COOKIE } from './core-hub-jwt.guard.js';
import { subsystemRoleFor } from './role-mapping.js';

/// `GET /auth/callback` — ปลายทางของ Central SSO (auth-contract.md ข้อ 5)
///
/// **อยู่นอก prefix `/api` โดยเจตนา** เพราะ `callback_url` ที่ลงทะเบียนไว้กับ
/// Core Hub ต้องตรงกับเส้นทางนี้เป๊ะ ๆ และมาตรฐานล็อกไว้ว่าไม่มี `/api` นำหน้า
///
/// ลำดับที่ห้ามสลับ: **ตรวจ token ให้ผ่านก่อน แล้วค่อยตั้งคุกกี้**
/// ถ้าตั้งคุกกี้ก่อนแล้วค่อยตรวจ จะเกิดช่องโหว่ที่ใครก็ยิง
/// `/auth/callback?access_token=อะไรก็ได้` แล้วได้คุกกี้ติดมือกลับไป
/// (ข้อ 5.1 · conformance L3-12/13 ยิงเคสนี้ตรง ๆ)
@Controller('auth')
export class SsoCallbackController {
  private readonly logger = new Logger(SsoCallbackController.name);

  constructor(private readonly verifier: CoreHubTokenVerifier) {}

  @Get('callback')
  @Public()
  @ApiExcludeEndpoint() // ไม่ใช่ API ของโดเมน — เป็นทางเข้าของเบราว์เซอร์
  async callback(
    @Query('access_token') accessToken: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!accessToken) {
      // ไม่มี token = คำขอผิดรูป ไม่ใช่ "ยืนยันตัวตนไม่ผ่าน"
      // conformance L3-14 รับทั้ง 400 และ 401 แต่ 400 ตรงความหมายกว่า
      throw new BadRequestException('ไม่พบ access_token');
    }

    let verified;

    try {
      verified = await this.verifier.verify(accessToken);
    } catch {
      // **ห้ามมี Set-Cookie ในคำตอบนี้เด็ดขาด** (ข้อ 5.1)
      // การโยน exception ออกไปเลยคือสิ่งที่รับประกันข้อนั้น เพราะยังไม่มีโค้ด
      // บรรทัดไหนแตะ response ก่อนถึงจุดนี้
      this.logger.warn({
        event: 'jwt.verification.failure',
        reason: 'invalid_claims',
        kid: null,
        path: '/auth/callback',
      });

      throw new UnauthorizedException('token จาก Core Hub ใช้ไม่ได้');
    }

    const { user, expiresAtMs } = verified;

    // อายุคุกกี้ต้องไม่ยาวกว่า token (ข้อ 5.1) — คิดจาก `exp` ที่ผ่านลายเซ็น
    // ไม่ใช่จาก `expires_in` ใน query string ซึ่งใครก็แก้ได้ระหว่างทาง
    const maxAge = Math.max(0, expiresAtMs - Date.now());

    response.cookie(SSO_COOKIE, accessToken, {
      httpOnly: true, // JavaScript ในหน้าเว็บอ่านไม่ได้ — กัน XSS ขโมย token
      sameSite: 'lax', // กัน CSRF แต่ยังให้ผู้ใช้เดินทางมาจาก Core Hub ได้
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge,
    });

    this.logger.log({
      event: 'jwt.verification.success',
      sub: user.coreUserId,
      coreRole: user.coreRole,
      subsystemRole: subsystemRoleFor(user.coreRole),
    });

    const target = frontendLanding(state);

    if (target) {
      response.redirect(302, target);
      return;
    }

    // ไม่ได้ตั้งหน้าบ้านไว้ (เช่นตอนรัน conformance แบบไม่มี UI)
    // ตอบเป็น MeEnvelope ตาม contracts/openapi.yaml ซึ่งสัญญารับทั้งสองแบบ
    response.status(200).json({
      success: true,
      data: {
        id: user.coreUserId,
        email: user.email,
        coreRole: user.coreRole,
        subsystemRole: subsystemRoleFor(user.coreRole),
      },
    });
  }
}

/// หน้าที่จะพาผู้ใช้ไปต่อหลังตั้ง session สำเร็จ
///
/// คืน null เมื่อยังไม่ได้ตั้ง `FRONTEND_URL` — ดีกว่าเดาเป็น localhost
/// แล้วพาผู้ใช้จริงไปหน้าที่ไม่มีอยู่
///
/// `state` ส่งกลับให้ client ตรวจได้ตามข้อ 5.1 และ **ต้องเข้ารหัสก่อนต่อเข้า URL**
/// ไม่งั้นค่าที่มี `&` หรือ `#` จะแตก query string และกลายเป็นช่องให้ยัดพารามิเตอร์อื่น
function frontendLanding(state: string | undefined): string | null {
  const base = process.env.FRONTEND_URL?.trim().replace(/\/+$/, '');

  if (!base) return null;

  return state
    ? `${base}/?state=${encodeURIComponent(state)}`
    : `${base}/`;
}

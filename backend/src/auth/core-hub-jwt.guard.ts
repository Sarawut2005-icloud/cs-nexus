import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CORE_HUB_PUBLIC_KEY } from './public.decorator.js';
import {
  CoreHubTokenVerifier,
  TokenRejected,
  type CoreHubUser,
} from './core-hub-token.verifier.js';

/// ชื่อคุกกี้มาตรฐาน — contracts/vocabulary.json `ssoCookieName`
/// ห้ามตั้งชื่อเอง เพราะ conformance L3 มองหาชื่อนี้ตรง ๆ
export const SSO_COOKIE = 'core_hub_access_token';

export interface RequestWithCoreUser extends Request {
  coreUser?: CoreHubUser;
}

/// ด่านแรกของทุก request — "คุณเป็นใคร"
///
/// ตอบ **401 เท่านั้น** ไม่ว่าจะพลาดขั้นไหน เพราะทุกกรณีที่ผ่านด่านนี้ไม่ได้
/// แปลว่า *ไม่รู้ว่าเป็นใคร* ส่วน 403 เป็นเรื่องของด่านถัดไปที่รู้แล้วว่าเป็นใคร
/// แต่สิทธิ์ไม่พอ (auth-contract.md ข้อ 8) — สลับสองอันนี้เมื่อไหร่
/// conformance ตกทันที และผู้ใช้จะเจออาการ "ล็อกอินใหม่แล้วก็ยังเข้าไม่ได้"
@Injectable()
export class CoreHubJwtGuard implements CanActivate {
  private readonly logger = new Logger(CoreHubJwtGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: CoreHubTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket ไม่มี HTTP header ให้อ่านที่ชั้นนี้ — ตัวตนของ socket
    // ยืนยันตอนจับมือใน gateway ของมันเอง
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      CORE_HUB_PUBLIC_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithCoreUser>();
    const token = extractToken(request);

    try {
      const { user } = await this.verifier.verify(token);

      request.coreUser = user;

      this.logger.debug({
        event: 'jwt.verification.success',
        sub: user.coreUserId,
        coreRole: user.coreRole,
      });

      return true;
    } catch (error) {
      const rejected =
        error instanceof TokenRejected
          ? error
          : new TokenRejected('invalid_signature');

      // log เหตุผลและ kid เท่านั้น — **ห้าม log ตัว token หรือ header
      // Authorization เด็ดขาด** (contracts/log-events.json `mustNeverLog`)
      // log ที่มี token อยู่ข้างในเท่ากับแจกสิทธิ์เข้าระบบให้ทุกคนที่อ่าน log ได้
      this.logger.warn({
        event: 'jwt.verification.failure',
        reason: rejected.reason,
        kid: rejected.kid,
        path: request.path,
      });

      throw new UnauthorizedException('ยืนยันตัวตนไม่สำเร็จ');
    }
  }
}

/// อ่าน token จากสองทางที่สัญญาอนุญาต (auth-contract.md ข้อ 6)
///
/// `Authorization` มาก่อนคุกกี้เสมอเมื่อมีทั้งคู่ — ระบุไว้ในสัญญาตรง ๆ
/// และสมเหตุสมผลเพราะ header เป็นสิ่งที่ผู้เรียก *ตั้งใจ* ส่งมารอบนี้
/// ส่วนคุกกี้เบราว์เซอร์แนบให้เองทุกครั้งโดยที่ผู้เรียกไม่ได้เลือก
export function extractToken(request: Request): string {
  const header = request.headers.authorization;

  if (typeof header === 'string') {
    // ต้องเป็น `Bearer` เท่านั้น — Basic หรือ scheme อื่นถือว่าไม่มี token
    // ไม่ใช่ token ที่ใช้ไม่ได้ (conformance L1-16 ตรวจข้อนี้)
    const [scheme, value] = header.split(/\s+/, 2);

    if (scheme?.toLowerCase() === 'bearer' && value) return value;

    return '';
  }

  return cookieValue(request.headers.cookie, SSO_COOKIE);
}

/// อ่านคุกกี้จาก header ดิบ
///
/// ไม่ใช้ `cookie-parser` เพราะมันไม่อยู่ใน whitelist ของมาตรฐาน (กฎ ARC-02)
/// และงานที่ต้องทำคือแยกสตริงด้วย `;` กับ `=` ซึ่งเขียนเองแล้วเห็นได้หมด
/// ว่าถูกหรือผิด — ไม่ใช่เรื่องที่ต้องแลกด้วย dependency เพิ่มหนึ่งตัว
function cookieValue(header: string | undefined, name: string): string {
  if (!header) return '';

  for (const part of header.split(';')) {
    const index = part.indexOf('=');

    if (index === -1) continue;

    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return '';
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GATEWAY_HEADERS,
  LAYER1_ROLES,
  type Layer1Role,
  type RequestWithUser,
} from './gateway-user.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/// กฎเหล็กความปลอดภัย (Blueprint หน้า 8 และ 9)
///
///   "ห้ามระบบย่อยทำหน้า Login เอง และห้ามเขียนโค้ด Verify ลายเซ็น JWT เอง
///    เด็ดขาด! (ให้เชื่อใจ Header จาก Gateway)"
///
/// guard นี้จึงไม่มีโค้ดถอดรหัสหรือตรวจลายเซ็น JWT แม้แต่บรรทัดเดียว —
/// ตรวจแค่ว่า header ที่ Gateway แนบมาครบและค่า role อยู่ในชุดที่กำหนด
///
/// สิ่งที่ต้องระวัง: header ปลอมได้ทันทีถ้ามีใครยิงเข้า backend ได้โดยตรง
/// ฉะนั้น production ต้องปิดไม่ให้เข้าถึง backend จากภายนอก และให้ผ่าน
/// Gateway ทางเดียว ตัว GATEWAY_SHARED_SECRET เป็นด่านสำรองอีกชั้น
@Injectable()
export class GatewayAuthGuard implements CanActivate {
  private readonly logger = new Logger(GatewayAuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // useGlobalGuards ครอบทุกบริบทรวมทั้ง WebSocket ซึ่งไม่มี HTTP header ให้อ่าน
    // ตัวตนของ socket ยืนยันตอนจับมือใน EventsGateway แล้ว (ผ่าน header ของ
    // Gateway หรือตั๋ว) จึงต้องปล่อยผ่านที่นี่ ไม่ใช่ไปพยายามอ่าน request ที่ไม่มี
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    this.assertCameThroughGateway(request);

    const username = this.header(request, GATEWAY_HEADERS.username);
    const layer1Role = this.header(request, GATEWAY_HEADERS.layer1Role);
    const faculty = this.header(request, GATEWAY_HEADERS.faculty);

    // header มาก่อนเสมอ แล้วค่อย fallback ไปที่ตัวตนปลอมของโหมด dev
    //
    // ลำดับนี้สำคัญกว่าที่คิด: ถ้าตัวตนปลอมมาก่อน จะทดสอบระบบที่มีผู้ใช้
    // หลายคนในเครื่องตัวเองไม่ได้เลย (ทุก request กลายเป็นคนเดียวกันหมด
    // แล้วเคสอย่าง "ติดตามคนอื่น" หรือ "คนนอกห้องกดรีแอ็กชัน" ทดสอบไม่ได้)
    //
    // ยังปลอดภัยเพราะ production ต้องตั้ง DEV_FAKE_GATEWAY=false
    // (main.ts ปฏิเสธการบูตถ้าเปิดไว้) จึงไม่มีทาง fallback บนของจริง
    if (!username || !layer1Role) {
      const devUser = this.devFakeUser();

      if (devUser) {
        request.gatewayUser = devUser;

        return true;
      }

      throw new UnauthorizedException(
        'ไม่พบข้อมูลตัวตนจาก API Gateway — เข้าใช้งานผ่าน Core Login ก่อน',
      );
    }

    if (!this.isLayer1Role(layer1Role)) {
      // Core ส่งค่าที่ไม่อยู่ในสัญญามา = สัญญาเพี้ยน ต้องดังพอให้เห็น
      this.logger.error(
        `Gateway ส่ง layer1_role ที่ไม่รู้จัก: "${layer1Role}" — เช็ค standards_version`,
      );
      throw new UnauthorizedException('สิทธิ์ระดับองค์กรไม่ถูกต้อง');
    }

    request.gatewayUser = {
      username,
      layer1Role,
      faculty: faculty ?? null,
    };

    return true;
  }

  /// ด่านสำรอง: ถ้าตั้ง GATEWAY_SHARED_SECRET ไว้ request ต้องมี secret ตรงกัน
  /// ป้องกันคนยิงตรงเข้า backend แล้วปลอม X-User-Id เป็นใครก็ได้
  private assertCameThroughGateway(request: RequestWithUser): void {
    const expected = process.env.GATEWAY_SHARED_SECRET;

    if (!expected) {
      return;
    }

    if (this.header(request, 'x-gateway-secret') !== expected) {
      throw new UnauthorizedException('คำขอนี้ไม่ได้ผ่าน API Gateway');
    }
  }

  /// ระหว่างที่ Core ยังไม่ออก client credential ให้ (Blueprint หน้า 6 ขั้นที่ 3)
  /// โหมดนี้ปลอม header เพื่อให้พัฒนาต่อได้ — main.ts ปฏิเสธการบูตถ้าเปิดไว้
  /// ตอน NODE_ENV เป็น production
  private devFakeUser() {
    if (process.env.DEV_FAKE_GATEWAY !== 'true') {
      return null;
    }

    const layer1Role = process.env.DEV_FAKE_LAYER1_ROLE ?? 'student';

    return {
      username: process.env.DEV_FAKE_USERNAME ?? 'dev-user',
      layer1Role: this.isLayer1Role(layer1Role) ? layer1Role : 'student',
      faculty: process.env.DEV_FAKE_FACULTY ?? null,
    };
  }

  private header(request: RequestWithUser, name: string): string | null {
    const value = request.headers[name];
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();

    return trimmed ? trimmed : null;
  }

  private isLayer1Role(value: string): value is Layer1Role {
    return (LAYER1_ROLES as readonly string[]).includes(value);
  }
}

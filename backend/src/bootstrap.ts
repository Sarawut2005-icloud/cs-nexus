import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GATEWAY_HEADERS } from './common/auth/gateway-user.js';
import { GatewayAuthGuard } from './common/auth/gateway-auth.guard.js';
import { RolesGuard } from './common/auth/roles.guard.js';
import { EnvelopeInterceptor } from './common/http/envelope.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { PrismaService } from './common/prisma/prisma.service.js';

/// ตั้งค่าทุกอย่างที่ทำให้ response ตรงมาตรฐาน CSMJU2030
///
/// อยู่ในไฟล์แยกเพราะทั้ง main.ts และชุดทดสอบต้องใช้ชุดเดียวกัน ถ้าปล่อยให้
/// test ก๊อปการตั้งค่าไปเอง วันหนึ่งมันจะเพี้ยนจากของจริงแล้วชุดทดสอบจะผ่าน
/// ทั้งที่ production พัง
/// โดเมนของหน้าบ้านที่ยิงเข้ามาได้
///
/// dev: ยอม localhost ทุกพอร์ต เพราะ Next.js เลื่อนพอร์ตเองเมื่อ 3000 ไม่ว่าง
/// production: ต้องระบุ CORS_ORIGIN เท่านั้น — ไม่มีการยอมทุกโดเมนเด็ดขาด
function corsOrigin(): string[] | RegExp | boolean {
  const configured = process.env.CORS_ORIGIN?.trim();

  if (configured) {
    return configured.split(',').map((origin) => origin.trim());
  }

  if (process.env.NODE_ENV === 'production') {
    // ไม่ตั้ง CORS_ORIGIN บน production = ไม่ยอมให้เบราว์เซอร์ไหนยิงเข้ามา
    // ปลอดภัยกว่าการเผลอเปิดให้ทุกโดเมนอ่าน API ในนามผู้ใช้ที่ล็อกอินอยู่
    return false;
  }

  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
}

export function configureApp(app: INestApplication): void {
  /// เปิด CORS ให้หน้าบ้านคนละพอร์ตยิงเข้ามาได้
  ///
  /// **บั๊กที่ตัวนี้แก้:** เดิมไม่ได้เปิดเลย เบราว์เซอร์จึงบล็อกทุกคำขอจาก
  /// http://localhost:3000 ไป :4000 ด้วย "Failed to fetch" — และไม่มีเทสต์ไหน
  /// จับได้ เพราะ curl กับ node fetch ไม่บังคับ CORS จึงเห็น HTTP 200 ตลอด
  ///
  /// `allowedHeaders` ต้องระบุ header ตัวตนของ Gateway ให้ครบ เพราะ header
  /// ที่ไม่ใช่ชุดมาตรฐานต้องผ่าน preflight ก่อน — ขาดตัวใดตัวหนึ่งแล้วคำขอ
  /// ทั้งก้อนถูกบล็อกโดยไม่มี error ฝั่งเซิร์ฟเวอร์ให้เห็น
  app.enableCors({
    origin: corsOrigin(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      GATEWAY_HEADERS.username,
      GATEWAY_HEADERS.layer1Role,
      GATEWAY_HEADERS.faculty,
      'x-gateway-secret',
    ],
    // ตัวตนมาจาก header ไม่ใช่ cookie จึงไม่ต้องเปิด credentials
    // (เปิดแล้วจะใช้ origin แบบ wildcard ไม่ได้ด้วย)
    credentials: false,
    maxAge: 86400,
  });

  // URL มาตรฐาน: /api/v1/<คำนามพหูพจน์แบบ kebab-case> (Blueprint หน้า 7)
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // ปฏิเสธ field ที่ไม่อยู่ใน DTO ไม่ใช่แค่ตัดออกเงียบ ๆ
      // เพื่อไม่ให้ client ยัดค่าอย่าง owner_username เข้ามาแล้วคิดว่ามันมีผล
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const reflector = app.get(Reflector);

  app.useGlobalGuards(
    new GatewayAuthGuard(reflector),
    new RolesGuard(reflector, app.get(PrismaService)),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
}

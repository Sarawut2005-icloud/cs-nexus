import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/// สร้างเอกสาร OpenAPI จากตัวแอปจริง
///
/// อยู่ในไฟล์แยกเพราะมีสองที่ที่ต้องใช้ชุดเดียวกัน:
///   1. main.ts — เขียน openapi.json ออกทุกครั้งที่บูต
///   2. scripts/check-openapi.ts — ตรวจใน CI ว่าไฟล์ที่ commit ไว้ตรงกับโค้ด
///
/// ถ้าปล่อยให้ทั้งสองที่สร้างเอกสารด้วยการตั้งค่าของตัวเอง ตัวตรวจจะเทียบ
/// เอกสารที่ไม่เหมือนของจริง แล้วมันจะแดงหรือเขียวโดยไม่มีความหมาย
export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CS Nexus — aie4-social-reels')
      .setDescription(
        'ระบบย่อยภายใต้ CSMJU2030 · ตัวตนมาจาก API Gateway ผ่าน header X-User-Id / X-Layer1-Role / X-Faculty',
      )
      .setVersion('1.0.0')
      .build(),
  );
}

export const OPENAPI_FILE = 'openapi.json';

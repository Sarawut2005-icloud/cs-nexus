import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'node:fs/promises';
import { AppModule } from './app.module.js';
import { configureApp, GLOBAL_PREFIX, PREFIX_EXCLUDE } from './bootstrap.js';
import { buildOpenApiDocument, OPENAPI_FILE } from './openapi.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  // **ไม่มีโหมดตัวตนปลอมอีกแล้ว**
  //
  // เดิมมี DEV_FAKE_GATEWAY ที่สร้างตัวตนขึ้นมาจาก env และ GATEWAY_SHARED_SECRET
  // ที่พยายามพิสูจน์ว่าคำขอมาจาก API Gateway — ทั้งสองอย่างถูกลบทิ้งพร้อมกับ
  // GatewayAuthGuard เพราะสถาปัตยกรรมที่มันรองรับไม่มีอยู่จริง
  // (auth-contract.md ข้อ 1: "ฉบับก่อนหน้าอธิบายสถาปัตยกรรมที่ยังไม่มีจริง")
  //
  // ตัวตนมาจาก JWT ที่ Core Hub เซ็นด้วย RS256 และเราตรวจลายเซ็นเองทุก request
  // ด้วยกุญแจสาธารณะจาก JWKS — ปลอมไม่ได้แม้ยิงตรงเข้าหลังบ้าน จึงไม่ต้องมี
  // ด่านสำรองแบบ shared secret และไม่ต้องมีธง "ยอมเปิดโล่ง" ให้ใครลืมปิด
  //
  // ตัวแปรที่ต้องมี (contracts/vocabulary.json `requiredEnvVars`) ตรวจที่
  // JwksService ตอนดึงกุญแจครั้งแรก ถ้าตั้งไม่ครบจะได้ 401 พร้อมเหตุผลใน log

  const app = await NestFactory.create(AppModule);

  // URL มาตรฐาน: /api/v1/<คำนามพหูพจน์แบบ kebab-case>
  // (api-conventions.md ข้อ 1 · contracts/vocabulary.json `naming.api.prefix`)
  // **ต้องเป็นสตริงตรง ๆ ห้ามใช้ตัวแปร** — `check-api-conventions.sh` (API-02)
  // grep หา /setGlobalPrefix\(\s*['"]api(\/v1)?['"]/ ในไฟล์นี้ไฟล์เดียว
  // เปลี่ยนเป็น setGlobalPrefix(GLOBAL_PREFIX, ...) แล้วมันจะตีตกทันที
  // ทั้งที่ทำงานถูก (ลองมาแล้วเมื่อ 27 ก.ย. 2569)
  //
  // ค่าซ้ำกับ GLOBAL_PREFIX ใน bootstrap.ts โดยจำใจ — กันค่าหลุดจากกันด้วย
  // การ assert ข้างล่าง ถ้าใครแก้ที่เดียว เซิร์ฟเวอร์จะไม่ยอมบูตพร้อมบอกเหตุผล
  app.setGlobalPrefix('api/v1', { exclude: PREFIX_EXCLUDE });

  if (GLOBAL_PREFIX !== 'api/v1') {
    throw new Error(
      `GLOBAL_PREFIX ใน bootstrap.ts เป็น "${GLOBAL_PREFIX}" แต่ main.ts ตั้ง "api/v1" — ` +
        'สองค่านี้ต้องตรงกันเสมอ ไม่งั้น openapi.json จะไม่ตรงกับที่เสิร์ฟจริง',
    );
  }

  configureApp(app);

  // "API Contract ต้องซิงก์กับ openapi.json เสมอ" (Blueprint หน้า 13)
  // จึงเขียนไฟล์ออกทุกครั้งที่บูต ไม่ต้องรอให้ใครจำมาสั่ง generate
  // และมี `npm run openapi:check` ตรวจซ้ำใน CI เผื่อคนที่ commit ไม่ได้บูต
  const document = buildOpenApiDocument(app);

  SwaggerModule.setup('api/docs', app, document);
  await writeFile(OPENAPI_FILE, JSON.stringify(document, null, 2), 'utf8');

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);

  logger.log(`หลังบ้านพร้อมที่ http://localhost:${port}/api/v1`);
  logger.log(`เอกสาร API: http://localhost:${port}/api/docs`);


}

await bootstrap();

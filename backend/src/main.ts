import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'node:fs/promises';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { buildOpenApiDocument, OPENAPI_FILE } from './openapi.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  // โหมดปลอม header ของ Gateway ต้องไม่หลุดขึ้น production เด็ดขาด
  // เพราะมันเท่ากับให้ใครก็ได้เป็นใครก็ได้ (Blueprint หน้า 8)
  if (
    process.env.DEV_FAKE_GATEWAY === 'true' &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'DEV_FAKE_GATEWAY=true บน production ไม่ได้ — ตั้งเป็น false ก่อน deploy',
    );
  }

  // ระบบนี้ **เชื่อ header ที่ส่งมา** ตามที่ Blueprint หน้า 9 บังคับ
  // ("ห้ามเขียนโค้ด Verify ลายเซ็น JWT เอง ให้เชื่อใจ Header จาก Gateway")
  //
  // การเชื่อ header จะปลอดภัยก็ต่อเมื่อ **ไม่มีใครยิงเข้ามาตรง ๆ ได้** ถ้า
  // backend เปิดรับจากอินเทอร์เน็ตโดยไม่มีอะไรกั้น ใครก็ส่ง
  // `X-User-Id: 6704101382-anuchat` มาแล้วกลายเป็นคนนั้นได้ทันที —
  // อ่านแชทส่วนตัว ลบโพสต์ เปลี่ยนสิทธิ์คนอื่น ได้หมด
  //
  // GATEWAY_SHARED_SECRET คือด่านที่พิสูจน์ว่าคำขอมาจาก Gateway จริง
  // ถ้าไม่ได้ตั้ง = ไม่มีการยืนยันตัวตนใด ๆ ทั้งสิ้น
  //
  // ยอมให้ข้ามได้ แต่ต้องเป็นการ "ตัดสินใจ" ไม่ใช่ "ลืม" — จึงต้องตั้ง
  // ALLOW_UNPROTECTED_GATEWAY=true ด้วยมือ ซึ่งเป็นคำที่อ่านแล้วรู้ทันทีว่า
  // กำลังยอมอะไรอยู่ (ใช้สำหรับเดโมในวงปิดเท่านั้น)
  const unprotected =
    process.env.NODE_ENV === 'production' &&
    process.env.DEV_FAKE_GATEWAY !== 'true' &&
    !process.env.GATEWAY_SHARED_SECRET;

  if (unprotected && process.env.ALLOW_UNPROTECTED_GATEWAY !== 'true') {
    throw new Error(
      'ยังไม่ได้ตั้ง GATEWAY_SHARED_SECRET บน production — ' +
        'ตอนนี้ใครก็ส่ง header X-User-Id มาเป็นใครก็ได้ ' +
        '(อ่านแชทส่วนตัว ลบโพสต์ เปลี่ยนสิทธิ์คนอื่นได้ทั้งหมด)\n' +
        '  · ต่อกับ API Gateway แล้ว: ตั้ง GATEWAY_SHARED_SECRET ให้ตรงกับที่ Gateway ส่งมา\n' +
        '  · ยังไม่ต่อ และจะเดโมในวงปิด: ตั้ง ALLOW_UNPROTECTED_GATEWAY=true ' +
        'เพื่อยืนยันว่ารู้ตัว',
    );
  }

  const app = await NestFactory.create(AppModule);

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

  if (process.env.DEV_FAKE_GATEWAY === 'true') {
    logger.warn(
      `DEV_FAKE_GATEWAY เปิดอยู่ — ทุก request จะถือว่าเป็น "${process.env.DEV_FAKE_USERNAME}" (${process.env.DEV_FAKE_LAYER1_ROLE})`,
    );
  }

  // เตือนซ้ำทุกครั้งที่บูต ไม่ใช่เตือนครั้งเดียวตอนตั้งค่า
  // เพราะคนที่มาดู log ทีหลังต้องเห็นด้วยว่าระบบกำลังเปิดโล่งอยู่
  if (unprotected) {
    logger.warn(
      'เปิดโล่งอยู่ — ไม่มี GATEWAY_SHARED_SECRET ใครส่ง X-User-Id มาก็เป็นคนนั้นได้ ' +
        '(ยอมไว้ด้วย ALLOW_UNPROTECTED_GATEWAY=true) ห้ามใช้กับข้อมูลจริง',
    );
  }
}

await bootstrap();

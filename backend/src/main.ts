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
}

await bootstrap();

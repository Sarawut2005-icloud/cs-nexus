import { Global, Module } from '@nestjs/common';
import { JwksService } from './jwks.service.js';
import { CoreHubTokenVerifier } from './core-hub-token.verifier.js';
import { MeController } from './me.controller.js';
import { SsoCallbackController } from './sso-callback.controller.js';

/// ชั้นยืนยันตัวตนตามสัญญา CSMJU2030 v1.0
///
/// `@Global` เพราะ `CoreHubJwtGuard` ถูกติดตั้งเป็น global guard ใน
/// `bootstrap.ts` และ Nest ต้องหา `CoreHubTokenVerifier` ให้มันได้
/// โดยไม่ต้องให้ทุกโมดูลในระบบ import ชั้นนี้เข้าไปเองทีละตัว
///
/// `JwksService` เป็น singleton โดยธรรมชาติของ Nest — สำคัญมาก เพราะแคชกุญแจ
/// กับตัวนับจำกัดอัตราอยู่ในตัวมัน ถ้ามีหลายอินสแตนซ์ การจำกัดอัตราจะหลวม
/// ลงตามจำนวนอินสแตนซ์โดยไม่มีใครสังเกต
@Global()
@Module({
  controllers: [MeController, SsoCallbackController],
  providers: [JwksService, CoreHubTokenVerifier],
  exports: [JwksService, CoreHubTokenVerifier],
})
export class AuthModule {}

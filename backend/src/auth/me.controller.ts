import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator.js';
import { CoreHubJwtGuard } from './core-hub-jwt.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { CoreHubUser } from './core-hub-token.verifier.js';
import { subsystemRoleFor } from './role-mapping.js';

/// `GET /api/v1/me` — เส้นทางบังคับตาม contracts/vocabulary.json
///
/// รูปร่างของคำตอบถูกล็อกไว้ที่ `contracts/openapi.yaml` (`MeEnvelope`)
/// **สี่ฟิลด์เท่านั้น** — `id` · `email` · `coreRole` · `subsystemRole`
/// conformance L1-08..12 อ่านทั้งสี่ตัวแล้วเทียบกับ claim ใน token ที่มันถืออยู่
///
/// `id` คือค่า `sub` ตรง ๆ ไม่ใช่ id ในฐานข้อมูลเรา — ตัวตนกลางมีที่เดียว
/// คือ Core Hub ถ้าคืน id ของเราไป ระบบย่อยอื่นจะเอาไปอ้างอิงข้ามระบบไม่ได้
///
/// ระหว่างย้ายจาก Gateway header ไป JWKS เส้นทางนี้ใช้ **ด่านใหม่เท่านั้น**
///
/// `@Public()` ปิดด่านเก่า (GatewayAuthGuard) ที่ยังเป็น global guard อยู่
/// ส่วน `@UseGuards(CoreHubJwtGuard)` เปิดด่านใหม่เฉพาะ route นี้
/// สองบรรทัดนี้จะหายไปพร้อมกันตอนสลับด่านใหม่เป็น global
@ApiTags('auth')
@Public()
@UseGuards(CoreHubJwtGuard)
@Controller('me')
export class MeController {
  @Get()
  @ApiOperation({ summary: 'ตัวตนของผู้ใช้ปัจจุบันจาก token ที่ตรวจแล้ว' })
  me(@CurrentUser() user: CoreHubUser) {
    return {
      id: user.coreUserId,
      email: user.email,
      coreRole: user.coreRole,

      // แปลงสด ไม่อ่านจากฐานข้อมูล เพราะ core role เปลี่ยนที่ Core Hub ได้
      // ตลอดเวลา ถ้าอ่านค่าที่เคยบันทึกไว้ คนที่เพิ่งถูกลดสิทธิ์จะยังใช้สิทธิ์เดิม
      // ได้จนกว่าจะมีอะไรไปแก้แถวนั้น
      subsystemRole: subsystemRoleFor(user.coreRole),
    };
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Layer2Role } from '../../generated/prisma/enums.js';
import type { CoreRole, RequestWithCoreUser } from './core-user.js';
import { defaultLayer2Role, resolveMember } from './member-role.js';
import { CORE_ROLES_KEY } from './core-roles.decorator.js';
import { LAYER2_ROLES_KEY } from './layer2-roles.decorator.js';

/// Two-Tier RBAC (Blueprint หน้า 11)
///
///   Layer 1 — มาจาก header ของ Gateway ทุก request เพราะ Core เป็นแหล่งความจริง
///   Layer 2 — อ่านจากตาราง subsystem_members ของระบบย่อยเราเอง
///
/// ถ้ายังไม่มีแถวใน subsystem_members จะสร้างให้ตาม default mapping ทันที
/// แปลว่าไม่ต้องมีขั้นตอน "ลงทะเบียนเข้าระบบย่อย" ให้ผู้ใช้ทำเอง
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // เหตุผลเดียวกับ GatewayAuthGuard — WebSocket ไม่ผ่านทางนี้
    if (context.getType() !== 'http') {
      return true;
    }

    const coreRoleRequired = this.reflector.getAllAndOverride<CoreRole[]>(
      CORE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const layer2Required = this.reflector.getAllAndOverride<Layer2Role[]>(
      LAYER2_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!coreRoleRequired?.length && !layer2Required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithCoreUser>();
    const user = request.coreUser;

    if (!user) {
      throw new ForbiddenException('ไม่พบตัวตนของผู้เรียก');
    }

    if (coreRoleRequired?.length && !coreRoleRequired.includes(user.coreRole)) {
      throw new ForbiddenException(
        `ต้องมีสิทธิ์ระดับองค์กรเป็น ${coreRoleRequired.join(' หรือ ')}`,
      );
    }

    if (layer2Required?.length) {
      // resolveMember ปรับสิทธิ์ให้ตรงกับ core_role ด้วยถ้าแถวถูกสร้าง
      // โดยคนอื่นไว้ก่อน (เช่นผู้ดูแลตั้งโควตาล่วงหน้า)
      const member = await resolveMember(this.prisma, user);

      if (!layer2Required.includes(member.layer2Role)) {
        throw new ForbiddenException(
          `ต้องมีสิทธิ์ในระบบนี้เป็น ${layer2Required.join(' หรือ ')}`,
        );
      }
    }

    return true;
  }

  /// คงไว้เพื่อความเข้ากันได้ — ตรรกะจริงย้ายไป common/auth/member-role.ts
  /// เพื่อให้ RolesGuard และ GET /subsystem-members/me ใช้ชุดเดียวกัน
  static defaultLayer2Role(coreRole: CoreRole): Layer2Role {
    return defaultLayer2Role(coreRole);
  }
}

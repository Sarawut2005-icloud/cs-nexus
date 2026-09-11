import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type GatewayUser } from '../../common/auth/gateway-user.js';
import { resolveMember } from '../../common/auth/member-role.js';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

export class MeResponseDto {
  @ApiProperty({ example: '6704101382-anuchat' }) username!: string;
  @ApiProperty({ example: 'student' }) layer1_role!: string;
  @ApiProperty({ example: 'science', nullable: true }) faculty!: string | null;
  @ApiProperty({ enum: ['GUEST', 'EDITOR', 'ADMIN'] }) layer2_role!: string;
  @ApiProperty({ example: '48120040' }) storage_used_bytes!: string;
  @ApiProperty({ example: '209715200' }) storage_quota_bytes!: string;
  @ApiProperty({ example: 22.9 }) storage_used_percent!: number;
}

/// "ฉันเป็นใครในระบบนี้" — รวมข้อมูลกลางจาก header กับข้อมูลเฉพาะระบบย่อยจาก DB
///
/// สังเกตว่า layer1_role และ faculty ส่งต่อจาก header ไม่ได้อ่านจากฐานข้อมูล
/// เพราะ Core เป็นแหล่งความจริงของสองค่านี้ (Blueprint หน้า 10)
@ApiTags('subsystem-members')
@Controller('subsystem-members')
export class MembersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'สิทธิ์และพื้นที่เก็บไฟล์ของฉันในระบบย่อยนี้' })
  @ApiEnvelope(MeResponseDto)
  async me(@CurrentUser() user: GatewayUser): Promise<MeResponseDto> {
    // ไม่ใช้ upsert ตรง ๆ เพราะ `update: {}` จะไม่แก้สิทธิ์ที่ผิดให้ —
    // แถวที่ผู้ดูแลสร้างไว้ตอนตั้งโควตาล่วงหน้าจะค้างเป็น GUEST ตลอดไป
    // แม้เจ้าตัวเป็นอาจารย์ (ดูเหตุผลเต็มใน common/auth/member-role.ts)
    const member = await resolveMember(this.prisma, user);

    const used = Number(member.storageUsedBytes);
    const quota = Number(member.storageQuotaBytes);

    return {
      username: member.username,
      layer1_role: user.layer1Role,
      faculty: user.faculty,
      layer2_role: member.layer2Role,
      storage_used_bytes: member.storageUsedBytes.toString(),
      storage_quota_bytes: member.storageQuotaBytes.toString(),
      storage_used_percent:
        quota > 0 ? Math.round((used / quota) * 1000) / 10 : 0,
    };
  }
}

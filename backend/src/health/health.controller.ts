import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator.js';
import { PrismaService } from '../common/prisma/prisma.service.js';

/// "รวมไปถึงต้องมี Endpoint GET /health สำหรับตรวจสถานะระบบเสมอ"
/// (Blueprint หน้า 7) — อยู่นอก prefix /api/v1 เพื่อให้ Gateway เรียกตรงได้
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'ตรวจสถานะระบบย่อยและการเชื่อมต่อฐานข้อมูล' })
  async check() {
    const startedAt = Date.now();
    let database = 'up';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      subsystem: 'aie4-social-reels',
      standards_version: '1.2.0',
      database,
      latency_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    };
  }
}

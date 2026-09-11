import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { LocalDiskStorage } from '../../common/storage/local-disk.storage.js';

/// รับ-ส่งไบต์ของไฟล์ "สำหรับ dev เท่านั้น"
///
/// บน staging/production ที่ตั้ง SUPABASE_URL แล้ว signed URL จะชี้ไปที่
/// Supabase ตรง ๆ และ controller นี้จะไม่ถูกเรียกเลย — ไบต์ไม่ผ่าน backend
///
/// ตัด @Public() ออกไม่ได้ เพราะ signed URL ถูกเปิดโดยเบราว์เซอร์ที่ไม่ได้
/// วิ่งผ่าน Gateway จึงไม่มี header X-User-Id ติดมา ความปลอดภัยมาจากลายเซ็น
/// HMAC ในตัว URL แทน
@ApiExcludeController()
@Controller('asset-blobs')
export class AssetBlobsController {
  constructor(
    private readonly disk: LocalDiskStorage,
    private readonly prisma: PrismaService,
  ) {}

  @Put(':bucket/:objectPath')
  @Public()
  async upload(
    @Param('bucket') bucket: string,
    @Param('objectPath') objectPath: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Req() request: Request,
  ): Promise<void> {
    const path = decodeURIComponent(objectPath);

    if (!this.disk.verify('put', bucket, path, Number(expires), signature)) {
      throw new UnauthorizedException('ลิงก์อัปโหลดหมดอายุหรือไม่ถูกต้อง');
    }

    const body = await readBody(request);

    if (body.length === 0) {
      throw new BadRequestException('ไม่มีข้อมูลไฟล์ในคำขอ');
    }

    await this.disk.write(bucket, path, body);
  }

  @Get(':bucket/:objectPath')
  @Public()
  @Header('x-content-type-options', 'nosniff')
  async download(
    @Param('bucket') bucket: string,
    @Param('objectPath') objectPath: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Query('download') download: string,
    @Res() response: Response,
  ): Promise<void> {
    const path = decodeURIComponent(objectPath);

    if (!this.disk.verify('get', bucket, path, Number(expires), signature)) {
      throw new UnauthorizedException('ลิงก์ดาวน์โหลดหมดอายุหรือไม่ถูกต้อง');
    }

    // ส่ง content-type จาก mimeType ที่ "ยืนยันด้วย magic bytes" ตอน commit
    // ไม่ใช่จากนามสกุลหรือจากที่ client แจ้ง
    //
    // เดิม handler นี้ไม่ส่ง content-type เลย ซึ่งพังคู่กับ nosniff ด้านบน:
    // เบราว์เซอร์ไม่รู้ว่าเป็นรูปและถูกห้ามเดา ผลคือรูปสตอรี่และคลิปไม่ขึ้น
    // โดยไม่มี error ให้เห็น
    //
    // objectPath เป็น unique ใน schema จึงหาแถวได้ตรงตัว และ URL นี้ถูก
    // เซ็น HMAC มาแล้ว การอ่านชนิดไฟล์จึงไม่เปิดช่องอะไรใหม่
    const asset = await this.prisma.asset.findUnique({
      where: { objectPath: path },
      select: { mimeType: true, fileName: true },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    response.setHeader('content-type', asset.mimeType);

    // ไฟล์เปลี่ยนเนื้อไม่ได้หลัง commit (objectPath มี uuid ในตัว) จึงแคชได้
    // แต่ต้องเป็น private เพราะ URL มีลายเซ็นของผู้ขอติดอยู่
    response.setHeader('cache-control', 'private, max-age=300');

    // ทุกอย่างที่ไม่ใช่ภาพ/วิดีโอถูกบังคับดาวน์โหลด และ nosniff กันเบราว์เซอร์
    // เดาชนิดไฟล์เอง — สองอย่างนี้คือสิ่งที่กัน stored XSS จากไฟล์ผู้ใช้
    if (download === '1') {
      response.setHeader(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      );
    }

    createReadStream(this.disk.pathFor(bucket, path)).pipe(response);
  }
}

/// อ่าน raw body เอง เพราะ signed upload ส่งมาเป็น application/octet-stream
/// ซึ่ง body parser ของ Nest ไม่แตะ
function readBody(request: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

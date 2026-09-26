import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/// รูปแบบ error ที่คู่กับ Standard Envelope
///
///   { "success": false, "error": { "code": "...", "message": "...", "details": [...] } }
///
/// ข้อความต้องบอกว่าเกิดอะไรและแก้อย่างไร ไม่ใช่แค่ "Bad Request"
/// เพราะ frontend ของระบบย่อยอื่นก็อ่าน error นี้เหมือนกัน
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const details = this.detailsFrom(body);

      response.status(status).json({
        success: false,
        error: {
          code: this.codeFor(status, details),
          message: this.messageFrom(body, exception.message),
          details,
        },
      });
      return;
    }

    // ข้อผิดพลาดที่ไม่ได้คาดไว้ — log ของจริงไว้ แต่ไม่ส่งรายละเอียดออกไป
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
        details: [],
      },
    });
  }

  /// รหัสข้อผิดพลาด — **enum ปิด 7 ค่า** ตาม contracts/error-codes.json
  ///
  /// สัญญาเขียนไว้ตรง ๆ ว่า "A subsystem MUST NOT invent error codes outside
  /// this list" จึงไม่มีรหัสสำหรับ 413 หรือ 429 โดยเฉพาะ ต้องยุบเข้ารหัส
  /// ที่ใกล้ที่สุด ไม่ใช่คิดชื่อใหม่ขึ้นมาเอง
  ///
  /// เหตุผลที่รายการต้องปิด: ระบบย่อย 36 ตัวคุยกันเอง ถ้าแต่ละตัวคิดรหัสเอง
  /// คนเขียนหน้าบ้านจะต้องจำว่า "ระบบนี้เรียก not_found ระบบนั้นเรียก missing"
  /// แล้วสุดท้ายจะเลิกอ่าน `code` แล้วไปอ่าน HTTP status แทน ซึ่งหยาบกว่ามาก
  private codeFor(status: number, details: string[]): string {
    // 400 แยกสองแบบ: ValidationPipe ส่ง message มาเป็น array เสมอ จึงใช้
    // การมี details เป็นตัวชี้ว่าเป็นการตรวจ body/query ตกจริง ไม่ใช่
    // คำขอผิดรูปแบบทั่วไป (api-conventions.md ข้อ 4)
    if (status === HttpStatus.BAD_REQUEST) {
      return details.length > 0 ? 'VALIDATION_ERROR' : 'BAD_REQUEST';
    }

    const map: Record<number, string> = {
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',

      // ไม่มีรหัสของตัวเองในรายการปิด — ยุบเป็น BAD_REQUEST เพราะทั้งสองกรณี
      // คือ "คำขอนี้ใช้ไม่ได้" ไม่ใช่ "ระบบพัง" ผู้เรียกยังได้ HTTP status
      // ที่ถูกต้อง (413 / 429) และข้อความที่บอกสาเหตุจริงอยู่ดี
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'BAD_REQUEST',
      [HttpStatus.TOO_MANY_REQUESTS]: 'BAD_REQUEST',
    };

    return map[status] ?? 'INTERNAL_ERROR';
  }

  private messageFrom(body: unknown, fallback: string): string {
    if (typeof body === 'string') {
      return body;
    }

    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message) && message.length > 0) {
        return String(message[0]);
      }
    }

    return fallback;
  }

  private detailsFrom(body: unknown): string[] {
    if (
      body &&
      typeof body === 'object' &&
      'message' in body &&
      Array.isArray((body as { message: unknown }).message)
    ) {
      return ((body as { message: unknown[] }).message).map(String);
    }

    return [];
  }
}

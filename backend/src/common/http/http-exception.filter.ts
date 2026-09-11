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

      response.status(status).json({
        success: false,
        error: {
          code: this.codeFor(status),
          message: this.messageFrom(body, exception.message),
          details: this.detailsFrom(body),
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
        code: 'internal_error',
        message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
        details: [],
      },
    });
  }

  private codeFor(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'validation_failed',
      [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
      [HttpStatus.FORBIDDEN]: 'forbidden',
      [HttpStatus.NOT_FOUND]: 'not_found',
      [HttpStatus.CONFLICT]: 'conflict',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
      [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
    };

    return map[status] ?? 'error';
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

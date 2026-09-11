import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { StoriesService } from './stories.service.js';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 90 * 1000;

/// เก็บกวาดสตอรี่ที่หมดอายุ เพื่อคืนพื้นที่เก็บไฟล์ให้เจ้าของ
///
/// ย้ำอีกครั้งเพราะเข้าใจผิดกันง่าย: **ตัวนี้ไม่ใช่สิ่งที่ทำให้สตอรี่หมดอายุ**
/// การหมดอายุบังคับด้วยเงื่อนไข expiresAt > now() ในทุกคิวรีอ่านไปแล้ว
/// ถ้าตัวนี้ไม่เคยรันเลย ผู้ใช้ก็ยังเห็นสตอรี่หายตรงเวลา — แค่ไฟล์ค้างกินโควตา
///
/// ใช้ setInterval ไม่ใช่ @nestjs/schedule เพื่อไม่เพิ่ม dependency และ
/// จับ error ไว้ทั้งหมดเพราะ error ใน setInterval ที่ไม่มีใครจับจะทำให้
/// โพรเซสตายทั้งตัว พาแชทและห้องเสียงล่มไปด้วย
@Injectable()
export class StoriesSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoriesSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;

  constructor(private readonly stories: StoriesService) {}

  onModuleInit(): void {
    this.firstRun = setTimeout(() => {
      void this.sweep();

      this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      this.timer.unref();
    }, FIRST_SWEEP_DELAY_MS);

    this.firstRun.unref();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      await this.stories.sweepExpired();
    } catch (error) {
      this.logger.error(
        `เก็บกวาดสตอรี่ไม่สำเร็จ: ${
          error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'
        }`,
      );
    }
  }
}

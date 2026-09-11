import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { ReelsController } from './reels.controller.js';
import { ReelsService } from './reels.service.js';

@Module({
  imports: [FollowsModule],
  controllers: [ReelsController],
  providers: [ReelsService],
})
export class ReelsModule {}

import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { StoriesSweeper } from './stories-sweeper.service.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

@Module({
  imports: [FollowsModule],
  controllers: [StoriesController],
  providers: [StoriesService, StoriesSweeper],
  exports: [StoriesService],
})
export class StoriesModule {}

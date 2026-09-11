import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ChannelsController, DirectChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  controllers: [ChannelsController, DirectChannelsController, MessagesController],
  providers: [ChannelsService, MessagesService],
  exports: [ChannelsService, MessagesService],
})
export class ChannelsModule {}

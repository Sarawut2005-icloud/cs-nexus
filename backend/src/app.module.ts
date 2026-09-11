import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RealtimeBusModule } from './common/realtime/realtime-bus.js';
import { StorageModule } from './common/storage/storage.module.js';
import { HealthModule } from './health/health.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { BookmarksModule } from './modules/bookmarks/bookmarks.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';
import { FollowsModule } from './modules/follows/follows.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PostsModule } from './modules/posts/posts.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { ReactionsModule } from './modules/reactions/reactions.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ReelsModule } from './modules/reels/reels.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { StoriesModule } from './modules/stories/stories.module.js';
import { VoiceModule } from './modules/voice/voice.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    // สองโมดูลนี้เป็น @Global — ทุก service เรียกใช้ได้โดยไม่ต้อง import
    // ซึ่งจำเป็นเพราะเกือบทุกฟีเจอร์ต้องยิงแจ้งเตือนหรือผลักเหตุการณ์ออก socket
    RealtimeBusModule,
    NotificationsModule,
    HealthModule,
    MembersModule,
    ProfilesModule,
    FollowsModule,
    AssetsModule,
    ReelsModule,
    RealtimeModule,
    ChannelsModule,
    PostsModule,
    VoiceModule,
    ReactionsModule,
    BookmarksModule,
    MeetingsModule,
    ReportsModule,
    SearchModule,
    StoriesModule,
    AdminModule,
  ],
})
export class AppModule {}

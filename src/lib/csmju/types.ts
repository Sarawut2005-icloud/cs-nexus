/// สัญญาของ API — ชนิดข้อมูลที่หลังบ้านตอบกลับ
///
/// field เป็น snake_case ทั้งหมดตามมาตรฐานหน้า 7 และ **ไม่แปลงเป็น camelCase**
/// ที่หน้าบ้านโดยตั้งใจ: ถ้าแปลง ชื่อใน DevTools จะไม่ตรงกับใน openapi.json
/// แล้วเวลาไล่บั๊กจะต้องแปลงกลับไปกลับมาในหัวตลอด
///
/// ที่มาของแต่ละชนิด: `backend/openapi.json` (78 endpoint)
/// ถ้าหลังบ้านเปลี่ยนสัญญา CI จะจับที่ `npm run openapi:check` ฝั่งหลังบ้าน
/// แต่ **ไฟล์นี้ไม่มีอะไรจับให้** — TODO(PL): พิจารณาสร้างชนิดจาก openapi.json
/// อัตโนมัติเมื่อ API เริ่มนิ่ง

export type Layer2Role = 'GUEST' | 'EDITOR' | 'ADMIN';
export type ChannelKind = 'DM' | 'GROUP' | 'COURSE' | 'VOICE';
export type ChannelRole = 'MEMBER' | 'MODERATOR';
export type ReactionTarget = 'MESSAGE' | 'POST' | 'REEL';
export type BookmarkTarget = 'POST' | 'REEL';
export type MeetingStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

export interface Me {
  username: string;
  layer1_role: string;
  faculty: string | null;
  layer2_role: Layer2Role;
  storage_used_bytes: string;
  storage_quota_bytes: string;
  storage_used_percent: number;
}

export interface EmojiCount {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

export interface ReactionSummary {
  target_kind: ReactionTarget;
  target_id: string;
  totals: EmojiCount[];
  total_count: number;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  course_tag: string | null;
  author_username: string;
  comment_count: number;
  reactions: ReactionSummary | null;
  created_at: string;
}

export interface PostComment {
  id: string;
  post_id: string;
  author_username: string;
  content: string;
  created_at: string;
}

export interface Reel {
  id: string;
  title: string;
  caption: string | null;
  asset_id: string;
  duration_ms: number;
  author_username: string;
  like_count: number;
  view_count: number;
  liked_by_me: boolean;
  created_at: string;
}

export interface ReelComment {
  id: string;
  reel_id: string;
  author_username: string;
  content: string;
  created_at: string;
}

export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string | null;
  course_tag: string | null;
  max_seats: number;
  member_count: number;
  my_role: ChannelRole;
  unread_count: number;
  created_at: string;
}

export interface MessageAttachment {
  id: string;
  file_name: string;
  kind: string;
  mime_type: string;
  size_bytes: string;
}

export interface Message {
  id: string;
  seq: number;
  channel_id: string;
  author_username: string;
  content: string | null;
  attachments: MessageAttachment[];
  embed: { kind: string; ref_id: string } | null;
  parent_id: string | null;
  reply_count: number;
  pinned_at: string | null;
  pinned_by_username: string | null;
  client_nonce: string;
  edited_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  ref_id: string;
  actor_username: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface Relation {
  following: boolean;
  followed_by: boolean;
  mutual: boolean;
}

export interface ProfileSummary {
  username: string;
  display_name: string;
  avatar_url: string | null;
  synced_at: string | null;
  /// เครื่องหมายยืนยันข้างชื่อ — มาจาก layer2_role ของระบบย่อยนี้
  /// ไม่ใช่ layer1_role ซึ่งเราห้ามเก็บ (Blueprint หน้า 10)
  badge: 'ADMIN' | 'STAFF' | null;
}

export interface ProfileDetail extends ProfileSummary {
  stats: {
    reel_count: number;
    post_count: number;
    follower_count: number;
    following_count: number;
  };
  relation: Relation;
  layer2_role: string | null;
  joined_at: string | null;
}

/// โปรไฟล์ของตัวเอง — เพิ่มของที่แก้ได้ และรายการ field ที่แก้ไม่ได้
export interface MyProfile extends ProfileDetail {
  bio: string | null;
  cover_url: string | null;
  /// field ที่ Core เป็นเจ้าของ — หน้าบ้านต้องแสดงเป็นอ่านอย่างเดียว
  /// มาจากหลังบ้าน ไม่ hardcode ที่นี่ เพื่อให้ตามทันถ้ากฎเปลี่ยน
  managed_by_core: string[];
}

export interface FollowEdge {
  username: string;
  created_at: string;
}

export interface Bookmark {
  target_kind: BookmarkTarget;
  target_id: string;
  title: string | null;
  author_username: string | null;
  created_at: string;
}

export interface SearchHit {
  kind: string;
  id: string;
  title: string;
  snippet: string | null;
  author_username: string | null;
  channel_id: string | null;
  created_at: string | null;
}

export interface SearchAll {
  query: string;
  counts: { reels: number; posts: number; people: number; messages: number };
  hits: SearchHit[];
}

export interface Meeting {
  id: string;
  channel_id: string;
  title: string;
  agenda: string | null;
  starts_at: string;
  ends_at: string;
  status: MeetingStatus;
  created_by_username: string;
  joinable_now: boolean;
  created_at: string;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface VoiceSession {
  id: string;
  channel_id: string;
  started_at: string;
  participants: { username: string; joined_at: string }[];
  max_seats: number;
  seats_taken: number;
}

export interface JoinVoiceResponse extends VoiceSession {
  ice_servers: IceServer[];
  turn_available: boolean;
  max_screen_viewers: number;
}

export interface AuditLog {
  id: string;
  actor_username: string;
  actor_layer1_role: string;
  action: string;
  target_kind: string;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SubsystemMember {
  username: string;
  layer2_role: Layer2Role;
  /// true = ผู้ดูแลตั้งด้วยมือ · false = แปลงมาจากสิทธิ์องค์กรอัตโนมัติ
  layer2_role_explicit: boolean;
  storage_used_bytes: string;
  storage_quota_bytes: string;
  created_at: string;
  updated_at: string;
}

export interface AdminOverview {
  subsystem: string;
  standards_version: string;
  member_count: number;
  reel_count: number;
  post_count: number;
  message_count: number;
  channel_count: number;
  open_report_count: number;
  storage_used_bytes: string;
  active_voice_session_count: number;
  default_role_mapping: Record<string, string>;
}

export interface Report {
  id: string;
  target_kind: string;
  target_id: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  reporter_username: string;
  resolved_by_username: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface StoryItem {
  id: string;
  author_username: string;
  kind: 'IMAGE' | 'VIDEO';
  /// signed URL อายุ 5 นาที — ถ้าโหลดไม่ขึ้นให้ดึงแถวใหม่
  media_url: string;
  asset_id: string;
  caption: string | null;
  viewed_by_me: boolean;
  /// เจ้าของเห็นเลขจริง คนอื่นเห็น 0 เสมอ
  view_count: number;
  created_at: string;
  expires_at: string;
}

export interface StoryTray {
  author_username: string;
  has_unseen: boolean;
  is_me: boolean;
  stories: StoryItem[];
}

export interface StoryViewerRow {
  username: string;
  viewed_at: string;
}

/// อิโมจิที่หลังบ้านอนุญาต — ต้องตรงกับ ALLOWED_EMOJI ใน
/// backend/src/modules/reactions/dto/reaction.dto.ts
/// ถ้าไม่ตรง ผู้ใช้จะกดแล้วได้ 400 ทั้งที่ปุ่มโผล่อยู่บนหน้าจอ
export const ALLOWED_EMOJI = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😠',
  '🎉',
  '🔥',
  '🙏',
  '✅',
  '❓',
  '💡',
] as const;

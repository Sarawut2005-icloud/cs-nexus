'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass,
  Film,
  MessageSquare,
  Mic,
  MicOff,
  Headphones,
  Plus,
  Code2,
  Paperclip,
  Image as ImageIcon,
  Send,
  Users,
  Search,
  Hash,
  Volume2,
  Sparkles,
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'feed' | 'reels' | 'community'>('feed');
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [postContent, setPostContent] = useState('');

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      {/* ------------------------------------------------------------- */}
      {/* 1. LEFT RAIL NAVIGATION (Microsoft Teams / Discord Style)    */}
      {/* ------------------------------------------------------------- */}
      <aside className="w-16 md:w-20 bg-slate-900/80 border-r border-slate-800 flex flex-col items-center py-4 justify-between backdrop-blur-xl z-30 shrink-0">
        <div className="flex flex-col items-center gap-6 w-full">
          {/* Logo / App Brand */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-blue-500/20">
            CS
          </div>

          <div className="h-[1px] w-8 bg-slate-800" />

          {/* Core Navigation Items */}
          <nav className="flex flex-col gap-3 w-full px-2">
            <button
              onClick={() => setActiveTab('feed')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 group relative ${
                activeTab === 'feed'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Compass className="w-5 h-5" />
              <span className="absolute left-full ml-3 px-2 py-1 bg-slate-800 text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                หน้าฟีดหลัก
              </span>
            </button>

            <button
              onClick={() => setActiveTab('reels')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 group relative ${
                activeTab === 'reels'
                  ? 'bg-pink-600 text-white shadow-md shadow-pink-600/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Film className="w-5 h-5" />
              <span className="absolute left-full ml-3 px-2 py-1 bg-slate-800 text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                CS Reels
              </span>
            </button>

            <button
              onClick={() => setActiveTab('community')}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 group relative ${
                activeTab === 'community'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="absolute left-full ml-3 px-2 py-1 bg-slate-800 text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                Q&A / แชทสาขา
              </span>
            </button>
          </nav>
        </div>

        {/* User Profile Avatar */}
        <div className="relative group cursor-pointer">
          <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-semibold text-blue-400">
            67
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900" />
        </div>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* 2. SUB-SIDEBAR: CHANNELS & ROOMS (Discord / Teams Style)      */}
      {/* ------------------------------------------------------------- */}
      <aside className="w-64 bg-slate-900/40 border-r border-slate-800 hidden md:flex flex-col justify-between shrink-0">
        <div className="p-4 overflow-y-auto space-y-6">
          {/* Header Workspace */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
            <div>
              <h2 className="text-sm font-bold text-slate-100 leading-tight">CSMJU Hub</h2>
              <p className="text-xs text-slate-400 mt-0.5">สาขาวิชาวิทยาการคอมพิวเตอร์</p>
            </div>
            <button className="p-1.5 rounded-lg bg-slate-800/60 text-slate-400 hover:text-white">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Text & Discussion Channels */}
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2">
              ช่องกระดานข่าวสาร
            </span>
            <div className="mt-2 space-y-1">
              {['ประกาศสาขา', 'ถาม-ตอบ-ปัญหาโค้ด', 'แชร์ผลงาน-โปรเจกต์', 'หางาน-ฝึกงาน'].map((channel, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800/50 hover:text-white transition-colors"
                >
                  <Hash className="w-4 h-4 text-slate-500" />
                  <span className="truncate leading-relaxed">{channel}</span>
                </button>
              ))}
            </div>
          </div>

          {/* WebRTC Always-on Voice Channels */}
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 flex items-center justify-between">
              <span>ห้องคอลเสียง (Voice)</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </span>
            <div className="mt-2 space-y-1">
              {[
                { name: 'ห้องติวสอบ Web Dev', users: 3 },
                { name: 'Office Hours - อาจารย์', users: 1 },
                { name: 'นั่งเขียนโค้ดเงียบๆ', users: 5 },
              ].map((room, idx) => (
                <button
                  key={idx}
                  onClick={() => setIsVoiceConnected(true)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm text-slate-300 hover:bg-emerald-500/10 hover:text-emerald-400 group transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Volume2 className="w-4 h-4 text-slate-500 group-hover:text-emerald-400" />
                    <span className="truncate leading-relaxed">{room.name}</span>
                  </div>
                  <span className="text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                    {room.users}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Discord-style Connected Voice Dock */}
        <AnimatePresence>
          {isVoiceConnected && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="p-3 bg-slate-900 border-t border-slate-800 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-emerald-400 leading-tight">เชื่อมต่อเสียงแล้ว</p>
                    <p className="text-[11px] text-slate-400">ห้องติวสอบ Web Dev</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-around pt-1">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`p-2 rounded-lg ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-200'}`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button className="p-2 rounded-lg bg-slate-800 text-slate-200">
                  <Headphones className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsVoiceConnected(false)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors"
                >
                  วางสาย
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      {/* ------------------------------------------------------------- */}
      {/* 3. CENTER CONTENT AREA: DYNAMIC FEED / REELS (IG + FB Style)   */}
      {/* ------------------------------------------------------------- */}
      <main className="flex-1 h-full overflow-y-auto bg-slate-950 p-4 md:p-6 space-y-6">
        {/* Top Search & Actions */}
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาโพสต์, โค้ดตัวอย่าง, หรือคลิป CS Reels..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 leading-relaxed"
            />
          </div>
          <button className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition-colors flex items-center gap-2 shrink-0">
            <Sparkles className="w-4 h-4" />
            <span>โพสต์สร้างสรรค์</span>
          </button>
        </div>

        {/* Quick Reels Carousel Bar (IG Stories / Reels Style) */}
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
            <span>CS Reels มาแรงประจำสัปดาห์</span>
            <button onClick={() => setActiveTab('reels')} className="text-blue-400 hover:underline">
              ดูทั้งหมด
            </button>
          </div>
          <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none">
            {[1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className="relative w-28 h-44 rounded-xl bg-slate-900 border border-slate-800 shrink-0 overflow-hidden group cursor-pointer"
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 z-10" />
                <div className="absolute top-2 left-2 z-20 w-7 h-7 rounded-full bg-pink-500 border border-white flex items-center justify-center text-[10px] font-bold">
                  CS
                </div>
                <div className="absolute bottom-2 left-2 right-2 z-20">
                  <p className="text-[11px] font-semibold text-white leading-snug line-clamp-2">
                    พรีวิวโปรเจกต์ Next.js 14
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Facebook-Style Create Post Box with Code & File Support */}
        <div className="max-w-3xl mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center font-bold text-sm text-white shrink-0">
              67
            </div>
            <textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder="มีคำถามเรื่องเขียนโค้ด หรืออยากแชร์ไอเดียโปรเจกต์ใหม่ไหม?"
              className="w-full bg-transparent border-none text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none min-h-[70px] leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-emerald-400 transition-colors flex items-center gap-1.5 text-xs">
                <Code2 className="w-4 h-4" />
                <span className="hidden sm:inline">แนบโค้ด</span>
              </button>
              <button className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-blue-400 transition-colors flex items-center gap-1.5 text-xs">
                <ImageIcon className="w-4 h-4" />
                <span className="hidden sm:inline">รูปภาพ/วิดีโอ</span>
              </button>
              <button className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-purple-400 transition-colors flex items-center gap-1.5 text-xs">
                <Paperclip className="w-4 h-4" />
                <span className="hidden sm:inline">ไฟล์งาน (.zip)</span>
              </button>
            </div>

            <button
              disabled={!postContent.trim()}
              className="px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 transition-all flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
              <span>โพสต์</span>
            </button>
          </div>
        </div>

        {/* Feed Posts List */}
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-sm text-white">
                  AJ
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 leading-tight">
                    ดร. สมชาย ใจดี (Staff)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">ประกาศรายวิชา CS203 • 2 ชม. ที่แล้ว</p>
                </div>
              </div>
            </div>

            {/* Post Body - Thai Typography Rule Compliant */}
            <p className="text-sm text-slate-200 leading-relaxed">
              ให้นักศึกษาทุกคนตรวจสอบไฟล์การบ้านเรื่อง WebSockets Integration และส่งไฟล์งาน Zip
              ผ่านระบบก่อนเที่ยงคืนวันศุกร์นี้ครับ หากติด Bug สามารถแปะ Snippet ในช่อง Q&A ได้เลย
            </p>

            {/* Embedded Code Snippet Box */}
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
              <div className="flex items-center justify-between text-slate-500 mb-2 pb-2 border-b border-slate-800/60">
                <span>server.ts</span>
                <span>TypeScript</span>
              </div>
              <pre>{`const socket = io("https://api.csmju2030.ac.th", {
  auth: { ticket: "SINGLE_USE_TICKET" }
});`}</pre>
            </div>
          </div>
        </div>
      </main>

      {/* ------------------------------------------------------------- */}
      {/* 4. RIGHT SIDEBAR: ONLINE MEMBERS & ACTIVITY (Discord Style)   */}
      {/* ------------------------------------------------------------- */}
      <aside className="w-64 bg-slate-900/40 border-l border-slate-800 hidden lg:flex flex-col p-4 space-y-6 shrink-0">
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            <span>เพื่อนในสาขาออนไลน์ (12)</span>
          </h3>
          <div className="mt-3 space-y-2">
            {[
              { name: 'อนุชาติ (AIE 4)', role: 'Student', status: 'กำลังทำ CS Reels' },
              { name: 'สมหญิง เรียนดี', role: 'Student', status: 'อยู่ในห้องติวสอบ' },
              { name: 'อาจารย์ ณัฐพล', role: 'Staff', status: 'พร้อมให้คำปรึกษา' },
            ].map((user, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-blue-400">
                    {user.name.charAt(0)}
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-semibold text-slate-200 truncate leading-tight">{user.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{user.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
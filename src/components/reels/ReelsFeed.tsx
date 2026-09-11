'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageSquare, Share2, Code2 } from 'lucide-react';

interface ReelItem {
  id: string;
  videoUrl: string;
  author: string;
  studentId: string;
  caption: string;
  likes: number;
}

// Dummy Data สำหรับทดสอบ UI สไตล์ CS Nexus
const DUMMY_REELS: ReelItem[] = [
  {
    id: '1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-code-animation-on-a-screen-40751-large.mp4',
    author: 'Somchai Dev',
    studentId: '66010001',
    caption: 'โชว์ผลงาน CS Reels UI ด้วย Tailwind CSS + Framer Motion 🚀 #CSNexus #Nextjs',
    likes: 128,
  },
  {
    id: '2',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-hands-holding-a-smartphone-with-green-screen-41529-large.mp4',
    author: 'Jane CS',
    studentId: '66010002',
    caption: 'ทดสอบระบบ Voice Call Discord Style ในโปรเจกต์สาขา 🎙️',
    likes: 256,
  },
];

export default function ReelsFeed() {
  const [reels] = useState<ReelItem[]>(DUMMY_REELS);

  return (
    <div className="h-screen w-full max-w-md mx-auto overflow-y-scroll snap-y snap-mandatory bg-black text-white rounded-xl shadow-2xl relative scrollbar-hide">
      {reels.map((reel) => (
        <div
          key={reel.id}
          className="h-screen w-full snap-start snap-always relative flex items-center justify-center bg-slate-900 overflow-hidden"
        >
          {/* Background Video */}
          <video
            src={reel.videoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            loop
            autoPlay
            muted
            playsInline
          />

          {/* Dark Overlay Gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

          {/* Action Bar Right */}
          <div className="absolute right-4 bottom-20 flex flex-col items-center gap-6 z-10">
            <motion.button
              whileTap={{ scale: 0.8 }}
              className="flex flex-col items-center gap-1 group"
            >
              <div className="p-3 rounded-full bg-slate-800/60 backdrop-blur-md group-hover:bg-red-500/20 transition-colors">
                <Heart className="w-6 h-6 text-white group-hover:text-red-500 transition-colors" />
              </div>
              <span className="text-xs font-semibold">{reel.likes}</span>
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.8 }}
              className="flex flex-col items-center gap-1 group"
            >
              <div className="p-3 rounded-full bg-slate-800/60 backdrop-blur-md">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs font-semibold">แชท</span>
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.8 }}
              className="flex flex-col items-center gap-1 group"
            >
              <div className="p-3 rounded-full bg-slate-800/60 backdrop-blur-md">
                <Share2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs font-semibold">แชร์</span>
            </motion.button>
          </div>

          {/* Bottom Info Overlay */}
          <div className="absolute bottom-6 left-4 right-16 z-10 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-sm">
                <Code2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-sm">{reel.author}</p>
                <p className="text-xs text-slate-300">@{reel.studentId}</p>
              </div>
            </div>
            <p className="text-sm line-clamp-2 text-slate-100">{reel.caption}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
'use client';

import React from 'react';
import DashboardPage from '../(app)/mockup/page';

export default function PreviewPage() {
  // บังคับจำลองสภาพแวดล้อม Development
  if (process.env.NODE_ENV === 'production') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-slate-400 font-mono text-sm">
        404 | Preview mode is disabled in production.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Dev Environment Badge */}
      <div className="fixed top-2 right-2 z-50 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] font-mono px-2 py-1 rounded-md backdrop-blur-md flex items-center gap-2 pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
        <span>PREVIEW MODE (Bypassed Auth)</span>
      </div>

      {/* Render Dashboard Component */}
      <DashboardPage />
    </div>
  );
}
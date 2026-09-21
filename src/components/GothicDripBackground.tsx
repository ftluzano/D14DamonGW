import React from 'react';

export const GothicDripBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-px bg-cyan-400/60 shadow-[0_0_22px_rgba(34,211,238,.6)]" />
      <div className="gw-scanline absolute top-[22%] left-0 h-px w-32 bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
      <div className="absolute left-[8%] top-[18%] h-32 w-px bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent" />
      <div className="absolute right-[12%] top-[32%] h-48 w-px bg-gradient-to-b from-transparent via-rose-400/30 to-transparent" />
      <div className="absolute bottom-[18%] left-[22%] h-px w-48 bg-gradient-to-r from-transparent via-lime-300/40 to-transparent" />

      {/* Subtle Realistic Perspective Grid Matrix */}
      <div 
        className="absolute inset-0 opacity-[0.025] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(168, 85, 247, 0.4) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(168, 85, 247, 0.4) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* 2. Top Edge Gothic Drips SVG (Subtle low transparency) */}
      <svg
        className="absolute top-0 left-0 w-full h-20 sm:h-28 text-slate-400/10 dark:text-purple-400/15 fill-current"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path d="M0,0 L1200,0 L1200,30 Q1160,32 1140,75 Q1130,95 1120,70 Q1100,25 1070,30 Q1040,35 1020,95 Q1010,118 1000,90 Q980,30 950,28 Q920,25 900,65 Q880,30 840,32 Q810,35 790,110 Q780,120 770,95 Q750,25 710,30 Q670,35 650,80 Q640,105 630,75 Q610,25 570,30 Q540,35 520,115 Q510,125 500,95 Q480,28 440,30 Q410,32 390,75 Q370,25 330,30 Q300,35 280,105 Q270,120 260,85 Q240,25 200,30 Q170,35 150,70 Q130,25 90,30 Q60,35 40,95 Q30,115 20,80 Q10,30 0,32 Z" />
      </svg>

      {/* Quiet editorial marks keep the shell branded without competing with gameplay. */}
      <div className="absolute inset-0 opacity-[0.035] dark:opacity-[0.08] text-slate-800 dark:text-slate-200 font-black tracking-widest pointer-events-none transition-opacity duration-300">
        
        {/* Top-Left Tag: GUESSWHAT */}
        <div className="absolute top-24 left-4 sm:left-12 rotate-[-8deg] text-3xl sm:text-6xl font-black uppercase tracking-tighter border-b-2 border-current pb-1">
          GUESS WHAT
        </div>

        {/* Top-Right Tag: Y2K DRIP */}
        <div className="absolute top-28 right-4 sm:right-16 rotate-[10deg] text-2xl sm:text-5xl font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-300">
          LIVE ARCADE
        </div>

        {/* Center-Left Stencil: DĄMON */}
        <div className="absolute top-[40%] left-2 sm:left-8 rotate-[-90deg] origin-left text-4xl sm:text-7xl font-extrabold tracking-widest uppercase">
          DĄMON
        </div>

        {/* Center-Right Gothic Cross & Barbed Graffiti */}
        <div className="absolute top-[45%] right-3 sm:right-12 rotate-[90deg] origin-right text-3xl sm:text-6xl font-black tracking-widest uppercase">
          PLAY TOGETHER
        </div>

        {/* Mid Background Spray Splatters & Symbols */}
        <div className="absolute bottom-20 left-6 sm:left-20 rotate-[6deg] text-3xl sm:text-6xl font-black uppercase tracking-tight">
          MAKE A MOVE
        </div>

        {/* Bottom-Right Graffiti: HIGH ROLLER งip */}
        <div className="absolute bottom-24 right-6 sm:right-24 rotate-[-8deg] text-2xl sm:text-5xl font-black uppercase tracking-wider text-rose-500/70">
          YOUR TURN
        </div>
      </div>

      {/* 4. Bottom Edge Gothic Drips SVG (Inverted) */}
      <svg
        className="absolute bottom-0 left-0 w-full h-14 sm:h-20 text-slate-400/10 dark:text-purple-400/10 fill-current rotate-180"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path d="M0,0 L1200,0 L1200,30 Q1160,32 1140,75 Q1130,95 1120,70 Q1100,25 1070,30 Q1040,35 1020,95 Q1010,118 1000,90 Q980,30 950,28 Q920,25 900,65 Q880,30 840,32 Q810,35 790,110 Q780,120 770,95 Q750,25 710,30 Q670,35 650,80 Q640,105 630,75 Q610,25 570,30 Q540,35 520,115 Q510,125 500,95 Q480,28 440,30 Q410,32 390,75 Q370,25 330,30 Q300,35 280,105 Q270,120 260,85 Q240,25 200,30 Q170,35 150,70 Q130,25 90,30 Q60,35 40,95 Q30,115 20,80 Q10,30 0,32 Z" />
      </svg>
    </div>
  );
};

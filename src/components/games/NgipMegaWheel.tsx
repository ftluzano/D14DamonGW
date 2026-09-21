import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Sparkles,
  Zap,
  RotateCcw,
  Crown,
  Trophy,
  Flame,
  Star,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { soundManager } from '../../utils/soundEffects';
import { NgipBadge } from '../NgipBadge';
import { useMultiplayerArcadeRace } from '../../utils/useMultiplayerArcadeRace';

interface NgipMegaWheelProps {
  onBackToHub: () => void;
}

interface WheelSegment {
  id: number;
  label: string;
  multiplier: number;
  color: string;
  isJackpot?: boolean;
}

const SEGMENTS: WheelSegment[] = [
  { id: 0, label: '2X', multiplier: 2, color: '#3B82F6' },
  { id: 1, label: '5X', multiplier: 5, color: '#10B981' },
  { id: 2, label: '10X', multiplier: 10, color: '#F59E0B' },
  { id: 3, label: '3X', multiplier: 3, color: '#8B5CF6' },
  { id: 4, label: '25X', multiplier: 25, color: '#EC4899' },
  { id: 5, label: '2X', multiplier: 2, color: '#06B6D4' },
  { id: 6, label: '50X', multiplier: 50, color: '#F43F5E' },
  { id: 7, label: '4X', multiplier: 4, color: '#84CC16' },
  { id: 8, label: '👑 100X', multiplier: 100, color: '#EAB308', isJackpot: true },
  { id: 9, label: '6X', multiplier: 6, color: '#A855F7' },
  { id: 10, label: '15X', multiplier: 15, color: '#FB923C' },
  { id: 11, label: '⚡ 30X', multiplier: 30, color: '#14B8A6' },
];

export const NgipMegaWheel: React.FC<NgipMegaWheelProps> = ({ onBackToHub }) => {
  const { user, isNgip, logPlayerActivity, updateStats } = useAuth();
  const [basePoints, setBasePoints] = useState<number>(100);
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [lastWin, setLastWin] = useState<{
    segment: WheelSegment;
    pointsWon: number;
    multiplier: number;
  } | null>(null);
  const [spinHistory, setSpinHistory] = useState<
    { id: string; label: string; points: number; time: string }[]
  >([]);

  useMultiplayerArcadeRace('ngip_mega_wheel', lastWin?.pointsWon || 0, Boolean(lastWin));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw the Wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width / 2 - 16;
    const numSegments = SEGMENTS.length;
    const segmentAngle = (2 * Math.PI) / numSegments;

    ctx.clearRect(0, 0, width, height);

    // Draw Segments
    SEGMENTS.forEach((seg, i) => {
      const startAngle = i * segmentAngle;
      const endAngle = startAngle + segmentAngle;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();

      // Gradient Fill
      const grad = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, radius);
      grad.addColorStop(0, '#1E1B4B');
      grad.addColorStop(0.7, seg.color);
      grad.addColorStop(1, '#0F172A');
      ctx.fillStyle = grad;
      ctx.fill();

      // Segment Outline
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FCD34D';
      ctx.stroke();

      // Text Label
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(startAngle + segmentAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillText(seg.label, radius - 20, 6);
      ctx.restore();
    });

    // Outer rim lights
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 4, 0, 2 * Math.PI);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#F59E0B';
    ctx.stroke();

    // Center Hub
    ctx.beginPath();
    ctx.arc(centerX, centerY, 38, 0, 2 * Math.PI);
    ctx.fillStyle = '#1E1B4B';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FBBF24';
    ctx.stroke();

    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('งip 3X', centerX, centerY);
  }, []);

  const handleSpin = () => {
    if (isSpinning) return;

    setIsSpinning(true);
    setLastWin(null);
    soundManager.playCardPlay();

    // Pick random segment
    const chosenIndex = Math.floor(Math.random() * SEGMENTS.length);
    const chosenSegment = SEGMENTS[chosenIndex];

    const segmentDegrees = 360 / SEGMENTS.length;
    const targetSegmentOffset = chosenIndex * segmentDegrees + segmentDegrees / 2;
    const spins = 6 + Math.floor(Math.random() * 3);
    const targetRotation = wheelRotation + spins * 360 + (360 - (targetSegmentOffset % 360)) + 270;

    setWheelRotation(targetRotation);

    setTimeout(() => {
      setIsSpinning(false);
      const ngipMultiplier = isNgip ? 3 : 1;
      const totalMultiplier = chosenSegment.multiplier * ngipMultiplier;
      const pointsWon = basePoints * totalMultiplier;

      updateStats({ gamesPlayed: 1, wins: 1, totalScore: pointsWon }, true, 'VIP Mega Wheel');

      if (chosenSegment.isJackpot || chosenSegment.multiplier >= 25) {
        soundManager.playVictory();
      } else {
        soundManager.playCorrect();
      }

      setLastWin({
        segment: chosenSegment,
        pointsWon,
        multiplier: totalMultiplier,
      });

      setSpinHistory((prev) => [
        {
          id: 'spin_' + Date.now(),
          label: `${chosenSegment.label} (${totalMultiplier}x Total)`,
          points: pointsWon,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
        ...prev.slice(0, 9),
      ]);

      logPlayerActivity({
        type: 'match_win',
        title: `⚡ งip Mega Wheel: Won ${pointsWon.toLocaleString()} Points!`,
        description: `${user?.username || 'VIP Player'} hit ${chosenSegment.label} with the งip 3x Multiplier Boost!`,
        gameMode: 'งip Supreme Mega Wheel',
        pointsEarned: pointsWon,
      });
    }, 4500);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToHub}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-700 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Arcade</span>
        </button>

        <div className="flex items-center gap-2">
          <NgipBadge size="sm" />
          <span className="text-xs font-mono font-bold text-amber-300">
            {user?.stats?.totalScore?.toLocaleString() || 0} Total Points
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Center: Wheel Stage */}
        <div className="lg:col-span-7 bg-slate-950 border-2 border-amber-400/60 rounded-3xl p-6 flex flex-col items-center justify-center relative shadow-2xl shadow-amber-500/10 min-h-[480px]">
          {/* Pointer indicator */}
          <div className="absolute top-4 z-20 flex flex-col items-center">
            <div className="w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[24px] border-t-amber-400 drop-shadow-[0_4px_10px_rgba(245,158,11,0.8)]" />
          </div>

          <div className="relative">
            <canvas
              ref={canvasRef}
              width={380}
              height={380}
              className="rounded-full shadow-2xl transition-transform duration-[4500ms] ease-out"
              style={{
                transform: `rotate(${wheelRotation}deg)`,
              }}
            />
          </div>

          {/* Spin Trigger Button */}
          <div className="mt-6 w-full max-w-xs">
            <button
              onClick={handleSpin}
              disabled={isSpinning}
              className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-5 h-5" />
              <span>{isSpinning ? 'SPINNING WHEEL...' : 'SPIN VIP MEGA WHEEL 🚀'}</span>
            </button>
          </div>
        </div>

        {/* Right: Controls & Results */}
        <div className="lg:col-span-5 space-y-4">
          {/* Multiplier Info Box */}
          <div className="p-5 bg-gradient-to-br from-amber-500/20 via-purple-950/40 to-slate-900 rounded-3xl border border-amber-400/50 space-y-3">
            <div className="flex items-center gap-2 text-amber-300 font-black text-sm">
              <Crown className="w-5 h-5 text-amber-400" />
              <span>งip 3X Point Multiplier Active</span>
            </div>
            <p className="text-xs text-slate-300">
              As a VIP member, every multiplier value landed on the wheel is automatically multiplied by <strong>3X</strong> for your career score!
            </p>

            <div className="pt-1">
              <label className="text-[11px] font-bold text-slate-400 block uppercase mb-1">
                Base Challenge Stake (Points)
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[50, 100, 250, 500].map((pts) => (
                  <button
                    key={pts}
                    onClick={() => setBasePoints(pts)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      basePoints === pts
                        ? 'bg-amber-500 text-slate-950 font-black'
                        : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {pts} Pts
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Last Result Banner */}
          {lastWin && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-5 bg-emerald-950/80 border-2 border-emerald-500 rounded-3xl text-center space-y-2 shadow-xl shadow-emerald-500/20"
            >
              <div className="flex items-center justify-center gap-1.5 text-emerald-300 font-bold text-xs uppercase">
                <CheckCircle2 className="w-4 h-4" />
                <span>Jackpot Landed!</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white">
                +{lastWin.pointsWon.toLocaleString()} Points
              </div>
              <p className="text-xs text-emerald-300 font-bold">
                {lastWin.segment.label} × 3X งip Boost = {lastWin.multiplier}x Multiplier
              </p>
            </motion.div>
          )}

          {/* Recent Spins History */}
          <div className="p-4 bg-slate-950 rounded-3xl border border-slate-800 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Recent VIP Spins
            </div>
            {spinHistory.length === 0 ? (
              <p className="text-xs text-slate-600 py-3 text-center">No spins yet. Press spin to play!</p>
            ) : (
              <div className="space-y-1.5">
                {spinHistory.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                  >
                    <span className="font-bold text-amber-300">{s.label}</span>
                    <span className="font-mono font-bold text-emerald-400">
                      +{s.points.toLocaleString()} Pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

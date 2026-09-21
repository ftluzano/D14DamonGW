import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Terminal,
  Lock,
  Unlock,
  Sparkles,
  Zap,
  Volume2,
  VolumeX,
  Award,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { soundManager } from '../../utils/soundEffects';
import { NgipBadge } from '../NgipBadge';
import { useMultiplayerAutoStart } from '../../utils/useMultiplayerAutoStart';
import { useMultiplayerArcadeRace } from '../../utils/useMultiplayerArcadeRace';

interface NgipVaultHackerProps {
  onBackToHub: () => void;
}

interface VaultLevel {
  level: number;
  name: string;
  codeLength: number;
  timeLimit: number;
  pointsReward: number;
  themeColor: string;
}

const VAULT_LEVELS: VaultLevel[] = [
  { level: 1, name: 'Alpha Firewall Matrix', codeLength: 4, timeLimit: 30, pointsReward: 500, themeColor: '#3B82F6' },
  { level: 2, name: 'Quantum Core Cipher', codeLength: 5, timeLimit: 25, pointsReward: 1500, themeColor: '#8B5CF6' },
  { level: 3, name: 'Cyber Sub-Zero Node', codeLength: 6, timeLimit: 20, pointsReward: 4000, themeColor: '#EC4899' },
  { level: 4, name: 'Supreme งip Diamond Vault', codeLength: 7, timeLimit: 18, pointsReward: 12000, themeColor: '#EAB308' },
];

export const NgipVaultHacker: React.FC<NgipVaultHackerProps> = ({ onBackToHub }) => {
  const { user, isNgip, logPlayerActivity, updateStats } = useAuth();
  const [gameStage, setGameStage] = useState<'lobby' | 'hacking' | 'success' | 'failed'>('lobby');
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [targetCode, setTargetCode] = useState<string>('');
  const [currentGuess, setCurrentGuess] = useState<string>('');
  const [guessHistory, setGuessHistory] = useState<{ guess: string; exact: number; exists: number }[]>([]);
  const [timeLeft, setTimeLeft] = useState(30);
  const [totalPointsWon, setTotalPointsWon] = useState(0);

  const currentLevel = VAULT_LEVELS[currentLevelIdx];

  const generateRandomCode = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += Math.floor(Math.random() * 10).toString();
    }
    return result;
  };

  useEffect(() => {
    if (gameStage !== 'hacking') return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleHackFail();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameStage, currentLevelIdx]);

  const handleStartInfiltration = () => {
    setCurrentLevelIdx(0);
    setTotalPointsWon(0);
    startLevel(0);
  };

  useMultiplayerAutoStart(handleStartInfiltration);
  useMultiplayerArcadeRace('ngip_vault_hacker', totalPointsWon, gameStage === 'success' || gameStage === 'failed');

  const startLevel = (levelIdx: number) => {
    const lvl = VAULT_LEVELS[levelIdx];
    const newCode = generateRandomCode(lvl.codeLength);
    setTargetCode(newCode);
    setCurrentGuess('');
    setGuessHistory([]);
    setTimeLeft(lvl.timeLimit);
    setGameStage('hacking');
    soundManager.playCardPlay();
  };

  const handleKeypadPress = (digit: string) => {
    if (gameStage !== 'hacking' || currentGuess.length >= currentLevel.codeLength) return;
    soundManager.playTick();
    setCurrentGuess((prev) => prev + digit);
  };

  const handleBackspace = () => {
    if (gameStage !== 'hacking' || currentGuess.length === 0) return;
    soundManager.playTick();
    setCurrentGuess((prev) => prev.slice(0, -1));
  };

  const handleSubmitGuess = () => {
    if (gameStage !== 'hacking' || currentGuess.length !== currentLevel.codeLength) return;

    let exact = 0;
    let exists = 0;

    const targetArr = targetCode.split('');
    const guessArr = currentGuess.split('');

    const targetUsed = new Array(targetArr.length).fill(false);
    const guessUsed = new Array(guessArr.length).fill(false);

    // Exact matches
    for (let i = 0; i < guessArr.length; i++) {
      if (guessArr[i] === targetArr[i]) {
        exact++;
        targetUsed[i] = true;
        guessUsed[i] = true;
      }
    }

    // Number exists elsewhere
    for (let i = 0; i < guessArr.length; i++) {
      if (!guessUsed[i]) {
        for (let j = 0; j < targetArr.length; j++) {
          if (!targetUsed[j] && guessArr[i] === targetArr[j]) {
            exists++;
            targetUsed[j] = true;
            break;
          }
        }
      }
    }

    const newHistory = [{ guess: currentGuess, exact, exists }, ...guessHistory];
    setGuessHistory(newHistory);
    setCurrentGuess('');

    if (exact === currentLevel.codeLength) {
      // Level cracked
      const ngipBoost = isNgip ? 3 : 1;
      const points = currentLevel.pointsReward * ngipBoost;
      const accumulated = totalPointsWon + points;
      setTotalPointsWon(accumulated);

      soundManager.playVictory();

      if (currentLevelIdx < VAULT_LEVELS.length - 1) {
        setCurrentLevelIdx((prev) => prev + 1);
        startLevel(currentLevelIdx + 1);
      } else {
        setGameStage('success');
        updateStats({ gamesPlayed: 1, wins: 1, totalScore: accumulated }, true, 'Cyber Matrix Hacker');
        logPlayerActivity({
          type: 'match_win',
          title: `Cracked Supreme งip Vault Matrix (+${accumulated.toLocaleString()} Pts)!`,
          description: `${user?.username || 'VIP Hacker'} bypassed all 4 quantum firewalls with 3X งip boost!`,
          gameMode: 'Cyber Matrix Hacker',
          pointsEarned: accumulated,
        });
      }
    } else {
      soundManager.playWrong();
    }
  };

  const handleHackFail = () => {
    setGameStage('failed');
    soundManager.playWrong();
    if (totalPointsWon > 0) {
      updateStats({ gamesPlayed: 1, wins: 0, totalScore: totalPointsWon }, false, 'Cyber Matrix Hacker');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
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

      {gameStage === 'lobby' && (
        <div className="bg-slate-950 border-2 border-purple-500/60 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl text-center max-w-xl mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-purple-950 border-2 border-purple-400 flex items-center justify-center mx-auto text-purple-400 shadow-lg shadow-purple-500/20">
            <Terminal className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              Cyber Matrix Decryption Vault
            </h2>
            <p className="text-xs text-purple-300 mt-1">
              Bypass 4 secure node ciphers to unlock up to 36,000 career points!
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-left">
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold block uppercase">Rules</span>
              <p className="text-xs text-slate-200">
                Guess numerical codes (0-9). 🟢 indicates exact digit match, 🟡 indicates correct digit in wrong slot.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 space-y-1">
              <span className="text-[10px] text-amber-400 font-bold block uppercase">งip 3X Boost</span>
              <p className="text-xs text-amber-200">
                VIP members earn 3X points on every solved node tier!
              </p>
            </div>
          </div>

          <button
            onClick={handleStartInfiltration}
            className="w-full py-4 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-sm rounded-2xl shadow-xl shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
          >
            <Zap className="w-5 h-5" />
            <span>START MATRIX INFILTRATION</span>
          </button>
        </div>
      )}

      {gameStage === 'hacking' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Main Keypad & Terminal */}
          <div className="md:col-span-7 bg-slate-950 border-2 border-purple-500/60 rounded-3xl p-6 space-y-5 shadow-2xl">
            {/* Level & Timer Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-purple-400 block">
                  Node {currentLevel.level} of {VAULT_LEVELS.length}
                </span>
                <span className="text-sm font-black text-white">{currentLevel.name}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold">Timer:</span>
                <span className={`text-lg font-mono font-black ${timeLeft <= 8 ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`}>
                  {timeLeft}s
                </span>
              </div>
            </div>

            {/* Target Display Slots */}
            <div className="flex justify-center gap-2 py-4">
              {Array.from({ length: currentLevel.codeLength }).map((_, idx) => {
                const char = currentGuess[idx];
                return (
                  <div
                    key={idx}
                    className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center font-mono text-2xl font-black transition-all ${
                      char
                        ? 'border-purple-400 bg-purple-950/60 text-white'
                        : 'border-slate-800 bg-slate-900 text-slate-600'
                    }`}
                  >
                    {char || '•'}
                  </div>
                );
              })}
            </div>

            {/* Keypad Grid 0-9 */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleKeypadPress(digit)}
                  className="py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500 text-white font-mono font-bold text-lg rounded-2xl transition-all active:scale-95 cursor-pointer"
                >
                  {digit}
                </button>
              ))}

              <button
                onClick={handleBackspace}
                className="py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 font-bold text-xs rounded-2xl cursor-pointer"
              >
                DEL
              </button>

              <button
                onClick={() => handleKeypadPress('0')}
                className="py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500 text-white font-mono font-bold text-lg rounded-2xl transition-all active:scale-95 cursor-pointer"
              >
                0
              </button>

              <button
                onClick={handleSubmitGuess}
                disabled={currentGuess.length !== currentLevel.codeLength}
                className="py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-2xl disabled:opacity-40 cursor-pointer"
              >
                SUBMIT
              </button>
            </div>
          </div>

          {/* Right: Feedback & Cipher Log */}
          <div className="md:col-span-5 bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Cipher Scan Feedback
            </span>

            {guessHistory.length === 0 ? (
              <p className="text-xs text-slate-600 py-6 text-center">
                Enter your guess using the numeric keypad.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {guessHistory.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                  >
                    <span className="font-mono font-black text-white tracking-widest">{h.guess}</span>
                    <div className="flex items-center gap-3 font-mono font-bold">
                      <span className="text-emerald-400">🟢 {h.exact} Exact</span>
                      <span className="text-amber-400">🟡 {h.exists} Exists</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {(gameStage === 'success' || gameStage === 'failed') && (
        <div className="bg-slate-950 border-2 rounded-3xl p-8 text-center space-y-4 max-w-md mx-auto shadow-2xl animate-scaleUp">
          {gameStage === 'success' ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-950 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-400">
                <Unlock className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-white">ALL FIREWALLS BREACHED!</h2>
              <div className="text-3xl font-black text-emerald-400 font-mono">
                +{totalPointsWon.toLocaleString()} Points
              </div>
              <p className="text-xs text-slate-300">
                Master terminal bypassed! Points credited to career score.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-rose-950 border-2 border-rose-400 flex items-center justify-center mx-auto text-rose-400">
                <Lock className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-white">SYSTEM LOCKED OUT</h2>
              <p className="text-xs text-rose-300">
                Security protocols initiated. Signal lost.
              </p>
              {totalPointsWon > 0 && (
                <div className="text-sm font-bold text-amber-400">
                  Secured: +{totalPointsWon.toLocaleString()} Points
                </div>
              )}
            </>
          )}

          <button
            onClick={handleStartInfiltration}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
        </div>
      )}
    </div>
  );
};

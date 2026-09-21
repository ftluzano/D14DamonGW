import React from 'react';
import { X, Trophy } from 'lucide-react';
import { ChatProfile } from '../types';
import { AvatarRenderer } from './AvatarRenderer';
import { NgipBadge, NgipName } from './NgipBadge';

export const PublicProfileModal: React.FC<{
  profile: ChatProfile | null;
  onClose: () => void;
}> = ({ profile, onClose }) => {
  if (!profile) return null;

  const gamesPlayed = Math.max(profile.stats.gamesPlayed || 0, profile.stats.wins || 0);
  const losses = typeof profile.stats.losses === 'number'
    ? profile.stats.losses
    : Math.max(0, gamesPlayed - (profile.stats.wins || 0));
  const winRate = gamesPlayed > 0 ? Math.round(((profile.stats.wins || 0) / gamesPlayed) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <section
        className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${profile.username} profile`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-indigo-400 bg-slate-100 dark:bg-slate-800">
              <AvatarRenderer avatar={profile.avatar} className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <NgipName name={profile.username} isNgip={Boolean(profile.isNgip)} className="truncate text-base font-black text-slate-900 dark:text-white" />
                {profile.isNgip && <NgipBadge size="xs" />}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Public player profile</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Close profile">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-indigo-50 p-3 dark:bg-indigo-950/40">
            <p className="text-[10px] font-bold uppercase text-indigo-500">Win rate</p>
            <p className="mt-1 text-2xl font-black text-indigo-700 dark:text-indigo-300">{winRate}%</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3 dark:bg-amber-950/40">
            <p className="text-[10px] font-bold uppercase text-amber-500">Wins</p>
            <p className="mt-1 text-2xl font-black text-amber-700 dark:text-amber-300">{profile.stats.wins || 0}</p>
          </div>
          <div className="rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase text-slate-500">Games</p>
            <p className="mt-1 text-xl font-black text-slate-800 dark:text-slate-100">{gamesPlayed}</p>
          </div>
          <div className="rounded-2xl bg-rose-50 p-3 dark:bg-rose-950/40">
            <p className="text-[10px] font-bold uppercase text-rose-500">Losses</p>
            <p className="mt-1 text-xl font-black text-rose-700 dark:text-rose-300">{losses}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 p-3 text-xs dark:border-slate-800">
          <Trophy className="h-4 w-4 text-amber-500" />
          <span className="font-bold text-slate-600 dark:text-slate-300">Total score</span>
          <span className="ml-auto font-black text-slate-900 dark:text-white">{profile.stats.totalScore || 0}</span>
        </div>
      </section>
    </div>
  );
};

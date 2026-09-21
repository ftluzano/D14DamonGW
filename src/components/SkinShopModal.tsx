import React, { useEffect, useState } from 'react';
import { Check, Coins, Palette, ShoppingBag, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ArcadeGameMode, GameSkinId } from '../types';
import { formatCompactCurrency } from '../utils/currencyUtils';

interface SkinShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SKINS: Array<{ id: GameSkinId; name: string; mode: ArcadeGameMode; preview: string }> = [
  { id: 'classic', name: 'Classic', mode: 'uno_party', preview: 'from-slate-500 to-slate-800' },
  { id: 'uno_neon', name: 'UNO Neon', mode: 'uno_party', preview: 'from-rose-500 via-amber-400 to-cyan-400' },
  { id: 'cyber_gold', name: 'Cyber Gold', mode: 'cyber_typing', preview: 'from-amber-300 via-orange-500 to-slate-950' },
];

const DURATIONS = [
  { days: 7 as const, price: 5000 },
  { days: 15 as const, price: 10000 },
  { days: 30 as const, price: 15000 },
];

export const SkinShopModal: React.FC<SkinShopModalProps> = ({ isOpen, onClose }) => {
  const { user, purchaseOrEquipSkin } = useAuth();
  const [message, setMessage] = useState('');
  const [, refreshExpiry] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setInterval(() => refreshExpiry(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-500/15 p-2 text-amber-300"><ShoppingBag className="h-5 w-5" /></div>
            <div><h2 className="font-black">Arcade Skin Shop</h2></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white" title="Close shop"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-sky-200"><Coins className="h-4 w-4" /> Points balance</span>
          <strong className="text-sky-300">{formatCompactCurrency(user.stats.totalScore)}</strong>
        </div>

        {message && <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-center text-xs font-bold text-emerald-300">{message}</p>}

        <div className="mt-4 space-y-5">
          {(['uno_party', 'cyber_typing'] as ArcadeGameMode[]).map((mode) => (
            <section key={mode} className="space-y-2">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                  {mode === 'uno_party' ? 'UNO Party' : 'Cyber Typing'} Skins
                </h3>
                <span className="text-[10px] text-slate-500">Game collection</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
          {SKINS.filter((skin) => skin.mode === mode).map((skin) => {
            const expiry = user.cosmetics?.ownedUntil?.[skin.id];
            const owned = skin.id === 'classic' || Boolean(user.cosmetics?.owned.includes(skin.id) && expiry && expiry > Date.now());
            const equipped = user.cosmetics?.equipped[skin.mode] === skin.id;
            return (
              <div key={skin.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                <div className={`h-20 bg-gradient-to-br ${skin.preview} p-3`}><Palette className="h-5 w-5 text-white/80" /></div>
                <div className="space-y-2 p-3">
                  <div><h3 className="text-sm font-black">{skin.name}</h3></div>
                  {equipped ? <div className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-black text-emerald-300"><Check className="h-3.5 w-3.5" /> Equipped</div> : owned ? (
                    <button type="button" onClick={() => { purchaseOrEquipSkin(skin.mode, skin.id); setMessage(`${skin.name} equipped.`); }} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-xs font-black text-white hover:bg-slate-700">Equip</button>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      {DURATIONS.map((duration) => (
                        <button key={duration.days} type="button" onClick={() => { const success = purchaseOrEquipSkin(skin.mode, skin.id, duration.days); setMessage(success ? `${skin.name} purchased for ${duration.days} days.` : 'Not enough points for this purchase.'); }} className="rounded-lg bg-slate-800 px-1 py-2 text-[10px] font-black text-white hover:bg-slate-700">
                          {formatCompactCurrency(duration.price)}<span className="block text-slate-400">{duration.days} days</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {expiry && owned && skin.id !== 'classic' && <p className="text-center text-[10px] text-slate-500">Expires {new Date(expiry).toLocaleDateString()}</p>}
                </div>
              </div>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

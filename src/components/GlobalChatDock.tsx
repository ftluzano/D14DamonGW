import React, { useEffect, useRef, useState } from 'react';
import { Globe2, MessageCircle, Send, Users, X } from 'lucide-react';
import { ChatMessage, ChatProfile } from '../types';
import { useGame } from '../context/GameContext';
import { useAuth } from '../context/AuthContext';
import { AvatarRenderer } from './AvatarRenderer';
import { PublicProfileModal } from './PublicProfileModal';

const MessageList: React.FC<{
  messages: ChatMessage[];
  onProfile: (profile: ChatProfile | null) => void;
}> = ({ messages, onProfile }) => {
  const { user } = useAuth();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return <div className="flex h-full items-center justify-center px-5 text-center text-xs text-slate-400">No messages yet.</div>;
  }

  return (
    <div className="space-y-2 overflow-y-auto px-3 py-3">
      {messages.map((message) => {
        const isMe = message.senderId === user?.id;
        return (
          <div key={message.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
            <button
              type="button"
              className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
              onClick={() => onProfile(message.profile || null)}
              title={`View ${message.senderName}'s profile`}
            >
              <AvatarRenderer avatar={message.senderAvatar || '1'} className="h-full w-full object-cover" />
            </button>
            <div className={`max-w-[78%] ${isMe ? 'text-right' : ''}`}>
              <button type="button" onClick={() => onProfile(message.profile || null)} className="px-1 text-[10px] font-bold text-slate-500 hover:text-indigo-500 dark:text-slate-400">
                {isMe ? 'You' : message.senderName}
              </button>
              <div className={`rounded-2xl px-3 py-1.5 text-xs ${isMe ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
                {message.text}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

export const GlobalChatDock: React.FC = () => {
  const { user } = useAuth();
  const { gameState, messages, globalMessages, sendMessage, sendGlobalMessage } = useGame();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'room' | 'global'>('global');
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState<ChatProfile | null>(null);

  const activeMessages = tab === 'room' ? messages : globalMessages;
  const send = tab === 'room' ? sendMessage : sendGlobalMessage;

  useEffect(() => {
    setProfile((current) => {
      if (!current) return null;
      const latest = [...messages, ...globalMessages].find((message) => message.senderId === current.id)?.profile;
      return latest || current;
    });
  }, [messages, globalMessages]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !input.trim()) return;
    send(input.trim());
    setInput('');
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 w-[min( calc(100vw-2rem),360px)]">
        {isOpen && (
          <div className="gw-surface mb-2 flex h-[min(70vh,430px)] flex-col overflow-hidden rounded-3xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white"><MessageCircle className="h-4 w-4 text-indigo-500" /> Live chat</div>
              <button type="button" onClick={() => setIsOpen(false)} className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Close chat"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 border-b border-slate-200 p-1 dark:border-slate-800">
              <button type="button" onClick={() => setTab('room')} disabled={!gameState} className={`rounded-xl px-2 py-1.5 text-xs font-bold ${tab === 'room' ? 'bg-indigo-600 text-white' : 'text-slate-500'} disabled:opacity-40`}><Users className="mr-1 inline h-3.5 w-3.5" />Room</button>
              <button type="button" onClick={() => setTab('global')} className={`rounded-xl px-2 py-1.5 text-xs font-bold ${tab === 'global' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><Globe2 className="mr-1 inline h-3.5 w-3.5" />Global</button>
            </div>
            <div className="min-h-0 flex-1"><MessageList messages={activeMessages} onProfile={setProfile} /></div>
            <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 p-2 dark:border-slate-800">
              <input value={input} onChange={(event) => setInput(event.target.value)} disabled={!user} placeholder={user ? `Message ${tab}...` : 'Sign in to chat'} className="min-w-0 flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:text-white" />
              <button type="submit" disabled={!user || !input.trim()} className="rounded-xl bg-indigo-600 p-2 text-white disabled:opacity-40" title="Send message"><Send className="h-4 w-4" /></button>
            </form>
          </div>
        )}
        <button type="button" onClick={() => setIsOpen((open) => !open)} className="ml-auto flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black text-white shadow-lg shadow-cyan-500/20 transition-transform hover:-translate-y-0.5 dark:bg-cyan-300 dark:text-slate-950" title="Open live chat">
          <MessageCircle className="h-4 w-4" /> Chat <span className="rounded-full bg-white/20 px-1.5 py-0.5">{globalMessages.length + messages.length}</span>
        </button>
      </div>
      <PublicProfileModal profile={profile} onClose={() => setProfile(null)} />
    </>
  );
};

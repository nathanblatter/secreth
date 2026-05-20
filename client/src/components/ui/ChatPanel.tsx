import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '../../../../shared/src/types/game';

interface ChatToggleProps {
  open: boolean;
  onToggle: () => void;
  unreadCount: number;
}

export function ChatToggle({ open, onToggle, unreadCount }: ChatToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        relative px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-sans font-bold uppercase tracking-[0.12em]
        border transition-all cursor-pointer leading-none
        ${open
          ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
          : 'bg-stone-900/70 text-stone-500 border-stone-700/40 hover:text-stone-300'
        }
      `}
    >
      {open ? 'Hide Chat' : 'Chat'}
      {!open && unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-amber-600 text-white rounded-full text-[8px] font-bold min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

interface ChatPanelProps {
  open: boolean;
  messages: ChatMessage[];
  myPlayerId: string | null;
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

export function ChatPanel({ open, messages, myPlayerId, onSendMessage, disabled }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div className="rounded-lg bg-stone-950/80 border border-stone-800/50 mx-1 sm:mx-0 mb-1.5 flex flex-col">
            {/* Message list */}
            <div className="max-h-[28vh] overflow-y-auto scrollbar-hide px-3 py-2 flex flex-col gap-1">
              {messages.length === 0 && (
                <p className="text-[11px] font-sans text-stone-600 italic text-center py-2">
                  No messages yet
                </p>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex items-start gap-1.5 ${msg.playerId === myPlayerId ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex-1 min-w-0 ${msg.playerId === myPlayerId ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`flex items-center gap-1 mb-0.5 ${msg.playerId === myPlayerId ? 'flex-row-reverse' : ''}`}>
                      <span className={`text-[9px] font-sans font-bold uppercase tracking-wide ${
                        msg.isAI ? 'text-amber-500/80' : 'text-stone-400/70'
                      }`}>
                        {msg.playerName}
                        {msg.isAI && <span className="ml-1 text-amber-600/60">[AI]</span>}
                      </span>
                      <span className="text-[9px] font-sans text-stone-700">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <p className={`text-[11px] font-sans text-stone-300 leading-[1.5] break-words max-w-[90%] rounded px-2 py-0.5 ${
                      msg.playerId === myPlayerId
                        ? 'bg-amber-950/30 text-amber-100/80 self-end'
                        : msg.isAI
                          ? 'bg-stone-800/40'
                          : 'bg-stone-900/40'
                    }`}>
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {!disabled && (
              <div className="flex items-center gap-1.5 border-t border-stone-800/40 px-2 py-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 200))}
                  onKeyDown={handleKeyDown}
                  placeholder="Say something..."
                  className="flex-1 bg-transparent text-[11px] font-sans text-stone-300 placeholder-stone-600 outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="text-[10px] font-sans font-bold uppercase tracking-wide text-amber-600 hover:text-amber-400 disabled:text-stone-700 transition-colors"
                >
                  Send
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

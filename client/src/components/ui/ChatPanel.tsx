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

/** Render message text, highlighting @Name mentions in amber. */
function MessageText({ text, knownNames }: { text: string; knownNames: string[] }) {
  if (knownNames.length === 0) return <>{text}</>;
  // Build a regex that matches @Name for any known name (case-insensitive)
  const pattern = new RegExp(
    `(@(?:${knownNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'gi'
  );
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <span key={i} className="text-amber-400 font-semibold">{part}</span>
        ) : (
          part
        )
      )}
    </>
  );
}

interface ChatPanelProps {
  open: boolean;
  messages: ChatMessage[];
  myPlayerId: string | null;
  onSendMessage: (text: string) => void;
  disabled?: boolean;
  players?: { id: string; name: string; isAI?: boolean }[];
}

export function ChatPanel({ open, messages, myPlayerId, onSendMessage, disabled, players = [] }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const aiPlayers = players.filter(p => p.isAI);
  const knownNames = players.map(p => p.name);

  // Compute autocomplete suggestions from mentionQuery
  const suggestions = mentionQuery !== null
    ? aiPlayers.filter(p => p.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightIndex(0);
  }, [suggestions.length]);

  const completeMention = (name: string) => {
    const before = input.slice(0, mentionStart);
    const after = input.slice(inputRef.current?.selectionStart ?? input.length);
    const newVal = `${before}@${name} ${after}`;
    setInput(newVal.slice(0, 200));
    setMentionQuery(null);
    setTimeout(() => {
      const pos = (before + `@${name} `).length;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    }, 0);
  };

  const handleChange = (value: string) => {
    setInput(value.slice(0, 200));
    // Detect @mention at cursor
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const textBefore = value.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionStart(cursor - atMatch[0].length);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setInput('');
    setMentionQuery(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex(i => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex(i => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        completeMention(suggestions[highlightIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }
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
                  No messages yet. Type @Name to mention an AI player.
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
                      <MessageText text={msg.text} knownNames={knownNames} />
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {!disabled && (
              <div className="relative border-t border-stone-800/40">
                {/* @mention autocomplete dropdown */}
                {suggestions.length > 0 && (
                  <div className="absolute bottom-full left-2 mb-1 bg-stone-900 border border-stone-700/60 rounded-md overflow-hidden shadow-lg z-10">
                    {suggestions.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); completeMention(p.name); }}
                        className={`block w-full text-left px-3 py-1.5 text-[11px] font-sans transition-colors ${
                          i === highlightIndex
                            ? 'bg-amber-900/40 text-amber-300'
                            : 'text-stone-300 hover:bg-stone-800/60'
                        }`}
                      >
                        <span className="text-amber-500">@</span>{p.name}
                        <span className="ml-1.5 text-[9px] text-stone-600">[AI]</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Say something... (@ to mention an AI)"
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
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

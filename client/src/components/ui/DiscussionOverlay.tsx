import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Player } from '../../../../shared/src/types/game';
import * as emitters from '../../lib/socketEmitters';

interface Props {
  players: Player[];
  readyVotes: string[];
  myPlayerId: string | null;
  onReady: () => void;
}

export function DiscussionOverlay({ players, readyVotes, myPlayerId, onReady }: Props) {
  const [loading, setLoading] = useState(false);
  const alive = players.filter(p => p.status === 'alive');
  const threshold = Math.floor(alive.length / 2) + 1;
  const iHaveVoted = myPlayerId ? readyVotes.includes(myPlayerId) : false;

  const handleReady = async () => {
    if (iHaveVoted || loading) return;
    setLoading(true);
    await emitters.castReady();
    setLoading(false);
    onReady();
  };

  return (
    <AnimatePresence>
      <motion.div
        key="discussion-overlay"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md mx-auto"
      >
        <div className="rounded-lg bg-stone-950/90 border border-stone-800/60 px-4 py-4 flex flex-col gap-3">
          {/* Header */}
          <div className="text-center">
            <p className="text-[10px] font-sans uppercase tracking-[0.25em] text-stone-500 mb-1">
              Discussion
            </p>
            <p className="text-sm font-display font-bold text-parchment-100">
              Ready to continue?
            </p>
            <p className="text-[10px] font-sans text-stone-600 mt-0.5">
              {readyVotes.length} / {threshold} needed
            </p>
          </div>

          {/* Player ready list */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {alive.map(p => {
              const isReady = readyVotes.includes(p.id);
              const isMe = p.id === myPlayerId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-sans font-semibold transition-colors ${
                    isReady
                      ? 'bg-green-900/50 border border-green-700/50 text-green-400'
                      : 'bg-stone-900/60 border border-stone-700/40 text-stone-500'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isReady ? 'bg-green-500' : 'bg-stone-600'}`} />
                  {p.name}{isMe ? ' (you)' : ''}{p.isAI ? ' [AI]' : ''}
                </div>
              );
            })}
          </div>

          {/* Ready button */}
          <button
            type="button"
            onClick={handleReady}
            disabled={iHaveVoted || loading}
            className={`w-full rounded-md py-2 text-sm font-display font-bold tracking-wider transition-all ${
              iHaveVoted
                ? 'bg-green-900/40 border border-green-700/40 text-green-500 cursor-default'
                : 'bg-amber-900/60 border border-amber-700/50 text-amber-300 hover:bg-amber-800/60 hover:text-amber-200 active:scale-95'
            }`}
          >
            {iHaveVoted ? 'Ready ✓' : loading ? '...' : 'Ready to Continue'}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

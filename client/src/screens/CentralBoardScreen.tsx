import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/useGameStore';
import type { ChatMessage } from '../../../shared/src/types/game';
import { unlockAudio } from '../hooks/useAudioQueue';
import { GameLogPanel } from '../components/ui/GameLog';
import {
  getFascistBoardKey,
  FASCIST_BOARD_POWERS,
} from '../../../shared/src/utils/constants';

const PHASE_LABELS: Record<string, string> = {
  'role-reveal': 'Roles Revealed',
  'election-nominate': 'Nominating Chancellor',
  'election-vote': 'Voting',
  'election-result': 'Vote Result',
  'legislative-president': 'President Reviewing Policies',
  'legislative-chancellor': 'Chancellor Enacting Policy',
  'executive-action': 'Executive Action',
  'game-over': 'Game Over',
};

const POWER_LABELS: Record<string, string> = {
  'policy-peek': 'Policy Peek',
  'investigate-loyalty': 'Investigate Loyalty',
  'special-election': 'Special Election',
  'execution': 'Execution',
};

const POWER_DESCRIPTIONS: Record<string, string> = {
  'policy-peek': 'Examine top 3 cards',
  'investigate-loyalty': 'Investigate a player',
  'special-election': 'Pick next President',
  'execution': 'Execute a player',
};

/* ── Fascist Board Slot ── */
function FascistSlot({
  index,
  filled,
  isNew,
  power,
  isVetoSlot,
  isHitlerZone,
}: {
  index: number;
  filled: boolean;
  isNew: boolean;
  power: string | null;
  isVetoSlot: boolean;
  isHitlerZone: boolean;
}) {
  return (
    <div className="flex flex-col items-center" style={{ gap: '6px' }}>
      {/* Power plaque */}
      {power ? (
        <div className="flex flex-col items-center justify-end" style={{ height: 52, minWidth: 90 }}>
          <div
            className="text-center px-2 py-1 rounded"
            style={{
              background: 'linear-gradient(180deg, rgba(139,0,0,0.3) 0%, rgba(60,0,0,0.2) 100%)',
              border: '1px solid rgba(220,38,38,0.2)',
            }}
          >
            <span className="block text-red-300/90 font-display font-bold tracking-wide" style={{ fontSize: 11 }}>
              {POWER_LABELS[power]}
            </span>
            <span className="block text-red-400/50 font-body" style={{ fontSize: 9, marginTop: 1 }}>
              {POWER_DESCRIPTIONS[power]}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ height: 52 }} />
      )}

      {/* The slot */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 72,
          height: 100,
          borderRadius: 8,
          border: filled ? 'none' : '2px dashed rgba(220,38,38,0.15)',
          background: filled ? 'none' : 'rgba(0,0,0,0.3)',
        }}
      >
        <AnimatePresence>
          {filled && (
            <motion.div
              initial={isNew ? { y: -40, opacity: 0, scale: 0.6, rotateX: 30 } : false}
              animate={{ y: 0, opacity: 1, scale: 1, rotateX: 0 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18 }}
              className="absolute inset-0 flex items-center justify-center"
              style={{
                borderRadius: 8,
                background: 'linear-gradient(145deg, #b71c1c 0%, #7f0000 50%, #4a0000 100%)',
                border: '2px solid rgba(220,38,38,0.6)',
                boxShadow: '0 0 20px rgba(220,38,38,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
              }}
            >
              <span className="text-white/90 font-display font-black" style={{ fontSize: 28 }}>F</span>
            </motion.div>
          )}
        </AnimatePresence>
        {!filled && power && (
          <span className="text-red-500/20 font-display font-bold" style={{ fontSize: 20 }}>
            {index + 1}
          </span>
        )}
        {!filled && !power && (
          <span className="text-red-500/10 font-display font-bold" style={{ fontSize: 20 }}>
            {index + 1}
          </span>
        )}
      </div>

      {/* Annotations below */}
      <div style={{ height: 18 }} className="flex items-start justify-center">
        {isHitlerZone && (
          <span
            className="font-sans font-bold uppercase"
            style={{
              fontSize: 8,
              letterSpacing: '0.15em',
              color: 'rgba(248,113,113,0.7)',
              textShadow: '0 0 8px rgba(220,38,38,0.3)',
            }}
          >
            Hitler Zone
          </span>
        )}
        {isVetoSlot && (
          <span
            className="font-sans font-bold uppercase"
            style={{
              fontSize: 8,
              letterSpacing: '0.15em',
              color: 'rgba(251,191,36,0.7)',
              textShadow: '0 0 8px rgba(251,191,36,0.2)',
            }}
          >
            Veto Power
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Liberal Board Slot ── */
function LiberalSlot({
  index,
  filled,
  isNew,
}: {
  index: number;
  filled: boolean;
  isNew: boolean;
}) {
  return (
    <div className="flex flex-col items-center" style={{ gap: '6px' }}>
      <div style={{ height: 52 }} />
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 72,
          height: 100,
          borderRadius: 8,
          border: filled ? 'none' : '2px dashed rgba(59,130,246,0.15)',
          background: filled ? 'none' : 'rgba(0,0,0,0.3)',
        }}
      >
        <AnimatePresence>
          {filled && (
            <motion.div
              initial={isNew ? { y: -40, opacity: 0, scale: 0.6, rotateX: 30 } : false}
              animate={{ y: 0, opacity: 1, scale: 1, rotateX: 0 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18 }}
              className="absolute inset-0 flex items-center justify-center"
              style={{
                borderRadius: 8,
                background: 'linear-gradient(145deg, #1d4ed8 0%, #1e3a8a 50%, #172554 100%)',
                border: '2px solid rgba(59,130,246,0.6)',
                boxShadow: '0 0 20px rgba(59,130,246,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
              }}
            >
              <span className="text-white/90 font-display font-black" style={{ fontSize: 28 }}>L</span>
            </motion.div>
          )}
        </AnimatePresence>
        {!filled && (
          <span className="text-blue-500/10 font-display font-bold" style={{ fontSize: 20 }}>
            {index + 1}
          </span>
        )}
      </div>
      <div style={{ height: 18 }} />
    </div>
  );
}

/* ── Player Chip ── */
function PlayerChip({
  name,
  isPresident,
  isChancellor,
  isDead,
}: {
  name: string;
  isPresident: boolean;
  isChancellor: boolean;
  isDead: boolean;
}) {
  const roleLabel = isPresident ? 'President' : isChancellor ? 'Chancellor' : null;

  return (
    <motion.div
      layout
      className="flex items-center gap-3 rounded-lg"
      style={{
        padding: '12px 24px',
        background: isDead
          ? 'rgba(24,24,27,0.5)'
          : isPresident
            ? 'linear-gradient(135deg, rgba(120,53,15,0.4) 0%, rgba(69,26,3,0.3) 100%)'
            : isChancellor
              ? 'linear-gradient(135deg, rgba(41,37,36,0.5) 0%, rgba(28,25,23,0.4) 100%)'
              : 'rgba(24,24,27,0.3)',
        border: isDead
          ? '1px solid rgba(63,63,70,0.3)'
          : isPresident
            ? '1px solid rgba(217,119,6,0.4)'
            : isChancellor
              ? '1px solid rgba(168,162,158,0.3)'
              : '1px solid rgba(63,63,70,0.2)',
        opacity: isDead ? 0.5 : 1,
      }}
    >
      {roleLabel && (
        <span
          className="font-sans font-bold uppercase"
          style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: isPresident ? 'rgba(217,119,6,0.8)' : 'rgba(168,162,158,0.7)',
          }}
        >
          {roleLabel}
        </span>
      )}
      {isDead && <span style={{ fontSize: 16 }}>&#x2620;</span>}
      <span
        className="font-display font-bold"
        style={{
          fontSize: 22,
          color: isDead
            ? 'rgba(113,113,122,0.6)'
            : isPresident
              ? '#fbbf24'
              : 'rgba(240,234,212,0.9)',
          textDecoration: isDead ? 'line-through' : 'none',
        }}
      >
        {name}
      </span>
    </motion.div>
  );
}

/* ── Chat Feed Overlay ── */
function ChatFeed({ messages }: { messages: ChatMessage[] }) {
  const last5 = messages.slice(-5);
  if (last5.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 w-72 z-40 pointer-events-none">
      <AnimatePresence>
        {last5.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="mb-1.5 rounded-lg px-3 py-2"
            style={{
              background: 'rgba(9,9,11,0.85)',
              border: '1px solid rgba(63,63,70,0.3)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <span
              className="font-sans font-bold text-[10px] mr-1.5"
              style={{ color: msg.isAI ? 'rgba(251,191,36,0.8)' : 'rgba(161,161,170,0.7)' }}
            >
              {msg.playerName}
              {msg.isAI && <span style={{ color: 'rgba(180,130,20,0.6)', marginLeft: 3 }}>[AI]</span>}
            </span>
            <span className="font-sans text-[11px] text-stone-300">{msg.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Screen ── */
export default function CentralBoardScreen() {
  const gameState = useGameStore((s) => s.gameState);
  const chatLog = useGameStore((s) => s.chatLog);
  const [logOpen, setLogOpen] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-propaganda">
        <p className="text-stone-400 font-display text-2xl">Connecting to game...</p>
      </div>
    );
  }

  const presidentName =
    gameState.players.find((p) => p.id === gameState.currentPresidentId)?.name ?? null;
  const chancellorName =
    gameState.players.find((p) => p.id === gameState.nominatedChancellorId)?.name ?? null;

  const boardKey = getFascistBoardKey(gameState.players.length);
  const powers = FASCIST_BOARD_POWERS[boardKey];
  const alivePlayers = gameState.players.filter((p) => p.status === 'alive');

  return (
    <div
      className="relative h-screen flex flex-col overflow-hidden"
      style={{
        background: `
          radial-gradient(ellipse at 20% 0%, rgba(139,0,0,0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 100%, rgba(30,64,175,0.05) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, #0f0f11 0%, #09090b 100%)
        `,
      }}
    >
      {/* ── Audio unlock prompt ── */}
      {!audioUnlocked && (
        <div className="absolute top-3 right-3 z-50">
          <button
            type="button"
            onClick={() => { unlockAudio(); setAudioUnlocked(true); }}
            className="bg-stone-900/90 border border-amber-800/40 rounded px-3 py-1.5 text-xs font-sans text-amber-500 hover:text-amber-400 hover:border-amber-600 transition-colors"
          >
            🔊 Enable narration
          </button>
        </div>
      )}

      {/* ── Header: Government + Phase ── */}
      <header className="flex flex-col items-center" style={{ paddingTop: 24, paddingBottom: 4 }}>
        {/* Government names */}
        <div
          className="flex items-center rounded-lg"
          style={{
            gap: 40,
            padding: '14px 48px',
            background: 'rgba(15,15,17,0.8)',
            border: '1px solid rgba(184,134,11,0.15)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          <GovernmentNameSlot title="President" name={presidentName} accent="#d97706" />
          <div style={{ width: 1, height: 28, background: 'rgba(184,134,11,0.2)' }} />
          <GovernmentNameSlot title="Chancellor" name={chancellorName} accent="#a8a29e" />
        </div>

        {/* Phase label */}
        <div style={{ marginTop: 12 }}>
          <span
            className="font-sans uppercase"
            style={{
              fontSize: 14,
              letterSpacing: '0.45em',
              color: 'rgba(184,134,11,0.6)',
              fontWeight: 500,
            }}
          >
            {PHASE_LABELS[gameState.phase] ?? gameState.phase}
          </span>
        </div>
      </header>

      {/* ── Decorative rule ── */}
      <div className="deco-rule mx-auto" style={{ width: '60%', marginTop: 4, marginBottom: 4 }} />

      {/* ── Board Area ── */}
      <main className="flex-1 flex flex-col items-center justify-center" style={{ paddingBottom: 8 }}>
        <div className="origin-center" style={{ transform: 'scale(1.35)' }}>
        <div className="flex flex-col items-center" style={{ gap: 20 }}>
        <div className="flex items-start justify-center" style={{ gap: 28 }}>
          {/* ── Liberal Board ── */}
          <div
            className="liberal-board relative"
            style={{ borderRadius: 12, padding: '16px 24px 20px' }}
          >
            {/* Board header */}
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <span
                className="font-display font-black uppercase"
                style={{
                  fontSize: 16,
                  letterSpacing: '0.15em',
                  color: 'rgba(147,197,253,0.9)',
                }}
              >
                Liberal
              </span>
              <span
                className="font-sans font-bold"
                style={{ fontSize: 13, color: 'rgba(96,165,250,0.4)' }}
              >
                {gameState.policyTrack.liberal} / 5
              </span>
            </div>

            {/* Slots */}
            <div className="flex justify-center" style={{ gap: 10 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <LiberalSlot
                  key={i}
                  index={i}
                  filled={i < gameState.policyTrack.liberal}
                  isNew={i === gameState.policyTrack.liberal - 1}
                />
              ))}
            </div>

            {/* Liberal win condition */}
            <div className="text-center" style={{ marginTop: 10 }}>
              <span className="font-body italic" style={{ fontSize: 10, color: 'rgba(147,197,253,0.35)' }}>
                Liberals win with 5 Liberal policies enacted
              </span>
            </div>
          </div>

          {/* ── Fascist Board ── */}
          <div
            className="fascist-board relative"
            style={{ borderRadius: 12, padding: '16px 24px 20px' }}
          >
            {/* Board header */}
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <span
                className="font-display font-black uppercase"
                style={{
                  fontSize: 16,
                  letterSpacing: '0.15em',
                  color: 'rgba(252,165,165,0.9)',
                }}
              >
                Fascist
              </span>
              <span
                className="font-sans font-bold"
                style={{ fontSize: 13, color: 'rgba(248,113,113,0.4)' }}
              >
                {gameState.policyTrack.fascist} / 6
              </span>
            </div>

            {/* Slots */}
            <div className="flex justify-center" style={{ gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => {
                const power = powers[i];
                return (
                  <FascistSlot
                    key={i}
                    index={i}
                    filled={i < gameState.policyTrack.fascist}
                    isNew={i === gameState.policyTrack.fascist - 1}
                    power={power}
                    isVetoSlot={i === 4}
                    isHitlerZone={i === 2}
                  />
                );
              })}
            </div>

            {/* Fascist win warning */}
            <div
              className="text-center"
              style={{
                marginTop: 10,
                padding: '4px 12px',
                background: 'rgba(139,0,0,0.15)',
                borderRadius: 4,
                border: '1px solid rgba(220,38,38,0.1)',
              }}
            >
              <span
                className="font-sans uppercase font-bold"
                style={{
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  color: 'rgba(252,165,165,0.5)',
                }}
              >
                Fascists win if Hitler is elected Chancellor after 3 fascist policies
              </span>
            </div>
          </div>
        </div>

        {/* ── Election Tracker + Piles (inline, custom for TV) ── */}
        <div
          className="flex items-center justify-center"
          style={{
            gap: 32,
            padding: '10px 32px',
            background: 'rgba(15,15,17,0.6)',
            borderRadius: 10,
            border: '1px solid rgba(63,63,70,0.2)',
          }}
        >
          {/* Election Tracker */}
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              className="font-sans font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(161,161,170,0.5)' }}
            >
              Election Tracker
            </span>
            <div className="flex" style={{ gap: 6 }}>
              {[0, 1, 2].map((i) => {
                const filled = i < gameState.electionTracker;
                const isWarning = gameState.electionTracker === 2 && filled;
                return (
                  <motion.div
                    key={i}
                    animate={
                      isWarning
                        ? {
                            boxShadow: [
                              '0 0 0px rgba(220,38,38,0)',
                              '0 0 12px rgba(220,38,38,0.6)',
                              '0 0 0px rgba(220,38,38,0)',
                            ],
                          }
                        : {}
                    }
                    transition={isWarning ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : {}}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: `2px solid ${filled ? 'rgba(220,38,38,0.7)' : 'rgba(63,63,70,0.4)'}`,
                      background: filled
                        ? 'radial-gradient(circle at 40% 35%, #dc2626 0%, #7f1d1d 100%)'
                        : 'rgba(9,9,11,0.6)',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div style={{ width: 1, height: 20, background: 'rgba(63,63,70,0.3)' }} />

          {/* Draw pile */}
          <div className="flex items-center" style={{ gap: 8 }}>
            <span
              className="font-sans font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.15em', color: 'rgba(161,161,170,0.5)' }}
            >
              Draw
            </span>
            <span
              className="font-display font-bold"
              style={{
                fontSize: 16,
                color: 'rgba(214,211,209,0.7)',
                minWidth: 24,
                textAlign: 'center',
              }}
            >
              {gameState.drawPileCount}
            </span>
          </div>

          <div style={{ width: 1, height: 20, background: 'rgba(63,63,70,0.3)' }} />

          {/* Discard pile */}
          <div className="flex items-center" style={{ gap: 8 }}>
            <span
              className="font-sans font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.15em', color: 'rgba(161,161,170,0.5)' }}
            >
              Discard
            </span>
            <span
              className="font-display font-bold"
              style={{
                fontSize: 16,
                color: 'rgba(161,161,170,0.5)',
                minWidth: 24,
                textAlign: 'center',
              }}
            >
              {gameState.discardPileCount}
            </span>
          </div>
        </div>
        </div>
        </div>
      </main>

      {/* ── Decorative rule ── */}
      <div className="deco-rule mx-auto" style={{ width: '80%' }} />

      {/* ── Player Strip ── */}
      <div className="flex flex-wrap justify-center" style={{ gap: 12, padding: '14px 40px' }}>
        {gameState.players.map((player) => (
          <PlayerChip
            key={player.id}
            name={player.name}
            isPresident={player.id === gameState.currentPresidentId}
            isChancellor={player.id === gameState.nominatedChancellorId}
            isDead={player.status === 'dead'}
          />
        ))}
      </div>

      {/* ── Game Log ── */}
      <div style={{ padding: '4px 32px 12px', maxHeight: '22vh', overflowY: 'auto' }}>
        <button
          type="button"
          onClick={() => setLogOpen(!logOpen)}
          className="transition-colors"
          style={{
            fontSize: 10,
            fontFamily: 'Inter, system-ui, sans-serif',
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            color: 'rgba(113,113,122,0.6)',
            marginBottom: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(161,161,170,0.8)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(113,113,122,0.6)')}
        >
          {logOpen ? 'Hide Log' : 'Show Log'}
        </button>
        <GameLogPanel entries={gameState.gameLog} open={logOpen} />
      </div>

      {/* ── Chat Feed Overlay ── */}
      <ChatFeed messages={chatLog} />

      {/* ── Vote Status Overlay ── */}
      {gameState.phase === 'election-vote' && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="fixed"
          style={{
            top: '50%',
            right: 32,
            transform: 'translateY(-50%)',
            background: 'rgba(15,15,17,0.95)',
            border: '1px solid rgba(184,134,11,0.25)',
            borderRadius: 16,
            padding: '24px 36px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <p
            className="font-sans uppercase font-bold"
            style={{
              fontSize: 10,
              letterSpacing: '0.35em',
              color: 'rgba(161,161,170,0.5)',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Votes Cast
          </p>
          <p className="text-center">
            <span className="font-display font-black" style={{ fontSize: 48, color: '#d97706' }}>
              {gameState.votedCount}
            </span>
            <span className="font-display" style={{ fontSize: 28, color: 'rgba(63,63,70,0.6)', margin: '0 4px' }}>
              /
            </span>
            <span className="font-display font-bold" style={{ fontSize: 28, color: 'rgba(161,161,170,0.5)' }}>
              {alivePlayers.length}
            </span>
          </p>
        </motion.div>
      )}
    </div>
  );
}

/* ── Government Name Slot ── */
function GovernmentNameSlot({
  title,
  name,
  accent,
}: {
  title: string;
  name: string | null;
  accent: string;
}) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <span
        className="font-sans font-bold uppercase"
        style={{ fontSize: 12, letterSpacing: '0.2em', color: accent, opacity: 0.7 }}
      >
        {title}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={name ?? 'empty'}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="font-display font-bold"
          style={{
            fontSize: 28,
            color: name ? 'rgba(240,234,212,0.95)' : 'rgba(63,63,70,0.4)',
          }}
        >
          {name ?? '\u2014'}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

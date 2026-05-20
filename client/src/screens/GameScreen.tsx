import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/useGameStore';

// Board components
import GovernmentBanner from '../components/board/GovernmentBanner';
import PolicyTrack from '../components/board/PolicyTrack';
import ElectionTracker from '../components/board/ElectionTracker';
import DrawDiscardPile from '../components/board/DrawDiscardPile';
import PlayerRing from '../components/board/PlayerRing';
import { NotificationToast } from '../components/ui/NotificationToast';
import { Spinner } from '../components/ui/Spinner';
import { RolePeek } from '../components/ui/RolePeek';
import { GameLogToggle, GameLogPanel } from '../components/ui/GameLog';
import { NotePadToggle, NotePadPanel } from '../components/ui/NotePad';
import { ChatToggle, ChatPanel } from '../components/ui/ChatPanel';
import * as emitters from '../lib/socketEmitters';

// Phase components
import RoleReveal from '../components/phases/RoleReveal';
import ElectionNominate from '../components/phases/ElectionNominate';
import ElectionVote from '../components/phases/ElectionVote';
import ElectionResult from '../components/phases/ElectionResult';
import LegislativePresident from '../components/phases/LegislativePresident';
import LegislativeChancellor from '../components/phases/LegislativeChancellor';
import ExecutiveAction from '../components/phases/ExecutiveAction';

function PhaseRenderer({ phase }: { phase: string }) {
  switch (phase) {
    case 'role-reveal':
      return <RoleReveal />;
    case 'election-nominate':
      return <ElectionNominate />;
    case 'election-vote':
      return <ElectionVote />;
    case 'election-result':
      return <ElectionResult />;
    case 'legislative-president':
      return <LegislativePresident />;
    case 'legislative-chancellor':
      return <LegislativeChancellor />;
    case 'executive-action':
      return <ExecutiveAction />;
    default:
      return null;
  }
}

export default function GameScreen() {
  const gameState = useGameStore((s) => s.gameState);
  const privateState = useGameStore((s) => s.privateState);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const voteReveal = useGameStore((s) => s.voteReveal);
  const isReconnecting = useGameStore((s) => s.isReconnecting);
  const chatLog = useGameStore((s) => s.chatLog);
  const chatOpen = useGameStore((s) => s.chatOpen);
  const unreadChatCount = useGameStore((s) => s.unreadChatCount);
  const setChatOpen = useGameStore((s) => s.setChatOpen);
  const clearUnreadChat = useGameStore((s) => s.clearUnreadChat);
  const [selectedPlayerId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [boardExpanded, setBoardExpanded] = useState(false);

  const handleToggleChat = () => {
    const next = !chatOpen;
    setChatOpen(next);
    if (next) clearUnreadChat();
    if (next) { setLogOpen(false); setNotesOpen(false); }
  };

  const handleSendMessage = async (text: string) => {
    await emitters.sendChatMessage(text);
  };

  if (!gameState || !myPlayerId) return null;

  const centralBoardActive = gameState.roomSettings?.centralBoardEnabled ?? false;

  const presidentName =
    gameState.players.find((p) => p.id === gameState.currentPresidentId)?.name ?? null;
  const chancellorName =
    gameState.players.find((p) => p.id === gameState.nominatedChancellorId)?.name ?? null;

  const displayVotes =
    gameState.phase === 'election-result' && voteReveal
      ? voteReveal.votes
      : null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-propaganda overflow-x-hidden">
      <AnimatePresence>
        {isReconnecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80"
          >
            <Spinner size="lg" />
            <p className="mt-4 text-sm font-sans text-stone-400 uppercase tracking-[0.2em]">
              Reconnecting…
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Government banner ─── */}
      <header className="flex items-center justify-center px-3 pt-2 pb-1 sm:px-4 sm:pt-3 sm:pb-2">
        <GovernmentBanner
          presidentName={presidentName}
          chancellorName={chancellorName}
          phase={gameState.phase}
        />
      </header>

      {/* ─── Board: policy tracks fill the width ─── */}
      {centralBoardActive && !boardExpanded ? (
        <div className="flex justify-center px-3 py-1">
          <button
            type="button"
            onClick={() => setBoardExpanded(true)}
            className="text-[9px] font-sans uppercase tracking-[0.2em] text-stone-600 hover:text-stone-400 transition-colors"
          >
            Show Board
          </button>
        </div>
      ) : (
        <>
          <section className="px-3 sm:px-4">
            <PolicyTrack
              policyTrack={gameState.policyTrack}
              playerCount={gameState.players.length}
            />
            <div className="flex items-center justify-center gap-4 mt-1 sm:mt-2">
              <ElectionTracker count={gameState.electionTracker} />
              <div className="w-px h-4 bg-stone-800" />
              <DrawDiscardPile
                drawCount={gameState.drawPileCount}
                discardCount={gameState.discardPileCount}
              />
            </div>
          </section>
          {centralBoardActive && (
            <div className="flex justify-center mt-1">
              <button
                type="button"
                onClick={() => setBoardExpanded(false)}
                className="text-[9px] font-sans uppercase tracking-[0.2em] text-stone-600 hover:text-stone-400 transition-colors"
              >
                Hide Board
              </button>
            </div>
          )}
        </>
      )}

      <div className="deco-rule mx-4 my-1.5 sm:mx-8 sm:my-3" />

      {/* ─── Phase action area ─── */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-2 sm:px-4 pb-1 sm:pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${gameState.phase}-${gameState.currentPresidentId}-${gameState.nominatedChancellorId}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-2xl"
          >
            <PhaseRenderer phase={gameState.phase} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ─── Bottom bar: players + role peek ─── */}
      <footer className="px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4">
        {/* Inline panels — stack above the toggle buttons row when open */}
        <ChatPanel
          open={chatOpen && !logOpen && !notesOpen}
          messages={chatLog}
          myPlayerId={myPlayerId}
          onSendMessage={handleSendMessage}
          disabled={gameState.phase === 'game-over'}
        />
        <GameLogPanel
          entries={gameState.gameLog}
          open={logOpen && !notesOpen && !chatOpen}
          investigationHistory={privateState?.investigationHistory}
        />
        <NotePadPanel open={notesOpen && !chatOpen} />

        {/* Toggle buttons row */}
        <div className="flex justify-center gap-2 mb-1">
          {privateState && (
            <RolePeek
              role={privateState.role}
              partyMembership={privateState.partyMembership}
              knownFascists={privateState.knownFascists}
              knownHitlerId={privateState.knownHitlerId}
              playerNames={Object.fromEntries(gameState.players.map(p => [p.id, p.name]))}
            />
          )}
          <ChatToggle
            open={chatOpen}
            onToggle={handleToggleChat}
            unreadCount={unreadChatCount}
          />
          <GameLogToggle
            open={logOpen}
            onToggle={() => { setLogOpen(!logOpen); setNotesOpen(false); setChatOpen(false); }}
            hasEntries={gameState.gameLog.length > 0}
          />
          <NotePadToggle
            open={notesOpen}
            onToggle={() => { setNotesOpen(!notesOpen); setLogOpen(false); setChatOpen(false); }}
          />
        </div>
        <PlayerRing
          players={gameState.players}
          gameState={gameState}
          myPlayerId={myPlayerId}
          selectedPlayerId={selectedPlayerId}
          selectablePlayerIds={[]}
          onSelectPlayer={() => {}}
          votes={displayVotes}
        />
      </footer>

      <NotificationToast />
    </div>
  );
}

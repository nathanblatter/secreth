import { useState } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useGameStore } from '../store/useGameStore';
import * as emitters from '../lib/socketEmitters';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { MIN_PLAYERS, MAX_PLAYERS } from '../../../shared/src/utils/constants';

export default function LobbyScreen() {
  const gameState = useGameStore((s) => s.gameState);
  const amHost = useGameStore((s) => s.amHost);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const addNotification = useGameStore((s) => s.addNotification);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!gameState) return null;

  const isHost = amHost();
  const humanCount = gameState.players.length;
  const aiCount = gameState.roomSettings?.aiPlayerCount ?? 0;
  const totalPlayers = humanCount + aiCount;
  const canStart = totalPlayers >= MIN_PLAYERS && totalPlayers <= MAX_PLAYERS;
  const { roomSettings } = gameState;

  const handleAICountChange = async (delta: number) => {
    const newCount = Math.max(0, Math.min(9, aiCount + delta));
    // Ensure total stays within 5-10
    const newTotal = humanCount + newCount;
    if (newCount === aiCount) return;
    if (newTotal > MAX_PLAYERS) return;
    const error = await emitters.updateRoomSettings({ aiPlayerCount: newCount });
    if (error) addNotification(error, 'error');
  };

  const joinUrl = `${window.location.origin}/join/${gameState.roomCode}`;
  const boardUrl = `${window.location.origin}/board/${gameState.roomCode}`;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(gameState.roomCode);
      setCopied(true);
      addNotification('Room code copied!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  };

  const handleStart = async () => {
    setLoading(true);
    const error = await emitters.startGame();
    setLoading(false);
    if (error) {
      addNotification(error, 'error');
    }
  };

  const handleToggleSetting = async (key: 'qrCodeEnabled' | 'centralBoardEnabled' | 'ttsNarrationEnabled') => {
    const error = await emitters.updateRoomSettings({
      [key]: !roomSettings[key],
    });
    if (error) addNotification(error, 'error');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-propaganda p-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-6 w-full max-w-md"
      >
        {/* Room Code */}
        <div className="text-center">
          <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-stone-600 mb-2">
            Room Code
          </p>
          <motion.button
            type="button"
            onClick={handleCopyCode}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="ornate-frame text-4xl font-display font-black tracking-[0.35em] text-amber-500 cursor-pointer
              hover:text-amber-400 transition-colors bg-stone-900/90 rounded-lg px-8 py-4"
          >
            {gameState.roomCode}
          </motion.button>
          <p className="text-[10px] font-sans text-stone-700 mt-2 tracking-wider">
            {copied ? 'Copied!' : 'Click to copy'}
          </p>
        </div>

        {/* QR Code Toggle + Display */}
        {roomSettings.qrCodeEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex flex-col items-center gap-3"
          >
            <button
              type="button"
              onClick={() => setShowQr(!showQr)}
              className="text-[10px] font-sans uppercase tracking-[0.2em] text-amber-600 hover:text-amber-400 transition-colors"
            >
              {showQr ? 'Hide QR Code' : 'Show QR Code to Join'}
            </button>
            {showQr && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-parchment-100 p-3 rounded-lg"
              >
                <QRCodeSVG
                  value={joinUrl}
                  size={180}
                  bgColor="#f5f0e8"
                  fgColor="#1c1917"
                  level="M"
                />
                <p className="text-[9px] text-stone-600 text-center mt-1.5 font-sans">
                  Scan to join
                </p>
              </motion.div>
            )}
          </motion.div>
        )}

        <div className="deco-rule w-full" />

        {/* Player List */}
        <Card className="w-full">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-bold text-parchment-100 tracking-wider">Players</h2>
            <span
              className={`text-xs font-sans font-semibold ${
                canStart ? 'text-green-500' : 'text-stone-600'
              }`}
            >
              {totalPlayers}/{MAX_PLAYERS}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {gameState.players.map((player, i) => (
              <motion.div
                key={player.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-center justify-between rounded-md px-4 py-2 ${
                  player.id === myPlayerId
                    ? 'bg-amber-950/40 border border-amber-800/30'
                    : 'bg-stone-800/40 border border-stone-800/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${
                      player.isConnected ? 'bg-green-600' : 'bg-stone-600'
                    }`}
                  />
                  <span className="text-sm font-display font-bold text-parchment-100">
                    {player.name}
                  </span>
                  {player.id === myPlayerId && (
                    <span className="text-[10px] font-sans text-amber-600 font-semibold tracking-wider uppercase">(You)</span>
                  )}
                </div>
                {player.id === gameState.hostId && (
                  <span className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] text-amber-700">
                    Host
                  </span>
                )}
              </motion.div>
            ))}
          </div>

          {totalPlayers < MIN_PLAYERS && (
            <p className="text-xs font-sans text-stone-600 text-center mt-4">
              Need at least {MIN_PLAYERS} players to start
              ({MIN_PLAYERS - totalPlayers} more needed)
            </p>
          )}
          {aiCount > 0 && (
            <p className="text-[10px] font-sans text-amber-700/70 text-center mt-2">
              {totalPlayers} total ({humanCount} human + {aiCount} AI)
            </p>
          )}
        </Card>

        {/* Host Settings */}
        {isHost && (
          <Card className="w-full">
            <h3 className="font-display text-xs font-bold text-stone-400 mb-3 uppercase tracking-[0.2em]">
              Room Settings
            </h3>
            <div className="flex flex-col gap-2.5">
              {/* AI Player Count */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-sans text-parchment-200">AI Players</span>
                  <p className="text-[10px] text-stone-500">
                    {humanCount + aiCount > MAX_PLAYERS ? 'Room full' : `${humanCount + aiCount} total players`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAICountChange(-1)}
                    disabled={aiCount === 0}
                    className="w-6 h-6 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold flex items-center justify-center"
                  >
                    −
                  </button>
                  <span className="text-sm font-display font-bold text-parchment-100 w-4 text-center">{aiCount}</span>
                  <button
                    type="button"
                    onClick={() => handleAICountChange(1)}
                    disabled={humanCount + aiCount >= MAX_PLAYERS}
                    className="w-6 h-6 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="h-px bg-stone-800/60" />
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-sans text-parchment-200">Show QR Code</span>
                <button
                  type="button"
                  onClick={() => handleToggleSetting('qrCodeEnabled')}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    roomSettings.qrCodeEnabled ? 'bg-amber-700' : 'bg-stone-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-parchment-100 transition-transform ${
                      roomSettings.qrCodeEnabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-sans text-parchment-200">Central Board Mode</span>
                <button
                  type="button"
                  onClick={() => handleToggleSetting('centralBoardEnabled')}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    roomSettings.centralBoardEnabled ? 'bg-amber-700' : 'bg-stone-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-parchment-100 transition-transform ${
                      roomSettings.centralBoardEnabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-xs font-sans text-parchment-200">Voice Narration</span>
                  {!roomSettings.centralBoardEnabled && (
                    <p className="text-[10px] text-stone-500">Requires Central Board Mode</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleSetting('ttsNarrationEnabled')}
                  disabled={!roomSettings.centralBoardEnabled}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    roomSettings.ttsNarrationEnabled && roomSettings.centralBoardEnabled
                      ? 'bg-amber-700'
                      : 'bg-stone-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-parchment-100 transition-transform ${
                      roomSettings.ttsNarrationEnabled && roomSettings.centralBoardEnabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </label>
            </div>

            {/* Board device link when central board is enabled */}
            {roomSettings.centralBoardEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-3 pt-3 border-t border-stone-800/50"
              >
                <p className="text-[10px] font-sans text-stone-500 mb-2 uppercase tracking-wider">
                  Open on your TV/laptop:
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(boardUrl);
                      addNotification('Board URL copied!', 'success');
                    } catch { /* ignore */ }
                  }}
                  className="text-xs font-mono text-amber-500 hover:text-amber-400 transition-colors break-all text-left"
                >
                  {boardUrl}
                </button>
                <div className="mt-2 flex justify-center">
                  <div className="bg-parchment-100 p-2 rounded">
                    <QRCodeSVG
                      value={boardUrl}
                      size={120}
                      bgColor="#f5f0e8"
                      fgColor="#1c1917"
                      level="M"
                    />
                  </div>
                </div>
                <p className="text-[9px] text-stone-600 text-center mt-1 font-sans">
                  Scan to open board view
                </p>
                {gameState.spectatorCount > 0 && (
                  <p className="text-[10px] text-green-600 text-center mt-1 font-sans">
                    {gameState.spectatorCount} board {gameState.spectatorCount === 1 ? 'device' : 'devices'} connected
                  </p>
                )}
              </motion.div>
            )}
          </Card>
        )}

        {/* Non-host: show spectator count if central board enabled */}
        {!isHost && roomSettings.centralBoardEnabled && gameState.spectatorCount > 0 && (
          <p className="text-[10px] text-green-600 text-center font-sans">
            {gameState.spectatorCount} board {gameState.spectatorCount === 1 ? 'device' : 'devices'} connected
          </p>
        )}

        {/* Start Button */}
        {isHost && (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!canStart || loading}
            loading={loading}
            onClick={handleStart}
          >
            {canStart ? 'Start Game' : `Need ${MIN_PLAYERS - totalPlayers} More`}
          </Button>
        )}

        {!isHost && (
          <p className="text-sm font-display text-stone-600 text-center italic">
            Waiting for the host to start the game...
          </p>
        )}
      </motion.div>
    </div>
  );
}

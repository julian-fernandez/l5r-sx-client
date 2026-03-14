/**
 * MultiplayerLobby — Create or join a private room.
 *
 * Modes:
 *  1. "Create" — paste deck, click Create, receive code + URL to share.
 *  2. "Join"   — enter code (or URL auto-fills it), paste deck, click Join.
 *
 * If `?room=CODE` is in the URL the component auto-switches to Join mode.
 */
import { useState, useEffect } from 'react';
import { parseDeck } from '../engine/deckParser';
import { UNICORN_TEST_DECK } from '../engine/testFixtures';
import type { MultiplayerStatus } from '../hooks/useMultiplayer';

interface Props {
  status: MultiplayerStatus;
  shareUrl: string | null;
  roomId: string | null;
  error: string | null;
  /** Pre-filled room code from ?room= URL param */
  initialRoomCode?: string;
  onCreateRoom: (deckString: string) => void;
  onJoinRoom: (roomCode: string, deckString: string) => void;
  onBack: () => void;
}

type Tab = 'create' | 'join';

export function MultiplayerLobby({
  status,
  shareUrl,
  roomId,
  error,
  initialRoomCode = '',
  onCreateRoom,
  onJoinRoom,
  onBack,
}: Props) {
  const [tab, setTab]         = useState<Tab>(initialRoomCode ? 'join' : 'create');
  const [deckText, setDeckText] = useState(UNICORN_TEST_DECK);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);

  // Auto-switch to Join when a URL code is detected
  useEffect(() => {
    if (initialRoomCode) {
      setTab('join');
      setRoomCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  function validateDeck(): boolean {
    try {
      parseDeck(deckText);
      setParseError(null);
      return true;
    } catch {
      setParseError('Could not parse deck. Check the format and try again.');
      return false;
    }
  }

  function handleCreate() {
    if (!validateDeck()) return;
    onCreateRoom(deckText);
  }

  function handleJoin() {
    if (!roomCode.trim()) {
      setParseError('Enter a room code.');
      return;
    }
    if (!validateDeck()) return;
    onJoinRoom(roomCode.trim(), deckText);
  }

  async function handleCopyUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyCode() {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isLoading = status === 'connecting' || status === 'waiting' || status === 'reconnecting';

  return (
    <div className="min-h-screen bg-board-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-gray-100 tracking-tight">
            Multiplayer — Private Game
          </h1>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-board-border overflow-hidden text-xs">
          {(['create', 'join'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              disabled={isLoading}
              className={[
                'flex-1 py-2 font-semibold capitalize transition-colors',
                tab === t
                  ? 'bg-sky-900/60 text-sky-200'
                  : 'bg-board-bg text-gray-500 hover:text-gray-300',
              ].join(' ')}
            >
              {t === 'create' ? 'Create Game' : 'Join Game'}
            </button>
          ))}
        </div>

        {/* ── Waiting state ─────────────────────────────────────── */}
        {status === 'waiting' && roomId && (
          <div className="rounded-xl border border-sky-700/50 bg-sky-950/30 p-4 space-y-3">
            <p className="text-xs text-sky-300 font-semibold uppercase tracking-widest">
              Waiting for opponent…
            </p>
            <div className="text-center">
              <p className="text-[10px] text-gray-500 mb-1">Room Code</p>
              <p className="text-4xl font-mono font-bold text-gray-100 tracking-[0.25em]">
                {roomId}
              </p>
            </div>
            {shareUrl && (
              <div className="space-y-2">
                <p className="text-[10px] text-gray-500">Share link</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 text-[10px] bg-board-bg border border-board-border rounded px-2 py-1.5 text-gray-400 font-mono"
                  />
                  <button
                    onClick={handleCopyUrl}
                    className="text-[10px] px-3 py-1.5 rounded border border-sky-700 text-sky-300 bg-sky-950/40 hover:bg-sky-800/40 transition-colors whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy URL'}
                  </button>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Or copy just the code
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 text-gray-600 text-[10px]">
              <span className="animate-pulse">●</span>
              <span>Game will start automatically when your opponent joins.</span>
            </div>
          </div>
        )}

        {/* ── Main form ─────────────────────────────────────────── */}
        {status !== 'waiting' && (
          <div className="space-y-3">
            {tab === 'join' && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
                  Room Code
                </label>
                <input
                  value={roomCode}
                  onChange={e => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="A7K2PQ"
                  maxLength={6}
                  className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-lg font-mono text-gray-100 tracking-[0.3em] focus:outline-none focus:border-sky-600"
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
                Your Deck (Sun and Moon format)
              </label>
              <textarea
                value={deckText}
                onChange={e => setDeckText(e.target.value)}
                rows={10}
                className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-[11px] font-mono text-gray-300 leading-relaxed focus:outline-none focus:border-sky-600 resize-none"
                placeholder="# Stronghold&#10;1 Plains of the Maiden&#10;..."
              />
            </div>
          </div>
        )}

        {/* ── Error display ──────────────────────────────────────── */}
        {(error || parseError) && (
          <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
            {error ?? parseError}
          </p>
        )}

        {/* ── Action buttons ─────────────────────────────────────── */}
        {status !== 'waiting' && (
          <div className="flex gap-3">
            {tab === 'create' ? (
              <button
                onClick={handleCreate}
                disabled={isLoading}
                className="flex-1 py-2.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors"
              >
                {isLoading ? 'Creating…' : 'Create Private Game'}
              </button>
            ) : (
              <button
                onClick={handleJoin}
                disabled={isLoading}
                className="flex-1 py-2.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors"
              >
                {isLoading ? 'Joining…' : 'Join Game'}
              </button>
            )}
          </div>
        )}

        {status === 'disconnected' && (
          <p className="text-[10px] text-amber-400 text-center">
            Connection lost. Reload the page to reconnect.
          </p>
        )}
      </div>
    </div>
  );
}

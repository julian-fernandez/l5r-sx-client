/**
 * GameLog — fixed-height sidebar that shows every action taken this session.
 * Newest entries appear at the bottom; the list auto-scrolls as entries arrive.
 */
import { useEffect, useRef } from 'react';
import type { LogEntry, LogCategory } from '../types/cards';
import { useGameStore } from '../store/gameStore';

const CATEGORY_COLOR: Record<LogCategory, string> = {
  draw:     'text-green-400',
  bow:      'text-amber-400',
  gold:     'text-yellow-300',
  recruit:  'text-sky-300',
  phase:    'text-gray-400',
  cycle:    'text-violet-400',
  discard:  'text-red-400',
  priority: 'text-indigo-400',
  battle:   'text-rose-400',
  honor:    'text-amber-300',
  other:    'text-gray-500',
};

const CATEGORY_DOT: Record<LogCategory, string> = {
  draw:     'bg-green-400',
  bow:      'bg-amber-400',
  gold:     'bg-yellow-300',
  recruit:  'bg-sky-400',
  phase:    'bg-gray-500',
  cycle:    'bg-violet-400',
  discard:  'bg-red-400',
  priority: 'bg-indigo-400',
  battle:   'bg-rose-500',
  honor:    'bg-amber-400',
  other:    'bg-gray-600',
};

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex items-start gap-1.5 py-[3px] border-b border-board-border/40 last:border-0">
      <span
        className={`mt-[4px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${CATEGORY_DOT[entry.category]}`}
      />
      <div className="min-w-0">
        <p className={`text-[10px] leading-snug break-words ${CATEGORY_COLOR[entry.category]}`}>
          {entry.message}
        </p>
        <p className="text-[8px] text-gray-700 leading-none mt-0.5">
          T{entry.turnNumber} · {entry.phase}
        </p>
      </div>
    </div>
  );
}

export function GameLog({ onClose }: { onClose?: () => void }) {
  const gameLog = useGameStore(s => s.gameLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameLog.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-board-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Game Log</span>
          <span className="text-[8px] text-gray-600 tabular-nums">{gameLog.length}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-300 text-sm leading-none transition-colors"
            title="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Entries — newest at bottom */}
      <div className="flex-1 overflow-y-auto px-2 py-1 min-h-0">
        {gameLog.length === 0 ? (
          <p className="text-[9px] text-gray-700 italic mt-2">No actions yet.</p>
        ) : (
          gameLog.map(entry => <LogRow key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

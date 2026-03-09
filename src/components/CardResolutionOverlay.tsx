/**
 * CardResolutionOverlay — shown when the player plays a card from hand.
 *
 * For strategies the overlay parses the card text into individual abilities and
 * presents them grouped by timing.  The player must pick exactly ONE ability
 * before confirming.  Abilities whose timing window is not currently open are
 * shown dimmed and un-selectable.
 *
 * For attachments (item, follower, spell) the player clicks a valid personality
 * in the InPlayRow to set a target, then confirms.
 *
 * `onConfirm(abilityText?)` is called with the selected ability text so the
 * store can include it in the game log.
 */
import { useState, useRef, useEffect } from 'react';
import type { CardInstance, CardType, NormalizedCard } from '../types/cards';
import { canAttachTo, parseCardAbilities, type AbilityTiming, type ParsedAbility } from '../engine/gameActions';
import { CardImage } from './CardImage';

interface Props {
  instance: CardInstance;
  /** For attachments: currently selected target personality instanceId */
  targetId: string | null;
  /** Player's personalities in play — used to validate attach targets */
  personalities: CardInstance[];
  /**
   * Set of timing windows currently open for the player (lower-cased).
   * e.g. new Set(['open', 'limited']) during the Action phase.
   */
  validTimings: Set<string>;
  /** Current gold pool — used to block resolution when the player can't afford the cost */
  goldPool: number;
  /** Called when the player confirms; receives the chosen ability text for logging */
  onConfirm: (abilityText?: string) => void;
  onCancel: () => void;
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const TYPE_COLOR: Partial<Record<CardType, string>> = {
  strategy: 'text-sky-300',
  item:     'text-amber-300',
  follower: 'text-emerald-300',
  spell:    'text-purple-300',
};

const TIMING_STYLES: Record<AbilityTiming, { badge: string; selected: string; hover: string }> = {
  Limited: {
    badge:    'bg-amber-900/70 text-amber-300 border-amber-700/60',
    selected: 'border-amber-500 bg-amber-950/60',
    hover:    'hover:border-amber-700/60 hover:bg-amber-950/30',
  },
  Open: {
    badge:    'bg-sky-900/70 text-sky-300 border-sky-700/60',
    selected: 'border-sky-500 bg-sky-950/60',
    hover:    'hover:border-sky-700/60 hover:bg-sky-950/30',
  },
  Battle: {
    badge:    'bg-red-900/70 text-red-300 border-red-700/60',
    selected: 'border-red-500 bg-red-950/60',
    hover:    'hover:border-red-700/60 hover:bg-red-950/30',
  },
  Engage: {
    badge:    'bg-orange-900/70 text-orange-300 border-orange-700/60',
    selected: 'border-orange-500 bg-orange-950/60',
    hover:    'hover:border-orange-700/60 hover:bg-orange-950/30',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CardResolutionOverlay({
  instance, targetId, personalities, validTimings, goldPool, onConfirm, onCancel,
}: Props) {
  const { card } = instance;
  const isAttachment = (['item', 'follower', 'spell'] as CardType[]).includes(card.type);
  const cost = Math.max(0, Number(card.cost) || 0);
  const canAfford = goldPool >= cost;

  // ── Ability parsing (strategies only) ─────────────────────────────────────
  const allAbilities: ParsedAbility[] = isAttachment ? [] : parseCardAbilities(card.text);
  const timedAbilities = allAbilities.filter(a => a.timing !== 'trait') as Array<ParsedAbility & { timing: AbilityTiming }>;
  const traitText      = allAbilities.filter(a => a.timing === 'trait').map(a => a.text).join(' ');

  const validAbilities = timedAbilities.filter(a => validTimings.has(a.timing.toLowerCase()));
  const hasAbilityStructure = timedAbilities.length > 0;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    validAbilities.length === 1 ? timedAbilities.indexOf(validAbilities[0]) : null,
  );

  // ── Attachment target info ────────────────────────────────────────────────
  const targetPersonality = personalities.find(p => p.instanceId === targetId);
  const validTargets      = isAttachment ? personalities.filter(p => canAttachTo(card, p)) : [];

  // ── Confirm gate ─────────────────────────────────────────────────────────
  const canConfirm = canAfford && (
    isAttachment
      ? targetId !== null
      : !hasAbilityStructure || selectedIdx !== null
  );

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (isAttachment || !hasAbilityStructure) {
      onConfirm(undefined);
    } else {
      const chosen = timedAbilities[selectedIdx!];
      onConfirm(`${chosen.timing}: ${chosen.text}`);
    }
  };

  // ── Draggable panel ───────────────────────────────────────────────────────
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, window.innerWidth  - 460),
    y: Math.max(0, window.innerHeight / 2 - 200),
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };

  const typeColor = TYPE_COLOR[card.type] ?? 'text-gray-300';

  // No backdrop — the panel floats over the board so the player can click
  // personalities / provinces behind it while choosing targets or abilities.
  return (
    <div
      className="fixed z-50 flex flex-col rounded-2xl border border-board-border shadow-2xl select-none overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: 420, maxHeight: '90vh', background: '#0f1117' }}
    >
      {/* ── Drag handle / title bar ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-board-border cursor-grab active:cursor-grabbing flex-shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500">Playing Card</span>
          <span className="text-[8px] text-gray-700">· drag to move</span>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-600 hover:text-gray-300 transition-colors text-sm leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* ── Body: card image + details side by side ───────────────────── */}
      <div className="flex overflow-hidden flex-1 min-h-0">
        {/* Card image */}
        <div
          className="flex-shrink-0 flex items-start justify-center bg-black/30 pt-4 pb-4"
          style={{ width: 130, paddingLeft: 12, paddingRight: 12 }}
        >
          <div className="rounded-xl overflow-hidden shadow-xl ring-1 ring-board-border" style={{ width: 106, height: 148 }}>
            <CardImage card={card} className="w-full h-full object-cover" alt={card.name} />
          </div>
        </div>

        {/* Details + controls */}
        <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1 min-w-0">

          {/* Card name + type */}
          <div>
            <h2 className="text-[14px] font-bold text-white leading-tight">{card.name}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[10px] font-semibold capitalize ${typeColor}`}>{card.type}</span>
              {card.clan && <span className="text-[9px] text-gray-600 capitalize">{card.clan}</span>}
            </div>
          </div>

          {/* Gold cost + pool */}
          {cost > 0 && (
            <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
              canAfford
                ? 'border-yellow-700/40 bg-yellow-950/20'
                : 'border-red-700/60 bg-red-950/30 animate-pulse'
            }`}>
              <span className={`text-sm font-bold tabular-nums ${canAfford ? 'text-yellow-300' : 'text-red-400'}`}>
                ◆ {cost}g
              </span>
              <span className="text-[9px] text-gray-600">cost</span>
              <span className="ml-auto text-[9px] font-semibold tabular-nums text-gray-400">
                pool: <span className={canAfford ? 'text-yellow-400' : 'text-red-400'}>{goldPool}g</span>
              </span>
              {!canAfford && (
                <span className="text-[8px] text-red-500 font-semibold">need {cost - goldPool}g more</span>
              )}
            </div>
          )}

          {/* ── Strategy: ability picker ──────────────────────────────── */}
          {!isAttachment && (
            <div className="flex flex-col gap-2">
              {traitText && (
                <p className="text-[9px] text-gray-500 leading-relaxed italic">{traitText}</p>
              )}
              {hasAbilityStructure ? (
                <>
                  <p className="text-[8px] text-gray-600 font-semibold uppercase tracking-wider">
                    Choose one ability:
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {timedAbilities.map((ab, i) => {
                      const styles  = TIMING_STYLES[ab.timing];
                      const isValid = validTimings.has(ab.timing.toLowerCase());
                      const isSel   = selectedIdx === i;
                      return (
                        <button
                          key={i}
                          disabled={!isValid}
                          onClick={() => setSelectedIdx(i)}
                          className={[
                            'text-left rounded-lg border px-2.5 py-1.5 transition-all',
                            isValid
                              ? isSel
                                ? styles.selected + ' cursor-default'
                                : 'border-board-border bg-transparent text-gray-300 ' + styles.hover + ' cursor-pointer'
                              : 'border-board-border bg-transparent opacity-30 cursor-not-allowed',
                          ].join(' ')}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[7px] font-bold uppercase tracking-wider px-1.5 py-px rounded border ${styles.badge}`}>
                              {ab.timing}
                            </span>
                            {!isValid && <span className="text-[7px] text-gray-600 italic">wrong timing</span>}
                            {isSel   && <span className="text-[7px] font-bold text-emerald-400">✓</span>}
                          </div>
                          <p className="text-[9px] leading-snug text-gray-400">{ab.text}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-gray-400 leading-relaxed">{card.text || 'No text.'}</p>
              )}
            </div>
          )}

          {/* ── Attachment target status ──────────────────────────────── */}
          {isAttachment && (
            <div className={`rounded-lg border px-2.5 py-2 text-[9px] leading-relaxed ${
              targetPersonality
                ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300'
                : validTargets.length > 0
                  ? 'border-sky-700/60 bg-sky-950/20 text-sky-400 animate-pulse'
                  : 'border-red-900/60 bg-red-950/20 text-red-500'
            }`}>
              {targetPersonality
                ? `→ ${targetPersonality.card.name}`
                : validTargets.length > 0
                  ? 'Click a highlighted personality on the board'
                  : 'No valid targets in play'}
              {targetPersonality && (
                <div className="text-[8px] text-emerald-600 mt-0.5">{targetPersonality.card.keywords.join(', ')}</div>
              )}
            </div>
          )}

          {/* ── Action buttons ────────────────────────────────────────── */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg border border-gray-700
                         text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={[
                'flex-1 text-[11px] font-bold py-1.5 rounded-lg border transition-colors',
                canConfirm
                  ? 'border-emerald-600 text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/70'
                  : !canAfford
                    ? 'border-red-900/60 text-red-700 cursor-not-allowed'
                    : 'border-gray-800 text-gray-700 cursor-not-allowed',
              ].join(' ')}
              title={!canAfford ? `Need ${cost}g — bow holdings or stronghold to build your gold pool` : undefined}
            >
              {!canAfford ? `Need ${cost}g` : isAttachment ? 'Equip →' : 'Resolve →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Returns personalities that are valid attach targets (used in Board.tsx for highlighting) */
export function getValidAttachTargets(card: NormalizedCard, personalities: CardInstance[]): Set<string> {
  if (!(['item', 'follower', 'spell'] as string[]).includes(card.type)) return new Set();
  return new Set(
    personalities.filter(p => canAttachTo(card, p)).map(p => p.instanceId),
  );
}

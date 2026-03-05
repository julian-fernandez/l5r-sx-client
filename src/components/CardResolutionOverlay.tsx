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
import { useState } from 'react';
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
  instance, targetId, personalities, validTimings, onConfirm, onCancel,
}: Props) {
  const { card } = instance;
  const isAttachment = (['item', 'follower', 'spell'] as CardType[]).includes(card.type);
  const cost = Math.max(0, Number(card.cost) || 0);

  // ── Ability parsing (strategies only) ─────────────────────────────────────
  const allAbilities: ParsedAbility[] = isAttachment ? [] : parseCardAbilities(card.text);
  const timedAbilities = allAbilities.filter(a => a.timing !== 'trait') as Array<ParsedAbility & { timing: AbilityTiming }>;
  const traitText      = allAbilities.filter(a => a.timing === 'trait').map(a => a.text).join(' ');

  // Abilities usable at current timing
  const validAbilities = timedAbilities.filter(a =>
    validTimings.has(a.timing.toLowerCase()),
  );

  // If the card has no parsed timed abilities, treat entire card as a single
  // unstructured strategy (old-style text without timing markers)
  const hasAbilityStructure = timedAbilities.length > 0;

  // Auto-select when only one ability is valid
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    validAbilities.length === 1 ? timedAbilities.indexOf(validAbilities[0]) : null,
  );

  // ── Attachment target info ────────────────────────────────────────────────
  const targetPersonality = personalities.find(p => p.instanceId === targetId);
  const validTargets      = isAttachment ? personalities.filter(p => canAttachTo(card, p)) : [];

  // ── Confirm gate ─────────────────────────────────────────────────────────
  const canConfirm = isAttachment
    ? targetId !== null
    : !hasAbilityStructure || selectedIdx !== null;

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (isAttachment || !hasAbilityStructure) {
      onConfirm(undefined);
    } else {
      const chosen = timedAbilities[selectedIdx!];
      onConfirm(`${chosen.timing}: ${chosen.text}`);
    }
  };

  const typeColor = TYPE_COLOR[card.type] ?? 'text-gray-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="flex gap-0 rounded-2xl overflow-hidden border border-board-border shadow-2xl"
        style={{ maxHeight: '90vh', background: '#0f1117' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Left: Large card image ─────────────────────────────────── */}
        <div
          className="relative flex-shrink-0 flex items-center justify-center bg-black/40"
          style={{ width: '28vh', padding: '1.5vh' }}
        >
          <div
            className="relative rounded-xl overflow-hidden shadow-xl ring-2 ring-board-border"
            style={{ width: '25vh', height: '35vh' }}
          >
            <CardImage card={card} className="w-full h-full object-cover" alt={card.name} />
          </div>
          <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 bg-black/60 px-2 py-0.5 rounded">
              Playing
            </span>
          </div>
        </div>

        {/* ── Right: Details + ability picker ───────────────────────── */}
        <div className="flex flex-col gap-3 p-5 overflow-y-auto" style={{ width: '34vh', minWidth: 280, maxHeight: '90vh' }}>

          {/* Card name + type */}
          <div>
            <h2 className="text-[15px] font-bold text-white leading-tight">{card.name}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[10px] font-semibold capitalize ${typeColor}`}>{card.type}</span>
              {card.clan && <span className="text-[9px] text-gray-600 capitalize">{card.clan}</span>}
              {cost > 0 && <span className="text-[9px] font-bold text-yellow-400/80">◆ {cost}g</span>}
            </div>
          </div>

          {/* ── Strategy: ability picker ──────────────────────────────── */}
          {!isAttachment && (
            <div className="flex flex-col gap-2">
              {/* Trait text (passive) */}
              {traitText && (
                <p className="text-[9px] text-gray-500 leading-relaxed italic">{traitText}</p>
              )}

              {/* Ability list */}
              {hasAbilityStructure ? (
                <>
                  <p className="text-[8px] text-gray-600 font-semibold uppercase tracking-wider">
                    Select an ability to use:
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {timedAbilities.map((ab, i) => {
                      const styles   = TIMING_STYLES[ab.timing];
                      const isValid  = validTimings.has(ab.timing.toLowerCase());
                      const isSel    = selectedIdx === i;

                      return (
                        <button
                          key={i}
                          disabled={!isValid}
                          onClick={() => setSelectedIdx(i)}
                          className={[
                            'text-left rounded-lg border px-3 py-2 transition-all',
                            isValid
                              ? isSel
                                ? styles.selected + ' cursor-default'
                                : 'border-board-border bg-transparent text-gray-300 ' + styles.hover + ' cursor-pointer'
                              : 'border-board-border bg-transparent opacity-30 cursor-not-allowed',
                          ].join(' ')}
                        >
                          {/* Timing badge */}
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`text-[7px] font-bold uppercase tracking-wider px-1.5 py-px rounded border ${styles.badge}`}>
                              {ab.timing}
                            </span>
                            {!isValid && (
                              <span className="text-[7px] text-gray-600 italic">wrong timing</span>
                            )}
                            {isSel && (
                              <span className="text-[7px] font-bold text-emerald-400">✓ selected</span>
                            )}
                          </div>
                          {/* Ability text */}
                          <p className="text-[9px] leading-snug text-gray-400">{ab.text}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                /* No timing structure — show raw text */
                <p className="text-[10px] text-gray-400 leading-relaxed">{card.text || 'No text.'}</p>
              )}
            </div>
          )}

          {/* ── Attachment target status ──────────────────────────────── */}
          {isAttachment && (
            <div className={`rounded-lg border px-3 py-2 text-[9px] leading-relaxed ${
              targetPersonality
                ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300'
                : validTargets.length > 0
                  ? 'border-sky-700/60 bg-sky-950/20 text-sky-400 animate-pulse'
                  : 'border-red-900/60 bg-red-950/20 text-red-500'
            }`}>
              {targetPersonality
                ? `Equip to: ${targetPersonality.card.name}`
                : validTargets.length > 0
                  ? 'Click a highlighted personality to select target'
                  : 'No valid targets — cannot play this card'}
              {targetPersonality && (
                <div className="text-[8px] text-emerald-600 mt-0.5">
                  {targetPersonality.card.keywords.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* ── Buttons ──────────────────────────────────────────────── */}
          <div className="flex gap-2 pt-1 flex-shrink-0">
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
                  : 'border-gray-800 text-gray-700 cursor-not-allowed',
              ].join(' ')}
            >
              {isAttachment ? 'Equip →' : 'Resolve →'}
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

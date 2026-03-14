/**
 * ManualResolutionOverlay
 *
 * Shown when a player chooses "Resolve manually" on a card — either from hand
 * or an in-play ability. Both players must check off their confirmation before
 * the "Resolve →" button appears, requiring a final explicit click.
 *
 * For hand cards: after resolution the card moves to its destination zone.
 * For in-play abilities: resolution is verbal; this overlay just provides a
 *   shared visual reference and records the action in the log.
 *
 * Gold cost is checked for hand cards; if the pool is short, resolution is
 * blocked (the cost display pulses red, same as CardResolutionOverlay).
 */

import { useState } from 'react';
import type { CardInstance } from '../types/cards';
import { CardImage } from './CardImage';

interface Props {
  instance: CardInstance;
  /** Set for attachment cards — shows the target personality next to the card. */
  targetPersonality?: CardInstance | null;
  /**
   * Current gold pool. Pass 0 and cost will show 0 warning.
   * Pass undefined (default) to skip the gold check entirely (in-play abilities).
   */
  goldPool?: number;
  /** Label for the final resolution button. Default: "Resolve →" */
  resolveLabel?: string;
  onBothResolved: () => void;
  onCancel: () => void;
}

export function ManualResolutionOverlay({
  instance,
  targetPersonality,
  goldPool,
  resolveLabel = 'Resolve →',
  onBothResolved,
  onCancel,
}: Props) {
  const [playerDone, setPlayerDone]     = useState(false);
  const [opponentDone, setOpponentDone] = useState(false);

  const cost      = Math.max(0, Number(instance.card.cost) || 0);
  const skipCost  = goldPool === undefined;
  const canAfford = skipCost || (goldPool ?? 0) >= cost;
  const needMore  = skipCost ? 0 : Math.max(0, cost - (goldPool ?? 0));

  const bothChecked = playerDone && opponentDone;
  const canResolve  = bothChecked && canAfford;

  return (
    /* Full-screen dark backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div
        className="bg-board-zone border border-board-border rounded-2xl shadow-2xl flex flex-col gap-4 p-6"
        style={{ width: 380, maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Manual Resolution
          </span>
          <button
            onClick={onCancel}
            className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
          >
            ✕ Cancel
          </button>
        </div>

        {/* ── Card display ──────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-4">
          {/* Main card */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="rounded-lg overflow-hidden border border-board-border shadow-xl"
              style={{ height: '22vh', aspectRatio: '2.5/3.5' }}
            >
              <CardImage
                card={instance.card}
                className="w-full h-full object-cover"
                alt={instance.card.name}
              />
            </div>
            <span className="text-[9px] text-gray-500 capitalize">{instance.card.type}</span>
          </div>

          {/* Arrow + target for attachments */}
          {targetPersonality && (
            <>
              <span className="text-gray-600 text-xl flex-shrink-0">→</span>
              <div className="flex flex-col items-center gap-1">
                <div
                  className="rounded-lg overflow-hidden border border-sky-700/50 shadow-xl"
                  style={{ height: '16vh', aspectRatio: '2.5/3.5' }}
                >
                  <CardImage
                    card={targetPersonality.card}
                    className="w-full h-full object-cover"
                    alt={targetPersonality.card.name}
                  />
                </div>
                <span className="text-[9px] text-sky-500">target</span>
              </div>
            </>
          )}
        </div>

        {/* ── Card name + text ──────────────────────────────────────── */}
        <div className="text-center">
          <p className="font-bold text-white text-sm">{instance.card.name}</p>
          {instance.card.text && (
            <p className="text-gray-400 text-[10px] mt-1.5 leading-relaxed text-left bg-board-bg rounded-lg px-2.5 py-2 max-h-24 overflow-y-auto">
              {instance.card.text}
            </p>
          )}
        </div>

        {/* ── Gold cost ─────────────────────────────────────────────── */}
        {!skipCost && cost > 0 && (
          <div className={[
            'flex items-center justify-between text-[10px] px-3 py-1.5 rounded-lg border',
            canAfford
              ? 'border-board-border text-gray-400'
              : 'border-red-700 bg-red-950/30 text-red-400 animate-pulse',
          ].join(' ')}>
            <span>◆ {cost}g cost</span>
            <span className="text-gray-600">pool: {goldPool}g</span>
            {!canAfford && (
              <span className="font-bold">need {needMore}g more</span>
            )}
          </div>
        )}

        {/* ── Confirmation checkboxes ───────────────────────────────── */}
        <div className="space-y-1.5">
          <p className="text-[9px] text-gray-600 text-center uppercase tracking-wider">
            Both players confirm before resolving
          </p>
          <div className="flex gap-2">
            <ConfirmButton
              label="You"
              checked={playerDone}
              onClick={() => setPlayerDone(v => !v)}
            />
            <ConfirmButton
              label="Opponent"
              checked={opponentDone}
              onClick={() => setOpponentDone(v => !v)}
            />
          </div>
        </div>

        {/* ── Resolve button (appears when both checked) ────────────── */}
        <button
          onClick={canResolve ? onBothResolved : undefined}
          disabled={!canResolve}
          title={
            !bothChecked  ? 'Both players must confirm first' :
            !canAfford    ? `Need ${needMore}g more in your gold pool` :
            undefined
          }
          className={[
            'w-full py-2 rounded-xl border font-bold text-sm transition-all',
            canResolve
              ? 'border-emerald-500 bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/70 cursor-pointer'
              : 'border-gray-700 bg-transparent text-gray-600 cursor-not-allowed',
          ].join(' ')}
        >
          {!bothChecked
            ? `Waiting… (${[playerDone && 'you', opponentDone && 'opp'].filter(Boolean).join(', ') || 'no one'} confirmed)`
            : !canAfford
            ? `Need ${needMore}g`
            : resolveLabel}
        </button>
      </div>
    </div>
  );
}

function ConfirmButton({
  label, checked, onClick,
}: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-[11px] font-semibold transition-all',
        checked
          ? 'border-emerald-500 bg-emerald-950/50 text-emerald-300'
          : 'border-board-border bg-board-bg text-gray-500 hover:border-gray-500 hover:text-gray-300',
      ].join(' ')}
    >
      <span className={[
        'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
        checked ? 'border-emerald-400 bg-emerald-700' : 'border-gray-600',
      ].join(' ')}>
        {checked && <span className="text-[8px] text-white font-bold">✓</span>}
      </span>
      {label}
    </button>
  );
}

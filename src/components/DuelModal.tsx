/**
 * DuelModal — UI for the AEG-edition duel system.
 *
 * Stage 1 — Challenge: defender may accept or refuse.
 * Stage 2 — Focus: players alternate playing Focus cards or passing.
 *   - "Focus from Hand": pick a face-down card from your hand (identity hidden).
 *   - "Focus from Deck": reveal the top card of your Fate deck (shown to both).
 *   - "Pass": forfeit this Focus turn; two consecutive passes → Strike.
 * Strike is resolved automatically once both players pass.
 */

import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { calcEffectiveChi } from '../engine/gameActions';
import type { FocusCard } from '../types/cards';

export function DuelModal() {
  const pendingDuel  = useGameStore(s => s.pendingDuel);
  const player       = useGameStore(s => s.player);
  const opponent     = useGameStore(s => s.opponent);

  const acceptDuel    = useGameStore(s => s.acceptDuel);
  const refuseDuel    = useGameStore(s => s.refuseDuel);
  const focusFromHand = useGameStore(s => s.focusFromHand);
  const focusFromDeck = useGameStore(s => s.focusFromDeck);
  const passFocus     = useGameStore(s => s.passFocus);
  const cancelDuel    = useGameStore(s => s.cancelDuel);

  const [pickingCard, setPickingCard] = useState(false);

  if (!pendingDuel) return null;

  const {
    challengerInstanceId, defenderInstanceId,
    challengerSide, triggerCardName,
    stage, focusTurn, canRefuse,
    playerFocusCards, opponentFocusCards,
  } = pendingDuel;

  const defenderSide: 'player' | 'opponent' = challengerSide === 'player' ? 'opponent' : 'player';
  const challengerPs = challengerSide === 'player' ? player : opponent;
  const defenderPs   = defenderSide   === 'player' ? player : opponent;

  const challenger = challengerPs.personalitiesHome.find(p => p.instanceId === challengerInstanceId);
  const defender   = defenderPs.personalitiesHome.find(p => p.instanceId === defenderInstanceId);

  const isMyFocusTurn = focusTurn === 'player';
  const playerFocusTotal    = playerFocusCards.reduce((s, c) => s + c.focusValue, 0);
  const opponentFocusTotal  = opponentFocusCards.reduce((s, c) => s + c.focusValue, 0);

  const playerDuelistChi    = (challengerSide === 'player' ? challenger : defender);
  const opponentDuelistChi  = (challengerSide === 'opponent' ? challenger : defender);
  const playerTotal   = (playerDuelistChi   ? calcEffectiveChi(playerDuelistChi)   : 0) + playerFocusTotal;
  const opponentTotal = (opponentDuelistChi ? calcEffectiveChi(opponentDuelistChi) : 0) + opponentFocusTotal;

  const handleFocusCard = (instanceId: string) => {
    focusFromHand(instanceId);
    setPickingCard(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-amber-700/60 rounded-xl shadow-2xl p-5 w-[460px] max-w-[95vw] flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg font-bold">⚔ Duel</span>
            <span className="text-gray-500 text-xs italic">{triggerCardName}</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
            stage === 'challenge'
              ? 'border-yellow-700 text-yellow-400 bg-yellow-950/40'
              : 'border-blue-700 text-blue-300 bg-blue-950/40'
          }`}>
            {stage === 'challenge' ? 'Challenge' : 'Focus Phase'}
          </span>
        </div>

        {/* Duelists */}
        <div className="grid grid-cols-2 gap-3">
          <DuelistCard
            label={`${challengerSide === 'player' ? 'Your' : "Opp."} challenger`}
            name={challenger?.card.name ?? '?'}
            chi={challenger ? calcEffectiveChi(challenger) : 0}
            focusCards={challengerSide === 'player' ? playerFocusCards : opponentFocusCards}
            total={challengerSide === 'player' ? playerTotal : opponentTotal}
            isLocalPlayer={challengerSide === 'player'}
          />
          <DuelistCard
            label={`${defenderSide === 'player' ? 'Your' : "Opp."} defender`}
            name={defender?.card.name ?? '?'}
            chi={defender ? calcEffectiveChi(defender) : 0}
            focusCards={defenderSide === 'player' ? playerFocusCards : opponentFocusCards}
            total={defenderSide === 'player' ? playerTotal : opponentTotal}
            isLocalPlayer={defenderSide === 'player'}
          />
        </div>

        {/* ── Challenge stage ─────────────────────────────────────── */}
        {stage === 'challenge' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              {defenderSide === 'player'
                ? <>You have been challenged by <strong className="text-amber-300">{challenger?.card.name}</strong>. Accept or refuse?{canRefuse && <> Refusal may carry a penalty per the triggering card's text.</>}</>
                : <>Your <strong className="text-amber-300">{challenger?.card.name}</strong> challenges <strong className="text-red-300">{defender?.card.name}</strong>. Waiting for the defender's response.</>
              }
            </p>
            {defenderSide === 'player' ? (
              <div className="flex gap-2">
                <button
                  onClick={acceptDuel}
                  className="flex-1 bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold py-1.5 rounded transition-colors"
                >
                  Accept Duel
                </button>
                {canRefuse && (
                  <button
                    onClick={refuseDuel}
                    className="flex-1 border border-gray-600 text-gray-300 hover:border-gray-400 text-sm py-1.5 rounded transition-colors"
                  >
                    Refuse (apply penalty manually)
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center text-amber-300 text-sm animate-pulse py-1">
                Waiting for opponent response…
              </div>
            )}
            <button
              onClick={cancelDuel}
              className="text-[10px] text-gray-600 hover:text-gray-400 self-end transition-colors"
            >
              Cancel duel
            </button>
          </div>
        )}

        {/* ── Focus stage ─────────────────────────────────────────── */}
        {stage === 'focus' && !pickingCard && (
          <div className="flex flex-col gap-3">
            {/* Turn indicator */}
            <div className={`text-xs font-semibold text-center py-1.5 rounded border ${
              isMyFocusTurn
                ? 'border-blue-600 text-blue-300 bg-blue-950/30'
                : 'border-gray-700 text-gray-400 bg-gray-800/30 animate-pulse'
            }`}>
              {isMyFocusTurn ? '▶ Your turn to focus or pass' : '⏳ Waiting for opponent to focus or pass…'}
            </div>

            <p className="text-[10px] text-gray-500 leading-relaxed">
              Focus: play a card <strong>face-down from hand</strong> (identity hidden) or reveal the
              <strong> top of your Fate deck</strong> face-up. Both players pass → Strike.
              Higher (Chi + Focus) wins; <em>Duelist</em> keyword wins ties.
            </p>

            {/* Focus actions */}
            {isMyFocusTurn && (
              <div className="flex gap-2">
                <button
                  onClick={() => setPickingCard(true)}
                  disabled={player.hand.length === 0}
                  className="flex-1 text-xs font-semibold px-3 py-1.5 rounded border border-blue-700 text-blue-300 bg-blue-950/30 hover:bg-blue-900/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Focus from Hand{player.hand.length > 0 ? ` (${player.hand.length})` : ' (empty)'}
                </button>
                <button
                  onClick={focusFromDeck}
                  disabled={player.fateDeck.length === 0}
                  className="flex-1 text-xs font-semibold px-3 py-1.5 rounded border border-purple-700 text-purple-300 bg-purple-950/30 hover:bg-purple-900/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Focus from Deck{player.fateDeck.length > 0 ? ` (${player.fateDeck.length})` : ' (empty)'}
                </button>
                <button
                  onClick={passFocus}
                  className="px-3 py-1.5 rounded border border-gray-700 text-gray-400 text-xs hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  Pass
                </button>
              </div>
            )}

            {/* Running totals */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-[9px] text-gray-500 uppercase">You</div>
                <div className="text-lg font-bold text-white">{playerTotal}</div>
                <div className="text-[9px] text-gray-500">Chi + Focus {playerFocusTotal}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-[9px] text-gray-500 uppercase">Opponent</div>
                <div className="text-lg font-bold text-gray-300">{opponentTotal}</div>
                <div className="text-[9px] text-gray-500">
                  Chi + Focus {opponentFocusCards.filter(c => !c.faceDown).reduce((s, c) => s + c.focusValue, 0)}
                  {opponentFocusCards.some(c => c.faceDown) && <span className="text-yellow-600"> +?</span>}
                </div>
              </div>
            </div>

            <button
              onClick={cancelDuel}
              className="text-[10px] text-gray-600 hover:text-gray-400 self-end transition-colors"
            >
              Cancel duel
            </button>
          </div>
        )}

        {/* ── Hand card picker ────────────────────────────────────── */}
        {stage === 'focus' && pickingCard && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold">Choose a card to focus face-down:</span>
              <button onClick={() => setPickingCard(false)} className="text-[10px] text-gray-600 hover:text-gray-400">↩ Back</button>
            </div>
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
              {player.hand.length === 0 && (
                <div className="text-xs text-gray-500 italic text-center py-3">Hand is empty</div>
              )}
              {player.hand.map(card => (
                <button
                  key={card.instanceId}
                  onClick={() => handleFocusCard(card.instanceId)}
                  className="flex items-center justify-between px-3 py-1.5 rounded border border-gray-700 hover:border-blue-600 hover:bg-blue-950/20 text-left transition-colors"
                >
                  <span className="text-xs text-gray-200">{card.card.name}</span>
                  <span className="text-[10px] text-blue-400 ml-2">Focus {card.card.focus || 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DuelistCard ──────────────────────────────────────────────────────────────

function DuelistCard({
  label, name, chi, focusCards, total, isLocalPlayer,
}: {
  label: string;
  name: string;
  chi: number;
  focusCards: FocusCard[];
  total: number;
  isLocalPlayer: boolean;
}) {
  const focusTotal = focusCards.reduce((s, c) => s + c.focusValue, 0);
  return (
    <div className={`rounded-lg border p-2.5 flex flex-col gap-1 ${
      isLocalPlayer ? 'border-amber-600/60 bg-amber-950/20' : 'border-gray-700/60 bg-gray-800/20'
    }`}>
      <span className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-semibold ${isLocalPlayer ? 'text-amber-200' : 'text-gray-300'}`}>{name}</span>
      <div className="text-[10px] text-gray-400 flex gap-2">
        <span className="text-blue-400">Chi {chi}</span>
        {focusCards.length > 0 && <span className="text-green-400">+F{focusTotal}</span>}
        {focusCards.length > 0 && <span className="text-white font-bold">={total}</span>}
      </div>
      {focusCards.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {focusCards.map((c, i) => (
            <span
              key={i}
              className={`text-[8px] px-1 py-0.5 rounded border ${
                c.faceDown && !isLocalPlayer
                  ? 'border-gray-700 text-gray-600 bg-gray-800/50'
                  : 'border-green-800 text-green-400 bg-green-950/30'
              }`}
            >
              {c.faceDown && !isLocalPlayer ? '??' : `${c.cardName} F${c.focusValue}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

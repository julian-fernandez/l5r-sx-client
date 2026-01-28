import { useState, useCallback, useEffect } from 'react';
import type { CardInstance, NormalizedCard, PlayerState } from '../types/cards';
import { useGameStore, type TurnPhase } from '../store/gameStore';
import { getValidAttachTargets } from './CardResolutionOverlay';
import { GameRow } from './GameRow';
import { InPlayRow } from './InPlayRow';
import { CardPreview } from './CardPreview';
import { CardModal } from './CardModal';
import { CardResolutionOverlay } from './CardResolutionOverlay';
import { DeckBrowser } from './DeckBrowser';
import { GameLog } from './GameLog';
import { ActionsPanel } from './ActionsPanel';
import { BattleStrip } from './BattleStrip';

/** State for tracking a card being played from hand */
interface PlayState {
  instance: CardInstance;
  /** null = attachment that still needs a target; 'none' = no target needed (strategies) */
  targetId: string | null;
}

interface Props {
  player: PlayerState;
  opponent: PlayerState;
  activePlayer: 'player' | 'opponent';
  onReset: () => void;
}

const PHASE_LABELS: Record<TurnPhase, string> = {
  straighten: 'Straighten',
  event:      'Event',
  action:     'Action',
  attack:     'Attack',
  dynasty:    'Dynasty',
  discard:    'Discard',
  draw:       'Draw',
  end:        'End',
};

interface PreviewState {
  card: NormalizedCard;
  x: number;
  y: number;
}

interface DeckBrowserState {
  cards: CardInstance[];
  title: string;
}

export function Board({ player, opponent, activePlayer, onReset }: Props) {
  const [preview, setPreview]         = useState<PreviewState | null>(null);
  const [modal, setModal]             = useState<NormalizedCard | null>(null);
  const [deckBrowser, setDeckBrowser] = useState<DeckBrowserState | null>(null);
  const [openPanel, setOpenPanel]     = useState<'actions' | 'log' | null>(null);
  const [playState, setPlayState]     = useState<PlayState | null>(null);

  const togglePanel = (panel: 'actions' | 'log') =>
    setOpenPanel(p => (p === panel ? null : panel));

  const turnPhase             = useGameStore(s => s.turnPhase);
  const priority              = useGameStore(s => s.priority);
  const passPriority          = useGameStore(s => s.passPriority);
  const opponentAutoPass      = useGameStore(s => s.opponentAutoPass);
  const advancePhase          = useGameStore(s => s.advancePhase);
  const battleAssignments     = useGameStore(s => s.battleAssignments);
  const battleStage           = useGameStore(s => s.battleStage);
  const endAttackPhase        = useGameStore(s => s.endAttackPhase);
  const passBattlefieldAction = useGameStore(s => s.passBattlefieldAction);
  const battleWindowPriority  = useGameStore(s => s.battleWindowPriority);

  // ── Auto-opponent: skip the entire opponent turn & auto-pass priority ──────
  useEffect(() => {
    const DELAY = 450;
    let timer: number;

    if (activePlayer === 'opponent') {
      // Whole opponent turn auto-skips
      if (
        turnPhase === 'straighten' || turnPhase === 'event' ||
        turnPhase === 'dynasty'    || turnPhase === 'discard' || turnPhase === 'end'
      ) {
        timer = window.setTimeout(() => advancePhase(), DELAY);
      } else if (turnPhase === 'action') {
        // Auto-pass whichever side has priority
        timer = window.setTimeout(
          () => (priority === 'opponent' ? opponentAutoPass() : passPriority()),
          DELAY,
        );
      } else if (turnPhase === 'attack') {
        // Skip battle entirely on opponent's turn
        timer = window.setTimeout(() => endAttackPhase(), DELAY);
      }
    } else {
      // Player's turn — only auto-pass opponent's actions
      if (turnPhase === 'action' && priority === 'opponent') {
        timer = window.setTimeout(() => opponentAutoPass(), DELAY);
      } else if (
        turnPhase === 'attack' &&
        (battleStage === 'engage' || battleStage === 'battleWindow') &&
        battleWindowPriority === 'opponent'
      ) {
        timer = window.setTimeout(() => passBattlefieldAction('opponent'), DELAY);
      }
    }

    return () => clearTimeout(timer);
  }, [
    activePlayer, turnPhase, priority, battleStage, battleWindowPriority,
    advancePhase, opponentAutoPass, passPriority, endAttackPhase, passBattlefieldAction,
  ]);

  const playFromHand = useGameStore(s => s.playFromHand);

  // ── Card play handlers ───────────────────────────────────────────────────
  const handlePlayCard = useCallback((instance: CardInstance) => {
    const isAttachment = ['item', 'follower', 'spell'].includes(instance.card.type);
    setPlayState({ instance, targetId: isAttachment ? null : 'none' });
    setPreview(null);
  }, []);

  const handleConfirmPlay = useCallback((abilityText?: string) => {
    if (!playState) return;
    const { instance, targetId } = playState;
    const isAttachment = ['item', 'follower', 'spell'].includes(instance.card.type);
    if (isAttachment && !targetId) return;
    playFromHand(instance.instanceId, 'player', targetId ?? undefined, abilityText);
    setPlayState(null);
  }, [playState, playFromHand]);

  const handleCancelPlay = useCallback(() => setPlayState(null), []);

  const handleSelectAttachTarget = useCallback((instanceId: string) => {
    setPlayState(prev => prev ? { ...prev, targetId: instanceId } : null);
  }, []);

  // Valid attach targets for the currently played card (empty when not targeting)
  const validAttachTargets = playState
    ? getValidAttachTargets(playState.instance.card, player.personalitiesHome)
    : new Set<string>();

  // Which timing windows are currently open for the player (used by the ability picker)
  const validTimings = new Set<string>();
  if (turnPhase === 'action') {
    validTimings.add('open');
    if (activePlayer === 'player') validTimings.add('limited');
  }
  if (turnPhase === 'attack' && battleWindowPriority === 'player') {
    if (battleStage === 'engage')       validTimings.add('engage');
    if (battleStage === 'battleWindow') validTimings.add('battle');
  }

  const handleOpenDeckBrowser = useCallback((cards: CardInstance[], title: string) => {
    setPreview(null);
    setDeckBrowser({ cards, title });
  }, []);

  const handlePreview      = useCallback((card: NormalizedCard, e: React.MouseEvent) =>
    setPreview({ card, x: e.clientX, y: e.clientY }), []);
  const handlePreviewMove  = useCallback((e: React.MouseEvent) =>
    setPreview(p => p ? { ...p, x: e.clientX, y: e.clientY } : null), []);
  const handlePreviewClear = useCallback(() => setPreview(null), []);
  const handleModal        = useCallback((card: NormalizedCard) => {
    setPreview(null); setModal(card);
  }, []);

  const pp = {
    onPreview: handlePreview,
    onPreviewMove: handlePreviewMove,
    onPreviewClear: handlePreviewClear,
    onModal: handleModal,
  };

  const clanAccent = clanColor(player.stronghold?.clan ?? null);
  const playerGoesFirst = activePlayer === 'player';

  return (
    <>
      <div className="flex flex-col" style={{ height: '100dvh', background: '#090d1a', overflow: 'hidden' }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-1.5 border-b border-board-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-1 h-4 rounded-full flex-shrink-0 ${clanAccent}`} />

            {/* Opponent label */}
            <div className="flex items-center gap-1.5">
              {!playerGoesFirst && <FirstPlayerBadge />}
              <span className={`text-[11px] font-semibold ${!playerGoesFirst ? 'text-white' : 'text-gray-500'}`}>
                {opponent.stronghold?.name ?? '—'} (Opponent)
              </span>
            </div>

            <span className="text-gray-700 text-[10px]">vs</span>

            {/* Player label */}
            <div className="flex items-center gap-1.5">
              {playerGoesFirst && <FirstPlayerBadge />}
              <span className={`text-[11px] font-semibold ${playerGoesFirst ? 'text-white' : 'text-gray-500'}`}>
                {player.stronghold?.name ?? '—'} (You)
              </span>
            </div>
          </div>

          {/* ── Phase + priority indicator ─────────────────────── */}
          <PhaseIndicator phase={turnPhase} priority={priority} />

          <div className="flex items-center gap-2">
            {/* Pass priority — only show during player's action phase */}
            {turnPhase === 'action' && activePlayer === 'player' && priority === 'player' && (
              <PassPriorityButton onClick={passPriority} />
            )}

            <NextPhaseButton phase={turnPhase} activePlayer={activePlayer} onAdvance={advancePhase} />

            {/* Panel toggles */}
            <ActionsPanelToggle active={openPanel === 'actions'} onClick={() => togglePanel('actions')} />
            <LogPanelToggle     active={openPanel === 'log'}     onClick={() => togglePanel('log')} />

            <button onClick={onReset} className="btn-ghost text-[11px] py-0.5 px-2">← New Deck</button>
          </div>
        </header>

        {/* ── Content ───────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 px-2 py-1.5 gap-1.5">

          {/* OPPONENT — top GameRow (flex-1, grows) */}
          <GameRow
            player={opponent}
            isOpponent
            onOpenDeckBrowser={handleOpenDeckBrowser}
            incomingAttacks={battleAssignments}
            attackerPersonalities={player.personalitiesHome}
            {...pp}
          />

          {/* OPPONENT — in-play row (compact, fixed) */}
          <InPlayRow
            holdingsInPlay={opponent.holdingsInPlay}
            personalitiesHome={opponent.personalitiesHome}
            specialsInPlay={opponent.specialsInPlay}
            isOpponent
            turnPhase={turnPhase}
            {...pp}
          />

          {/* ── Battlefield divider / BattleStrip ───────────────── */}
          {turnPhase === 'attack' ? (
            <BattleStrip
              battleAssignments={battleAssignments}
              battleStage={battleStage}
              playerPersonalities={player.personalitiesHome}
              opponentProvinces={opponent.provinces}
            />
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex-1 h-px bg-board-border" />
              <span className="text-[9px] font-semibold text-gray-700 uppercase tracking-widest px-2">Battlefield</span>
              <div className="flex-1 h-px bg-board-border" />
            </div>
          )}

          {/* PLAYER — in-play row (compact, fixed) */}
          <InPlayRow
            holdingsInPlay={player.holdingsInPlay}
            personalitiesHome={player.personalitiesHome}
            specialsInPlay={player.specialsInPlay}
            turnPhase={turnPhase}
            battleAssignments={battleAssignments}
            opponentProvinces={opponent.provinces}
            validAttachTargets={validAttachTargets}
            onSelectAttachTarget={handleSelectAttachTarget}
            selectedAttachTarget={playState?.targetId ?? null}
            {...pp}
          />

          {/* PLAYER — bottom GameRow (flex-1, grows) */}
          <GameRow
            player={player}
            onOpenDeckBrowser={handleOpenDeckBrowser}
            onPlayCard={handlePlayCard}
            {...pp}
          />

        </div>
      </div>

      {/* ── Card resolution overlay ─────────────────────────────────── */}
      {playState && (
        <CardResolutionOverlay
          instance={playState.instance}
          targetId={playState.targetId === 'none' ? null : playState.targetId}
          personalities={player.personalitiesHome}
          validTimings={validTimings}
          onConfirm={handleConfirmPlay}
          onCancel={handleCancelPlay}
        />
      )}

      {/* ── Slide-over panel overlay ─────────────────────────────────── */}
      {openPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpenPanel(null)}
          />
          {/* Panel */}
          <div
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-board-zone border-l border-board-border shadow-2xl"
            style={{ width: '320px' }}
          >
            {openPanel === 'actions' && (
              <ActionsPanel
                player={player}
                onClose={() => setOpenPanel(null)}
                onOpenDeckBrowser={handleOpenDeckBrowser}
              />
            )}
            {openPanel === 'log' && (
              <GameLog onClose={() => setOpenPanel(null)} />
            )}
          </div>
        </>
      )}

      <CardPreview preview={preview} />
      <CardModal card={modal} onClose={() => setModal(null)} />
      {deckBrowser && (
        <DeckBrowser
          cards={deckBrowser.cards}
          title={deckBrowser.title}
          onClose={() => setDeckBrowser(null)}
          onPreview={handlePreview}
          onPreviewMove={handlePreviewMove}
          onPreviewClear={handlePreviewClear}
          onModal={handleModal}
        />
      )}
    </>
  );
}

function ActionsPanelToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  const availableCount = useGameStore(s => {
    const p = s.player;
    let n = 0;
    if (s.turnNumber === 1 && !p.cyclingDone && s.cyclingActive === null) n++;
    for (const h of p.holdingsInPlay) {
      const name = h.card.name;
      const used = p.abilitiesUsed.includes(h.instanceId);
      if (!used && !h.bowed && (/border keep/i.test(name) || /bamboo harvesters/i.test(name))) n++;
    }
    return n;
  });
  return (
    <button
      onClick={onClick}
      title="Available actions & activated abilities"
      className={[
        'relative text-[10px] font-semibold px-2.5 py-1 rounded border transition-all leading-none',
        active
          ? 'border-sky-500 bg-sky-900/60 text-sky-200'
          : 'border-gray-700 bg-transparent text-gray-400 hover:border-sky-700 hover:text-sky-300',
      ].join(' ')}
    >
      ⚡ Actions
      {availableCount > 0 && (
        <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-sky-500 text-black rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
          {availableCount}
        </span>
      )}
    </button>
  );
}

function LogPanelToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  const count = useGameStore(s => s.gameLog.length);
  return (
    <button
      onClick={onClick}
      title="Game log"
      className={[
        'text-[10px] font-semibold px-2.5 py-1 rounded border transition-all leading-none',
        active
          ? 'border-gray-500 bg-gray-800/60 text-gray-200'
          : 'border-gray-700 bg-transparent text-gray-500 hover:border-gray-500 hover:text-gray-300',
      ].join(' ')}
    >
      📋 Log {count > 0 && <span className="text-gray-600">({count})</span>}
    </button>
  );
}

function FirstPlayerBadge() {
  return (
    <span className="text-[9px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">
      First
    </span>
  );
}

function PhaseIndicator({ phase, priority }: { phase: TurnPhase; priority: 'player' | 'opponent' }) {
  const isActionPhase = phase === 'action';
  const playerHasPriority = priority === 'player';

  return (
    <div className="flex items-center gap-2">
      {/* Phase pill */}
      <div className="flex items-center gap-1.5 bg-board-zone border border-board-border rounded-full px-3 py-0.5">
        <span className="text-gray-500 text-[9px] uppercase tracking-widest">Phase</span>
        <span className="text-[10px] font-bold text-gray-200 uppercase tracking-wide">
          {PHASE_LABELS[phase]}
        </span>
      </div>

      {/* Priority pill — only shown during action phase */}
      {isActionPhase && (
        <div className={[
          'flex items-center gap-1.5 rounded-full px-3 py-0.5 border text-[9px] font-semibold uppercase tracking-wide transition-all duration-300',
          playerHasPriority
            ? 'border-sky-600 bg-sky-950/60 text-sky-300'
            : 'border-gray-700 bg-transparent text-gray-600',
        ].join(' ')}>
          <span className={[
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            playerHasPriority ? 'bg-sky-400 animate-pulse' : 'bg-gray-600',
          ].join(' ')} />
          {playerHasPriority ? 'Your priority' : 'Opponent acting…'}
        </div>
      )}
    </div>
  );
}

const HAND_LIMIT = 8;

function NextPhaseButton({
  phase, activePlayer, onAdvance,
}: { phase: TurnPhase; activePlayer: 'player' | 'opponent'; onAdvance: () => void }) {
  const hand = useGameStore(s => s[activePlayer].hand);

  // Action / Attack / Draw phases are governed by Pass buttons or auto-handled
  if (phase === 'action' || phase === 'attack' || phase === 'draw') {
    return null;
  }

  const mustDiscard = phase === 'end' && hand.length > HAND_LIMIT;
  const surplus = hand.length - HAND_LIMIT;

  const label =
    phase === 'straighten' ? 'Flip Provinces →' :
    phase === 'event'      ? '→ Action Phase' :
    phase === 'dynasty'    ? 'Done Buying →' :
    phase === 'discard'    ? 'Done Discarding  (draws 1) →' :
    mustDiscard             ? `Discard ${surplus} card${surplus > 1 ? 's' : ''} first` :
    'End Turn →';

  return (
    <button
      onClick={mustDiscard ? undefined : onAdvance}
      disabled={mustDiscard}
      title={
        phase === 'straighten'
          ? 'Flip all four of your provinces face-up. Events and Celestials resolve immediately.'
          : phase === 'event'
          ? 'Events have resolved — proceed to the Action Phase'
          : phase === 'discard'
          ? 'End Discard Phase — automatically draws 1 Fate card then goes to End Phase'
          : phase === 'end' && mustDiscard
          ? `Hand limit is ${HAND_LIMIT}. Click hand cards to discard.`
          : undefined
      }
      className={[
        'text-[11px] font-semibold px-3 py-1 rounded border transition-all flex-shrink-0',
        mustDiscard
          ? 'border-red-700 text-red-400 bg-red-950/40 cursor-not-allowed'
          : phase === 'end'
          ? 'border-emerald-600 text-emerald-300 bg-emerald-950/50 hover:bg-emerald-900/70 cursor-pointer'
          : phase === 'straighten'
          ? 'border-amber-500 text-amber-300 bg-amber-950/50 hover:bg-amber-900/70 cursor-pointer animate-pulse'
          : 'border-sky-600 text-sky-300 bg-sky-950/50 hover:bg-sky-900/70 cursor-pointer',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function PassPriorityButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Pass action priority to opponent. If both players pass consecutively, the Action Phase ends."
      className="text-[11px] font-semibold px-3 py-1 rounded border transition-all flex-shrink-0 border-sky-600 text-sky-300 bg-sky-950/50 hover:bg-sky-900/70 cursor-pointer"
    >
      Pass →
    </button>
  );
}

function clanColor(clan: string | null): string {
  switch (clan?.toLowerCase()) {
    case 'crab':       return 'bg-clan-crab';
    case 'crane':      return 'bg-clan-crane';
    case 'dragon':     return 'bg-clan-dragon';
    case 'lion':       return 'bg-clan-lion';
    case 'phoenix':    return 'bg-clan-phoenix';
    case 'scorpion':   return 'bg-clan-scorpion';
    case 'unicorn':    return 'bg-clan-unicorn';
    case 'mantis':     return 'bg-clan-mantis';
    default:           return 'bg-gray-600';
  }
}

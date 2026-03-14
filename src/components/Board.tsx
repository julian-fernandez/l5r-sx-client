import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CardInstance, NormalizedCard, PlayerState } from '../types/cards';
import { useGameStore, type TurnPhase } from '../store/gameStore';
import { isCavalryUnit, calcFollowerForce } from '../engine/gameActions';
import type { BattleKeywordType } from '../engine/gameActions';
import { getValidAttachTargets } from './CardResolutionOverlay';
import { ManualResolutionOverlay } from './ManualResolutionOverlay';
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
  /**
   * When true, uses ManualResolutionOverlay instead of CardResolutionOverlay.
   * Both players must confirm before the card resolves.
   */
  manual?: boolean;
}

/** State for a pending Fear / Melee / Ranged battle keyword — waiting for a target click */
interface BattleTargetMode {
  sourceId: string;
  type: BattleKeywordType;
  value: number;
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
  const [preview, setPreview]               = useState<PreviewState | null>(null);
  const [modal, setModal]                   = useState<NormalizedCard | null>(null);
  const [deckBrowser, setDeckBrowser]       = useState<DeckBrowserState | null>(null);
  const [openPanel, setOpenPanel]           = useState<'actions' | 'log' | null>(null);
  const [playState, setPlayState]           = useState<PlayState | null>(null);
  /** Fear/Melee/Ranged targeting: waiting for the player to click an opponent personality */
  const [battleTargetMode, setBattleTargetMode] = useState<BattleTargetMode | null>(null);
  /** Tactician mode: waiting for the player to pick a Fate card from hand */
  const [tacticianPersonalityId, setTacticianPersonalityId] = useState<string | null>(null);
  /** Reserve mode: waiting for the player to pick a province to recruit from */
  const [reserveSourceId, setReserveSourceId] = useState<string | null>(null);
  /**
   * Manual resolution for in-play card abilities (personalities, holdings).
   * No zone change happens automatically — effect is resolved verbally.
   */
  const [manualAbilityCard, setManualAbilityCard] = useState<CardInstance | null>(null);

  const togglePanel = (panel: 'actions' | 'log') =>
    setOpenPanel(p => (p === panel ? null : panel));

  const turnPhase             = useGameStore(s => s.turnPhase);
  const priority              = useGameStore(s => s.priority);
  const passPriority          = useGameStore(s => s.passPriority);
  const opponentAutoPass      = useGameStore(s => s.opponentAutoPass);
  const advancePhase          = useGameStore(s => s.advancePhase);
  const battleAssignments     = useGameStore(s => s.battleAssignments);
  const defenderAssignments   = useGameStore(s => s.defenderAssignments);
  const assignDefender        = useGameStore(s => s.assignDefender);
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

  // ── Auto-defender: when player commits attackers, opponent assigns defenders ─
  // Fires when battleStage moves to 'resolving' and no defenders are yet assigned.
  // Assignment order mirrors the CR: non-Cavalry defenders first, then Cavalry.
  useEffect(() => {
    if (battleStage !== 'resolving') return;
    if (defenderAssignments.length > 0) return; // already assigned

    const attackedProvinces = [...new Set(battleAssignments.map(a => a.provinceIndex))];
    if (attackedProvinces.length === 0) return;

    // Sort opponent personalities: non-Cavalry first, Cavalry last
    const available = [...opponent.personalitiesHome]
      .filter(p => !p.bowed) // bowed personalities cannot defend
      .sort((a, b) => (isCavalryUnit(a) ? 1 : 0) - (isCavalryUnit(b) ? 1 : 0));

    if (available.length === 0) return;

    const timer = window.setTimeout(() => {
      // Assign one defender per attacked province (as many as available)
      for (let i = 0; i < attackedProvinces.length && i < available.length; i++) {
        assignDefender(available[i].instanceId, attackedProvinces[i]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [battleStage, defenderAssignments.length, battleAssignments, opponent.personalitiesHome, assignDefender]);

  const playFromHand       = useGameStore(s => s.playFromHand);
  const applyBattleKeyword = useGameStore(s => s.applyBattleKeyword);
  const activateTactician  = useGameStore(s => s.activateTactician);
  const reserveRecruit     = useGameStore(s => s.reserveRecruit);
  const gameResult         = useGameStore(s => s.gameResult);

  // ── Card play handlers ───────────────────────────────────────────────────
  const handlePlayCard = useCallback((instance: CardInstance) => {
    const isAttachment = ['item', 'follower', 'spell'].includes(instance.card.type);
    setPlayState({ instance, targetId: isAttachment ? null : 'none' });
    setPreview(null);
  }, []);

  /** Opens the manual resolution overlay for a hand card (bypasses timing/ability checks). */
  const handleManualPlay = useCallback((instance: CardInstance) => {
    const isAttachment = ['item', 'follower', 'spell'].includes(instance.card.type);
    setPlayState({ instance, targetId: isAttachment ? null : 'none', manual: true });
    setPreview(null);
  }, []);

  /**
   * Opens the manual resolution overlay for an in-play card ability.
   * No automatic zone changes occur — effect is resolved verbally.
   */
  const handleManualAbility = useCallback((instance: CardInstance) => {
    setManualAbilityCard(instance);
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

  // ── Battle keyword targeting ──────────────────────────────────────────────
  // Compute which opponent personalities are valid targets for the active keyword
  const validBattleTargets = useMemo(() => {
    if (!battleTargetMode) return new Set<string>();
    const { value } = battleTargetMode;
    const targets = new Set<string>();
    for (const p of opponent.personalitiesHome) {
      // Valid if: has any follower whose effective Force ≤ value (bowed state irrelevant),
      // OR the personality's own Force ≤ value.
      const hasShieldFollower = p.attachments.some(
        att => att.card.type === 'follower' && calcFollowerForce(att) <= value,
      );
      const persForce = Math.max(0, Number(p.card.force) || 0);
      if (hasShieldFollower || persForce <= value) targets.add(p.instanceId);
    }
    return targets;
  }, [battleTargetMode, opponent.personalitiesHome]);

  const handleBattleKeywordTrigger = useCallback(
    (sourceId: string, type: BattleKeywordType | 'tactician', value: number) => {
      if (type === 'tactician') {
        setTacticianPersonalityId(sourceId);
      } else if (type === 'reserve') {
        setReserveSourceId(sourceId);
      } else {
        setBattleTargetMode({ sourceId, type, value });
      }
    },
    [],
  );

  const handleSelectBattleTarget = useCallback((targetId: string) => {
    if (!battleTargetMode) return;
    applyBattleKeyword(battleTargetMode.sourceId, targetId, battleTargetMode.type, battleTargetMode.value);
    setBattleTargetMode(null);
  }, [battleTargetMode, applyBattleKeyword]);

  const handleTacticianCardPick = useCallback((cardInstanceId: string) => {
    if (!tacticianPersonalityId) return;
    activateTactician(tacticianPersonalityId, cardInstanceId);
    setTacticianPersonalityId(null);
  }, [tacticianPersonalityId, activateTactician]);

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
            defenderAssignments={defenderAssignments}
            validBattleTargets={validBattleTargets}
            onSelectBattleTarget={handleSelectBattleTarget}
            {...pp}
          />

          {/* ── Battlefield divider / BattleStrip ───────────────── */}
          {turnPhase === 'attack' ? (
            <BattleStrip
              battleAssignments={battleAssignments}
              defenderAssignments={defenderAssignments}
              battleStage={battleStage}
              playerPersonalities={player.personalitiesHome}
              opponentPersonalities={opponent.personalitiesHome}
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
            onBattleKeywordTrigger={handleBattleKeywordTrigger}
            onManualAbility={handleManualAbility}
            {...pp}
          />

          {/* PLAYER — bottom GameRow (flex-1, grows) */}
          <GameRow
            player={player}
            onOpenDeckBrowser={handleOpenDeckBrowser}
            onPlayCard={handlePlayCard}
            onManualPlay={handleManualPlay}
            {...pp}
          />

        </div>
      </div>

      {/* ── Battle targeting hint banner ─────────────────────────────── */}
      {battleTargetMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                        bg-orange-950/90 border border-orange-600 rounded-xl px-4 py-2 shadow-2xl text-sm">
          <span className="text-orange-300 font-semibold">
            {battleTargetMode.type === 'fear'
              ? `Fear ${battleTargetMode.value}`
              : battleTargetMode.type === 'melee'
              ? `Melee Attack ${battleTargetMode.value}`
              : `Ranged Attack ${battleTargetMode.value}`}
          </span>
          <span className="text-orange-400/70 text-xs">— click an opponent personality to target</span>
          <button
            onClick={() => setBattleTargetMode(null)}
            className="text-[10px] text-orange-500 hover:text-orange-300 border border-orange-700 rounded px-2 py-0.5"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Tactician card picker ─────────────────────────────────────── */}
      {tacticianPersonalityId && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50
                        bg-board-zone border border-violet-600 rounded-xl shadow-2xl"
             style={{ minWidth: 320, maxWidth: 560 }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-board-border">
            <span className="text-[11px] font-bold text-violet-300">
              Tactician — pick a Fate card to discard for its Focus Value
            </span>
            <button
              onClick={() => setTacticianPersonalityId(null)}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-2 p-3 overflow-x-auto">
            {player.hand.length === 0 ? (
              <span className="text-gray-600 text-xs self-center px-2">No cards in hand</span>
            ) : player.hand.map(inst => (
              <button
                key={inst.instanceId}
                onClick={() => handleTacticianCardPick(inst.instanceId)}
                className="flex-shrink-0 flex flex-col items-center gap-1 group"
                title={`${inst.card.name} — Focus ${inst.card.focus}`}
              >
                <div className="relative rounded overflow-hidden border border-board-border group-hover:border-violet-500 transition-colors"
                     style={{ width: '7vh', height: '10vh' }}>
                  <img
                    src={inst.card.imagePath}
                    alt={inst.card.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <span className="text-[8px] text-violet-300 font-bold">Focus {inst.card.focus}</span>
                <span className="text-[7px] text-gray-500 max-w-[7vh] truncate">{inst.card.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Card resolution overlay (automated) ────────────────────── */}
      {playState && !playState.manual && (
        <CardResolutionOverlay
          instance={playState.instance}
          targetId={playState.targetId === 'none' ? null : playState.targetId}
          personalities={player.personalitiesHome}
          validTimings={validTimings}
          goldPool={player.goldPool}
          onConfirm={handleConfirmPlay}
          onCancel={handleCancelPlay}
        />
      )}

      {/* ── Manual resolution overlay (hand card) ───────────────────── */}
      {playState?.manual && (playState.targetId === 'none' || playState.targetId) && (
        <ManualResolutionOverlay
          instance={playState.instance}
          targetPersonality={
            playState.targetId && playState.targetId !== 'none'
              ? player.personalitiesHome.find(p => p.instanceId === playState.targetId) ?? null
              : null
          }
          goldPool={player.goldPool}
          onBothResolved={() => {
            handleConfirmPlay(undefined);
          }}
          onCancel={handleCancelPlay}
        />
      )}

      {/* ── Manual resolution overlay (in-play ability) ─────────────── */}
      {manualAbilityCard && (
        <ManualResolutionOverlay
          instance={manualAbilityCard}
          resolveLabel="Done — mark as resolved"
          onBothResolved={() => setManualAbilityCard(null)}
          onCancel={() => setManualAbilityCard(null)}
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

      {/* ── Reserve Province Picker ───────────────────────────────────────── */}
      {reserveSourceId && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#0d1325] border border-violet-600/60 rounded-xl shadow-2xl p-4"
          style={{ width: 340 }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-bold text-violet-300">Reserve</span>
              <span className="text-xs text-gray-500 ml-2">— pick a province to recruit from</span>
            </div>
            <button onClick={() => setReserveSourceId(null)}
              className="text-gray-600 hover:text-gray-300 text-sm leading-none">✕</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {player.provinces
              .filter(p => p.faceUp && p.card && !p.broken)
              .map(prov => {
                const cost = Math.max(0, Number(prov.card!.card.cost) || 0);
                const canAfford = player.goldPool >= cost;
                return (
                  <button
                    key={prov.index}
                    disabled={!canAfford}
                    onClick={() => {
                      reserveRecruit(prov.index, reserveSourceId);
                      setReserveSourceId(null);
                    }}
                    className={[
                      'flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all',
                      canAfford
                        ? 'border-violet-500/60 bg-violet-900/20 text-white hover:bg-violet-800/30 cursor-pointer'
                        : 'border-gray-700/40 bg-gray-900/20 text-gray-600 cursor-not-allowed',
                    ].join(' ')}
                    title={canAfford ? `Recruit for ${cost}g` : `Need ${cost}g (have ${player.goldPool}g)`}
                  >
                    <span className="font-semibold text-[10px] max-w-[70px] text-center leading-tight truncate">
                      {prov.card!.card.name}
                    </span>
                    <span className={`text-[9px] font-bold ${canAfford ? 'text-amber-400' : 'text-gray-600'}`}>
                      {cost}g
                    </span>
                    <span className="text-[8px] text-gray-600 capitalize">{prov.card!.card.type}</span>
                  </button>
                );
              })
            }
          </div>
          {player.provinces.every(p => !p.faceUp || !p.card || p.broken) && (
            <p className="text-[10px] text-gray-600 text-center mt-2">No face-up province cards available</p>
          )}
          {player.goldPool === 0 && (
            <p className="text-[9px] text-gray-700 mt-2 text-center">Bow holdings to build gold pool first</p>
          )}
        </div>
      )}

      {/* ── Game Result Screen ────────────────────────────────────────────── */}
      {gameResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="text-center space-y-6 px-8 py-10 bg-[#0b1020] border border-gray-700/60 rounded-2xl shadow-2xl max-w-md">
            {gameResult.winner === 'player' ? (
              <>
                <div className="text-5xl">🏆</div>
                <h1 className="text-4xl font-bold text-amber-300 tracking-wide">Victory!</h1>
                <p className="text-gray-400 text-sm">
                  {gameResult.reason === 'honor'
                    ? 'You achieved Honor Victory — 40 or more Family Honor at the start of your turn.'
                    : 'Your opponent has been reduced to Dishonor.'}
                </p>
              </>
            ) : (
              <>
                <div className="text-5xl">💀</div>
                <h1 className="text-4xl font-bold text-red-400 tracking-wide">Defeat</h1>
                <p className="text-gray-400 text-sm">
                  {gameResult.reason === 'dishonor'
                    ? 'Your Family Honor has reached −20. You have been dishonored.'
                    : 'Your opponent achieved Honor Victory.'}
                </p>
              </>
            )}
            <div className="pt-2">
              <button
                onClick={onReset}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-black font-bold rounded-lg text-sm transition-colors"
              >
                New Game
              </button>
            </div>
          </div>
        </div>
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

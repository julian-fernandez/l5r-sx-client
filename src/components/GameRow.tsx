/**
 * One player's combined row: Hand | [centered] Provinces + Decks | Pregame
 *
 * Uses CSS grid (1fr auto 1fr) so provinces are always screen-centered.
 * Card sizes are vh-based so they scale with available screen height.
 *
 * Interactions:
 *  - Fate deck: left-click = open DeckBrowser; "Draw ↑" pill below = draw 1 card
 *  - Dynasty deck: left-click = open DeckBrowser
 *  - Province card (face-up, player only): right-click = context menu with Recruit
 *  - Province card (Cycle mode, player only): left-click = cycle it
 *  - Stronghold: double-click = bow/unbow (adds gold)
 *  - Hand card / province card: hover = preview, right-click = modal
 */
import { useState } from 'react';
import type { BattleAssignment, CardInstance, NormalizedCard, PlayerState, Province } from '../types/cards';
import { BATTLEFIELD_STYLES } from '../types/cards';
import { useGameStore } from '../store/gameStore';
import { canPlayFromHand } from '../engine/gameActions';
import { CardImage } from './CardImage';
import { GameCard } from './GameCard';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

interface SharedPreviewProps {
  onPreview?: (card: NormalizedCard, e: React.MouseEvent) => void;
  onPreviewMove?: (e: React.MouseEvent) => void;
  onPreviewClear?: () => void;
  onModal?: (card: NormalizedCard) => void;
}

interface Props extends SharedPreviewProps {
  player: PlayerState;
  isOpponent?: boolean;
  onOpenDeckBrowser?: (cards: CardInstance[], title: string) => void;
  /** Attack assignments targeting THIS player's provinces (used to show force indicators). */
  incomingAttacks?: BattleAssignment[];
  /** The attacker's personalities (needed to compute attacking force per province). */
  attackerPersonalities?: CardInstance[];
  /** Called when the player right-clicks a hand card and selects "Play". */
  onPlayCard?: (instance: CardInstance) => void;
  /** Called when the player selects "Resolve manually" on a hand card. */
  onManualPlay?: (instance: CardInstance) => void;
  /**
   * Called when the player chooses "Put ring into play" for a ring card in hand.
   * The caller must verify the ring's entry condition has been met before calling this.
   */
  onPlayRingPermanent?: (instance: CardInstance) => void;
}

// All card heights in vh so they scale with the viewport.
const CARD_H    = '19vh';  // province + hand cards
const PREGAME_H = '17vh';  // stronghold / sensei
const DECK_H    = '14vh';  // deck stacks

interface CtxMenu {
  items: ContextMenuEntry[];
  x: number;
  y: number;
}

export function GameRow({
  player, isOpponent = false,
  onPreview, onPreviewMove, onPreviewClear, onModal,
  onOpenDeckBrowser,
  incomingAttacks = [],
  attackerPersonalities = [],
  onPlayCard,
  onManualPlay,
  onPlayRingPermanent,
}: Props) {
  const pp = { onPreview, onPreviewMove, onPreviewClear, onModal };
  const target = isOpponent ? 'opponent' : 'player';

  const drawFateCard          = useGameStore(s => s.drawFateCard);
  const bowStronghold         = useGameStore(s => s.bowStronghold);
  const recruitFromProvince   = useGameStore(s => s.recruitFromProvince);
  const discardFromProvince   = useGameStore(s => s.discardFromProvince);
  const discardHandCard       = useGameStore(s => s.discardHandCard);
  const useKharmic            = useGameStore(s => s.useKharmic);
  const flipProvinceCard      = useGameStore(s => s.flipProvinceCard);
  const breakProvince         = useGameStore(s => s.breakProvince);
  const turnPhase             = useGameStore(s => s.turnPhase);
  const turnNumber            = useGameStore(s => s.turnNumber);
  const cyclingActive         = useGameStore(s => s.cyclingActive);
  const startCycling          = useGameStore(s => s.startCycling);
  const commitCycling         = useGameStore(s => s.commitCycling);
  const endCycling            = useGameStore(s => s.endCycling);
  // For timing validation of hand-card play actions
  const activePlayer          = useGameStore(s => s.activePlayer);
  const priority              = useGameStore(s => s.priority);
  const battleStage           = useGameStore(s => s.battleStage);
  const battleWindowPriority  = useGameStore(s => s.battleWindowPriority);
  const currentBattlefield    = useGameStore(s => s.currentBattlefield);
  const battleAssignments     = useGameStore(s => s.battleAssignments);
  const defenderAssignments   = useGameStore(s => s.defenderAssignments);

  const isAction   = turnPhase === 'action';
  const isAttack   = turnPhase === 'attack';
  const HAND_LIMIT = 8;
  // mustDiscard is now tied to the 'discard' sub-phase (per SX: hand limit checked at end of Dynasty)
  const mustDiscard = turnPhase === 'discard' && !isOpponent && player.hand.length > HAND_LIMIT;

  // Cycling: whether this side is actively in cycle mode
  const isCycling = cyclingActive === target;
  const canCycle  = !isOpponent && turnNumber === 1 && !player.cyclingDone && cyclingActive === null;

  // Local set of province indices the player has selected for cycling
  const [cyclingSelected, setCyclingSelected] = useState<Set<number>>(new Set());

  const toggleCycleSelection = (idx: number) => {
    setCyclingSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCommitCycling = () => {
    commitCycling([...cyclingSelected], target);
    setCyclingSelected(new Set());
  };

  const handleEndCycling = () => {
    endCycling(target);
    setCyclingSelected(new Set());
  };

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  // Both decks open the browser on left-click. Drawing from Fate is via the pill button.
  const handleFateDeckClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onOpenDeckBrowser?.(player.fateDeck, `${isOpponent ? 'Opponent ' : ''}Fate Deck`);
  };
  const handleDynastyDeckClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onOpenDeckBrowser?.(player.dynastyDeck, `${isOpponent ? 'Opponent ' : ''}Dynasty Deck`);
  };

  const handleProvinceRightClick = (province: Province, e: React.MouseEvent) => {
    e.preventDefault();
    if (isOpponent) return;
    const cardData = province.card?.card ?? null;
    const items: ContextMenuEntry[] = [];

    // ── Flip face-up / face-down (any province with a card) ───────────────
    if (province.card && !province.broken) {
      items.push({
        label: province.faceUp ? '🔽 Flip Face-Down' : '🔼 Flip Face-Up',
        sublabel: 'Toggle province card visibility',
        onClick: () => flipProvinceCard(province.index, target),
      });
    }

    // ── Recruit (always available when face-up and has a personality/holding) ─
    if (cardData && province.faceUp && !province.broken) {
      const baseCost   = Math.max(0, Number(cardData.cost) || 0);
      const playerClan = player.stronghold?.clan?.toLowerCase() ?? '';
      const cardClan   = cardData.clan?.toLowerCase() ?? '';
      const isSameClan = !!playerClan && !!cardClan && playerClan === cardClan;
      const isPersonality = cardData.type === 'personality';
      const canAfford  = (c: number) => player.goldPool >= c;

      if (items.length > 0) items.push({ separator: true });

      if (isSameClan && isPersonality) {
        const discountCost = Math.max(0, baseCost - 2);
        const ph           = Number(cardData.personalHonor) || 0;
        items.push({
          label: 'Recruit with Clan Discount',
          sublabel: `${discountCost}g  (−2, no honor)`,
          onClick: () => recruitFromProvince(province.index, target, { discount: true }),
          disabled: !canAfford(discountCost),
          variant: 'primary',
        });
        items.push({
          label: 'Recruit + Proclaim',
          sublabel: `${baseCost}g  +${ph} Honor`,
          onClick: () => recruitFromProvince(province.index, target, { proclaim: true }),
          disabled: !canAfford(baseCost) || player.proclaimUsed,
          variant: 'primary',
        });
        items.push({
          label: 'Recruit (standard)',
          sublabel: `${baseCost}g`,
          onClick: () => recruitFromProvince(province.index, target),
          disabled: !canAfford(baseCost),
        });
      } else if (cardData.type !== 'region') {
        items.push({
          label: 'Recruit',
          sublabel: `${baseCost}g`,
          onClick: () => recruitFromProvince(province.index, target),
          disabled: !canAfford(baseCost),
          variant: 'primary',
        });
      }
    }

    // ── Kharmic (Limited, action or attack phase) ──────────────────────────
    if (cardData && province.faceUp) {
      const isKharmic = cardData.keywords.some(k => k.toLowerCase().trim() === 'kharmic');
      if (isKharmic && (isAction || isAttack)) {
        items.push({
          label: 'Kharmic — discard to refill face-up',
          sublabel: `2g — Repeatable Limited`,
          onClick: () => useKharmic('province', province.card!.instanceId, target, province.index),
          disabled: player.goldPool < 2,
          variant: 'primary',
        });
      }
    }

    // ── Discard from Province ──────────────────────────────────────────────
    if (province.card && !province.broken) {
      if (items.length > 0) items.push({ separator: true });
      items.push({
        label: '🗑 Discard from Province',
        sublabel: 'Refills face-down from dynasty deck',
        onClick: () => discardFromProvince(province.index, target),
        variant: 'danger',
      });
    }

    // ── Break Province ─────────────────────────────────────────────────────
    if (!province.broken) {
      items.push({
        label: '💥 Break Province',
        sublabel: 'Mark as broken — cannot be attacked again',
        onClick: () => breakProvince(province.index, target),
        variant: 'danger',
      });
    }

    // ── View card ──────────────────────────────────────────────────────────
    if (cardData) {
      if (items.length > 0) items.push({ separator: true });
      items.push({ label: 'View card', onClick: () => onModal?.(cardData) });
    }

    if (items.length > 0) setCtxMenu({ items, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className="zone flex-1 min-h-0 overflow-hidden"
      style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto' }}
    >
      {/* ── LEFT: Hand ─────────────────────────────────────────────── */}
      <div className="flex flex-col px-3 py-2 gap-1 min-w-0 overflow-hidden border-r border-board-border">
        <div className="flex items-center justify-between flex-shrink-0">
          <span className="zone-label">{isOpponent ? 'Opponent Hand' : 'Hand'}</span>
          <div className="flex items-center gap-1.5">
            {mustDiscard && (
              <span className="text-[9px] font-bold text-red-400 animate-pulse">
                Discard {player.hand.length - HAND_LIMIT}
              </span>
            )}
            <span className={`text-[10px] font-medium ${mustDiscard ? 'text-red-400' : 'text-gray-600'}`}>
              {player.hand.length}{!isOpponent ? `/${HAND_LIMIT}` : ''} cards
            </span>
          </div>
        </div>
        {mustDiscard && (
          <p className="text-[9px] text-red-400/70 flex-shrink-0">Click a card to discard it</p>
        )}
        <HandFan
          cards={player.hand}
          cardH={CARD_H}
          isOpponent={isOpponent}
          mustDiscard={mustDiscard}
          onDiscard={(id) => discardHandCard(id, target)}
          onPlayCard={!isOpponent ? onPlayCard : undefined}
          onManualPlay={!isOpponent ? onManualPlay : undefined}
          onPlayRingPermanent={!isOpponent ? onPlayRingPermanent : undefined}
          canPlay={(inst) => {
            // Rule of Presence (SX 5.4.c): must have a unit at the current battlefield
            // for Battle / Engage actions.
            const playerAtBattlefield = currentBattlefield !== null && (
              battleAssignments.some(a => a.provinceIndex === currentBattlefield) ||
              defenderAssignments.some(a => a.provinceIndex === currentBattlefield &&
                player.personalitiesHome.some(p => p.instanceId === a.instanceId))
            );
            return canPlayFromHand(inst.card, turnPhase, battleStage, activePlayer, priority, battleWindowPriority, playerAtBattlefield);
          }}
          onKharmic={!isOpponent ? (instanceId) => useKharmic('hand', instanceId, target) : undefined}
          canKharmic={!isOpponent && (isAction || isAttack) && player.goldPool >= 2}
          pp={pp}
        />
      </div>

      {/* ── CENTER: Provinces + Deck stacks ─────────────────────────── */}
      <div className="flex flex-col px-4 py-2 gap-1 items-center border-r border-board-border min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="zone-label">Provinces</span>
          {/* Cycle button — first turn only, player only */}
          {(canCycle || isCycling) && (
            <button
              onClick={() => {
                if (isCycling) handleCommitCycling();
                else startCycling(target);
              }}
              className={[
                'text-[8px] font-semibold px-2 py-0.5 rounded border transition-colors leading-none',
                isCycling
                  ? 'text-emerald-200 border-emerald-500 bg-emerald-900/60 hover:bg-emerald-800/60'
                  : 'text-sky-300/80 border-sky-700/50 bg-sky-950/40 hover:border-sky-500 hover:text-sky-200',
              ].join(' ')}
              title={isCycling
                ? `Cycle ${cyclingSelected.size} selected province(s) — click provinces to toggle selection`
                : 'Declare Cycle: select face-up provinces to replace, then confirm'
              }
            >
              {isCycling
                ? `✓ Cycle ${cyclingSelected.size > 0 ? `(${cyclingSelected.size})` : '— select provinces'}`
                : 'Cycle'
              }
            </button>
          )}
          {isCycling && (
            <button
              onClick={handleEndCycling}
              className="text-[8px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700/40 hover:border-gray-500 transition-colors leading-none"
              title="Cancel cycling without changing any province"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex gap-2 items-end flex-1">
          {/* Dynasty deck — click to browse */}
          <div className="flex flex-col items-center gap-0.5">
            <DeckStack
              count={player.dynastyDeck.length}
              label="Dy"
              color="text-orange-400"
              h={DECK_H}
              onClick={handleDynastyDeckClick}
              title="Click to browse Dynasty deck"
            />
            {/* Dead pile — clickable to browse */}
            {(player.honorablyDead.length + player.dishonorablelyDead.length) > 0 && (
              <button
                onClick={() => {
                  const dead = [...player.honorablyDead, ...player.dishonorablelyDead];
                  onOpenDeckBrowser?.(dead, 'Dead Pile');
                }}
                className="text-[8px] text-rose-400/80 hover:text-rose-300 border border-rose-900/40 hover:border-rose-600 rounded px-1.5 py-0.5 transition-colors leading-none"
                title="Browse dead personalities"
              >
                ☠ {player.honorablyDead.length + player.dishonorablelyDead.length}
              </button>
            )}
          </div>

          {player.provinces.map(p => {
            const attackersHere = incomingAttacks.filter(a => a.provinceIndex === p.index);
            const attackForce   = attackersHere.reduce((sum, a) => {
              const pers = attackerPersonalities.find(pp2 => pp2.instanceId === a.instanceId);
              return sum + Math.max(0, Number(pers?.card.force) || 0);
            }, 0);
            return (
              <ProvinceSlot
                key={p.index}
                province={p}
                strength={player.provinceStrength}
                forceHidden={isOpponent && !p.faceUp}
                h={CARD_H}
                isCycling={isCycling}
                cycleSelected={cyclingSelected.has(p.index)}
                onToggleCycleSelect={() => toggleCycleSelection(p.index)}
                onProvinceRightClick={handleProvinceRightClick}
                underAttack={attackersHere.length > 0}
                attackForce={attackForce}
                {...pp}
              />
            );
          })}

          {/* Fate deck — click to browse; Draw pill = draw 1 card */}
          <div className="flex flex-col items-center gap-0.5">
            <DeckStack
              count={player.fateDeck.length}
              label="Fate"
              color="text-green-400"
              h={DECK_H}
              onClick={handleFateDeckClick}
              title={isOpponent ? 'Opponent Fate deck' : 'Click to browse Fate deck'}
            />
            {!isOpponent && (
              <button
                onClick={() => drawFateCard(target)}
                className="text-[8px] text-green-400/70 hover:text-green-300 border border-green-800/40 hover:border-green-600 rounded px-1.5 py-0.5 transition-colors leading-none"
                title="Draw 1 card from the top of the Fate deck"
              >
                Draw ↑
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Stronghold + Sensei + Stats ──────────────────────── */}
      <div className="flex flex-col px-3 py-2 gap-1 items-end flex-shrink-0">
        <span className="zone-label flex-shrink-0">Pregame</span>
        <div className="flex gap-2 items-end justify-end flex-1">
          <StrongholdCard
            card={player.stronghold}
            bowed={player.strongholdBowed}
            h={PREGAME_H}
            isOpponent={isOpponent}
            onDoubleClick={() => bowStronghold(target)}
            {...pp}
          />
          <PregameCard card={player.sensei} label="SN" ring="ring-violet-600/50" h={PREGAME_H} {...pp} />
        </div>
        {/* Stats — Honor and Province Strength as large paired blocks */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          <div className="flex rounded-lg border border-board-border overflow-hidden flex-shrink-0">
            <HonorBlock
              value={player.familyHonor}
              label="Honor"
              colorClass={
                player.familyHonor >= 25 ? 'text-emerald-300'
                : player.familyHonor >= 10 ? 'text-amber-300'
                : player.familyHonor >= 0  ? 'text-gray-200'
                : 'text-red-400'
              }
              bgClass={
                player.familyHonor >= 25 ? 'bg-emerald-950/40'
                : player.familyHonor >= 10 ? 'bg-amber-950/40'
                : player.familyHonor >= 0  ? 'bg-board-bg'
                : 'bg-red-950/40'
              }
              tip="Family Honor — win at 40, lose at −20"
            />
            <div className="w-px bg-board-border" />
            <HonorBlock
              value={player.provinceStrength}
              label="Prov. Str"
              colorClass="text-blue-300"
              bgClass="bg-blue-950/20"
              tip="Province Strength"
            />
          </div>
          {player.goldPool > 0 && <GoldPoolBadge gold={player.goldPool} />}
        </div>
        {/* Proclaim indicator */}
        {!isOpponent && player.proclaimUsed && (
          <span className="text-[8px] text-gray-600 italic flex-shrink-0">Proclaim used this turn</span>
        )}
      </div>

      {/* Context menu for province cards */}
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * HandFan — displays hand cards in a compact overlapping spread.
 *
 * Strategy: each card is absolutely positioned inside a relative container.
 * We compute a `step` (horizontal offset per card) that guarantees all 8
 * cards fit within the container width, regardless of actual count.
 * Hovering a card lifts it above the others (z-index + translate-y).
 */
function HandFan({
  cards, cardH, isOpponent, mustDiscard, onDiscard, onPlayCard, onManualPlay, onPlayRingPermanent, canPlay, onKharmic, canKharmic, pp,
}: {
  cards: CardInstance[];
  cardH: string;
  isOpponent: boolean;
  mustDiscard: boolean;
  onDiscard: (id: string) => void;
  onPlayCard?: (inst: CardInstance) => void;
  onManualPlay?: (inst: CardInstance) => void;
  onPlayRingPermanent?: (inst: CardInstance) => void;
  canPlay?: (inst: CardInstance) => boolean;
  /** Called when the player uses the Kharmic ability on this hand card */
  onKharmic?: (instanceId: string) => void;
  /** Whether Kharmic Limited timing is active and player can afford it (2g) */
  canKharmic?: boolean;
  pp: SharedPreviewProps;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ items: ContextMenuEntry[]; x: number; y: number } | null>(null);

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-gray-700 text-xs">Empty</span>
      </div>
    );
  }

  // Card width derived from height (19vh) and 2.5:3.5 aspect ratio → ~13.57vh
  const cardWidthVh = parseFloat(cardH) * 2.5 / 3.5;

  // Guarantee 8 cards always fit: step = (container - cardWidth) / 7 gaps minimum
  const slots    = Math.max(cards.length - 1, 7);
  const stepExpr = `calc((100% - ${cardWidthVh}vh) / ${slots})`;

  // Extra height above cards for the hover-lift animation
  const containerH = `calc(${cardH} + 16px)`;

  const handleHandCardRightClick = (inst: CardInstance, e: React.MouseEvent) => {
    e.preventDefault();
    if (isOpponent || mustDiscard) return;

    const items: ContextMenuEntry[] = [];
    const playable = canPlay?.(inst) ?? false;
    const isAttachment = ['item', 'follower', 'spell'].includes(inst.card.type);
    const cost = Math.max(0, Number(inst.card.cost) || 0);

    const isRing = inst.card.type === 'ring';

    if (onPlayCard && playable) {
      items.push({
        label: isAttachment ? `Equip ${inst.card.name}` : `Play ${inst.card.name}`,
        sublabel: cost > 0 ? `${cost}g` : (isAttachment ? 'select target →' : isRing ? 'discard for ability' : 'resolve immediately'),
        onClick: () => onPlayCard(inst),
        variant: 'primary',
      });
    } else if (onPlayCard) {
      items.push({
        label: isAttachment ? 'Equip (wrong timing)' : 'Play (wrong timing)',
        sublabel: 'Not your action window',
        onClick: () => {},
        disabled: true,
      });
    }

    // Ring-specific: enter play as a permanent (condition must be met manually)
    if (isRing && onPlayRingPermanent) {
      items.push({
        label: '⬡ Put into play (condition met)',
        sublabel: 'Enters Celestials & Events zone — counts toward Enlightenment',
        onClick: () => onPlayRingPermanent(inst),
        variant: 'primary',
      });
    }

    // Kharmic: discard from hand to draw a card (Limited, 2g)
    const isKharmic = inst.card.keywords.some(k => k.toLowerCase().trim() === 'kharmic');
    if (isKharmic && onKharmic) {
      items.push({ separator: true });
      items.push({
        label: 'Kharmic — discard to draw',
        sublabel: '2g — Repeatable Limited',
        onClick: () => onKharmic(inst.instanceId),
        disabled: !canKharmic,
        variant: 'primary',
      });
    }

    if (onManualPlay) {
      items.push({ separator: true });
      items.push({
        label: '⚙ Resolve manually',
        sublabel: 'Both players confirm verbally',
        onClick: () => onManualPlay(inst),
      });
    }
    items.push({ separator: true });
    items.push({ label: 'View card', onClick: () => pp.onModal?.(inst.card) });
    setCtxMenu({ items, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        className="relative flex-1 min-w-0"
        style={{ height: containerH }}
      >
        {cards.map((inst, i) => {
          const playable = !isOpponent && !mustDiscard && (canPlay?.(inst) ?? false);
          return (
            // Shell div owns the absolute position + hover lift.
            <div
              key={inst.instanceId}
              className="absolute bottom-0 transition-all duration-150 hover:-translate-y-4"
              style={{
                height: cardH,
                width: `${cardWidthVh}vh`,
                left: `calc(${stepExpr} * ${i})`,
                zIndex: i,
              }}
            >
              {isOpponent
                ? (
                  <div className="w-full h-full rounded-lg bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 border border-slate-600 shadow" />
                )
                : (
                  <GameCard
                    instance={inst}
                    faceDown={false}
                    className={[
                      'w-full h-full',
                      mustDiscard ? 'ring-2 ring-red-500/60 rounded-lg cursor-pointer' : '',
                      playable    ? 'ring-1 ring-sky-500/40 rounded-lg' : '',
                    ].join(' ')}
                    style={{ height: '100%', width: '100%', aspectRatio: undefined }}
                    onClick={mustDiscard ? () => onDiscard(inst.instanceId) : undefined}
                    onContextMenu={(e) => handleHandCardRightClick(inst, e)}
                    {...pp}
                  />
                )
              }
            </div>
          );
        })}
      </div>
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}


/** How many vh of the Region card peek out below the province card. */
const REGION_PEEK_VH = 2.4;

function ProvinceSlot({ province, strength, forceHidden, h, isCycling, cycleSelected, onToggleCycleSelect, onProvinceRightClick, underAttack, attackForce, ...pp }: {
  province: Province; strength: number; forceHidden?: boolean; h: string;
  isCycling?: boolean;
  cycleSelected?: boolean;
  onToggleCycleSelect?: () => void;
  onProvinceRightClick?: (province: Province, e: React.MouseEvent) => void;
  underAttack?: boolean;
  attackForce?: number;
} & SharedPreviewProps) {
  const faceDown   = forceHidden || !province.faceUp;
  const canCycleThis = isCycling && !forceHidden && !!province.card && !province.broken;
  const bf = BATTLEFIELD_STYLES[province.index];
  const hasRegion = !!province.region;
  const cardW = `calc(${h} * 2.5 / 3.5)`;
  // Total height = card height + optional region peek strip below
  const totalH = hasRegion ? `calc(${h} + ${REGION_PEEK_VH}vh)` : h;

  if (province.broken) {
    return (
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 opacity-40" style={{ height: h, width: cardW }}>
        <span className="text-[8px] text-gray-700 font-semibold">P{province.index + 1}</span>
        <div className="flex-1 w-full rounded-lg border-2 border-dashed border-red-900/60 bg-red-950/20 flex items-center justify-center">
          <span className="text-[9px] text-red-700 font-bold uppercase tracking-wider">Broken</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'flex flex-col items-center gap-0.5 flex-shrink-0 rounded-lg transition-all',
        underAttack ? `ring-2 ${bf.ring} p-0.5` : '',
      ].join(' ')}
      style={{ height: totalH, width: 'auto' }}
    >
      <div className="flex justify-between flex-shrink-0 items-center" style={{ width: cardW }}>
        <span className="text-[8px] text-gray-700 font-semibold">P{province.index + 1}</span>
        {underAttack && attackForce !== undefined && (
          <span className={`text-[8px] font-bold px-1 rounded leading-tight ${bf.badge}`}>
            ⚔ {attackForce}f
          </span>
        )}
        {canCycleThis && (
          <span className={`text-[7px] font-bold ${cycleSelected ? 'text-emerald-300' : 'text-gray-600'}`}>
            {cycleSelected ? '✓' : '↺'}
          </span>
        )}
      </div>

      {/*
        Card stack: province card on top (z-index 2), region peeking below (z-index 1).
        The container is h tall for the province card + REGION_PEEK_VH for the strip below.
      */}
      <div className="relative flex-shrink-0" style={{ width: cardW, height: `calc(${h} + ${hasRegion ? REGION_PEEK_VH : 0}vh)` }}>

        {/* ── Region peek strip (behind province card, bottom strip shows) ── */}
        {province.region && (
          <div
            className="absolute left-0 right-0 bottom-0 overflow-hidden rounded-b-lg border border-teal-700/50 cursor-pointer"
            style={{ height: `${REGION_PEEK_VH}vh`, zIndex: 1 }}
            title={`Region: ${province.region.card.name}`}
            onMouseEnter={(e) => pp.onPreview?.(province.region!.card, e)}
            onMouseMove={(e)  => pp.onPreviewMove?.(e)}
            onMouseLeave={()  => pp.onPreviewClear?.()}
            onContextMenu={(e) => { e.preventDefault(); pp.onModal?.(province.region!.card); }}
          >
            {/* Full card image — wrapper clips it to just the peek strip height */}
            <CardImage
              card={province.region.card}
              className="w-full object-cover object-top pointer-events-none"
              style={{ height: h } as React.CSSProperties}
              alt={province.region.card.name}
            />
            {/* Name label overlaid on the peek */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[5.5px] font-bold text-teal-200 bg-teal-950/80 px-1 py-px rounded leading-tight shadow max-w-full truncate">
                {province.region.card.name}
              </span>
            </div>
          </div>
        )}

        {/* ── Province card (on top of region) ── */}
        <div className="absolute left-0 right-0 top-0" style={{ height: h, zIndex: 2 }}>
          {province.card
            ? <GameCard
                instance={province.card}
                faceDown={faceDown}
                className={[
                  'w-full h-full',
                  canCycleThis && cycleSelected  ? 'ring-2 ring-emerald-400 rounded-lg cursor-pointer' : '',
                  canCycleThis && !cycleSelected ? 'ring-1 ring-gray-600/60 rounded-lg cursor-pointer' : '',
                ].join(' ')}
                style={{ height: '100%', width: '100%', aspectRatio: '2.5/3.5' }}
                onClick={canCycleThis ? onToggleCycleSelect : undefined}
                onContextMenu={!isCycling
                  ? (e) => onProvinceRightClick?.(province, e)
                  : undefined
                }
                {...pp}
              />
            : <div
                className="card-slot-empty w-full h-full"
                style={{ aspectRatio: '2.5/3.5' }}
                onContextMenu={!isCycling ? (e) => onProvinceRightClick?.(province, e) : undefined}
              >
                <span className="text-gray-700 text-[9px]">—</span>
              </div>
          }
        </div>
      </div>
    </div>
  );
}

function DeckStack({ count, label, color, h, onClick, onRightClick, title }: {
  count: number; label: string; color: string; h: string;
  onClick?: (e: React.MouseEvent) => void;
  onRightClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const w = `calc(${h} * 2.5 / 3.5)`;
  return (
    <div
      className="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer group"
      style={{ height: h }}
      title={title}
      onClick={onClick}
      onContextMenu={onRightClick}
    >
      <div className="relative flex-1 w-full" style={{ width: w }}>
        {count > 0 && <>
          <div className="absolute inset-0 rounded bg-slate-700 border border-slate-600 transition-transform group-hover:translate-y-[-4px]" style={{ transform: 'translateY(-3px) translateX(2px)' }} />
          <div className="absolute inset-0 rounded bg-slate-700 border border-slate-600" style={{ transform: 'translateY(-1.5px) translateX(1px)' }} />
        </>}
        <div className={`absolute inset-0 rounded border flex items-center justify-center text-sm font-bold transition-all ${
          count > 0
            ? `bg-slate-800 border-slate-600 ${color} group-hover:border-slate-400`
            : 'bg-transparent border-dashed border-gray-700 text-gray-700'
        }`}>{count}</div>
      </div>
      <span className="text-[8px] text-gray-600 font-medium flex-shrink-0 group-hover:text-gray-400 transition-colors">{label}</span>
    </div>
  );
}

/** Stronghold card — trackable bowed state (separate from CardInstance) */
function StrongholdCard({ card, bowed, h, isOpponent, onDoubleClick, onPreview, onPreviewMove, onPreviewClear, onModal }: {
  card: NormalizedCard | null; bowed: boolean; h: string; isOpponent: boolean;
  onDoubleClick?: () => void;
} & SharedPreviewProps) {
  const w = `calc(${h} * 2.5 / 3.5)`;
  const title = isOpponent
    ? card?.name ?? 'Stronghold'
    : `${card?.name ?? 'Stronghold'} — double-click to bow/unbow (adds gold)`;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ height: h }}>
      <span className="text-[8px] text-gray-600 flex-shrink-0">SH</span>
      {card
        ? <div
            className="relative rounded overflow-hidden ring-1 ring-amber-600/50 shadow cursor-pointer group flex-1"
            style={{
              width: w,
              transform: bowed ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s ease',
            }}
            title={title}
            onMouseEnter={e => onPreview?.(card, e)}
            onMouseMove={e => onPreviewMove?.(e)}
            onMouseLeave={() => onPreviewClear?.()}
            onContextMenu={e => { e.preventDefault(); onModal?.(card); }}
            onDoubleClick={!isOpponent ? onDoubleClick : undefined}
          >
            <CardImage card={card} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-150" alt={card.name} />
            {bowed && (
              <div className="absolute inset-0 ring-2 ring-amber-400/80 bg-amber-950/20 rounded pointer-events-none" />
            )}
            {!isOpponent && (
              <div className="absolute bottom-0.5 inset-x-0 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[8px] bg-black/70 px-1.5 py-0.5 rounded text-amber-300 font-semibold">
                  {bowed ? 'Bowed — dbl-click to unbow' : 'Dbl-click to bow'}
                </span>
              </div>
            )}
          </div>
        : <div className="card-slot-empty flex-1" style={{ width: w }}>
            <span className="text-gray-700 text-[9px]">SH</span>
          </div>
      }
    </div>
  );
}

function PregameCard({ card, label, ring, h, onPreview, onPreviewMove, onPreviewClear, onModal }: {
  card: NormalizedCard | null; label: string; ring: string; h: string;
} & SharedPreviewProps) {
  const w = `calc(${h} * 2.5 / 3.5)`;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ height: h }}>
      <span className="text-[8px] text-gray-600 flex-shrink-0">{label}</span>
      {card
        ? <div
            className={`relative rounded overflow-hidden ring-1 ${ring} shadow cursor-pointer group flex-1`}
            style={{ width: w }}
            onMouseEnter={e => onPreview?.(card, e)}
            onMouseMove={e => onPreviewMove?.(e)}
            onMouseLeave={() => onPreviewClear?.()}
            onContextMenu={e => { e.preventDefault(); onModal?.(card); }}
          >
            <CardImage card={card} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-150" alt={card.name} />
          </div>
        : <div className="card-slot-empty flex-1" style={{ width: w }}>
            <span className="text-gray-700 text-[9px]">{label}</span>
          </div>
      }
    </div>
  );
}

/** Paired stat block — used for Honor and Province Strength */
function HonorBlock({ value, label, colorClass, bgClass, tip }: {
  value: number; label: string; colorClass: string; bgClass: string; tip?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center px-3 py-1 ${bgClass} flex-shrink-0`}
      title={tip}
    >
      <span className="text-[7px] font-semibold uppercase tracking-widest text-gray-500 leading-none">{label}</span>
      <span className={`text-2xl font-bold leading-tight tabular-nums ${colorClass}`}>{value}</span>
    </div>
  );
}

function GoldPoolBadge({ gold }: { gold: number }) {
  return (
    <div
      className="bg-yellow-950/80 border border-yellow-500/60 rounded px-1.5 py-0.5 text-center animate-pulse"
      title="Gold pool — unspent gold, resets on priority change"
    >
      <p className="text-[9px] font-bold text-yellow-300">◆ {gold}g</p>
    </div>
  );
}

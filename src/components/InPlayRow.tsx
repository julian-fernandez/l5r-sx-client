/**
 * In-play row with three zones:
 *   Holdings (left) | Personalities at home (middle) | Celestials/Events (right)
 *
 * Holdings are always stationary — they don't go "home", they simply are in play.
 * Only Personalities move between home, battle, etc.
 *
 * Double-clicking any in-play card bows/unbows it (holdings also add gold).
 * Pass priority is handled by the header button (Board.tsx) and auto-passed for opponent.
 */
import type { BattleAssignment, CardInstance, NormalizedCard, Province } from '../types/cards';
import { BATTLEFIELD_STYLES } from '../types/cards';
import type { TurnPhase } from '../store/gameStore';
import { useGameStore } from '../store/gameStore';
import { isCavalryUnit } from '../engine/gameActions';
import { GameCard } from './GameCard';
import { CardImage } from './CardImage';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { useState } from 'react';

interface SharedPreviewProps {
  onPreview?: (card: NormalizedCard, e: React.MouseEvent) => void;
  onPreviewMove?: (e: React.MouseEvent) => void;
  onPreviewClear?: () => void;
  onModal?: (card: NormalizedCard) => void;
}

interface Props extends SharedPreviewProps {
  holdingsInPlay: CardInstance[];
  personalitiesHome: CardInstance[];
  specialsInPlay: CardInstance[];
  isOpponent?: boolean;
  turnPhase?: TurnPhase;
  /** Current battle assignments (player attacking opponent). */
  battleAssignments?: BattleAssignment[];
  /** Defender assignments (opponent personalities defending provinces). */
  defenderAssignments?: BattleAssignment[];
  /** Opponent's provinces — used to build assignment context menus. */
  opponentProvinces?: Province[];
  /**
   * When set, the row is in "targeting mode": clicking a personality with its
   * instanceId in this set selects it as an attach target.
   */
  validAttachTargets?: Set<string>;
  /** Called with the selected personality instanceId when targeting. */
  onSelectAttachTarget?: (instanceId: string) => void;
  /** The currently selected attach target instanceId (shown with a green ring). */
  selectedAttachTarget?: string | null;
}

// vh-based so cards scale with viewport height
const HOLDING_H     = '11vh';
const PERSONALITY_H = '13vh';
const SPECIAL_H     = '11vh';

export function InPlayRow({
  holdingsInPlay, personalitiesHome, specialsInPlay,
  isOpponent = false,
  turnPhase,
  battleAssignments = [], defenderAssignments = [], opponentProvinces = [],
  validAttachTargets, onSelectAttachTarget, selectedAttachTarget,
  onPreview, onPreviewMove, onPreviewClear, onModal,
}: Props) {
  const pp = { onPreview, onPreviewMove, onPreviewClear, onModal };
  const prefix = isOpponent ? 'Opponent ' : '';
  const target = isOpponent ? 'opponent' : 'player';

  const bowCard             = useGameStore(s => s.bowCard);
  const assignToBattlefield = useGameStore(s => s.assignToBattlefield);
  const unassignFromBattle  = useGameStore(s => s.unassignFromBattle);
  const battleStage         = useGameStore(s => s.battleStage);


  const [ctxMenu, setCtxMenu] = useState<{ items: ContextMenuEntry[]; x: number; y: number } | null>(null);

  const isAttackPhase  = turnPhase === 'attack';
  const isAssigning    = isAttackPhase && battleStage === 'assigning';
  const isTargeting    = !!validAttachTargets && validAttachTargets.size > 0;

  const handlePersonalityContextMenu = (inst: CardInstance, e: React.MouseEvent) => {
    if (isOpponent || !isAssigning) return;
    e.preventDefault();
    const currentAssignment = battleAssignments.find(a => a.instanceId === inst.instanceId);
    const items: ContextMenuEntry[] = [];

    opponentProvinces.forEach(prov => {
      if (prov.broken) return;
      const isCurrentTarget = currentAssignment?.provinceIndex === prov.index;
      items.push({
        label: isCurrentTarget ? `✓ Province ${prov.index + 1}` : `Attack Province ${prov.index + 1}`,
        sublabel: `Str ${prov.strength}`,
        onClick: () => assignToBattlefield(inst.instanceId, prov.index),
        disabled: isCurrentTarget,
        variant: 'primary',
      });
    });

    if (currentAssignment !== undefined) {
      if (items.length > 0) items.push({ separator: true });
      items.push({
        label: 'Retreat (remove from battle)',
        onClick: () => unassignFromBattle(inst.instanceId),
        variant: 'danger',
      });
    }

    if (items.length > 0) setCtxMenu({ items, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="zone flex gap-0 overflow-hidden flex-shrink-0" style={{ minHeight: '16vh' }}>

      {/* ── Holdings ───────────────────────────────────── */}
      <Panel label={`${prefix}Holdings`} accent="border-r-amber-800/40">
        {holdingsInPlay.length === 0
          ? <Empty />
          : holdingsInPlay.map(inst => (
              <GameCard key={inst.instanceId} instance={inst} faceDown={false}
                style={{ height: HOLDING_H, width: 'auto', aspectRatio: '2.5/3.5', flexShrink: 0 }}
                onDoubleClick={() => bowCard(inst.instanceId, target)}
                {...pp}
              />
            ))
        }
      </Panel>

      {/* ── Personalities at home ─────────────────────── */}
      <Panel
        label={`${prefix}Personalities`}
        flex={2}
        accent="border-r-blue-800/30"
        action={
          isAssigning && !isOpponent ? (
            <span className="text-[8px] text-red-400 font-semibold animate-pulse">
              Right-click to assign
            </span>
          ) : isTargeting && !isOpponent ? (
            <span className="text-[8px] text-sky-400 font-semibold animate-pulse">
              Click target personality
            </span>
          ) : undefined
        }
      >
        {personalitiesHome.length === 0
          ? <Empty text="No personalities in play" />
          : personalitiesHome.map(inst => {
              const assignment        = battleAssignments.find(a => a.instanceId === inst.instanceId);
              const defenderAssignment = defenderAssignments.find(d => d.instanceId === inst.instanceId);
              const isValidTarget     = validAttachTargets?.has(inst.instanceId) ?? false;
              const isSelected        = selectedAttachTarget === inst.instanceId;
              return (
                <PersonalityCard
                  key={inst.instanceId} instance={inst} h={PERSONALITY_H}
                  onBow={() => bowCard(inst.instanceId, target)}
                  assignment={assignment}
                  defenderAssignment={defenderAssignment}
                  isAssigning={isAssigning && !isOpponent}
                  onContextMenu={(e) => handlePersonalityContextMenu(inst, e)}
                  bowCard={bowCard}
                  target={target}
                  isValidTarget={isValidTarget}
                  isSelectedTarget={isSelected}
                  onSelectTarget={isValidTarget ? () => onSelectAttachTarget?.(inst.instanceId) : undefined}
                  showCavalryBadge={isAssigning && !isOpponent && isCavalryUnit(inst)}
                  {...pp}
                />
              );
            })
        }
      </Panel>

      {/* ── Celestials / Events ───────────────────────── */}
      <Panel label={`${prefix}Celestials & Events`}>
        {specialsInPlay.length === 0
          ? <Empty />
          : specialsInPlay.map(inst => (
              <GameCard key={inst.instanceId} instance={inst} faceDown={false}
                style={{ height: SPECIAL_H, width: 'auto', aspectRatio: '2.5/3.5', flexShrink: 0 }}
                onDoubleClick={() => bowCard(inst.instanceId, target)}
                {...pp}
              />
            ))
        }
      </Panel>

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

// ── Personality with peeking attachments ─────────────────────────────────────

/**
 * Amount of each attachment card that peeks out ABOVE the personality.
 * This is enough to read the card title, which sits at the top of L5R cards.
 */
const PEEK_VH = 2.6;

/** Attachment type → subtle accent colour for the peek strip border. */
const ATTACH_ACCENT: Record<string, string> = {
  follower: 'border-emerald-700/60',
  item:     'border-sky-700/60',
  spell:    'border-purple-700/60',
};

function PersonalityCard({
  instance, h, onBow, assignment, defenderAssignment, isAssigning, onContextMenu,
  onPreview, onPreviewMove, onPreviewClear, onModal,
  bowCard, target,
  isValidTarget, isSelectedTarget, onSelectTarget,
  showCavalryBadge,
}: {
  instance: CardInstance; h: string; onBow?: () => void;
  assignment?: BattleAssignment;
  defenderAssignment?: BattleAssignment;
  isAssigning?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  bowCard: (instanceId: string, target: 'player' | 'opponent') => void;
  target: 'player' | 'opponent';
  isValidTarget?: boolean;
  isSelectedTarget?: boolean;
  onSelectTarget?: () => void;
  showCavalryBadge?: boolean;
} & SharedPreviewProps) {
  const pp = { onPreview, onPreviewMove, onPreviewClear, onModal };
  const n   = instance.attachments.length;
  const bf  = assignment ? BATTLEFIELD_STYLES[assignment.provinceIndex] : null;

  // Container width stays the card width (derived from card height × aspect ratio).
  // Container height grows upward to accommodate n attachment peek strips above.
  const cardW = `calc(${h} * 5 / 7)`;   // 2.5 / 3.5 ≈ 5/7
  const totalH = n > 0
    ? `calc(${h} + ${n * PEEK_VH}vh)`
    : h;

  return (
    <div
      className="flex-shrink-0 relative"
      style={{ width: cardW, height: totalH }}
    >
      {/* ── Attachment peeks (stacked above the personality) ── */}
      {instance.attachments.map((att, i) => {
        const accent = ATTACH_ACCENT[att.card.type] ?? 'border-gray-600/40';
        return (
          <div
            key={att.instanceId}
            className={`absolute left-0 right-0 overflow-hidden border-b ${accent} rounded-t-lg cursor-pointer`}
            style={{
              top: `${i * PEEK_VH}vh`,
              height: `${PEEK_VH}vh`,
              // Peek strips sit behind the personality card (zIndex < n+1)
              // but each strip covers those behind it (higher i = more in front)
              zIndex: i + 1,
            }}
            title={`${att.card.name}${att.bowed ? ' — bowed' : ''} (double-click to ${att.bowed ? 'unbow' : 'bow'})`}
            onMouseEnter={(e) => onPreview?.(att.card, e)}
            onMouseMove={(e) => onPreviewMove?.(e)}
            onMouseLeave={() => onPreviewClear?.()}
            onDoubleClick={() => bowCard(att.instanceId, target)}
            onContextMenu={(e) => { e.preventDefault(); onModal?.(att.card); }}
          >
            {/* Full card image — the wrapper clips it to just the title strip */}
            <CardImage
              card={att.card}
              className={`w-full object-cover object-top pointer-events-none ${att.bowed ? 'brightness-50 saturate-50' : ''}`}
              style={{ height: h } as React.CSSProperties}
              alt={att.card.name}
            />
            {/* Bowed indicator in the peek strip */}
            {att.bowed && (
              <div className="absolute inset-0 flex items-center justify-end pr-1 pointer-events-none">
                <span className="text-[6px] font-bold text-amber-400 bg-black/60 px-0.5 rounded">bowed</span>
              </div>
            )}
            {/* Card type badge */}
            <div className="absolute bottom-0 right-0.5 pointer-events-none">
              <span className={`text-[5px] font-bold uppercase tracking-wider opacity-60 ${att.bowed ? 'text-gray-500' : 'text-gray-300'}`}>
                {att.card.type}
              </span>
            </div>
          </div>
        );
      })}

      {/* ── Personality card (on top) ── */}
      <div
        className="absolute left-0 right-0"
        style={{ top: `${n * PEEK_VH}vh`, height: h, zIndex: n + 1 }}
      >
        <GameCard
          instance={instance}
          faceDown={false}
          className={[
            isAssigning    ? 'cursor-context-menu' : '',
            isValidTarget  ? 'ring-2 ring-sky-400 rounded-lg cursor-pointer animate-pulse' : '',
            isSelectedTarget ? 'ring-2 ring-emerald-400 rounded-lg cursor-pointer' : '',
            bf && !isValidTarget && !isSelectedTarget ? `ring-2 ${bf.ring} rounded-lg` : '',
          ].filter(Boolean).join(' ')}
          style={{ height: '100%', width: '100%' }}
          onClick={onSelectTarget}
          onDoubleClick={!isAssigning && !isValidTarget ? onBow : undefined}
          onContextMenu={onContextMenu}
          {...pp}
        />
      </div>

      {/* ── Battlefield assignment badge ── */}
      {bf && (
        <div
          className={`absolute -right-1 text-[8px] font-bold px-1 rounded leading-tight shadow-md pointer-events-none ${bf.badge}`}
          style={{ top: `${n * PEEK_VH}vh`, zIndex: n + 2 }}
          title={`Assigned to Province ${assignment!.provinceIndex + 1}`}
        >
          P{assignment!.provinceIndex + 1}
        </div>
      )}

      {/* ── Cavalry badge (assignment phase) ── */}
      {showCavalryBadge && (
        <div
          className="absolute -left-1 text-[7px] font-bold px-1 py-px rounded leading-tight shadow-md pointer-events-none
                     bg-yellow-500 text-black"
          style={{ top: `${n * PEEK_VH}vh`, zIndex: n + 2 }}
          title="Cavalry unit — assign AFTER all non-Cavalry attackers and defenders"
        >
          CAV
        </div>
      )}

      {/* ── Defender badge (opponent personality defending a province) ── */}
      {defenderAssignment && (
        <div
          className="absolute -left-1 text-[7px] font-bold px-1 py-px rounded leading-tight shadow-md pointer-events-none
                     bg-rose-600 text-white"
          style={{ top: `${n * PEEK_VH}vh`, zIndex: n + 2 }}
          title={`Defending Province ${defenderAssignment.provinceIndex + 1}`}
        >
          🛡P{defenderAssignment.provinceIndex + 1}
        </div>
      )}
    </div>
  );
}

// ── Shared layout helpers ─────────────────────────────────────────────────────

function Panel({ label, children, flex = 1, accent = '', action }: {
  label: string; children: React.ReactNode; flex?: number; accent?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 px-2.5 py-2 border-r border-board-border last:border-r-0 ${accent}`}
      style={{ flex }}
    >
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="zone-label">{label}</span>
        {action}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 flex-wrap content-start" style={{ minHeight: 72 }}>
        {children}
      </div>
    </div>
  );
}

function Empty({ text = 'Empty' }: { text?: string }) {
  return <span className="text-gray-700 text-[10px] self-center">{text}</span>;
}


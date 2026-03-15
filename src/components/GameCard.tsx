import type { NormalizedCard } from '../types/cards';
import type { CardInstance } from '../types/cards';
import { useGameStore } from '../store/gameStore';
import { useIsTargetable, useIsTargeting } from './TargetingOverlay';
import { CardImage } from './CardImage';

interface Props {
  instance: CardInstance;
  faceDown?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  /** Double-click handler — used to bow/unbow the card */
  onDoubleClick?: () => void;
  /** Overrides the default right-click → modal behaviour */
  onContextMenu?: (e: React.MouseEvent) => void;
  onPreview?: (card: NormalizedCard, e: React.MouseEvent) => void;
  onPreviewMove?: (e: React.MouseEvent) => void;
  onPreviewClear?: () => void;
  onModal?: (card: NormalizedCard) => void;
}

export function GameCard({
  instance,
  faceDown = !instance.faceUp,
  className = '',
  style,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPreview,
  onPreviewMove,
  onPreviewClear,
  onModal,
}: Props) {
  const { card } = instance;
  const canPreview = !faceDown;

  const isTargeting   = useIsTargeting();
  const isTargetable  = useIsTargetable(instance.instanceId);
  const resolveTarget = useGameStore(s => s.resolveTarget);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (canPreview && onPreview) onPreview(card, e);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (canPreview && onPreviewMove) onPreviewMove(e);
  };
  const handleMouseLeave = () => {
    if (onPreviewClear) onPreviewClear();
  };
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onContextMenu) {
      onContextMenu(e);
    } else if (canPreview && onModal) {
      onModal(card);
    }
  };

  const handleClick = () => {
    // While targeting is active, clicks on valid targets resolve the target
    // instead of triggering normal card interactions.
    if (isTargeting) {
      if (isTargetable) resolveTarget(instance.instanceId);
      return;
    }
    onClick?.();
  };

  const handleDoubleClick = () => {
    if (isTargeting) return; // block bow/unbow during targeting
    onDoubleClick?.();
  };

  return (
    <div
      className={`relative select-none group ${isTargeting && !isTargetable ? 'opacity-40' : 'cursor-pointer'} ${className}`}
      style={{
        aspectRatio: '2.5/3.5',
        ...style,
        // Rotate 90° clockwise when bowed — matches physical L5R convention.
        transform: instance.bowed ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.25s ease',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      title={
        isTargetable
          ? `Click to target: ${card.name}`
          : faceDown
            ? 'Face-down'
            : `${card.name}${instance.bowed ? ' (bowed — double-click to unbow)' : ' — double-click to bow'}`
      }
    >
      {faceDown ? (
        <FaceDownCard />
      ) : (
        <>
          <CardImage
            card={card}
            className="w-full h-full object-cover rounded-lg shadow-lg transition-transform duration-150 group-hover:scale-[1.02] group-hover:shadow-xl"
            alt={card.name}
          />
          {instance.bowed && (
            <div className="absolute inset-0 rounded-lg ring-2 ring-amber-400/80 bg-amber-950/20 pointer-events-none" />
          )}
          {/* Targeting highlight — pulsing green ring + tint */}
          {isTargetable && (
            <div className="absolute inset-0 rounded-lg pointer-events-none
                            ring-2 ring-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.55)]
                            animate-pulse bg-emerald-400/10" />
          )}
        </>
      )}
    </div>
  );
}

function FaceDownCard() {
  return (
    <div className="w-full h-full rounded-lg bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 border border-slate-600 flex items-center justify-center shadow-lg">
      <div className="w-[72%] h-[72%] rounded-md border border-slate-500/40 bg-slate-700/30 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-slate-500/50" />
      </div>
    </div>
  );
}

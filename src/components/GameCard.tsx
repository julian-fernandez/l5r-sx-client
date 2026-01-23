import type { NormalizedCard } from '../types/cards';
import type { CardInstance } from '../types/cards';
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

  return (
    <div
      className={`relative select-none cursor-pointer group ${className}`}
      style={{
        aspectRatio: '2.5/3.5',
        ...style,
        // Rotate 90° clockwise when bowed — matches physical L5R convention.
        // CSS transforms don't affect layout flow, so the element keeps its
        // original footprint; the card will visually overlap its neighbours
        // slightly when bowed, which is intentional and expected.
        transform: instance.bowed ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.25s ease',
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      title={faceDown ? 'Face-down' : `${card.name}${instance.bowed ? ' (bowed — double-click to unbow)' : ' — double-click to bow'}`}
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

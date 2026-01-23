import { useEffect, useRef } from 'react';
import type { NormalizedCard } from '../types/cards';
import { CardImage } from './CardImage';

interface PreviewState {
  card: NormalizedCard;
  x: number;
  y: number;
}

interface Props {
  preview: PreviewState | null;
}

/** Floating card preview that follows the cursor */
export function CardPreview({ preview }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preview || !ref.current) return;
    const el = ref.current;
    const PREVIEW_W = 280;
    const PREVIEW_H = 420;
    const GAP = 16;

    let left = preview.x + GAP;
    let top = preview.y - PREVIEW_H / 2;

    // Flip to left if not enough room on right
    if (left + PREVIEW_W > window.innerWidth - 8) {
      left = preview.x - PREVIEW_W - GAP;
    }
    // Clamp vertically
    top = Math.max(8, Math.min(top, window.innerHeight - PREVIEW_H - 8));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [preview]);

  if (!preview) return null;
  const { card } = preview;

  return (
    <div
      ref={ref}
      className="fixed z-50 pointer-events-none select-none"
      style={{ width: 280 }}
    >
      <div className="rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-board-zone">
        <CardImage
          card={card}
          className="w-full block"
          alt={card.name}
        />
        <div className="px-3 py-2 space-y-1 border-t border-board-border">
          <p className="text-sm font-semibold text-white leading-tight">{card.name}</p>
          <p className="text-[11px] text-gray-400 capitalize">
            {card.type}{card.clan ? ` · ${card.clan}` : ''}
          </p>
          <CardStats card={card} />
        </div>
      </div>
    </div>
  );
}

function CardStats({ card }: { card: NormalizedCard }) {
  const stats: { label: string; value: string | number }[] = [];

  if (card.type === 'personality') {
    stats.push({ label: 'F', value: card.force });
    stats.push({ label: 'C', value: card.chi });
    stats.push({ label: 'Cost', value: card.cost });
    if (card.personalHonor !== 0) stats.push({ label: 'PH', value: card.personalHonor });
    if (card.honorRequirement !== 0) stats.push({ label: 'HR', value: card.honorRequirement });
  } else if (card.type === 'holding' || card.type === 'stronghold') {
    stats.push({ label: 'Gold', value: card.goldProduction });
    if (card.cost) stats.push({ label: 'Cost', value: card.cost });
  } else if (card.type === 'follower') {
    stats.push({ label: 'F', value: card.force });
    stats.push({ label: 'Cost', value: card.cost });
    stats.push({ label: 'Focus', value: card.focus });
  } else {
    if (card.cost) stats.push({ label: 'Cost', value: card.cost });
    if (card.focus) stats.push({ label: 'Focus', value: card.focus });
  }

  if (!stats.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {stats.map(s => (
        <span key={s.label} className="text-[11px] bg-white/10 rounded px-1.5 py-0.5 font-medium">
          <span className="text-gray-400">{s.label} </span>
          <span className="text-white">{s.value}</span>
        </span>
      ))}
    </div>
  );
}

import { useEffect } from 'react';
import type { NormalizedCard } from '../types/cards';
import { CardImage } from './CardImage';

interface Props {
  card: NormalizedCard | null;
  onClose: () => void;
}

export function CardModal({ card, onClose }: Props) {
  useEffect(() => {
    if (!card) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.82)' }}
      onClick={onClose}
    >
      <div
        className="flex gap-6 items-start max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Large card image */}
        <div style={{ width: 340 }} className="flex-shrink-0">
          <CardImage
            card={card}
            className="w-full rounded-xl shadow-2xl ring-1 ring-white/10"
            alt={card.name}
          />
        </div>

        {/* Card details panel */}
        <div className="bg-board-zone border border-board-border rounded-xl p-5 w-72 max-h-[90vh] overflow-y-auto">
          <h2 className="text-lg font-bold text-white mb-0.5">{card.name}</h2>
          <p className="text-sm text-gray-400 capitalize mb-4">
            {card.type}{card.clan ? ` · ${card.clan}` : ''}
          </p>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <StatItem label="Cost" value={card.cost} show={!!card.cost} />
            <StatItem label="Force" value={card.force} show={card.type === 'personality' || card.type === 'follower'} />
            <StatItem label="Chi" value={card.chi} show={card.type === 'personality'} />
            <StatItem label="Personal Honor" value={card.personalHonor} show={card.personalHonor !== 0 && card.type === 'personality'} />
            <StatItem label="Honor Req." value={card.honorRequirement} show={card.honorRequirement !== 0 && card.type === 'personality'} />
            <StatItem label="Focus" value={card.focus} show={!!card.focus} />
            <StatItem label="Gold Prod." value={card.goldProduction} show={card.type === 'holding' || card.type === 'stronghold'} />
          </div>

          {/* Keywords */}
          {card.keywords.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">Keywords</p>
              <div className="flex flex-wrap gap-1">
                {card.keywords.map(kw => (
                  <span key={kw} className="text-[11px] bg-violet-950/60 text-violet-300 border border-violet-800/40 rounded px-1.5 py-0.5">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Card text */}
          {card.text && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5">Text</p>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{card.text}</p>
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-5 w-full btn-ghost text-center justify-center"
          >
            Close · Esc
          </button>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, show }: { label: string; value: string | number; show: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-white/5 rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
    </div>
  );
}

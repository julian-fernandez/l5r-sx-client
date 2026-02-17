/**
 * DeckBrowser — searchable list of cards remaining in a deck.
 * Opened when the player clicks a deck stack to look through it.
 */
import { useState, useEffect, useRef } from 'react';
import type { CardInstance, NormalizedCard } from '../types/cards';

interface Props {
  cards: CardInstance[];
  title: string;
  onClose: () => void;
  onPreview?: (card: NormalizedCard, e: React.MouseEvent) => void;
  onPreviewMove?: (e: React.MouseEvent) => void;
  onPreviewClear?: () => void;
  onModal?: (card: NormalizedCard) => void;
}

const TYPE_ORDER = [
  'personality', 'holding', 'region', 'celestial', 'event',
  'strategy', 'spell', 'item', 'follower', 'ring', 'ancestor', 'unknown',
];

export function DeckBrowser({ cards, title, onClose, onPreview, onPreviewMove, onPreviewClear, onModal }: Props) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Group cards by type, then sort by name
  const filtered = search
    ? cards.filter(c => c.card.name.toLowerCase().includes(search.toLowerCase()))
    : cards;

  const grouped = TYPE_ORDER.reduce<Record<string, CardInstance[]>>((acc, t) => {
    const group = filtered.filter(c => c.card.type === t);
    if (group.length) acc[t] = group.sort((a, b) => a.card.name.localeCompare(b.card.name));
    return acc;
  }, {});

  // Count by name (for copy counts)
  const countByName: Record<string, number> = {};
  filtered.forEach(c => { countByName[c.card.name] = (countByName[c.card.name] ?? 0) + 1; });
  // Deduplicate: show each name once with a count badge
  const seen = new Set<string>();
  const deduped = filtered.filter(c => {
    if (seen.has(c.card.name)) return false;
    seen.add(c.card.name);
    return true;
  });
  void grouped; // used for future grouping display; using deduped for now

  const dedupedByType = TYPE_ORDER.reduce<Record<string, CardInstance[]>>((acc, t) => {
    const group = deduped.filter(c => c.card.type === t);
    if (group.length) acc[t] = group.sort((a, b) => a.card.name.localeCompare(b.card.name));
    return acc;
  }, {});

  const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-board-zone border border-board-border rounded-xl shadow-2xl flex flex-col"
        style={{ width: 440, maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-board-border flex-shrink-0">
          <div>
            <span className="text-[11px] font-bold text-gray-200">{title}</span>
            <span className="text-[10px] text-gray-500 ml-2">
              {filtered.length}/{cards.length} cards
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-[12px] transition-colors px-1"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 flex-shrink-0">
          <input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cards…"
            className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-600 outline-none focus:border-sky-600 transition-colors"
          />
        </div>

        {/* Card list grouped by type */}
        <div className="overflow-y-auto flex-1 px-2 pb-3">
          {Object.entries(dedupedByType).map(([type, group]) => (
            <div key={type} className="mb-2">
              <div className="zone-label px-2 py-1">{typeLabel(type)} ({
                filtered.filter(c => c.card.type === type).length
              })</div>
              {group.map(inst => (
                <div
                  key={inst.cardId}
                  className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-board-hover cursor-pointer transition-colors"
                  onMouseEnter={e => onPreview?.(inst.card, e)}
                  onMouseMove={e => onPreviewMove?.(e)}
                  onMouseLeave={() => onPreviewClear?.()}
                  onClick={() => { onPreviewClear?.(); onModal?.(inst.card); }}
                >
                  {/* Gold cost */}
                  <span className="text-[10px] font-bold text-yellow-400 w-5 text-center flex-shrink-0">
                    {inst.card.cost || '—'}
                  </span>
                  {/* Name + count */}
                  <span className="text-[12px] text-gray-200 flex-1 truncate">{inst.card.name}</span>
                  {countByName[inst.card.name] > 1 && (
                    <span className="text-[9px] font-bold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      ×{countByName[inst.card.name]}
                    </span>
                  )}
                  {/* Force / Chi for personalities */}
                  {inst.card.type === 'personality' && (
                    <span className="text-[9px] text-gray-500 flex-shrink-0">
                      {inst.card.force}F / {inst.card.chi}C
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {deduped.length === 0 && (
            <p className="text-center text-gray-600 text-[11px] py-8">No cards match.</p>
          )}
        </div>
      </div>
    </div>
  );
}

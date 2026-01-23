/**
 * Generic positioned context menu — appears near a right-click event.
 * Closes on outside click or Escape.
 */
import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  sublabel?: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Props {
  items: ContextMenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = () => onClose();
    window.addEventListener('keydown', handleKey);
    // Slight delay so the right-click that opened it doesn't immediately close it
    const t = setTimeout(() => window.addEventListener('click', handleClick), 50);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('click', handleClick);
      clearTimeout(t);
    };
  }, [onClose]);

  // Clamp to viewport after render
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 100,
    left: x,
    top: y,
    // Will be adjusted by the ref after mount — starts off-screen if needed
  };

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth)  menuRef.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menuRef.current.style.top  = `${y - rect.height}px`;
  });

  return (
    <div
      ref={menuRef}
      style={style}
      className="bg-[#1a2033] border border-board-border rounded-lg shadow-2xl py-1 min-w-[160px]"
      onClick={e => e.stopPropagation()}
    >
      {items.map((entry, i) => {
        if ('separator' in entry && entry.separator) {
          return <div key={i} className="my-1 border-t border-board-border" />;
        }
        const item = entry as ContextMenuItem;
        const colorClass = item.variant === 'primary'
          ? 'text-sky-300 hover:bg-sky-900/40'
          : item.variant === 'danger'
          ? 'text-red-400 hover:bg-red-900/30'
          : 'text-gray-300 hover:bg-board-hover';

        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
            className={[
              'w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between gap-4 transition-colors',
              item.disabled ? 'opacity-40 cursor-not-allowed text-gray-500' : `cursor-pointer ${colorClass}`,
            ].join(' ')}
          >
            <span>{item.label}</span>
            {item.sublabel && (
              <span className="text-[10px] text-gray-500 flex-shrink-0">{item.sublabel}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

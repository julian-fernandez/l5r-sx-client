/**
 * ActionsPanel — lists every declared action / activated ability available to
 * the current player this turn. Opened via the header toggle button.
 *
 * Currently hard-codes detection for:
 *  - Cycle          (first-turn only, enabled by Border Keep's first-turn ability)
 *  - Border Keep    (once-per-game: recycle any number of province cards)
 *  - Bamboo Harvesters: produces 2 Gold when bowed — handled on the board
 *    (double-click to bow); no separate Actions Panel entry needed.
 *
 * Extend `buildActions()` as more abilities are added.
 */
import type { CardInstance, PlayerState } from '../types/cards';
import { useGameStore } from '../store/gameStore';

interface Props {
  player: PlayerState;
  onClose: () => void;
  onOpenDeckBrowser: (cards: CardInstance[], title: string) => void;
}

interface ActionEntry {
  id: string;
  label: string;
  source: string;           // card name, "Turn 1 rule", etc.
  description: string;
  available: boolean;
  disabledReason?: string;
  onActivate: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActionsPanel({ player, onClose, onOpenDeckBrowser: _onOpenDeckBrowser }: Props) {
  const turnNumber        = useGameStore(s => s.turnNumber);
  const cyclingActive     = useGameStore(s => s.cyclingActive);
  const startCycling      = useGameStore(s => s.startCycling);
  const borderKeepCycle   = useGameStore(s => s.borderKeepCycle);

  const target = 'player';

  const actions: ActionEntry[] = [];

  // ── Cycle (turn 1 only — Border Keep's first-turn ability) ───────────────
  if (turnNumber === 1 && !player.cyclingDone) {
    const inProgress = cyclingActive === 'player';
    actions.push({
      id: 'cycle',
      label: 'Cycle Provinces',
      source: 'Turn 1 rule (Border Keep)',
      description:
        'Click face-up province cards to mark them for cycling, then confirm. ' +
        'Selected cards move to the bottom of the Dynasty deck and provinces refill face-up. ' +
        'You may cycle 0–4 provinces. Once per game.',
      available: !inProgress,
      disabledReason: inProgress ? 'Cycling in progress — select provinces near the board' : undefined,
      onActivate: () => {
        startCycling(target);
        onClose();
      },
    });
  }

  // ── Holding abilities ─────────────────────────────────────────────────────
  for (const holding of player.holdingsInPlay) {
    const name = holding.card.name;

    if (/border keep/i.test(name)) {
      const usedOncePerGame = player.oncePerGameAbilitiesUsed.includes(holding.instanceId);
      // Show the once-per-game cycle ability only after turn 1 (turn 1 already has Cycle rule above).
      // Still show on turn 1 in case the player wants to use BK directly.
      actions.push({
        id: `${holding.instanceId}-bk-cycle`,
        label: 'Border Keep — Recycle Provinces',
        source: name,
        description:
          'Limited, once per game: put any number of face-up province cards at the bottom of ' +
          'your Dynasty deck, then refill those provinces face-up. ' +
          'Border Keep also produces 2 Gold when bowed (double-click on the board).',
        available: !usedOncePerGame,
        disabledReason: usedOncePerGame ? 'Already used this game' : undefined,
        onActivate: () => {
          borderKeepCycle(holding.instanceId);
          onClose();
        },
      });
    }

    // Bamboo Harvesters: only produces 2 Gold when bowed.
    // Double-click the card on the board to bow it and add gold to the pool.
    // Card text: "This card will not straighten before your second turn."
    // No separate ability entry here — it's just a holding you bow for gold.
  }

  const available   = actions.filter(a => a.available);
  const unavailable = actions.filter(a => !a.available);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-board-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Actions</span>
          {available.length > 0 && (
            <span className="text-[8px] font-bold bg-sky-500 text-black rounded-full px-1.5 leading-tight">
              {available.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-300 text-sm leading-none transition-colors"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {actions.length === 0 ? (
          <p className="text-[10px] text-gray-600 italic mt-3 px-1">
            No actions or activated abilities available this turn.
          </p>
        ) : (
          <>
            {available.length > 0 && (
              <section>
                <p className="text-[7px] uppercase tracking-widest text-gray-600 px-1 mb-1">Available</p>
                {available.map(a => (
                  <ActionCard key={a.id} action={a} />
                ))}
              </section>
            )}
            {unavailable.length > 0 && (
              <section className="mt-2">
                <p className="text-[7px] uppercase tracking-widest text-gray-700 px-1 mb-1">Used / Unavailable</p>
                {unavailable.map(a => (
                  <ActionCard key={a.id} action={a} dimmed />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionCard({ action, dimmed = false }: { action: ActionEntry; dimmed?: boolean }) {
  return (
    <div
      className={[
        'rounded-lg border p-2.5 transition-colors',
        dimmed
          ? 'border-board-border bg-board-bg opacity-50'
          : 'border-sky-800/60 bg-sky-950/30',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[11px] font-bold leading-snug ${dimmed ? 'text-gray-500' : 'text-sky-200'}`}>
            {action.label}
          </p>
          <p className="text-[8px] text-gray-600 leading-none mb-1">{action.source}</p>
          <p className="text-[9px] text-gray-400 leading-snug">{action.description}</p>
          {action.disabledReason && (
            <p className="text-[8px] text-amber-600/80 mt-1 italic">{action.disabledReason}</p>
          )}
        </div>
        {!dimmed && (
          <button
            onClick={action.onActivate}
            className="flex-shrink-0 text-[9px] font-semibold px-2 py-1 rounded border border-sky-600 text-sky-300 bg-sky-950/60 hover:bg-sky-800/60 transition-colors leading-none mt-0.5"
          >
            Activate
          </button>
        )}
      </div>
    </div>
  );
}

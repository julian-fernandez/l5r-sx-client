import type { ReactionCandidate } from '../engine/gameActions';
import { useGameStore } from '../store/gameStore';

/**
 * Modal displayed whenever a trigger fires and at least one Reaction is available.
 *
 * Shows all matching Reaction abilities from both sides (in solo mode both are
 * presented to the local player). In multiplayer the prompt should only show
 * the local player's candidates — the opponent's reactions are handled on their
 * own client.
 *
 * Clicking "Use" marks the ability as used this turn via resolveReaction().
 * The actual card effect must be applied separately — this prompt only gates
 * the "I want to react" decision.
 *
 * Clicking "Pass" (or the backdrop) clears pendingReaction without using any ability.
 */
export function ReactionPrompt() {
  const pendingReaction = useGameStore(s => s.pendingReaction);
  const resolveReaction = useGameStore(s => s.resolveReaction);
  const declineReactions = useGameStore(s => s.declineReactions);
  const multiplayerMode = useGameStore(s => s.multiplayerMode);

  if (!pendingReaction) return null;

  const { trigger, candidates } = pendingReaction;

  // In multiplayer only show the local player's reactions to avoid info leakage
  const visible: ReactionCandidate[] = multiplayerMode
    ? candidates.filter(c => c.side === 'player')
    : candidates;

  const triggerLabel: Record<string, string> = {
    'battle-declared':         'Battle declared',
    'battle-action-announced': 'Battle action announced',
    'battle-won':              'Battle won',
    'battle-lost':             'Battle lost',
    'province-broken':         'Province broken',
    'personality-destroyed':   'Personality destroyed',
    'personality-killed':      'Personality killed in battle',
    'personality-recruited':   'Personality recruited',
    'honor-gained':            'Honor gained',
    'honor-lost':              'Honor lost',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — clicking it passes */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={declineReactions}
      />

      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-amber-500/60 bg-gray-900 shadow-2xl shadow-amber-900/40">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-700 px-5 py-4">
          <span className="text-xl">⚡</span>
          <div>
            <p className="text-sm font-semibold text-amber-300 uppercase tracking-widest">
              Reaction window
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Trigger: <span className="text-gray-200">{triggerLabel[trigger] ?? trigger}</span>
            </p>
          </div>
        </div>

        {/* Candidates list */}
        <div className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400 italic">
              No reactions available for you — click Pass to continue.
            </p>
          ) : (
            visible.map((c, i) => (
              <div key={`${c.instanceId}-${c.abilityIndex}-${i}`} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {c.side === 'opponent' && <span className="text-red-400 mr-1">[Opp]</span>}
                      {c.cardName}
                    </p>
                    <p className="mt-1 text-xs text-gray-300 leading-relaxed line-clamp-3">
                      <span className="text-amber-400 font-medium">Reaction: </span>
                      {c.abilityText}
                    </p>
                    <p className="mt-1.5 text-[10px] text-gray-500 uppercase tracking-wide">
                      {c.source === 'hand' ? 'From hand'
                        : c.source === 'fateDiscard' ? 'From discard'
                        : 'In play'}
                    </p>
                  </div>
                  <button
                    onClick={() => resolveReaction(c)}
                    className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 active:scale-95 transition-all"
                  >
                    Use
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 px-5 py-3 flex justify-end">
          <button
            onClick={declineReactions}
            className="rounded-lg border border-gray-600 px-4 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 active:scale-95 transition-all"
          >
            Pass — no reactions
          </button>
        </div>
      </div>
    </div>
  );
}

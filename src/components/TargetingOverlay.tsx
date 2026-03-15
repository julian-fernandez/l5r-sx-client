import { useGameStore } from '../store/gameStore';

/**
 * Returns true when the card with `instanceId` is a valid target for the
 * current pending targeting request.
 *
 * Use this hook inside any card-rendering component to decide whether to
 * show the targeting highlight ring.
 */
export function useIsTargetable(instanceId: string): boolean {
  return useGameStore(s => s.pendingTarget?.validTargetIds.has(instanceId) ?? false);
}

/**
 * Returns true whenever the game is in targeting mode (waiting for the local
 * player to click a card).  Use this to dim non-targetable cards or block
 * other interactions while targeting is active.
 */
export function useIsTargeting(): boolean {
  return useGameStore(s => s.pendingTarget !== null);
}

/**
 * Prompt banner shown at the top of the board while the engine waits for
 * the player to select a target.  Provides the effect label and a Cancel
 * button (when allowed).
 *
 * Renders nothing when no targeting is pending.
 */
export function TargetingOverlay() {
  const pendingTarget = useGameStore(s => s.pendingTarget);
  const cancelTarget  = useGameStore(s => s.cancelTarget);

  if (!pendingTarget) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center pointer-events-none">
      <div
        className="mt-3 flex items-center gap-4 rounded-xl border border-emerald-400/60
                   bg-slate-900/95 px-5 py-3 shadow-2xl shadow-emerald-900/40
                   pointer-events-auto"
      >
        {/* Pulsing target icon */}
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>

        <p className="text-sm font-medium text-emerald-200 select-none">
          {pendingTarget.label}
          <span className="ml-2 text-xs text-emerald-400/70">
            ({pendingTarget.validTargets.length} valid target{pendingTarget.validTargets.length !== 1 ? 's' : ''})
          </span>
        </p>

        {pendingTarget.allowCancel && (
          <button
            className="ml-2 rounded-md border border-slate-600 bg-slate-700 px-3 py-1
                       text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white
                       focus:outline-none focus:ring-2 focus:ring-emerald-500"
            onClick={cancelTarget}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * BattleStrip — replaces the "Battlefield" divider during the Attack Phase.
 *
 * Stages:
 *   assigning    → right-click personalities to assign them to provinces; "Commit →" to lock in
 *   resolving    → pick which battlefield to resolve next ("Resolve →" per battlefield)
 *   engage       → Engage window: Engage: abilities can be played; both players pass to advance
 *   battleWindow → Battle window: Battle: abilities only; both players pass → auto-resolve
 */
import type { BattleAssignment, CardInstance, Province } from '../types/cards';
import { BATTLEFIELD_STYLES } from '../types/cards';
import { calcUnitForce } from '../engine/gameActions';
import { useGameStore } from '../store/gameStore';

interface Props {
  battleAssignments: BattleAssignment[];
  battleStage: 'assigning' | 'resolving' | 'engage' | 'battleWindow' | null;
  playerPersonalities: CardInstance[];
  opponentProvinces: Province[];
}

export function BattleStrip({ battleAssignments, battleStage, playerPersonalities, opponentProvinces }: Props) {
  const beginResolution       = useGameStore(s => s.beginResolution);
  const selectBattlefield     = useGameStore(s => s.selectBattlefield);
  const passBattlefieldAction = useGameStore(s => s.passBattlefieldAction);
  const endAttackPhase        = useGameStore(s => s.endAttackPhase);
  const currentBattlefield    = useGameStore(s => s.currentBattlefield);
  const battleWindowPriority  = useGameStore(s => s.battleWindowPriority);
  const battleWindowPasses    = useGameStore(s => s.battleWindowPasses);

  // Group assignments by province index
  const byProvince = new Map<number, BattleAssignment[]>();
  for (const a of battleAssignments) {
    const list = byProvince.get(a.provinceIndex) ?? [];
    list.push(a);
    byProvince.set(a.provinceIndex, list);
  }
  const battlefields = [...byProvince.entries()].sort(([a], [b]) => a - b);

  /**
   * Compute force vs province strength for a given battlefield.
   * Uses calcUnitForce(p, true) so that bowed personalities/followers
   * are correctly excluded and item modifiers are always applied.
   */
  const stats = (provinceIndex: number, assignments: BattleAssignment[]) => {
    const province = opponentProvinces[provinceIndex];
    const strength = province?.strength ?? 0;
    const attackers = assignments
      .map(a => playerPersonalities.find(p => p.instanceId === a.instanceId))
      .filter(Boolean) as CardInstance[];
    const totalForce = attackers.reduce((sum, p) => sum + calcUnitForce(p, true), 0);
    return { strength, attackers, totalForce, winning: totalForce > strength };
  };

  // ── ENGAGE or BATTLE window ──────────────────────────────────────────────
  if ((battleStage === 'engage' || battleStage === 'battleWindow') && currentBattlefield !== null) {
    const pIdx        = currentBattlefield;
    const assignments = byProvince.get(pIdx) ?? [];
    const { strength, attackers, totalForce, winning } = stats(pIdx, assignments);
    const bf          = BATTLEFIELD_STYLES[pIdx] ?? BATTLEFIELD_STYLES[0];

    const isEngage    = battleStage === 'engage';
    const windowLabel = isEngage ? 'Engage Window' : 'Battle Window';
    const windowHint  = isEngage
      ? 'Play Engage: abilities now, or pass.'
      : 'Play Battle: abilities now, or pass. (Open/Limited are Action phase only)';

    const youHasPriority  = battleWindowPriority === 'player';
    const oppHasPriority  = battleWindowPriority === 'opponent';
    const onePassMade     = battleWindowPasses === 1;

    return (
      <div className="flex flex-col gap-2 flex-shrink-0 px-3 py-2 bg-red-950/25 border-y border-red-900/40">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">⚔ Battle Phase</span>
            <span className={`text-[9px] font-bold px-1.5 rounded ${bf.badge}`}>
              {windowLabel} — Province {pIdx + 1}
            </span>
          </div>
          <button
            onClick={endAttackPhase}
            className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            title="Retreat all attackers and skip to Dynasty Phase"
          >
            Retreat All
          </button>
        </div>

        {/* Battle summary card */}
        <div className={`flex items-stretch gap-3 px-3 py-2 rounded-lg border ${bf.border} bg-board-bg`}>

          {/* Left: attacker list */}
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-[7px] text-gray-600 italic mb-0.5">{windowHint}</span>
            {attackers.map(p => (
              <div key={p.instanceId} className="flex items-center justify-between gap-2">
                <span className={`text-[8px] truncate ${p.bowed ? 'text-gray-600 line-through' : 'text-gray-300'}`}>
                  {p.card.name}
                </span>
                <span className="text-[8px] text-gray-500 tabular-nums flex-shrink-0">
                  {calcUnitForce(p, true)}f
                </span>
              </div>
            ))}
          </div>

          {/* Right: force readout */}
          <div className="flex flex-col items-end justify-center gap-0.5 flex-shrink-0">
            <span className={`text-[12px] font-bold tabular-nums ${winning ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalForce}f vs {strength}s
            </span>
            <span className={`text-[7px] font-semibold uppercase ${winning ? 'text-emerald-500' : 'text-gray-600'}`}>
              {winning ? '→ Break' : '→ Hold'}
            </span>
          </div>
        </div>

        {/* Pass row */}
        <div className="flex items-center gap-2">
          {/* Priority label */}
          <div className="flex-1 text-[8px] text-gray-500">
            {/* Defender (opponent) always has priority first per CR */}
            Priority:{' '}
            <span className="text-gray-300 font-semibold">
              {youHasPriority ? 'You (Attacker)' : 'Opponent (Defender)'}
            </span>
            {onePassMade && (
              <span className="ml-1.5 text-amber-500/80">
                (1 pass — {youHasPriority ? 'you' : 'opponent'} can act or pass to close window)
              </span>
            )}
          </div>

          {/* You Pass */}
          <button
            onClick={() => passBattlefieldAction('player')}
            disabled={!youHasPriority}
            className="text-[9px] font-semibold px-2.5 py-0.5 rounded border border-board-border
                       text-gray-400 hover:text-white hover:border-gray-500
                       disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title="Pass your action in this window"
          >
            You Pass
          </button>

          {/* Opponent Passes */}
          <button
            onClick={() => passBattlefieldAction('opponent')}
            disabled={!oppHasPriority}
            className="text-[9px] font-semibold px-2.5 py-0.5 rounded border border-board-border
                       text-gray-400 hover:text-white hover:border-gray-500
                       disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title="Pass opponent's action in this window"
          >
            Opp. Passes
          </button>
        </div>
      </div>
    );
  }

  // ── ASSIGNING or RESOLVING ───────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1.5 flex-shrink-0 px-3 py-2 bg-red-950/20 border-y border-red-900/40">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">⚔ Battle Phase</span>
          <span className="text-[8px] text-gray-600">
                 {battleStage === 'assigning'
                     ? '— assign Infantry first, then Cavalry (CAV badge)'
                     : '— select a battlefield to resolve'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {battleStage === 'assigning' && (
            <button
              onClick={beginResolution}
              className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-red-600 text-red-200 bg-red-950/60 hover:bg-red-900 transition-colors"
              title="Commit assignments and begin resolving battlefields"
            >
              Commit →
            </button>
          )}
          <button
            onClick={endAttackPhase}
            className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            title="Retreat all attackers and skip to Dynasty Phase"
          >
            Retreat All
          </button>
        </div>
      </div>

      {/* Battlefield cards */}
      {battlefields.length === 0 ? (
        <p className="text-[9px] text-gray-700 italic">
          No attackers assigned. Right-click personalities above to assign them to provinces.
        </p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {battlefields.map(([provinceIndex, assignments]) => {
            const bf = BATTLEFIELD_STYLES[provinceIndex] ?? BATTLEFIELD_STYLES[0];
            const { strength, attackers, totalForce, winning } = stats(provinceIndex, assignments);

            return (
              <div
                key={provinceIndex}
                className={`flex flex-col gap-1 px-2.5 py-1.5 rounded-lg border ${bf.border} bg-board-bg`}
                style={{ minWidth: 160 }}
              >
                {/* Province header */}
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-bold px-1.5 rounded leading-tight ${bf.badge}`}>
                    Province {provinceIndex + 1}
                  </span>
                  <span className={`text-[9px] font-bold tabular-nums ${winning ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalForce}f vs {strength}s
                  </span>
                </div>

                {/* Attacker list */}
                <div className="flex flex-col gap-0.5">
                  {attackers.map(p => (
                    <div key={p.instanceId} className="flex items-center justify-between gap-2">
                      <span className={`text-[8px] truncate max-w-[110px] ${p.bowed ? 'text-gray-600 line-through' : 'text-gray-300'}`}>
                        {p.card.name}
                      </span>
                      <span className="text-[8px] text-gray-500 tabular-nums flex-shrink-0">
                        {calcUnitForce(p, true)}f
                      </span>
                    </div>
                  ))}
                </div>

                {/* Result preview + action button */}
                <div className="flex items-center justify-between pt-0.5 border-t border-board-border">
                  <span className={`text-[7px] font-semibold uppercase ${winning ? 'text-emerald-500' : 'text-gray-600'}`}>
                    {winning ? '→ Break' : '→ Hold'}
                  </span>
                  {battleStage === 'resolving' && (
                    <button
                      onClick={() => selectBattlefield(provinceIndex)}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-red-600/60 text-red-300 hover:bg-red-950/60 transition-colors"
                      title="Open Engage → Battle windows for this battlefield"
                    >
                      Resolve →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

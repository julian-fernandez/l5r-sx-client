/**
 * BattleStrip — replaces the "Battlefield" divider during the Attack Phase.
 *
 * Stages (shown as a step-by-step progress indicator):
 *   1. Assign Infantry  — right-click non-Cavalry personalities to assign
 *   2. Assign Cavalry   — right-click Cavalry personalities to assign (after Infantry)
 *   3. Defenders        — opponent auto-assigns defenders (after Commit)
 *   4. Engage Window    — Engage: abilities; both players pass to advance
 *   5. Battle Window    — Battle: abilities only; both players pass → auto-resolve
 */
import type { BattleAssignment, CardInstance, Province } from '../types/cards';
import { BATTLEFIELD_STYLES } from '../types/cards';
import { calcUnitForce, isCavalryUnit } from '../engine/gameActions';
import { useGameStore } from '../store/gameStore';

interface Props {
  battleAssignments: BattleAssignment[];
  defenderAssignments: BattleAssignment[];
  battleStage: 'assigning' | 'resolving' | 'engage' | 'battleWindow' | null;
  playerPersonalities: CardInstance[];
  opponentPersonalities: CardInstance[];
  opponentProvinces: Province[];
  /** Wrapped by Board to also relay the action in multiplayer. */
  onEndAttackPhase: () => void;
}

export function BattleStrip({ battleAssignments, defenderAssignments, battleStage, playerPersonalities, opponentPersonalities, opponentProvinces, onEndAttackPhase }: Props) {
  const beginResolution       = useGameStore(s => s.beginResolution);
  const selectBattlefield     = useGameStore(s => s.selectBattlefield);
  const passBattlefieldAction = useGameStore(s => s.passBattlefieldAction);
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
   * Compute force vs province strength + defender force for a given battlefield.
   * Uses calcUnitForce(p, true) so bowed personalities/followers are excluded.
   */
  const stats = (provinceIndex: number, assignments: BattleAssignment[]) => {
    const province = opponentProvinces[provinceIndex];
    const strength = province?.strength ?? 0;
    const attackers = assignments
      .map(a => playerPersonalities.find(p => p.instanceId === a.instanceId))
      .filter(Boolean) as CardInstance[];
    const defenders = defenderAssignments
      .filter(d => d.provinceIndex === provinceIndex)
      .map(d => opponentPersonalities.find(p => p.instanceId === d.instanceId))
      .filter(Boolean) as CardInstance[];
    const totalForce    = attackers.reduce((sum, p) => sum + calcUnitForce(p, true), 0);
    const defenderForce = defenders.reduce((sum, p) => sum + calcUnitForce(p, true), 0);
    const defenseTotal  = strength + defenderForce;
    return { strength, defenderForce, defenseTotal, attackers, defenders, totalForce, winning: totalForce > defenseTotal };
  };

  // ── Derived sub-state helpers ────────────────────────────────────────────
  const hasCavalryAssigned = battleAssignments.some(a => {
    const p = playerPersonalities.find(pp => pp.instanceId === a.instanceId);
    return p ? isCavalryUnit(p) : false;
  });
  const hasInfantryAssigned = battleAssignments.some(a => {
    const p = playerPersonalities.find(pp => pp.instanceId === a.instanceId);
    return p ? !isCavalryUnit(p) : false;
  });

  // Which of the 5 sub-steps are we on?
  // 1=assignInfantry 2=assignCavalry 3=pickBattlefield 4=engage 5=battleWindow
  const currentStep =
    battleStage === 'assigning'    ? (hasCavalryAssigned || (hasInfantryAssigned && !hasCavalryAssigned) ? 2 : 1)
    : battleStage === 'resolving'  ? 3
    : battleStage === 'engage'     ? 4
    : 5; // battleWindow

  const STEPS: { label: string; hint: string }[] = [
    { label: '1 · Infantry',  hint: 'Right-click non-Cavalry personalities to assign attackers' },
    { label: '2 · Cavalry',   hint: 'Right-click Cavalry (CAV badge) personalities to assign after Infantry' },
    { label: '3 · Pick',      hint: 'Opponent auto-assigns defenders — choose which battlefield to resolve first' },
    { label: '4 · Engage',    hint: 'Play Engage: cards from hand (right-click), then pass' },
    { label: '5 · Battle',    hint: 'Play Battle: cards from hand (right-click), then pass — Open/Limited not allowed here' },
  ];

  // ── ENGAGE or BATTLE window ──────────────────────────────────────────────
  if ((battleStage === 'engage' || battleStage === 'battleWindow') && currentBattlefield !== null) {
    const pIdx        = currentBattlefield;
    const assignments = byProvince.get(pIdx) ?? [];
    const { strength, defenderForce, defenseTotal, attackers, defenders, totalForce, winning } = stats(pIdx, assignments);
    const bf          = BATTLEFIELD_STYLES[pIdx] ?? BATTLEFIELD_STYLES[0];
    const isEngage    = battleStage === 'engage';
    const youHasPriority = battleWindowPriority === 'player';
    const oppHasPriority = battleWindowPriority === 'opponent';
    const onePassMade    = battleWindowPasses === 1;

    return (
      <div className="flex flex-col gap-2 flex-shrink-0 px-3 py-2 bg-red-950/25 border-y border-red-900/40">

        {/* Step indicator */}
        <StepIndicator steps={STEPS} current={currentStep} />

        {/* Battlefield header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${bf.badge}`}>
              Province {pIdx + 1} — {isEngage ? 'Engage Window' : 'Battle Window'}
            </span>
            <span className="text-[8px] text-gray-500">
              {isEngage
                ? 'Right-click hand cards to play Engage: abilities, then pass'
                : 'Right-click hand cards to play Battle: abilities, then pass'}
            </span>
          </div>
          <button onClick={onEndAttackPhase} className="btn-retreat">Retreat All</button>
        </div>

        {/* Army summary */}
        <div className={`flex items-stretch gap-3 px-3 py-2 rounded-lg border ${bf.border} bg-board-bg`}>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            {attackers.map(p => (
              <div key={p.instanceId} className="flex items-center justify-between gap-2">
                <span className={`text-[8px] truncate ${p.bowed ? 'text-gray-600 line-through' : 'text-gray-300'}`}>⚔ {p.card.name}</span>
                <span className="text-[8px] text-gray-500 tabular-nums flex-shrink-0">{calcUnitForce(p, true)}f</span>
              </div>
            ))}
            {defenders.length > 0 && <>
              <div className="border-t border-board-border my-0.5" />
              {defenders.map(p => (
                <div key={p.instanceId} className="flex items-center justify-between gap-2">
                  <span className={`text-[8px] truncate ${p.bowed ? 'text-gray-600 line-through' : 'text-rose-300'}`}>🛡 {p.card.name}</span>
                  <span className="text-[8px] text-rose-600 tabular-nums flex-shrink-0">{calcUnitForce(p, true)}f</span>
                </div>
              ))}
            </>}
          </div>
          <div className="flex flex-col items-end justify-center gap-0.5 flex-shrink-0 border-l border-board-border pl-3">
            <span className={`text-[13px] font-bold tabular-nums ${winning ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalForce}f
            </span>
            <span className="text-[8px] text-gray-600">vs {strength}s{defenderForce > 0 ? ` + ${defenderForce}f` : ''} = {defenseTotal}</span>
            <span className={`text-[8px] font-bold uppercase tracking-wide ${winning ? 'text-emerald-500' : 'text-gray-600'}`}>
              {winning ? '→ BREAK' : '→ holds'}
            </span>
          </div>
        </div>

        {/* Priority + pass buttons */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <span className="text-[8px] text-gray-600">Priority: </span>
            <span className={`text-[8px] font-bold ${youHasPriority ? 'text-sky-300' : 'text-rose-300'}`}>
              {youHasPriority ? 'You (Attacker)' : 'Opponent (Defender)'}
            </span>
            {onePassMade && (
              <span className="text-[8px] text-amber-500/80 ml-2">
                · 1 pass made — pass again to close window
              </span>
            )}
          </div>
          <button
            onClick={() => passBattlefieldAction('player')}
            disabled={!youHasPriority}
            className={[
              'text-[9px] font-bold px-3 py-1 rounded border transition-colors flex-shrink-0',
              youHasPriority
                ? 'border-sky-600 text-sky-200 bg-sky-950/60 hover:bg-sky-900 cursor-pointer'
                : 'border-gray-800 text-gray-700 cursor-not-allowed',
            ].join(' ')}
          >
            You Pass
          </button>
          <button
            onClick={() => passBattlefieldAction('opponent')}
            disabled={!oppHasPriority}
            className={[
              'text-[9px] font-bold px-3 py-1 rounded border transition-colors flex-shrink-0',
              oppHasPriority
                ? 'border-rose-700 text-rose-300 bg-rose-950/60 hover:bg-rose-900 cursor-pointer'
                : 'border-gray-800 text-gray-700 cursor-not-allowed',
            ].join(' ')}
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

      {/* Step indicator */}
      <StepIndicator steps={STEPS} current={currentStep} />

      {/* Sub-header with instruction + buttons */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[8px] text-gray-500 italic flex-1 min-w-0">
          {battleStage === 'assigning'
            ? STEPS[hasInfantryAssigned && !hasCavalryAssigned ? 1 : 0].hint
            : STEPS[2].hint}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {battleStage === 'assigning' && (
            <button
              onClick={beginResolution}
              disabled={battleAssignments.length === 0}
              className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-red-600 text-red-200 bg-red-950/60 hover:bg-red-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Lock in assignments — opponent will auto-assign defenders"
            >
              Commit →
            </button>
          )}
          <button
            onClick={onEndAttackPhase}
            className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
          >
            Retreat All
          </button>
        </div>
      </div>

      {/* Battlefield cards */}
      {battlefields.length === 0 ? (
        <p className="text-[9px] text-gray-700 italic">
          Right-click your personalities (above) to assign them to opponent provinces.
        </p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {battlefields.map(([provinceIndex, assignments]) => {
            const bf = BATTLEFIELD_STYLES[provinceIndex] ?? BATTLEFIELD_STYLES[0];
            const { defenseTotal, attackers, defenders, totalForce, winning } = stats(provinceIndex, assignments);
            return (
              <div
                key={provinceIndex}
                className={`flex flex-col gap-1 px-2.5 py-1.5 rounded-lg border ${bf.border} bg-board-bg`}
                style={{ minWidth: 170 }}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-bold px-1.5 rounded leading-tight ${bf.badge}`}>Province {provinceIndex + 1}</span>
                  <span className={`text-[9px] font-bold tabular-nums ${winning ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalForce}f vs {defenseTotal}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {attackers.map(p => (
                    <div key={p.instanceId} className="flex items-center justify-between gap-2">
                      <span className={`text-[8px] truncate max-w-[110px] ${p.bowed ? 'text-gray-600 line-through' : 'text-gray-300'}`}>⚔ {p.card.name}</span>
                      <span className="text-[8px] text-gray-500 tabular-nums flex-shrink-0">{calcUnitForce(p, true)}f</span>
                    </div>
                  ))}
                </div>
                {defenders.length > 0 && (
                  <div className="flex flex-col gap-0.5 border-t border-board-border pt-0.5">
                    {defenders.map(p => (
                      <div key={p.instanceId} className="flex items-center justify-between gap-2">
                        <span className={`text-[8px] truncate max-w-[110px] ${p.bowed ? 'text-gray-600 line-through' : 'text-rose-300'}`}>🛡 {p.card.name}</span>
                        <span className="text-[8px] text-rose-600 tabular-nums flex-shrink-0">{calcUnitForce(p, true)}f</span>
                      </div>
                    ))}
                  </div>
                )}
                {battleStage === 'resolving' && defenders.length === 0 && (
                  <p className="text-[7px] text-gray-700 italic">No defenders</p>
                )}
                <div className="flex items-center justify-between pt-0.5 border-t border-board-border">
                  <span className={`text-[7px] font-semibold uppercase ${winning ? 'text-emerald-500' : 'text-gray-600'}`}>
                    {winning ? `→ BREAK` : `→ holds`}
                    <span className="font-normal normal-case ml-1 text-gray-700">({totalForce} vs {defenseTotal})</span>
                  </span>
                  {battleStage === 'resolving' && (
                    <button
                      onClick={() => selectBattlefield(provinceIndex)}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-red-600/60 text-red-300 hover:bg-red-950/60 transition-colors"
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

// ── Step progress indicator ───────────────────────────────────────────────────

function StepIndicator({ steps, current }: { steps: { label: string; hint: string }[]; current: number }) {
  return (
    <div className="flex items-center gap-0 flex-shrink-0">
      {steps.map((s, i) => {
        const stepNum  = i + 1;
        const isDone   = stepNum < current;
        const isActive = stepNum === current;
        return (
          <div key={i} className="flex items-center gap-0 flex-1 min-w-0" title={s.hint}>
            <div className={[
              'flex-1 px-2 py-0.5 text-center text-[8px] font-bold leading-tight truncate transition-all',
              isActive
                ? 'bg-red-700/60 text-red-100 border-y border-red-600'
                : isDone
                  ? 'bg-emerald-950/40 text-emerald-700 border-y border-emerald-900/40 line-through'
                  : 'bg-transparent text-gray-700 border-y border-transparent',
            ].join(' ')}>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <span className={`text-[8px] flex-shrink-0 ${isDone ? 'text-emerald-800' : 'text-gray-800'}`}>›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

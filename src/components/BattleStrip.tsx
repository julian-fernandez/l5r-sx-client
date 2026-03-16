/**
 * BattleStrip — replaces the "Battlefield" divider during the Attack Phase.
 *
 * Maneuvers Segment (Cavalry rules):
 *   1. Infantry      — attacker assigns non-Cavalry personalities (right-click)
 *   2. Defenders     — defender assigns their own personalities (right-click on own row)
 *   3. Cavalry       — attacker assigns Cavalry personalities (after seeing defenders)
 *   4. Pick          — attacker picks which battlefield to resolve first
 *   5. Engage Window — Engage: abilities; both players pass to advance
 *   6. Battle Window — Battle: abilities only; both players pass → auto-resolve
 */
import type { BattleAssignment, CardInstance, Province } from '../types/cards';
import { BATTLEFIELD_STYLES } from '../types/cards';
import { calcUnitForce, isCavalryUnit } from '../engine/gameActions';
import { useGameStore } from '../store/gameStore';

interface Props {
  battleAssignments: BattleAssignment[];
  defenderAssignments: BattleAssignment[];
  battleStage: 'assigning' | 'defender-assigning' | 'cavalry-assigning' | 'defender-cavalry-assigning' | 'resolving' | 'engage' | 'battleWindow' | null;
  playerPersonalities: CardInstance[];
  opponentPersonalities: CardInstance[];
  opponentProvinces: Province[];
  activePlayer: 'player' | 'opponent';
  multiplayerMode: boolean;
  onEndAttackPhase: () => void;
}

export function BattleStrip({
  battleAssignments, defenderAssignments, battleStage,
  playerPersonalities, opponentPersonalities, opponentProvinces,
  activePlayer, multiplayerMode,
  onEndAttackPhase,
}: Props) {
  const beginResolution       = useGameStore(s => s.beginResolution);
  const commitDefenders       = useGameStore(s => s.commitDefenders);
  const commitCavalry         = useGameStore(s => s.commitCavalry);
  const commitDefenderCavalry = useGameStore(s => s.commitDefenderCavalry);
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

  // Cavalry state for the attacker's row
  const playerCavalry    = playerPersonalities.filter(isCavalryUnit);
  const hasCavAvailable  = playerCavalry.some(p =>
    !p.bowed && !battleAssignments.some(a => a.instanceId === p.instanceId)
  );

  // Which step are we on?
  const currentStep =
    battleStage === 'assigning'                  ? 1
    : battleStage === 'defender-assigning'         ? 2
    : battleStage === 'cavalry-assigning'          ? 3
    : battleStage === 'defender-cavalry-assigning' ? 4
    : battleStage === 'resolving'                  ? 5
    : battleStage === 'engage'                     ? 6
    : 7; // battleWindow

  const STEPS: { label: string; hint: string }[] = [
    { label: '1 · Infantry',    hint: 'Right-click your non-Cavalry personalities to assign attackers' },
    { label: '2 · Defenders',   hint: 'Defender assigns non-Cavalry units (right-click own personalities)' },
    { label: '3 · Cavalry',     hint: 'Attacker assigns Cavalry after seeing defender positions' },
    { label: '4 · Def. Cavalry',hint: 'Defender assigns Cavalry after seeing attacker Cavalry' },
    { label: '5 · Pick',        hint: 'Choose which battlefield to resolve first' },
    { label: '6 · Engage',      hint: 'Play Engage: cards from hand (right-click), then pass' },
    { label: '7 · Battle',      hint: 'Play Battle: cards from hand (right-click), then pass' },
  ];

  // ── ENGAGE or BATTLE window ────────────────────────────────────────────────
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
        <StepIndicator steps={STEPS} current={currentStep} />

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
          <button onClick={onEndAttackPhase} className="btn-retreat">No Battle</button>
        </div>

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

  // ── DEFENDER-ASSIGNING ────────────────────────────────────────────────────
  if (battleStage === 'defender-assigning') {
    const isDefender = multiplayerMode && activePlayer === 'opponent';

    return (
      <div className="flex flex-col gap-1.5 flex-shrink-0 px-3 py-2 bg-rose-950/20 border-y border-rose-900/40">
        <StepIndicator steps={STEPS} current={currentStep} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-[8px] font-semibold text-rose-300">
              {isDefender ? '🛡 Assign your defenders' : '⏳ Waiting for defender to assign…'}
            </span>
            <span className="text-[8px] text-gray-500 italic">
              {isDefender
                ? 'Right-click your own personalities to assign them to defend provinces'
                : 'Opponent is choosing which personalities to defend with'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* In solo mode (not multiplayer) the auto-advance effect handles this; 
                in multiplayer the DEFENDER commits manually */}
            {(isDefender || !multiplayerMode) && (
              <button
                onClick={commitDefenders}
                className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-rose-600 text-rose-200 bg-rose-950/60 hover:bg-rose-900 transition-colors"
                title="Lock in defender assignments — Cavalry phase begins"
              >
                Finish Assignments →
              </button>
            )}
            <button
              onClick={onEndAttackPhase}
              className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            >
              No Battle
            </button>
          </div>
        </div>

        <AssignmentCards
          battlefields={battlefields}
          byProvince={byProvince}
          playerPersonalities={playerPersonalities}
          opponentPersonalities={opponentPersonalities}
          defenderAssignments={defenderAssignments}
          opponentProvinces={opponentProvinces}
          battleStage={battleStage}
          onSelectBattlefield={null}
        />
      </div>
    );
  }

  // ── CAVALRY-ASSIGNING ─────────────────────────────────────────────────────
  if (battleStage === 'cavalry-assigning') {
    const isAttacker = !multiplayerMode || activePlayer === 'player';
    const cavAssigned = battleAssignments.filter(a => {
      const p = playerPersonalities.find(pp => pp.instanceId === a.instanceId);
      return p ? isCavalryUnit(p) : false;
    });

    return (
      <div className="flex flex-col gap-1.5 flex-shrink-0 px-3 py-2 bg-yellow-950/20 border-y border-yellow-900/30">
        <StepIndicator steps={STEPS} current={currentStep} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-[8px] font-semibold text-yellow-300">
              {isAttacker
                ? hasCavAvailable
                  ? '🐴 Cavalry phase — assign Cavalry units (they know where defenders went)'
                  : '🐴 Cavalry phase — no Cavalry available, skip to continue'
                : '⏳ Waiting for attacker to assign Cavalry…'}
            </span>
            <span className="text-[8px] text-gray-500 italic">
              {isAttacker
                ? `${cavAssigned.length} Cavalry assigned so far`
                : 'Attacker is choosing where to send Cavalry units'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isAttacker && (
              <button
                onClick={commitCavalry}
                className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-yellow-600 text-yellow-200 bg-yellow-950/60 hover:bg-yellow-900 transition-colors"
                title="Lock in Cavalry assignments — proceed to battle resolution"
                >
                  {hasCavAvailable ? 'Finish Assignments →' : 'Skip →'}
              </button>
            )}
            <button
              onClick={onEndAttackPhase}
              className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            >
              No Battle
            </button>
          </div>
        </div>

        <AssignmentCards
          battlefields={battlefields}
          byProvince={byProvince}
          playerPersonalities={playerPersonalities}
          opponentPersonalities={opponentPersonalities}
          defenderAssignments={defenderAssignments}
          opponentProvinces={opponentProvinces}
          battleStage={battleStage}
          onSelectBattlefield={null}
        />
      </div>
    );
  }

  // ── DEFENDER-CAVALRY-ASSIGNING ────────────────────────────────────────────
  if (battleStage === 'defender-cavalry-assigning') {
    const isDefender = multiplayerMode && activePlayer === 'opponent';

    // Which of the defender's cavalry are still unassigned?
    const assignedDefenderIds = new Set(defenderAssignments.map(d => d.instanceId));
    const defCavAvailable = opponentPersonalities.filter(p =>
      isCavalryUnit(p) && !assignedDefenderIds.has(p.instanceId) && !p.bowed
    ).length > 0;

    return (
      <div className="flex flex-col gap-1.5 flex-shrink-0 px-3 py-2 bg-rose-950/20 border-y border-rose-900/40">
        <StepIndicator steps={STEPS} current={currentStep} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-[8px] font-semibold text-rose-300">
              {isDefender
                ? defCavAvailable
                  ? '🐴 Assign your Cavalry defenders'
                  : '🐴 No Cavalry available — skip to continue'
                : '⏳ Waiting for defender to assign Cavalry…'}
            </span>
            <span className="text-[8px] text-gray-500 italic">
              {isDefender
                ? 'Right-click your Cavalry personalities to assign them to defend provinces'
                : 'Defender is choosing where to send their Cavalry'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {(isDefender || !multiplayerMode) && (
              <button
                onClick={commitDefenderCavalry}
                className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-rose-600 text-rose-200 bg-rose-950/60 hover:bg-rose-900 transition-colors"
                title="Lock in Cavalry defenders — proceed to battle resolution"
                >
                  {defCavAvailable ? 'Finish Assignments →' : 'Skip →'}
              </button>
            )}
            <button
              onClick={onEndAttackPhase}
              className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
            >
              No Battle
            </button>
          </div>
        </div>

        <AssignmentCards
          battlefields={battlefields}
          byProvince={byProvince}
          playerPersonalities={playerPersonalities}
          opponentPersonalities={opponentPersonalities}
          defenderAssignments={defenderAssignments}
          opponentProvinces={opponentProvinces}
          battleStage={battleStage}
          onSelectBattlefield={null}
        />
      </div>
    );
  }

  // ── ASSIGNING or RESOLVING ────────────────────────────────────────────────

  // Infantry phase: if ALL available (unbowed) personalities are Cavalry,
  // there is nothing to assign here — allow proceeding with 0 assignments.
  const nonCavalryAvailable = playerPersonalities.filter(
    p => !isCavalryUnit(p) && !p.bowed,
  );
  const canCommitInfantry =
    battleAssignments.length > 0 || nonCavalryAvailable.length === 0;

  return (
    <div className="flex flex-col gap-1.5 flex-shrink-0 px-3 py-2 bg-red-950/20 border-y border-red-900/40">
      <StepIndicator steps={STEPS} current={currentStep} />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[8px] text-gray-500 italic flex-1 min-w-0">
          {battleStage === 'assigning'
            ? 'Right-click your non-Cavalry personalities to assign attackers'
            : 'Choose which battlefield to resolve first'}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {battleStage === 'assigning' && (
            <button
              onClick={beginResolution}
              disabled={!canCommitInfantry}
              className="text-[9px] font-bold px-2.5 py-0.5 rounded border border-red-600 text-red-200 bg-red-950/60 hover:bg-red-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Lock in infantry assignments — defender may now assign"
            >
              Finish Assignments →
            </button>
          )}
          <button
            onClick={onEndAttackPhase}
            className="text-[9px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
          >
            No Battle
          </button>
        </div>
      </div>

      <AssignmentCards
        battlefields={battlefields}
        byProvince={byProvince}
        playerPersonalities={playerPersonalities}
        opponentPersonalities={opponentPersonalities}
        defenderAssignments={defenderAssignments}
        opponentProvinces={opponentProvinces}
        battleStage={battleStage}
        onSelectBattlefield={battleStage === 'resolving' ? selectBattlefield : null}
      />
    </div>
  );
}

// ── Shared battlefield card grid ───────────────────────────────────────────────

function AssignmentCards({
  battlefields, byProvince,
  playerPersonalities, opponentPersonalities, defenderAssignments, opponentProvinces,
  battleStage, onSelectBattlefield,
}: {
  battlefields: [number, BattleAssignment[]][];
  byProvince: Map<number, BattleAssignment[]>;
  playerPersonalities: CardInstance[];
  opponentPersonalities: CardInstance[];
  defenderAssignments: BattleAssignment[];
  opponentProvinces: Province[];
  battleStage: Props['battleStage'];
  onSelectBattlefield: ((idx: number) => void) | null;
}) {
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
    return { defenseTotal, attackers, defenders, totalForce, winning: totalForce > defenseTotal };
  };

  if (battlefields.length === 0) {
    return (
      <p className="text-[9px] text-gray-700 italic">
        {battleStage === 'assigning'
          ? 'Right-click your non-Cavalry personalities (above) to assign them to opponent provinces.'
          : battleStage === 'cavalry-assigning'
          ? 'Right-click your Cavalry personalities (CAV badge) to assign them.'
          : 'No attackers assigned yet.'}
      </p>
    );
  }

  return (
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
              {attackers.map(p => {
                const isCav = isCavalryUnit(p);
                return (
                  <div key={p.instanceId} className="flex items-center justify-between gap-2">
                    <span className={`text-[8px] truncate max-w-[110px] ${p.bowed ? 'text-gray-600 line-through' : isCav ? 'text-yellow-300' : 'text-gray-300'}`}>
                      {isCav ? '🐴' : '⚔'} {p.card.name}
                    </span>
                    <span className="text-[8px] text-gray-500 tabular-nums flex-shrink-0">{calcUnitForce(p, true)}f</span>
                  </div>
                );
              })}
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
            {(battleStage === 'resolving' || battleStage === 'defender-assigning' || battleStage === 'cavalry-assigning') && defenders.length === 0 && (
              <p className="text-[7px] text-gray-700 italic">No defenders</p>
            )}
            <div className="flex items-center justify-between pt-0.5 border-t border-board-border">
              <span className={`text-[7px] font-semibold uppercase ${winning ? 'text-emerald-500' : 'text-gray-600'}`}>
                {winning ? `→ BREAK` : `→ holds`}
                <span className="font-normal normal-case ml-1 text-gray-700">({totalForce} vs {defenseTotal})</span>
              </span>
              {onSelectBattlefield && (
                <button
                  onClick={() => onSelectBattlefield(provinceIndex)}
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

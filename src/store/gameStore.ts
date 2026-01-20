import { create } from 'zustand';
import type { BattleAssignment, CardInstance, LogCategory, LogEntry, NormalizedCard, ParsedDeck, PlayerState, Province, ZoneId } from '../types/cards';
import { calcUnitForce, createInstance, expandDeck, shuffle } from '../engine/gameActions';

type GamePhase = 'setup' | 'playing';

/**
 * The eight phases of a Samurai Extended turn (in order).
 * Straighten → Event → Action → Attack → Dynasty → Discard → Draw → End
 */
export type TurnPhase =
  | 'straighten'
  | 'event'
  | 'action'
  | 'attack'
  | 'dynasty'
  | 'discard'
  | 'draw'
  | 'end';


interface GameStore {
  phase: GamePhase;
  catalogLoaded: boolean;
  player: PlayerState;
  opponent: PlayerState;
  /** Whose overall turn it is */
  activePlayer: 'player' | 'opponent';
  /** Current SX turn phase */
  turnPhase: TurnPhase;
  /** Who has action priority right now (matters in Action/Battle phases) */
  priority: 'player' | 'opponent';
  /**
   * Which side is currently in Cycle mode (first-turn province cycling).
   * null when no cycling is in progress.
   */
  cyclingActive: 'player' | 'opponent' | null;

  // ── Battle ──────────────────────────────────────────────────────────────────
  /**
   * Player's personality-to-province assignments for the current Attack Phase.
   * Each entry maps one personality instanceId to one opponent province index.
   */
  battleAssignments: BattleAssignment[];
  /**
   * Which stage of the Attack Phase we are in.
   * null          → not in Attack Phase
   * 'assigning'   → player is assigning personalities to provinces
   * 'resolving'   → player selects which battlefield to resolve next
   * 'engage'      → Engage window open on currentBattlefield (Engage: abilities)
   * 'battleWindow'→ Battle window open on currentBattlefield (Battle:/Open: abilities)
   */
  battleStage: 'assigning' | 'resolving' | 'engage' | 'battleWindow' | null;
  /** Index of the opponent province currently being resolved (engage/battleWindow stages). */
  currentBattlefield: number | null;
  /** Who holds priority within the current engage/battleWindow pass cycle. */
  battleWindowPriority: 'player' | 'opponent';
  /** Consecutive passes within the current engage/battleWindow cycle. */
  battleWindowPasses: number;
  /**
   * How many consecutive passes have been made in the current action round.
   * Resets to 0 whenever a non-pass action is taken.
   * When it reaches 2 (both players pass back-to-back), the phase ends.
   */
  consecutivePasses: number;
  turnNumber: number;
  lastDeckText: string;
  strongholdOverride: { honor: number; gold: number; provinceStrength: number } | null;
  /** Append-only game log — records every meaningful action */
  gameLog: LogEntry[];

  setCatalogLoaded: (loaded: boolean) => void;
  setStrongholdOverride: (o: { honor: number; gold: number; provinceStrength: number } | null) => void;
  loadGame: (deck: ParsedDeck) => void;
  resetGame: () => void;
  setLastDeckText: (text: string) => void;

  // ── Priority / Phase ────────────────────────────────────────────────────────
  /** Player clicks "Pass" — passes action priority to opponent. Gold resets per SX rules. */
  passPriority: () => void;
  /** Called when the opponent (or the user controlling them) passes priority. */
  opponentAutoPass: () => void;

  // ── Card actions ────────────────────────────────────────────────────────────
  /** Draw the top card of the target's Fate deck into their hand. */
  drawFateCard: (target: 'player' | 'opponent') => void;
  /**
   * Toggle bow on any in-play card (holding, personality, special).
   * Bowing a holding automatically adds its gold production to the owner's pool.
   */
  bowCard: (instanceId: string, target: 'player' | 'opponent') => void;
  /**
   * Toggle bow on the stronghold.
   * Bowing adds its gold production to the owner's pool.
   */
  bowStronghold: (target: 'player' | 'opponent') => void;
  /**
   * Spend gold from the pool to recruit the face-up card in the given province.
   * The province is immediately refilled face-down from the top of the dynasty deck.
   *
   * Options (only valid for same-clan personalities):
   *  - `discount`: apply the 2-gold Clan Discount (mutually exclusive with proclaim)
   *  - `proclaim`: pay 2 extra gold; add the personality's Personal Honor to Family Honor
   *                (may only be used once per turn)
   */
  recruitFromProvince: (
    provinceIndex: number,
    target: 'player' | 'opponent',
    options?: { discount?: boolean; proclaim?: boolean },
  ) => void;

  // ── Phase advancement ────────────────────────────────────────────────────────
  /**
   * Advance to the next phase. Handles:
   *   Dynasty → Discard
   *   Discard → End (auto-draws 1 Fate card)
   *   End     → next turn Action (straightens incoming active player, switches turn)
   * Blocked from End → next turn while hand > HAND_LIMIT.
   */
  advancePhase: () => void;
  /** During Discard Phase: discard the face-up province card and refill face-down. */
  discardFromProvince: (provinceIndex: number, target: 'player' | 'opponent') => void;
  /** During End Phase: discard a hand card to meet the 8-card hand limit. */
  discardHandCard: (instanceId: string, target: 'player' | 'opponent') => void;

  // ── First-turn Cycle ─────────────────────────────────────────────────────────
  /** Enter Cycle mode — player may now click face-up province cards to cycle them. */
  startCycling: (target: 'player' | 'opponent') => void;
  /**
   * Commit all selected provinces at once: send their face-up cards to the
   * bottom of the dynasty deck, then draw one new face-up card per province.
   * New cards cannot be cycled (cycling ends immediately after).
   */
  commitCycling: (selectedIndices: number[], target: 'player' | 'opponent') => void;
  /** Exit Cycle mode without cycling any province (still marks cycling as used). */
  endCycling: (target: 'player' | 'opponent') => void;

  /**
   * Mark a card's once-per-turn activated ability as used for this turn.
   * No-ops if the ability was already used. Resets with each new turn.
   */
  useHoldingAbility: (instanceId: string, target: 'player' | 'opponent') => void;

  /**
   * Play a card from the player's hand.
   *
   * - Strategies: resolve immediately → Fate discard pile.
   * - Attachments (item, follower, spell): equip to `attachTargetId` personality.
   *
   * Gold cost is deducted from the player's pool.
   * Timing validation should be done before calling (see canPlayFromHand).
   */
  playFromHand: (
    instanceId: string,
    target: 'player' | 'opponent',
    attachTargetId?: string,
    /** For strategies: the ability text the player declared they are using */
    selectedAbility?: string,
  ) => void;

  // ── Battle actions ────────────────────────────────────────────────────────
  /** Begin the Attack Phase — player now assigns personalities to provinces. */
  declareBattle: () => void;
  /** Assign (or reassign) a personality to attack a specific province. */
  assignToBattlefield: (instanceId: string, provinceIndex: number) => void;
  /** Remove a personality from their current battlefield assignment. */
  unassignFromBattle: (instanceId: string) => void;
  /** Move from assigning to resolving (commits the battle plan). */
  beginResolution: () => void;
  /**
   * Select a battlefield to resolve. Enters the Engage window for that province.
   * After both players pass Engage → Battle window; after both pass Battle → auto-resolve.
   */
  selectBattlefield: (provinceIndex: number) => void;
  /**
   * Pass within the current Engage or Battle window.
   * When both players pass consecutively:
   *   engage → battleWindow; battleWindow → auto-resolve the current battlefield.
   */
  passBattlefieldAction: (side: 'player' | 'opponent') => void;
  /** End the Attack Phase (all battlefields done or player retreats). */
  endAttackPhase: () => void;
}

function emptyPlayer(): PlayerState {
  return {
    stronghold: null,
    sensei: null,
    familyHonor: 5,
    strongholdGoldProduction: 5,
    provinceStrength: 6,
    hand: [],
    fateDeck: [],
    dynastyDeck: [],
    fateDiscard: [],
    dynastyDiscard: [],
    provinces: Array.from({ length: 4 }, (_, i) => ({
      index: i, card: null, faceUp: false, region: null, strength: 6, broken: false,
    })),
    personalitiesHome: [],
    holdingsInPlay: [],
    specialsInPlay: [],
    goldPool: 0,
    strongholdBowed: false,
    proclaimUsed: false,
    cyclingDone: false,
    abilitiesUsed: [],
  };
}

function resolveStats(
  stronghold: NormalizedCard | null,
  sensei: NormalizedCard | null,
  override: { honor: number; gold: number; provinceStrength: number } | null,
) {
  const base = override ?? {
    honor: stronghold?.startingHonor ?? 5,
    gold: Number(stronghold?.goldProduction) || 5,
    provinceStrength: stronghold?.provinceStrength ?? 6,
  };
  return {
    familyHonor: base.honor + (sensei?.senseiHonorMod ?? 0),
    strongholdGoldProduction: base.gold + (sensei?.senseiGoldMod ?? 0),
    provinceStrength: base.provinceStrength + (sensei?.senseiProvinceMod ?? 0),
  };
}

function buildProvinces(deck: CardInstance[], strength: number): { provinces: Province[]; remaining: CardInstance[] } {
  const remaining = [...deck];
  const provinces: Province[] = [];
  for (let i = 0; i < 4; i++) {
    const card = remaining.shift() ?? null;
    if (card) { card.location = `province${i}` as CardInstance['location']; card.faceUp = false; }
    provinces.push({ index: i, card, faceUp: false, region: null, strength, broken: false });
  }
  return { provinces, remaining };
}

function buildPlayerState(
  deck: ParsedDeck,
  override: { honor: number; gold: number; provinceStrength: number } | null,
  isOpponent: boolean,
): PlayerState {
  const stronghold = deck.stronghold[0]?.card ?? null;
  const sensei = deck.sensei[0]?.card ?? null;
  const { familyHonor, strongholdGoldProduction, provinceStrength } = resolveStats(stronghold, sensei, override);

  const dynastyInstances = shuffle(expandDeck(deck.dynasty, 'dynastyDeck'));
  const fateInstances = shuffle(expandDeck(deck.fate, 'fateDeck'));

  const { provinces, remaining: dynastyRemaining } = buildProvinces(dynastyInstances, provinceStrength);

  // Opponent hand cards are always face-down (private)
  const hand = fateInstances.slice(0, 5).map(c => ({
    ...c, location: 'hand' as const, faceUp: !isOpponent,
  }));
  const fateDeck = fateInstances.slice(5);

  const holdingsInPlay = deck.pregameHoldings.flatMap(e => {
    if (!e.card) return [];
    return [createInstance(e.card, 'holdingsInPlay', true)];
  });

    return {
      stronghold, sensei,
      familyHonor, strongholdGoldProduction, provinceStrength,
      hand, fateDeck,
      dynastyDeck: dynastyRemaining,
      fateDiscard: [], dynastyDiscard: [],
      provinces,
      personalitiesHome: [],
      holdingsInPlay,
      specialsInPlay: [],
      goldPool: 0,
      strongholdBowed: false,
      proclaimUsed: false,
      cyclingDone: false,
      abilitiesUsed: [],
    };
}

/**
 * Pure function: reveals all four provinces for a player, processing special
 * card types according to SX rules:
 *  - Celestial → enters specialsInPlay (displaces any existing celestial); province refills face-down, then is revealed
 *  - Event     → discarded; province refills face-down, then is revealed
 *  - Region / Personality / Holding → stays face-up
 * Replacement cards drawn for celestial/event provinces are flipped face-up
 * immediately as part of the same reveal action.
 */
function applyRevealProvinces(state: PlayerState): PlayerState {
  let dynastyDeck     = [...state.dynastyDeck];
  let specialsInPlay  = [...state.specialsInPlay];
  let dynastyDiscard  = [...state.dynastyDiscard];

  const provinces = state.provinces.map(p => {
    if (!p.card) return { ...p, faceUp: true };
    const cardType   = p.card.card.type;
    const faceUpInst = { ...p.card, faceUp: true };

    if (cardType === 'celestial') {
      dynastyDiscard = [...dynastyDiscard, ...specialsInPlay.filter(c => c.card.type === 'celestial')];
      specialsInPlay = [
        ...specialsInPlay.filter(c => c.card.type !== 'celestial'),
        { ...faceUpInst, location: 'specialsInPlay' as ZoneId },
      ];
      const [next = null, ...rest] = dynastyDeck;
      dynastyDeck = rest;
      // Replacement card is also revealed face-up (it's part of the initial flip)
      return {
        ...p, faceUp: true,
        card: next ? { ...next, location: p.card.location, faceUp: true, bowed: false } : null,
      };
    }

    if (cardType === 'event') {
      dynastyDiscard = [...dynastyDiscard, { ...faceUpInst, location: 'dynastyDiscard' as ZoneId }];
      const [next = null, ...rest] = dynastyDeck;
      dynastyDeck = rest;
      // Replacement card is also revealed face-up
      return {
        ...p, faceUp: true,
        card: next ? { ...next, location: p.card.location, faceUp: true, bowed: false } : null,
      };
    }

    return { ...p, faceUp: true, card: faceUpInst };
  });

  return { ...state, provinces, dynastyDeck, specialsInPlay, dynastyDiscard };
}

export const useGameStore = create<GameStore>((set, get) => {
  /** Append one entry to the game log without disrupting the main state update. */
  const pushLog = (
    message: string,
    category: LogCategory,
    side: 'player' | 'opponent' | 'system' = 'system',
  ) => {
    const st = get();
    const entry: LogEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      turnNumber: st.turnNumber ?? 1,
      phase: st.turnPhase ?? 'action',
      side,
      message,
      category,
    };
    set({ gameLog: [...st.gameLog, entry] });
  };

  return ({
  phase: 'setup',
  catalogLoaded: false,
  player: emptyPlayer(),
  opponent: emptyPlayer(),
  activePlayer: 'player',
    turnPhase: 'action',
    priority: 'player',
    consecutivePasses: 0,
    cyclingActive: null,
  turnNumber: 1,
  lastDeckText: '',
  strongholdOverride: null,
  gameLog: [],
  battleAssignments: [],
  battleStage: null,
  currentBattlefield: null,
  battleWindowPriority: 'player',
  battleWindowPasses: 0,

  setCatalogLoaded: (loaded) => set({ catalogLoaded: loaded }),
  setLastDeckText: (text) => set({ lastDeckText: text }),
  setStrongholdOverride: (o) => set({ strongholdOverride: o }),
  resetGame: () => set({
    phase: 'setup', player: emptyPlayer(), opponent: emptyPlayer(),
    activePlayer: 'player', turnPhase: 'action', priority: 'player',
    consecutivePasses: 0, turnNumber: 1, strongholdOverride: null, gameLog: [],
    battleAssignments: [], battleStage: null,
    currentBattlefield: null, battleWindowPriority: 'player', battleWindowPasses: 0,
  }),

  // ── Internal log helper ───────────────────────────────────────────────────

  // addLog is not part of the public interface — called internally by actions
  // via a closure over `get`/`set`.

  // ── Priority / Phase ──────────────────────────────────────────────────────

  passPriority: () => {
    const { priority, consecutivePasses, activePlayer, player, opponent } = get();
    if (priority !== 'player') return;
    const newCount = consecutivePasses + 1;
    const clearedPlayer = { ...player, goldPool: 0 };
    if (newCount >= 2) {
      pushLog('Both players passed — entering Attack Phase', 'phase', 'system');
      set({
        turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [],
        consecutivePasses: 0, priority: activePlayer,
        currentBattlefield: null, battleWindowPriority: 'player', battleWindowPasses: 0,
        player: clearedPlayer, opponent: { ...opponent, goldPool: 0 },
      });
    } else {
      pushLog('You passed priority', 'priority', 'player');
      set({ consecutivePasses: newCount, priority: 'opponent', player: clearedPlayer });
    }
  },

  opponentAutoPass: () => {
    const { priority, consecutivePasses, activePlayer, player, opponent } = get();
    if (priority !== 'opponent') return;
    const newCount = consecutivePasses + 1;
    const clearedOpponent = { ...opponent, goldPool: 0 };
    if (newCount >= 2) {
      pushLog('Both players passed — entering Attack Phase', 'phase', 'system');
      set({
        turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [],
        consecutivePasses: 0, priority: activePlayer,
        currentBattlefield: null, battleWindowPriority: 'player', battleWindowPasses: 0,
        player: { ...player, goldPool: 0 }, opponent: clearedOpponent,
      });
    } else {
      pushLog('Opponent passed priority', 'priority', 'opponent');
      set({ consecutivePasses: newCount, priority: 'player', opponent: clearedOpponent });
    }
  },

  // ── Card actions ──────────────────────────────────────────────────────────

  drawFateCard: (target) => {
    const ps = get()[target];
    if (ps.fateDeck.length === 0) return;
    const [top, ...rest] = ps.fateDeck;
    const drawn: CardInstance = { ...top, location: 'hand', faceUp: target !== 'opponent' };
    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} drew ${target === 'player' ? top.card.name : 'a card'} from the Fate deck`, 'draw', target);
    set({ [target]: { ...ps, fateDeck: rest, hand: [...ps.hand, drawn] } });
  },

  bowCard: (instanceId, target) => {
    const ps = get()[target];

    // Toggle bow in an array; also computes gold delta (positive when bowing, negative when unbowing).
    // Returns null when the card isn't in this array.
    const toggleIn = (arr: CardInstance[]): { result: CardInstance[]; goldDelta: number } | null => {
      let found = false;
      let goldDelta = 0;
      const result = arr.map(inst => {
        if (inst.instanceId !== instanceId) return inst;
        found = true;
        const nowBowed = !inst.bowed;
        if (inst.card.type === 'holding') {
          const gp = Math.max(0, Number(inst.card.goldProduction) || 0);
          // Bowing → add gold; unbowing (mistake undo) → remove gold
          goldDelta = nowBowed ? gp : -gp;
        }
        return { ...inst, bowed: nowBowed };
      });
      return found ? { result, goldDelta } : null;
    };

    for (const zone of ['holdingsInPlay', 'personalitiesHome', 'specialsInPlay'] as const) {
      const hit = toggleIn(ps[zone] as CardInstance[]);
      if (hit) {
        const card = (ps[zone] as CardInstance[]).find(c => c.instanceId === instanceId);
        const nowBowed = card ? !card.bowed : false;
        const who = target === 'player' ? 'You' : 'Opponent';
        if (nowBowed) {
          const gpMsg = hit.goldDelta > 0 ? ` (+${hit.goldDelta}g)` : '';
          pushLog(`${who} bowed ${card?.card.name ?? 'card'}${gpMsg}`, 'bow', target);
        } else {
          const gpMsg = hit.goldDelta < 0 ? ` (−${Math.abs(hit.goldDelta)}g removed)` : '';
          pushLog(`${who} unbowed ${card?.card.name ?? 'card'}${gpMsg}`, 'bow', target);
        }
        set({
          [target]: {
            ...ps,
            [zone]: hit.result,
            goldPool: Math.max(0, ps.goldPool + hit.goldDelta),
          },
        });
        return;
      }
    }

    // Also search inside personality attachments
    const personalities = ps.personalitiesHome;
    for (let pi = 0; pi < personalities.length; pi++) {
      const hit = toggleIn(personalities[pi].attachments);
      if (hit) {
        const att = personalities[pi].attachments.find(a => a.instanceId === instanceId);
        const nowBowed = att ? !att.bowed : false;
        const who = target === 'player' ? 'You' : 'Opponent';
        pushLog(
          `${who} ${nowBowed ? 'bowed' : 'unbowed'} ${att?.card.name ?? 'attachment'} (on ${personalities[pi].card.name})`,
          'bow', target,
        );
        set({
          [target]: {
            ...ps,
            personalitiesHome: personalities.map((p, i) =>
              i !== pi ? p : { ...p, attachments: hit.result },
            ),
            // Attachments don't produce gold, so no goldPool change
          },
        });
        return;
      }
    }
  },

  bowStronghold: (target) => {
    const ps = get()[target];
    const nowBowed = !ps.strongholdBowed;
    const goldDelta = nowBowed ? ps.strongholdGoldProduction : -ps.strongholdGoldProduction;
    const who = target === 'player' ? 'You' : 'Opponent';
    const shName = ps.stronghold?.name ?? 'Stronghold';
    if (nowBowed) {
      pushLog(`${who} bowed ${shName} (+${ps.strongholdGoldProduction}g)`, 'gold', target);
    } else {
      pushLog(`${who} unbowed ${shName} (−${ps.strongholdGoldProduction}g removed)`, 'gold', target);
    }
    set({ [target]: { ...ps, strongholdBowed: nowBowed, goldPool: Math.max(0, ps.goldPool + goldDelta) } });
  },

  recruitFromProvince: (provinceIndex, target, options = {}) => {
    const { discount = false, proclaim = false } = options;
    const ps = get()[target];
    const province = ps.provinces[provinceIndex];
    if (!province?.card || !province.faceUp) return;
    if (proclaim && ps.proclaimUsed) return; // once per turn

    const inst = province.card;
    const baseCost = Math.max(0, Number(inst.card.cost) || 0);

    // Clan Discount: -2g when using the discount option. Mutually exclusive with Proclaim.
    // Proclaim: full printed cost (no discount), adds Personal Honor to Family Honor.
    const discountAmt = discount ? 2 : 0;
    const finalCost   = Math.max(0, baseCost - discountAmt);

    if (ps.goldPool < finalCost) return;

    // Refill province from top of dynasty deck (face-down)
    const [nextCard = null, ...restDynasty] = ps.dynastyDeck;
    const newProvinceCard: CardInstance | null = nextCard
      ? { ...nextCard, location: `province${provinceIndex}` as ZoneId, faceUp: false, bowed: false }
      : null;

    const newProvince: Province = { ...province, card: newProvinceCard, faceUp: false };
    const provinces = ps.provinces.map((p, i) => (i === provinceIndex ? newProvince : p));

    // Place recruited card into the right zone; holdings always enter play bowed
    const isHolding = inst.card.type === 'holding';
    const recruited: CardInstance = {
      ...inst,
      location: isHolding ? 'holdingsInPlay' : 'personalitiesHome',
      bowed: isHolding,
    };

    // Proclaim: gain Personal Honor equal to the personality's PH stat
    const phGain = proclaim ? Math.max(0, Number(inst.card.personalHonor) || 0) : 0;

    const who = target === 'player' ? 'You' : 'Opponent';
    if (proclaim) {
      pushLog(
        `${who} proclaimed ${inst.card.name} for ${finalCost}g (+${phGain} honor)`,
        'recruit', target,
      );
    } else if (discount) {
      pushLog(
        `${who} recruited ${inst.card.name} with clan discount for ${finalCost}g`,
        'recruit', target,
      );
    } else {
      pushLog(`${who} recruited ${inst.card.name} for ${finalCost}g`, 'recruit', target);
    }

    set({
      [target]: {
        ...ps,
        provinces,
        dynastyDeck: restDynasty,
        personalitiesHome: isHolding ? ps.personalitiesHome : [...ps.personalitiesHome, recruited],
        holdingsInPlay:    isHolding ? [...ps.holdingsInPlay, recruited] : ps.holdingsInPlay,
        // No gold change in this edition: entire pool is spent on a purchase
        goldPool:     0,
        familyHonor:  ps.familyHonor + phGain,
        proclaimUsed: proclaim ? true : ps.proclaimUsed,
      },
    });
  },

  loadGame: (deck: ParsedDeck) => {
    const { strongholdOverride } = get();
    const player   = buildPlayerState(deck, strongholdOverride, false);
    const opponent = buildPlayerState(deck, strongholdOverride, true);

    // Higher starting family honor goes first; tie → player goes first
    const activePlayer: 'player' | 'opponent' =
      opponent.familyHonor > player.familyHonor ? 'opponent' : 'player';

    // The first player has action priority at game start.
    // Provinces are NOT yet revealed — player must click "Flip Provinces" in Straighten Phase.
    const firstWho = activePlayer === 'player' ? 'You go' : 'Opponent goes';
    set({
      phase: 'playing',
      player,
      opponent,
      activePlayer,
      turnPhase: 'straighten',
      priority: activePlayer,
      consecutivePasses: 0,
      turnNumber: 1,
      gameLog: [{
        id: 'start',
        turnNumber: 1,
        phase: 'straighten',
        side: 'system',
        message: `Game started — ${firstWho} first (higher starting honor). Flip your provinces to begin.`,
        category: 'phase',
      }],
    });
  },

  // ── Phase advancement ─────────────────────────────────────────────────────

  advancePhase: () => {
    const st = get();
    const { turnPhase, activePlayer } = st;
    const ps = st[activePlayer];
    const HAND_LIMIT = 8;

    // ── First-turn: reveal the active player's provinces ──────────────────────
    if (turnPhase === 'straighten') {
      const revealed = applyRevealProvinces(st[activePlayer]);
      const logMsg = `${activePlayer === 'player' ? 'You' : 'Opponent'} flipped provinces — any events/celestials resolved`;
      pushLog(logMsg, 'phase', 'system');
      set({ [activePlayer]: revealed, turnPhase: 'event' });
      return;
    }

    // ── Event Phase: no interactive events yet — just continue ────────────────
    if (turnPhase === 'event') {
      pushLog('Event Phase passed → Action Phase', 'phase', 'system');
      set({ turnPhase: 'action', priority: activePlayer });
      return;
    }

    if (turnPhase === 'dynasty') {
      pushLog('Dynasty Phase ended → Discard Phase', 'phase', 'system');
      set({ turnPhase: 'discard' });
      return;
    }

    if (turnPhase === 'discard') {
      if (ps.fateDeck.length > 0) {
        const [top, ...rest] = ps.fateDeck;
        const drawn: CardInstance = { ...top, location: 'hand', faceUp: activePlayer !== 'opponent' };
        pushLog(
          `${activePlayer === 'player' ? 'You' : 'Opponent'} drew ${activePlayer === 'player' ? top.card.name : 'a card'} (end-of-turn draw)`,
          'draw', activePlayer,
        );
        set({ turnPhase: 'end', [activePlayer]: { ...ps, fateDeck: rest, hand: [...ps.hand, drawn] } });
      } else {
        set({ turnPhase: 'end' });
      }
      pushLog('Discard Phase ended → End Phase', 'phase', 'system');
      return;
    }

    if (turnPhase === 'end') {
      if (ps.hand.length > HAND_LIMIT) return;

      const newActive: 'player' | 'opponent' = activePlayer === 'player' ? 'opponent' : 'player';
      const incoming = st[newActive];

      // Straighten: unbow everything, reset per-turn flags
      const straightened: PlayerState = {
        ...incoming,
        strongholdBowed: false,
        holdingsInPlay:     incoming.holdingsInPlay.map(c => ({ ...c, bowed: false })),
        personalitiesHome:  incoming.personalitiesHome.map(c => ({ ...c, bowed: false })),
        specialsInPlay:     incoming.specialsInPlay.map(c => ({ ...c, bowed: false })),
        proclaimUsed: false,
        goldPool: 0,
        abilitiesUsed: [],
      };

      // Per SX rules: all face-down province cards flip face-up at the start of every turn.
      // Events and Celestials resolve immediately (same as the first-turn flip).
      const revealed = applyRevealProvinces(straightened);

      pushLog(
        `Turn ${st.turnNumber} ended — Turn ${st.turnNumber + 1} begins (${newActive === 'player' ? 'Your' : "Opponent's"} turn). Face-down provinces revealed.`,
        'phase', 'system',
      );
      set({
        // Go to Event phase so the player can see what was revealed before acting
        turnPhase: 'event',
        activePlayer: newActive,
        priority: newActive,
        consecutivePasses: 0,
        turnNumber: st.turnNumber + 1,
        [newActive]: revealed,
      });
      return;
    }
  },

  discardFromProvince: (provinceIndex, target) => {
    const ps = get()[target];
    const province = ps.provinces[provinceIndex];
    if (!province?.card) return;

    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} discarded ${province.card.card.name} from province ${provinceIndex + 1}`, 'discard', target);
    const discarded: CardInstance = { ...province.card, location: 'dynastyDiscard' };
    const [next = null, ...restDynasty] = ps.dynastyDeck;
    const newCard: CardInstance | null = next
      ? { ...next, location: `province${provinceIndex}` as ZoneId, faceUp: false, bowed: false }
      : null;

    set({
      [target]: {
        ...ps,
        provinces: ps.provinces.map((p, i) =>
          i === provinceIndex ? { ...p, card: newCard, faceUp: false } : p,
        ),
        dynastyDeck: restDynasty,
        dynastyDiscard: [...ps.dynastyDiscard, discarded],
      },
    });
  },

  discardHandCard: (instanceId, target) => {
    const ps = get()[target];
    const card = ps.hand.find(c => c.instanceId === instanceId);
    if (!card) return;
    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} discarded ${card.card.name} from hand`, 'discard', target);
    set({
      [target]: {
        ...ps,
        hand: ps.hand.filter(c => c.instanceId !== instanceId),
        fateDiscard: [...ps.fateDiscard, { ...card, location: 'fateDiscard' }],
      },
    });
  },

  playFromHand: (instanceId, target, attachTargetId, selectedAbility) => {
    const ps  = get()[target];
    const inst = ps.hand.find(c => c.instanceId === instanceId);
    if (!inst) return;

    const { card } = inst;
    const cost = Math.max(0, Number(card.cost) || 0);
    const who  = target === 'player' ? 'You' : 'Opponent';
    const newHand = ps.hand.filter(c => c.instanceId !== instanceId);

    if (['item', 'follower', 'spell'].includes(card.type)) {
      // ── Attachment: move from hand into target personality's attachments ──
      if (!attachTargetId) return;
      const personality = ps.personalitiesHome.find(p => p.instanceId === attachTargetId);
      if (!personality) return;

      pushLog(
        `${who} equipped ${card.name} → ${personality.card.name} (−${cost}g)`,
        'other', target,
      );
      set({
        [target]: {
          ...ps,
          hand: newHand,
          personalitiesHome: ps.personalitiesHome.map(p =>
            p.instanceId !== attachTargetId
              ? p
              : { ...p, attachments: [...p.attachments, { ...inst, location: 'personalitiesHome' as ZoneId }] },
          ),
          goldPool: Math.max(0, ps.goldPool - cost),
        },
      });
    } else {
      // ── Strategy / other fate card: resolve → Fate discard ──
      const abilityNote = selectedAbility
        ? ` — "${selectedAbility.length > 60 ? selectedAbility.slice(0, 60) + '…' : selectedAbility}"`
        : '';
      pushLog(
        `${who} played ${card.name}${abilityNote}${cost > 0 ? ` (−${cost}g)` : ''} → Fate discard`,
        'other', target,
      );
      set({
        [target]: {
          ...ps,
          hand: newHand,
          fateDiscard: [{ ...inst, location: 'fateDiscard' as ZoneId }, ...ps.fateDiscard],
          goldPool: Math.max(0, ps.goldPool - cost),
        },
      });
    }
  },

  // ── First-turn Cycle ─────────────────────────────────────────────────────────

  startCycling: (target) => {
    const ps = get()[target];
    if (ps.cyclingDone) return;
    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} declared a Cycle`, 'cycle', target);
    set({ cyclingActive: target });
  },

  commitCycling: (selectedIndices, target) => {
    if (get().cyclingActive !== target) return;
    const ps = get()[target];

    // Collect face-up province cards that were selected (in index order)
    const validIndices = selectedIndices.filter(i => {
      const p = ps.provinces[i];
      return p && p.card && p.faceUp;
    });

    // All selected cards go to the bottom of the dynasty deck simultaneously
    const cardsToBottom: CardInstance[] = validIndices.map(i => ({
      ...ps.provinces[i].card!,
      location: 'dynastyDeck' as ZoneId,
      faceUp: false,
      bowed: false,
    }));

    let deckWorking = [...ps.dynastyDeck, ...cardsToBottom];

    // Draw one card from the top per cycled province
    const newProvinces = ps.provinces.map(p => ({ ...p }));
    for (const idx of validIndices) {
      const [incoming, ...rest] = deckWorking;
      deckWorking = rest;
      newProvinces[idx] = {
        ...newProvinces[idx],
        card: incoming
          ? { ...incoming, location: `province${idx}` as ZoneId, faceUp: true, bowed: false }
          : null,
        faceUp: true,
      };
    }

    const who = target === 'player' ? 'You' : 'Opponent';
    if (validIndices.length === 0) {
      pushLog(`${who} cycled 0 provinces`, 'cycle', target);
    } else {
      const names = validIndices.map(i => ps.provinces[i].card!.card.name).join(', ');
      pushLog(`${who} cycled ${validIndices.length} province${validIndices.length > 1 ? 's' : ''}: ${names}`, 'cycle', target);
    }
    set({
      cyclingActive: null,
      [target]: { ...ps, dynastyDeck: deckWorking, provinces: newProvinces, cyclingDone: true },
    });
  },

  endCycling: (target) => {
    const ps = get()[target];
    pushLog(`${target === 'player' ? 'You' : 'Opponent'} ended cycle with no changes`, 'cycle', target);
    set({
      cyclingActive: null,
      [target]: { ...ps, cyclingDone: true },
    });
  },

  useHoldingAbility: (instanceId, target) => {
    const ps = get()[target];
    if (ps.abilitiesUsed.includes(instanceId)) return;
    const card = ps.holdingsInPlay.find(c => c.instanceId === instanceId);
    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} activated ${card?.card.name ?? 'holding'} ability`, 'other', target);
    set({ [target]: { ...ps, abilitiesUsed: [...ps.abilitiesUsed, instanceId] } });
  },

  // ── Battle ────────────────────────────────────────────────────────────────

  declareBattle: () => {
    if (get().turnPhase !== 'action') return;
    pushLog('Battle declared — assign personalities to provinces', 'phase', 'system');
    set({ turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [] });
  },

  assignToBattlefield: (instanceId, provinceIndex) => {
    const { battleAssignments, opponent } = get();
    const province = opponent.provinces[provinceIndex];
    if (!province || province.broken) return;
    // Replace any existing assignment for this personality
    const filtered = battleAssignments.filter(a => a.instanceId !== instanceId);
    const cardName = get().player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ?? 'personality';
    pushLog(`Assigned ${cardName} to attack Province ${provinceIndex + 1}`, 'other', 'player');
    set({ battleAssignments: [...filtered, { instanceId, provinceIndex }] });
  },

  unassignFromBattle: (instanceId) => {
    const cardName = get().player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ?? 'personality';
    pushLog(`${cardName} removed from battle`, 'other', 'player');
    set({ battleAssignments: get().battleAssignments.filter(a => a.instanceId !== instanceId) });
  },

  beginResolution: () => {
    const { battleAssignments } = get();
    if (battleAssignments.length === 0) {
      // No one assigned — just end battle
      pushLog('No attackers assigned — ending battle', 'phase', 'system');
      set({ turnPhase: 'dynasty', battleStage: null, battleAssignments: [] });
      return;
    }
    pushLog('Battle assignments committed — resolve battlefields', 'phase', 'system');
    set({ battleStage: 'resolving' });
  },

  selectBattlefield: (provinceIndex) => {
    const { opponent, battleAssignments } = get();
    const province = opponent.provinces[provinceIndex];
    if (!province || province.broken) return;
    if (!battleAssignments.some(a => a.provinceIndex === provinceIndex)) return;

    pushLog(`Battlefield — Province ${provinceIndex + 1} selected for resolution`, 'phase', 'system');
    pushLog('Engage window open — Defender has first action', 'phase', 'system');
    set({
      battleStage: 'engage',
      currentBattlefield: provinceIndex,
      // Per CR: Defender (opponent) has priority first in both Engage and Combat segments
      battleWindowPriority: 'opponent',
      battleWindowPasses: 0,
    });
  },

  passBattlefieldAction: (side) => {
    const st = get();
    const { battleStage, battleWindowPriority, battleWindowPasses, currentBattlefield } = st;
    if (battleWindowPriority !== side) return;
    if (battleStage !== 'engage' && battleStage !== 'battleWindow') return;

    const otherSide: 'player' | 'opponent' = side === 'player' ? 'opponent' : 'player';
    const newCount = battleWindowPasses + 1;
    const sideLabel = side === 'player' ? 'You' : 'Opponent';

    if (newCount >= 2) {
      // Both passed — advance to next window or resolve
      if (battleStage === 'engage') {
        pushLog('Engage window closed → Battle window open — Defender has first action', 'phase', 'system');
        // Per CR: Defender also has priority first in the Combat (Battle) segment
        set({ battleStage: 'battleWindow', battleWindowPriority: 'opponent', battleWindowPasses: 0 });
      } else {
        // battleWindow closed — auto-resolve current battlefield
        const { player, opponent, battleAssignments } = st;
        const provinceIndex = currentBattlefield!;
        const province = opponent.provinces[provinceIndex];
        if (!province || province.broken) return;

        const assignedIds = battleAssignments
          .filter(a => a.provinceIndex === provinceIndex)
          .map(a => a.instanceId);
        const attackers = player.personalitiesHome.filter(p => assignedIds.includes(p.instanceId));
        // calcUnitForce(p, true) → respects bowed Personality/Follower and Item modifier rules
        const attackingForce = attackers.reduce((sum, p) => sum + calcUnitForce(p, true), 0);
        const defenseStrength = opponent.provinceStrength;
        const isBreached = attackingForce > defenseStrength;

        const resultMsg = isBreached
          ? `Province ${provinceIndex + 1} BROKEN! (${attackingForce}f vs ${defenseStrength}s)`
          : `Province ${provinceIndex + 1} holds. (${attackingForce}f vs ${defenseStrength}s)`;
        pushLog(resultMsg, 'phase', 'system');

        const newOpponentProvinces = opponent.provinces.map((p, i) =>
          i !== provinceIndex ? p : {
            ...p,
            broken: isBreached,
            card:   isBreached ? null : p.card,
            faceUp: isBreached ? false : p.faceUp,
          },
        );
        const newPersonalitiesHome = player.personalitiesHome.map(p =>
          assignedIds.includes(p.instanceId) ? { ...p, bowed: true } : p,
        );
        const remainingAssignments = battleAssignments.filter(a => a.provinceIndex !== provinceIndex);

        if (remainingAssignments.length === 0) {
          pushLog('All battlefields resolved → Dynasty Phase', 'phase', 'system');
          set({
            turnPhase: 'dynasty', battleStage: null, battleAssignments: [],
            currentBattlefield: null, battleWindowPasses: 0,
            opponent: { ...opponent, provinces: newOpponentProvinces },
            player:   { ...player,   personalitiesHome: newPersonalitiesHome },
          });
        } else {
          pushLog('Battlefield resolved — select next battlefield to resolve', 'phase', 'system');
          set({
            battleStage: 'resolving', currentBattlefield: null,
            battleWindowPriority: 'opponent', battleWindowPasses: 0,
            battleAssignments: remainingAssignments,
            opponent: { ...opponent, provinces: newOpponentProvinces },
            player:   { ...player,   personalitiesHome: newPersonalitiesHome },
          });
        }
      }
    } else {
      pushLog(`${sideLabel} passed in the ${battleStage === 'engage' ? 'Engage' : 'Battle'} window`, 'priority', side);
      set({ battleWindowPasses: newCount, battleWindowPriority: otherSide });
    }
  },

  endAttackPhase: () => {
    const { player, battleAssignments } = get();
    // Any still-assigned personalities retreat home bowed
    const assignedIds = battleAssignments.map(a => a.instanceId);
    const newPersonalitiesHome = player.personalitiesHome.map(p =>
      assignedIds.includes(p.instanceId) ? { ...p, bowed: true } : p
    );
    pushLog('Attack Phase ended — all attackers return home bowed', 'phase', 'system');
    set({
      turnPhase: 'dynasty',
      battleStage: null,
      battleAssignments: [],
      player: { ...player, personalitiesHome: newPersonalitiesHome },
    });
  },
});});

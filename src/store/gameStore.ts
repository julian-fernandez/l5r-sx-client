import { create } from 'zustand';
import type { BattleAssignment, CardInstance, LogCategory, LogEntry, NormalizedCard, ParsedDeck, PlayerState, Province, ZoneId } from '../types/cards';
import { calcUnitForce, calcFollowerForce, createInstance, expandDeck, shuffle, isConquerorUnit, calcEffectiveChi, hasRepeatableAbility } from '../engine/gameActions';
import type { BattleKeywordType } from '../engine/gameActions';
import { parseDeck } from '../engine/deckParser';
import { applyMidGameState, UNICORN_TEST_DECK, PHOENIX_TEST_DECK } from '../engine/testFixtures';
import type { SerializedAction } from '../../server/src/types';

// ─── Module-level relay state ─────────────────────────────────────────────────
// Stored outside Zustand so relay calls don't trigger re-renders.
// Set by App.tsx via setRelayCallback() when a multiplayer game starts.

let _relayFn: ((a: SerializedAction) => void) | null = null;
/** Prevents echo: while applyRelayedAction is running, don't re-relay. */
let _suppressRelay = false;

function relay(action: SerializedAction): void {
  if (_relayFn && !_suppressRelay) _relayFn(action);
}

/** Call before applyRelayedAction to prevent echo-relay. */
export function suppressRelay(): void  { _suppressRelay = true;  }
/** Call after  applyRelayedAction to restore relay. */
export function unsuppressRelay(): void { _suppressRelay = false; }

type GamePhase = 'setup' | 'lobby' | 'playing';

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
  /** True when in a live networked game (vs. solo/goldfish). */
  multiplayerMode: boolean;
  /** This client's player index in the room (0 = first, 1 = second). null in solo mode. */
  myPlayerIndex: 0 | 1 | null;
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
   * Opponent's personality-to-province defender assignments.
   * Each entry maps one opponent personality instanceId to the province they are defending.
   * Populated automatically by the auto-opponent when the stage moves to 'resolving'.
   */
  defenderAssignments: BattleAssignment[];
  /**
   * Which stage of the Attack Phase we are in.
   * null          → not in Attack Phase
   * 'assigning'   → player is assigning personalities to provinces
   * 'assigning'                 → attacker assigns non-Cavalry units
   * 'defender-assigning'        → defender assigns non-Cavalry; attacker waits
   * 'cavalry-assigning'         → attacker assigns Cavalry after seeing defender positions
   * 'defender-cavalry-assigning'→ defender assigns Cavalry after seeing attacker Cavalry
   * 'resolving'                 → player selects which battlefield to resolve next
   * 'engage'                    → Engage window open on currentBattlefield
   * 'battleWindow'              → Battle window open on currentBattlefield
   */
  battleStage: 'assigning' | 'defender-assigning' | 'cavalry-assigning' | 'defender-cavalry-assigning' | 'resolving' | 'engage' | 'battleWindow' | null;
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
  /**
   * Set when the game ends. null = game is still in progress.
   * reason: 'honor' = Honor victory (40+); 'dishonor' = Dishonor defeat (≤ −20).
   */
  gameResult: { winner: 'player' | 'opponent'; reason: 'honor' | 'dishonor' | 'enlightenment' } | null;
  /**
   * Who currently holds the Imperial Favor. Starts null (uncontrolled).
   * Gained via the Lobby player ability; spent by Rulebook Favor actions.
   */
  imperialFavor: 'player' | 'opponent' | null;

  setCatalogLoaded: (loaded: boolean) => void;
  setStrongholdOverride: (o: { honor: number; gold: number; provinceStrength: number } | null) => void;
  loadGame: (deck: ParsedDeck) => void;
  /**
   * Quick-start a simulated turn-3/4 game using the last pasted player deck
   * (or the built-in Unicorn sample) vs. the hardcoded Phoenix test opponent.
   * Useful for rapidly testing board UI without manually playing through setup.
   */
  loadTestGame: () => void;
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

  /**
   * Use the Kharmic player ability (Repeatable Limited, 2g).
   * - source 'hand': discard a Kharmic Fate card from hand → draw a Fate card.
   * - source 'province': discard a Kharmic Dynasty card from a province → refill that province face-up.
   */
  useKharmic: (
    source: 'hand' | 'province',
    instanceId: string,
    target: 'player' | 'opponent',
    provinceIndex?: number,
  ) => void;

  // ── Imperial Favor / Lobby ────────────────────────────────────────────────
  /**
   * Lobby player ability (Political Limited, once per turn).
   * Preconditions: Action phase, active player's turn, Honor strictly higher than opponent's
   * (including Lobby Bonus on each side), personality must be unbowed with PH ≥ 1.
   * Effect: bow the personality, take the Imperial Favor.
   */
  lobby: (personalityId: string, target?: 'player' | 'opponent') => void;
  /**
   * Rulebook Favor Limited (Favor Political Limited).
   * Cost: discard the Imperial Favor + discard one Fate card from hand.
   * Effect: draw a Fate card.
   */
  useFavorLimited: (discardCardInstanceId: string, target?: 'player' | 'opponent') => void;
  /**
   * Rulebook Favor Battle (Favor Political Battle).
   * Cost: discard the Imperial Favor.
   * Effect: move a target attacking enemy Personality home.
   * actingTarget: 'player' when own action; 'opponent' when relay (flips perspective).
   */
  useFavorBattle: (targetPersonalityId: string, actingTarget?: 'player' | 'opponent') => void;

  // ── Tactical Advantage ────────────────────────────────────────────────────
  /**
   * Rulebook Tactical Advantage (Battle, once per turn per Tactician).
   * Cost: discard a hand card.
   * Effect: give this Tactician personality a Force bonus equal to the discarded
   *         card's Focus Value.
   */
  useTacticalAdvantage: (personalityId: string, handCardInstanceId: string, target?: 'player' | 'opponent') => void;

  // ── Discipline ────────────────────────────────────────────────────────────
  /**
   * Play a Fate card with the Discipline trait from the Fate discard pile.
   * Cost: card's normal Gold Cost + Discipline cost (from card text).
   * After the action resolves the card is removed from the game.
   * For strategies: resolved as a played card; for attachments: equip to target.
   */
  playDiscipline: (fateDiscardInstanceId: string, attachTargetId?: string, target?: 'player' | 'opponent') => void;

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
  /**
   * Defender commits their assignments — moves stage to 'cavalry-assigning'.
   * In solo mode, called automatically after the bot auto-assigns.
   */
  commitDefenders: () => void;
  /**
   * Attacker commits cavalry assignments — moves stage to 'defender-cavalry-assigning'.
   * Also used to skip the cavalry phase when no cavalry are available.
   */
  commitCavalry: () => void;
  /**
   * Defender commits their cavalry assignments — moves stage to 'resolving'.
   * In solo mode, called automatically after the bot auto-assigns cavalry defenders.
   */
  commitDefenderCavalry: () => void;
  /**
   * Assign a personality as a defender for a province.
   * Can be called with either a player or opponent personality id:
   *   - Solo: auto-assigns from opponent.personalitiesHome
   *   - Multiplayer (defender): assigns from player.personalitiesHome and relays
   */
  assignDefender: (instanceId: string, provinceIndex: number) => void;
  /** Remove a personality from defender assignments. */
  unassignFromDefense: (instanceId: string) => void;
  /**
   * Apply a Fear / Melee Attack / Ranged Attack keyword action.
   * The follower-shield rule is enforced automatically: if the target personality
   * has any unbowed followers with Force ≤ value, the first one is targeted instead.
   */
  applyBattleKeyword: (
    sourceId: string,
    targetPersonalityId: string,
    type: BattleKeywordType,
    value: number,
  ) => void;
  /**
   * Tactician action: discard a Fate card from hand to grant the personality
   * a Force bonus equal to the card's Focus Value for the rest of the battle.
   */
  activateTactician: (personalityId: string, fateCardInstanceId: string) => void;
  /**
   * Reserve action: during the Engage or Battle window, spend gold to recruit
   * the face-up card in `provinceIndex` directly to the current battlefield.
   * Holdings enter play bowed; personalities are auto-assigned to the current battlefield.
   * Once per turn (tracked via abilitiesUsed using the source personality's instanceId).
   */
  reserveRecruit: (provinceIndex: number, sourcePersonalityId: string) => void;
  /**
   * Border Keep Limited (once per game): recycle any number of face-up province cards
   * to the bottom of the dynasty deck and refill them face-up immediately.
   * Tracked in `oncePerGameAbilitiesUsed` so it persists across turns.
   */
  borderKeepCycle: (holdingInstanceId: string) => void;
  /**
   * Play a ring card from hand into `specialsInPlay` as a permanent.
   * Call when the ring's condition for entering play has been met.
   * Checks for Enlightenment victory (5 rings with different elemental keywords).
   */
  playRingToPermanent: (instanceId: string) => void;
  /**
   * Toggle the dishonored state of a personality.
   * Dishonored personalities that die become Dishonorably Dead; their controller
   * loses Family Honor equal to the personality's printed Personal Honor.
   */
  dishonorPersonality: (instanceId: string, target: 'player' | 'opponent') => void;

  // ── Token system ─────────────────────────────────────────────────────────────
  /**
   * Place a discrete token on a card in play.
   * Searches personalitiesHome; the token is included in Force/Chi calculations.
   */
  addToken: (instanceId: string, token: Omit<import('../types/cards').GameToken, 'id'>, target?: 'player' | 'opponent') => void;
  /**
   * Remove a single token from a card in play by its token id.
   */
  removeToken: (instanceId: string, tokenId: string, target?: 'player' | 'opponent') => void;
  /**
   * Move a token from one card to another (e.g. "pass this token to the next Personality").
   * Both cards must be in the same player's personalitiesHome.
   */
  transferToken: (fromInstanceId: string, toInstanceId: string, tokenId: string, target?: 'player' | 'opponent') => void;

  // ── Removal from play ────────────────────────────────────────────────────────
  /**
   * Destroy a card that is currently in play.
   * - Personality: routed to honorablyDead or dishonorablelyDead based on dishonored state;
   *   controller loses Family Honor if dishonored; attachments go to fateDiscard.
   * - Holding / Special: routed to dynastyDiscard.
   */
  destroyCard: (instanceId: string, target?: 'player' | 'opponent') => void;
  /**
   * Discard a card from play WITHOUT it being "killed in battle."
   * - Personality: goes to dynastyDiscard (not the Dead piles); no honor loss.
   * - Holding / Special: goes to dynastyDiscard.
   * - Attachment: goes to fateDiscard.
   */
  discardFromPlay: (instanceId: string, target?: 'player' | 'opponent') => void;
  /**
   * Remove a card from play entirely — it ceases to exist in any zone.
   * Used by Discipline and "remove from game" card effects.
   */
  removeFromGame: (instanceId: string, target?: 'player' | 'opponent') => void;

  // ── Multiplayer ─────────────────────────────────────────────────────────────
  /** Enter lobby phase (shows MultiplayerLobby component). */
  enterLobby: () => void;
  /**
   * Initialize the game from server-provided state (multiplayer only).
   * Both PlayerState blobs come from the server after game-ready is received.
   */
  loadFromServerState: (
    ownState: PlayerState,
    opponentState: PlayerState,
    firstPlayerIndex: 0 | 1,
    myPlayerIndex: 0 | 1,
  ) => void;
  /**
   * Called when the server notifies us that the opponent drew a fate card.
   * Increments opponent hand count; actual card is unknown.
   */
  applyOpponentDrew: () => void;
  /** Register the socket send-action function so store actions self-relay. */
  setRelayCallback: (fn: ((a: SerializedAction) => void) | null) => void;
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
    oncePerGameAbilitiesUsed: [],
    honorablyDead: [],
    dishonorablelyDead: [],
    removed: [],
    lobbyBonus: 0,
    lobbyUsed: false,
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
      oncePerGameAbilitiesUsed: [],
      honorablyDead: [],
      dishonorablelyDead: [],
      removed: [],
      lobbyBonus: 0,
      lobbyUsed: false,
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
function applyRevealProvinces(state: PlayerState): { state: PlayerState; resolved: string[] } {
  let dynastyDeck     = [...state.dynastyDeck];
  let specialsInPlay  = [...state.specialsInPlay];
  let dynastyDiscard  = [...state.dynastyDiscard];
  const resolved: string[] = [];

  const provinces = state.provinces.map(p => {
    if (!p.card) return { ...p, faceUp: true };
    const cardType   = p.card.card.type;
    const faceUpInst = { ...p.card, faceUp: true };

    if (cardType === 'celestial') {
      // Displaced celestial (if any) goes to discard
      const displaced = specialsInPlay.filter(c => c.card.type === 'celestial');
      if (displaced.length) {
        resolved.push(`${displaced[0].card.name} displaced`);
        dynastyDiscard = [...dynastyDiscard, ...displaced];
      }
      resolved.push(`${p.card.card.name} → in play (Celestial)`);
      specialsInPlay = [
        ...specialsInPlay.filter(c => c.card.type !== 'celestial'),
        { ...faceUpInst, location: 'specialsInPlay' as ZoneId },
      ];
      const [next = null, ...rest] = dynastyDeck;
      dynastyDeck = rest;
      // Province refills face-down with a new card
      return {
        ...p, faceUp: true,
        card: next ? { ...next, location: p.card.location, faceUp: false, bowed: false } : null,
      };
    }

    if (cardType === 'event') {
      resolved.push(`${p.card.card.name} → resolved (Event)`);
      dynastyDiscard = [...dynastyDiscard, { ...faceUpInst, location: 'dynastyDiscard' as ZoneId }];
      const [next = null, ...rest] = dynastyDeck;
      dynastyDeck = rest;
      // Province refills face-down with a new card
      return {
        ...p, faceUp: true,
        card: next ? { ...next, location: p.card.location, faceUp: false, bowed: false } : null,
      };
    }

    if (cardType === 'region') {
      // Region attaches to the province; the province refills face-down with a new card
      const regionInst: CardInstance = { ...faceUpInst, location: p.card.location as ZoneId };
      const [next = null, ...rest] = dynastyDeck;
      dynastyDeck = rest;
      return {
        ...p, faceUp: false,
        card: next ? { ...next, location: p.card.location, faceUp: false, bowed: false } : null,
        region: regionInst,
      };
    }

    return { ...p, faceUp: true, card: faceUpInst };
  });

  return {
    state: { ...state, provinces, dynastyDeck, specialsInPlay, dynastyDiscard },
    resolved,
  };
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
  multiplayerMode: false,
  myPlayerIndex: null,
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
  gameResult: null,
  imperialFavor: null,
  battleAssignments: [],
  defenderAssignments: [],
  battleStage: null,
  currentBattlefield: null,
  battleWindowPriority: 'player',
  battleWindowPasses: 0,

  setCatalogLoaded: (loaded) => set({ catalogLoaded: loaded }),
  setLastDeckText: (text) => set({ lastDeckText: text }),
  setStrongholdOverride: (o) => set({ strongholdOverride: o }),
  resetGame: () => {
    // Clear any saved multiplayer session so auto-reconnect doesn't fire
    sessionStorage.removeItem('l5r_room_id');
    sessionStorage.removeItem('l5r_player_id');
    sessionStorage.removeItem('l5r_player_index');
    return set({
      phase: 'setup', player: emptyPlayer(), opponent: emptyPlayer(),
      multiplayerMode: false, myPlayerIndex: null,
      activePlayer: 'player', turnPhase: 'action', priority: 'player',
      consecutivePasses: 0, turnNumber: 1, strongholdOverride: null, gameLog: [],
      battleAssignments: [], defenderAssignments: [], battleStage: null,
      currentBattlefield: null, battleWindowPriority: 'player', battleWindowPasses: 0,
      cyclingActive: null, gameResult: null,
    });
  },

  // ── Internal log helper ───────────────────────────────────────────────────

  // addLog is not part of the public interface — called internally by actions
  // via a closure over `get`/`set`.

  // ── Priority / Phase ──────────────────────────────────────────────────────

  passPriority: () => {
    const { priority, consecutivePasses, activePlayer, player, opponent } = get();
    if (priority !== 'player') return;
    relay({ type: 'pass-priority' });
    const newCount = consecutivePasses + 1;
    const clearedPlayer = { ...player, goldPool: 0 };
    if (newCount >= 2) {
      pushLog('Both players passed — entering Attack Phase', 'phase', 'system');
      set({
        turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [], defenderAssignments: [],
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
        turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [], defenderAssignments: [],
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
        if (target === 'player') relay({ type: 'bow-card', instanceId, target: 'player' });
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
        if (target === 'player') relay({ type: 'bow-card', instanceId, target: 'player' });
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
    if (target === 'player') relay({ type: 'bow-stronghold', target: 'player' });
    set({ [target]: { ...ps, strongholdBowed: nowBowed, goldPool: Math.max(0, ps.goldPool + goldDelta) } });
  },

  recruitFromProvince: (provinceIndex, target, options = {}) => {
    const { discount = false, proclaim = false } = options;
    const state = get();
    const ps  = state[target];
    const province = ps.provinces[provinceIndex];
    if (!province?.card || !province.faceUp) return;
    if (proclaim && ps.proclaimUsed) return; // once per turn

    const inst = province.card;
    const kws  = inst.card.keywords.map(k => k.toLowerCase().trim());
    const isHolding = inst.card.type === 'holding';
    const who = target === 'player' ? 'You' : 'Opponent';

    // Loyal: personality can only be recruited if the player's stronghold clan matches
    if (!isHolding && kws.includes('loyal')) {
      const strongholdClan = ps.stronghold?.clan?.toLowerCase() ?? '';
      const cardClan       = inst.card.clan?.toLowerCase() ?? '';
      if (!strongholdClan || !cardClan || strongholdClan !== cardClan) {
        pushLog(
          `Cannot recruit ${inst.card.name} — Loyal (requires ${inst.card.clan ?? 'matching'} clan)`,
          'recruit', target,
        );
        return;
      }
    }

    // Singular: only one copy of this card in play for this player
    if (!isHolding && kws.includes('singular')) {
      if (ps.personalitiesHome.some(p => p.card.id === inst.card.id)) {
        pushLog(`Cannot recruit ${inst.card.name} — Singular card already in play`, 'recruit', target);
        return;
      }
    }

    // Unique: a player cannot bring into play a Unique card if they already control one with the same title
    if (kws.includes('unique')) {
      const title = inst.card.name.toLowerCase();
      const alreadyControlled =
        ps.personalitiesHome.some(p => p.card.name.toLowerCase() === title) ||
        ps.holdingsInPlay.some(p => p.card.name.toLowerCase() === title);
      if (alreadyControlled) {
        pushLog(`Cannot recruit ${inst.card.name} — Unique: already control one`, 'recruit', target);
        return;
      }
    }

    const baseCost    = Math.max(0, Number(inst.card.cost) || 0);
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

    // Fortification: track which province this holding came from
    const isFortification = isHolding && kws.includes('fortification');

    const recruited: CardInstance = {
      ...inst,
      location: isHolding ? 'holdingsInPlay' : 'personalitiesHome',
      // Fortifications enter unbowed (they defend immediately from a province)
      bowed: isHolding && !isFortification,
      ...(isFortification ? { fortificationProvince: provinceIndex } : {}),
    };

    // Proclaim: gain Personal Honor equal to the personality's PH stat
    const phGain = proclaim ? Math.max(0, Number(inst.card.personalHonor) || 0) : 0;

    if (proclaim) {
      pushLog(`${who} proclaimed ${inst.card.name} for ${finalCost}g (+${phGain} honor)`, 'recruit', target);
    } else if (discount) {
      pushLog(`${who} recruited ${inst.card.name} with clan discount for ${finalCost}g`, 'recruit', target);
    } else {
      pushLog(`${who} recruited ${inst.card.name} for ${finalCost}g`, 'recruit', target);
    }

    // Destined: draw a Fate card when entering play
    const isDestined = !isHolding && kws.includes('destined');
    let newFateDeck = ps.fateDeck;
    let newHand = ps.hand;
    if (isDestined && ps.fateDeck.length > 0) {
      const [drawnCard, ...restFate] = ps.fateDeck;
      newFateDeck = restFate;
      newHand = [...ps.hand, { ...drawnCard, location: 'hand' as ZoneId }];
      pushLog(`${who} draws a Fate card — ${inst.card.name} is Destined`, 'recruit', target);
    }

    if (target === 'player') relay({ type: 'recruit', provinceIndex, proclaim });
    set({
      [target]: {
        ...ps,
        provinces,
        dynastyDeck:      restDynasty,
        fateDeck:         newFateDeck,
        hand:             newHand,
        personalitiesHome: isHolding ? ps.personalitiesHome : [...ps.personalitiesHome, recruited],
        holdingsInPlay:    isHolding ? [...ps.holdingsInPlay, recruited] : ps.holdingsInPlay,
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

  loadTestGame: () => {
    const { lastDeckText, strongholdOverride } = get();

    const playerDeckText   = lastDeckText?.trim() ? lastDeckText : UNICORN_TEST_DECK;
    const playerDeckParsed = parseDeck(playerDeckText);
    const opponentDeckParsed = parseDeck(PHOENIX_TEST_DECK);

    // Build fresh initial states, then layer on the mid-game snapshot
    const playerBase   = buildPlayerState(playerDeckParsed, strongholdOverride, false);
    const opponentBase = buildPlayerState(opponentDeckParsed, null, true);

    const player   = applyMidGameState(playerBase, false);
    const opponent = applyMidGameState(opponentBase, true);

    // Nudge honors to mid-game values:
    // Player gained 2 honor (proclaims / events); opponent lost 1 (dishonored action)
    const finalPlayer   = { ...player,   familyHonor: player.familyHonor + 2 };
    const finalOpponent = { ...opponent, familyHonor: opponent.familyHonor - 1 };

    set({
      phase: 'playing',
      player: finalPlayer,
      opponent: finalOpponent,
      activePlayer: 'player',
      turnPhase: 'straighten',
      priority: 'player',
      consecutivePasses: 0,
      turnNumber: 4,
      battleAssignments: [],
      defenderAssignments: [],
      battleStage: null,
      currentBattlefield: null,
      battleWindowPriority: 'player',
      battleWindowPasses: 0,
      cyclingActive: null,
      gameLog: [{
        id: 'test-start',
        turnNumber: 4,
        phase: 'straighten',
        side: 'system',
        message: 'Test game loaded — Turn 4, Straighten Phase. Flip your provinces to begin.',
        category: 'other',
      }],
    });
  },

  // ── Phase advancement ─────────────────────────────────────────────────────

  advancePhase: () => {
    const st = get();
    const { turnPhase, activePlayer } = st;
    const ps = st[activePlayer];
    const HAND_LIMIT = 8;

    // Relay immediately so the opponent mirrors this phase advance.
    // The hand-limit guard below is the only early-return that can block the action;
    // in multiplayer both clients track the same active player hand, so the guard
    // fires or not identically on both sides.
    relay({ type: 'advance-phase' });

    // ── First-turn: reveal the active player's provinces ──────────────────────
    if (turnPhase === 'straighten') {
      const { state: revealed, resolved } = applyRevealProvinces(st[activePlayer]);
      const who = activePlayer === 'player' ? 'You' : 'Opponent';
      const resolvedMsg = resolved.length
        ? `: ${resolved.join('; ')}`
        : '';
      pushLog(`${who} flipped provinces${resolvedMsg}`, 'phase', 'system');
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

      // ── Victory condition: Dishonor (≤ −20) at end of active player's turn ──
      if (ps.familyHonor <= -20) {
        const winner: 'player' | 'opponent' = activePlayer === 'player' ? 'opponent' : 'player';
        pushLog(
          `${activePlayer === 'player' ? 'You have' : 'Opponent has'} reached −20 Honor — Dishonor defeat!`,
          'honor', 'system',
        );
        set({ gameResult: { winner, reason: 'dishonor' } });
        return;
      }

      const newActive: 'player' | 'opponent' = activePlayer === 'player' ? 'opponent' : 'player';
      const incoming = st[newActive];
      const newTurnNumber = st.turnNumber + 1;

      // Straighten: unbow everything, reset per-turn flags, clear battle bonuses
      // Bamboo Harvesters cannot straighten before the incoming player's second turn.
      // Global turn 2 is always the second player's FIRST turn (regardless of who goes first/second),
      // so BH stays bowed whenever newTurnNumber === 2.
      const straightened: PlayerState = {
        ...incoming,
        strongholdBowed: false,
        holdingsInPlay: incoming.holdingsInPlay.map(c => {
          const isBH = /bamboo harvesters/i.test(c.card.name);
          if (isBH && newTurnNumber === 2) return c; // stays bowed — first turn for this player
          return { ...c, bowed: false };
        }),
        personalitiesHome:  incoming.personalitiesHome.map(c => ({ ...c, bowed: false, tempForceBonus: 0 })),
        specialsInPlay:     incoming.specialsInPlay.map(c => ({ ...c, bowed: false })),
        proclaimUsed: false,
        goldPool: 0,
        abilitiesUsed: [],
        lobbyUsed: false,
      };

      // Per SX rules: all face-down province cards flip face-up at the start of every turn.
      // Events and Celestials resolve immediately (same as the first-turn flip).
      const { state: revealed, resolved } = applyRevealProvinces(straightened);

      // ── Victory condition: Honor (≥ 40) at start of incoming player's turn ──
      if (revealed.familyHonor >= 40) {
        pushLog(
          `${newActive === 'player' ? 'You begin' : 'Opponent begins'} their turn with ${revealed.familyHonor} Honor — Honor victory!`,
          'honor', 'system',
        );
        set({ gameResult: { winner: newActive, reason: 'honor' }, [newActive]: revealed });
        return;
      }

      const resolvedMsg = resolved.length ? ` — ${resolved.join('; ')}` : '';
      pushLog(
        `Turn ${st.turnNumber} ended — Turn ${st.turnNumber + 1} begins (${newActive === 'player' ? 'Your' : "Opponent's"} turn). Provinces revealed${resolvedMsg}.`,
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

    if (target === 'player') relay({ type: 'discard-province', provinceIndex });
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
    if (target === 'player') relay({ type: 'discard-from-hand', instanceId });
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

    // Hard block: player must have enough gold in the pool to pay the cost.
    if (ps.goldPool < cost) {
      pushLog(
        `Cannot play ${card.name} — need ${cost}g but only have ${ps.goldPool}g`,
        'gold', target,
      );
      return;
    }

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
      if (target === 'player') relay({ type: 'play-from-hand', instanceId, targetId: attachTargetId, abilityText: selectedAbility });

      let newPersonalitiesHome = ps.personalitiesHome.map(p =>
        p.instanceId !== attachTargetId
          ? p
          : { ...p, attachments: [...p.attachments, { ...inst, location: 'personalitiesHome' as ZoneId }] },
      );
      // Chi Death: if attaching this item reduces the personality's effective Chi to ≤ 0, destroy it
      const afterAttach = newPersonalitiesHome.find(p => p.instanceId === attachTargetId);
      if (afterAttach && calcEffectiveChi(afterAttach) <= 0) {
        pushLog(`Chi Death: ${afterAttach.card.name}'s effective Chi reached 0 — destroyed`, 'battle', 'system');
        newPersonalitiesHome = newPersonalitiesHome.filter(p => p.instanceId !== attachTargetId);
      }

      set({
        [target]: {
          ...ps,
          hand: newHand,
          personalitiesHome: newPersonalitiesHome,
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
      if (target === 'player') relay({ type: 'play-from-hand', instanceId, abilityText: selectedAbility });
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

    // Any province with a card can be cycled, face-up or face-down
    const validIndices = selectedIndices.filter(i => {
      const p = ps.provinces[i];
      return p && p.card && !p.broken;
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
      const names = validIndices
        .map(i => {
          const p = ps.provinces[i];
          return p.faceUp ? p.card!.card.name : '(face-down)';
        })
        .join(', ');
      pushLog(`${who} cycled ${validIndices.length} province${validIndices.length > 1 ? 's' : ''}: ${names}`, 'cycle', target);
    }
    if (target === 'player') relay({ type: 'commit-cycling', selectedIndices: validIndices });
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
    const ps   = get()[target];
    const card = ps.holdingsInPlay.find(c => c.instanceId === instanceId);
    const repeatable = card ? hasRepeatableAbility(card.card) : false;
    if (!repeatable && ps.abilitiesUsed.includes(instanceId)) return;
    const who = target === 'player' ? 'You' : 'Opponent';
    pushLog(`${who} activated ${card?.card.name ?? 'holding'} ability`, 'other', target);
    if (!repeatable) {
      set({ [target]: { ...ps, abilitiesUsed: [...ps.abilitiesUsed, instanceId] } });
    }
  },

  useKharmic: (source, instanceId, target, provinceIndex) => {
    const ps  = get()[target];
    const who = target === 'player' ? 'You' : 'Opponent';
    const KHARMIC_COST = 2;

    if (ps.goldPool < KHARMIC_COST) {
      pushLog(`Cannot use Kharmic ability — need ${KHARMIC_COST}g, have ${ps.goldPool}g`, 'gold', target);
      return;
    }

    if (source === 'hand') {
      const card = ps.hand.find(c => c.instanceId === instanceId);
      if (!card) return;
      if (!card.card.keywords.some(k => k.toLowerCase().trim() === 'kharmic')) {
        pushLog(`${card.card.name} does not have the Kharmic keyword`, 'other', target);
        return;
      }
      if (ps.fateDeck.length === 0) {
        pushLog('Cannot use Kharmic — Fate deck is empty', 'other', target);
        return;
      }
      const [drawn, ...restFate] = ps.fateDeck;
      if (target === 'player') relay({ type: 'use-kharmic', source: 'hand', instanceId });
      pushLog(`${who} used Kharmic — discarded ${card.card.name}, drew a Fate card (−${KHARMIC_COST}g)`, 'other', target);
      set({
        [target]: {
          ...ps,
          goldPool:   Math.max(0, ps.goldPool - KHARMIC_COST),
          hand:       [...ps.hand.filter(c => c.instanceId !== instanceId), { ...drawn, location: 'hand' as ZoneId }],
          fateDeck:   restFate,
          fateDiscard: [{ ...card, location: 'fateDiscard' as ZoneId }, ...ps.fateDiscard],
        },
      });
    } else {
      // source === 'province'
      if (provinceIndex === undefined) return;
      const province = ps.provinces[provinceIndex];
      if (!province?.card || !province.faceUp) return;
      const card = province.card;
      if (!card.card.keywords.some(k => k.toLowerCase().trim() === 'kharmic')) {
        pushLog(`${card.card.name} does not have the Kharmic keyword`, 'other', target);
        return;
      }
      // Draw from dynasty deck to refill province face-up
      const [nextCard = null, ...restDynasty] = ps.dynastyDeck;
      const newProvinceCard: CardInstance | null = nextCard
        ? { ...nextCard, location: `province${provinceIndex}` as ZoneId, faceUp: true, bowed: false }
        : null;
      const newProvinces = ps.provinces.map((p, i) =>
        i === provinceIndex ? { ...p, card: newProvinceCard, faceUp: true } : p,
      );
      if (target === 'player') relay({ type: 'use-kharmic', source: 'province', instanceId, provinceIndex });
      pushLog(`${who} used Kharmic — discarded ${card.card.name} from Province ${provinceIndex + 1}, refilled face-up (−${KHARMIC_COST}g)`, 'other', target);
      set({
        [target]: {
          ...ps,
          goldPool:      Math.max(0, ps.goldPool - KHARMIC_COST),
          dynastyDeck:   restDynasty,
          provinces:     newProvinces,
          dynastyDiscard: [{ ...card, location: 'dynastyDiscard' as ZoneId }, ...ps.dynastyDiscard],
        },
      });
    }
  },

  // ── Imperial Favor / Lobby ────────────────────────────────────────────────

  lobby: (personalityId, target = 'player') => {
    const state = get();
    const ps  = state[target];
    const opp = state[target === 'player' ? 'opponent' : 'player'];

    // Phase guard: skip for relay (target='opponent') since the initiating client already validated
    if (target === 'player') {
      if (state.turnPhase !== 'action' || state.activePlayer !== 'player') return;
      if (ps.lobbyUsed) { pushLog('Lobby already used this turn', 'other', 'player'); return; }
    }

    const personality = ps.personalitiesHome.find(p => p.instanceId === personalityId);
    if (!personality || personality.bowed) return;
    const ph = Math.max(0, Number(personality.card.personalHonor) || 0);
    if (personality.dishonored || ph < 1) {
      if (target === 'player')
        pushLog(`Cannot Lobby — ${personality.card.name} needs ≥1 Personal Honor and must be honorable`, 'other', 'player');
      return;
    }

    const psEffHonor  = ps.familyHonor  + ps.lobbyBonus;
    const oppEffHonor = opp.familyHonor + opp.lobbyBonus;
    const success = psEffHonor > oppEffHonor;
    const who = target === 'player' ? 'You' : 'Opponent';

    if (success) {
      const prev = state.imperialFavor === (target === 'player' ? 'opponent' : 'player') ? ' (taken from opponent)' : '';
      pushLog(`Lobby: ${personality.card.name} bowed — ${who} take${target === 'player' ? '' : 's'} the Imperial Favor${prev} (${psEffHonor} > ${oppEffHonor})`, 'other', target);
    } else {
      pushLog(`Lobby: ${personality.card.name} bowed — ${who} failed (${psEffHonor} ≤ ${oppEffHonor})`, 'other', target);
    }

    if (target === 'player') relay({ type: 'lobby', personalityId });
    set({
      imperialFavor: success ? target : state.imperialFavor,
      [target]: {
        ...ps,
        personalitiesHome: ps.personalitiesHome.map(p =>
          p.instanceId === personalityId ? { ...p, bowed: true } : p,
        ),
        lobbyUsed: true,
      },
    });
  },

  useFavorLimited: (discardCardInstanceId, target = 'player') => {
    const state = get();
    const ps = state[target];

    if (target === 'player') {
      if (state.turnPhase !== 'action' || state.activePlayer !== 'player') return;
      if (state.imperialFavor !== 'player') {
        pushLog('Cannot use Rulebook Favor Limited — you do not control the Imperial Favor', 'other', 'player');
        return;
      }
    }

    if (target === 'player') {
      const card = ps.hand.find(c => c.instanceId === discardCardInstanceId);
      if (!card) return;
      if (ps.fateDeck.length === 0) {
        pushLog('Cannot use Rulebook Favor Limited — Fate deck is empty', 'other', 'player');
        return;
      }
      const [drawn, ...restFate] = ps.fateDeck;
      pushLog(`Rulebook Favor Limited: Discarded Imperial Favor + ${card.card.name} → drew a Fate card`, 'other', 'player');
      relay({ type: 'use-favor-limited', discardCardInstanceId });
      set({
        imperialFavor: null,
        [target]: {
          ...ps,
          hand: [...ps.hand.filter(c => c.instanceId !== discardCardInstanceId), { ...drawn, location: 'hand' as ZoneId }],
          fateDiscard: [{ ...card, location: 'fateDiscard' as ZoneId }, ...ps.fateDiscard],
          fateDeck: restFate,
        },
      });
    } else {
      // Relay: opponent used Favor Limited — we only know the Favor is gone; hand/deck are hidden
      pushLog('Opponent used Rulebook Favor Limited — Imperial Favor discarded', 'other', 'opponent');
      set({ imperialFavor: null });
    }
  },

  useFavorBattle: (targetPersonalityId, actingTarget = 'player') => {
    const state = get();
    const { battleStage, battleAssignments, defenderAssignments } = state;
    if (battleStage !== 'engage' && battleStage !== 'battleWindow') return;

    if (actingTarget === 'player') {
      if (state.imperialFavor !== 'player') {
        pushLog('Cannot use Rulebook Favor Battle — you do not control the Imperial Favor', 'battle', 'player');
        return;
      }
      // Target is an attacking enemy — in our model, opponent is the defender, so this applies
      // when the OPPONENT attacked us (they are the attacker) and we are using the Favor to
      // send one of their attackers home. Their attackers are tracked in defenderAssignments
      // from our perspective (wait, no) — battleAssignments are OUR attackers.
      // Actually: Favor Battle is used DURING battle by whoever holds the Favor.
      // "Move a target attacking enemy Personality home" — the attacker is our player.
      // So the enemy attacker = one of player.battleAssignments personalities.
      // This means we're using it against OURSELVES? No — we can only use it when the opponent attacked.
      // In that scenario battleAssignments would contain OPPONENT's attackers tracked as defenderAssignments.
      // For simplicity: target any personality at the current battlefield on the opponent's side.
      const tgt = state.opponent.personalitiesHome.find(p => p.instanceId === targetPersonalityId);
      if (!tgt) return;
      pushLog(`Rulebook Favor Battle: Discarded Imperial Favor — ${tgt.card.name} moved home`, 'battle', 'player');
      relay({ type: 'use-favor-battle', targetPersonalityId });
      set({
        imperialFavor: null,
        defenderAssignments: defenderAssignments.filter(d => d.instanceId !== targetPersonalityId),
      });
    } else {
      // Relay: opponent used Favor Battle — remove target from our battleAssignments
      const tgt = state.player.personalitiesHome.find(p => p.instanceId === targetPersonalityId);
      pushLog(`Opponent used Rulebook Favor Battle — ${tgt?.card.name ?? 'Personality'} moved home`, 'battle', 'opponent');
      set({
        imperialFavor: null,
        battleAssignments: battleAssignments.filter(a => a.instanceId !== targetPersonalityId),
      });
    }
  },

  // ── Tactical Advantage ────────────────────────────────────────────────────

  useTacticalAdvantage: (personalityId, handCardInstanceId, target = 'player') => {
    const state = get();
    const ps = state[target];
    const { battleStage } = state;
    if (battleStage !== 'engage' && battleStage !== 'battleWindow') return;

    const personality = ps.personalitiesHome.find(p => p.instanceId === personalityId);
    if (!personality) return;
    if (!personality.card.keywords.some(k => k.toLowerCase().trim() === 'tactician')) return;

    const tacKey = `${personalityId}:tactical`;
    if (ps.abilitiesUsed.includes(tacKey)) {
      if (target === 'player') pushLog(`${personality.card.name} has already used Tactical Advantage this turn`, 'battle', 'player');
      return;
    }

    const handCard = ps.hand.find(c => c.instanceId === handCardInstanceId);
    // For opponent relay, hand cards are hidden — use a dummy Focus Value of 0 if card not found
    const focusValue = handCard?.card.focus ?? 0;
    const who = target === 'player' ? '' : 'Opponent\'s ';
    const cardName = handCard?.card.name ?? '(hand card)';

    pushLog(
      `Tactical Advantage: ${who}${personality.card.name} discards ${cardName} (FV${focusValue}) → +${focusValue}F`,
      'battle', target,
    );
    if (target === 'player') relay({ type: 'tactical-advantage', personalityId, handCardInstanceId });

    const newHand = handCard
      ? ps.hand.filter(c => c.instanceId !== handCardInstanceId)
      : ps.hand;
    const newDiscard = handCard
      ? [{ ...handCard, location: 'fateDiscard' as ZoneId }, ...ps.fateDiscard]
      : ps.fateDiscard;

    set({
      [target]: {
        ...ps,
        hand: newHand,
        fateDiscard: newDiscard,
        personalitiesHome: ps.personalitiesHome.map(p =>
          p.instanceId === personalityId
            ? { ...p, tempForceBonus: p.tempForceBonus + focusValue }
            : p,
        ),
        abilitiesUsed: [...ps.abilitiesUsed, tacKey],
      },
    });
  },

  // ── Discipline ────────────────────────────────────────────────────────────

  playDiscipline: (fateDiscardInstanceId, attachTargetId, target = 'player') => {
    const state = get();
    const ps = state[target];
    const { turnPhase, battleStage } = state;
    const card = ps.fateDiscard.find(c => c.instanceId === fateDiscardInstanceId);
    if (!card) return;

    const discCost = card.card.disciplineCost;
    if (discCost === undefined) {
      if (target === 'player') pushLog(`${card.card.name} does not have the Discipline trait`, 'other', 'player');
      return;
    }
    const totalCost = (card.card.cost ?? 0) + discCost;

    if (target === 'player') {
      if (ps.goldPool < totalCost) {
        pushLog(
          `Cannot use Discipline — need ${totalCost}g (${card.card.cost}g + ${discCost}g Discipline), have ${ps.goldPool}g`,
          'gold', 'player',
        );
        return;
      }
      const inAction = turnPhase === 'action';
      const inBattle = battleStage === 'engage' || battleStage === 'battleWindow';
      if (!inAction && !inBattle) {
        pushLog('Cannot use Discipline outside of Action or Battle phase', 'other', 'player');
        return;
      }
    }

    const isAttachment = ['item', 'follower', 'spell'].includes(card.card.type);
    const who = target === 'player' ? '' : "Opponent's ";
    pushLog(
      `Discipline: ${who}${card.card.name} played from discard (cost ${card.card.cost}g + ${discCost}g Discipline = ${totalCost}g) — removed from game`,
      'other', target,
    );
    if (target === 'player') relay({ type: 'play-discipline', fateDiscardInstanceId, attachTargetId });

    const newFateDiscard = ps.fateDiscard.filter(c => c.instanceId !== fateDiscardInstanceId);
    let newPersonalitiesHome = ps.personalitiesHome;

    if (isAttachment && attachTargetId) {
      newPersonalitiesHome = ps.personalitiesHome.map(p =>
        p.instanceId === attachTargetId
          ? { ...p, attachments: [...p.attachments, { ...card, location: 'personalitiesHome' as ZoneId }] }
          : p,
      );
      // Chi Death: check if attaching this item reduced effective Chi to ≤ 0
      const attached = newPersonalitiesHome.find(p => p.instanceId === attachTargetId);
      if (attached && calcEffectiveChi(attached) <= 0) {
        pushLog(`Chi Death: ${attached.card.name}'s effective Chi reached 0`, 'battle', 'system');
        newPersonalitiesHome = newPersonalitiesHome.filter(p => p.instanceId !== attachTargetId);
      }
    }

    set({
      [target]: {
        ...ps,
        goldPool: target === 'player' ? ps.goldPool - totalCost : ps.goldPool,
        fateDiscard: newFateDiscard,
        personalitiesHome: newPersonalitiesHome,
      },
    });
  },

  // ── Battle ────────────────────────────────────────────────────────────────

  declareBattle: () => {
    if (get().turnPhase !== 'action') return;
    pushLog('Battle declared — assign personalities to provinces', 'phase', 'system');
    relay({ type: 'declare-battle' });
    set({ turnPhase: 'attack', battleStage: 'assigning', battleAssignments: [], defenderAssignments: [] });
  },

  assignToBattlefield: (instanceId, provinceIndex) => {
    const { battleAssignments, opponent } = get();
    const province = opponent.provinces[provinceIndex];
    if (!province || province.broken) return;
    // Replace any existing assignment for this personality
    const filtered = battleAssignments.filter(a => a.instanceId !== instanceId);
    const cardName = get().player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ?? 'personality';
    pushLog(`Assigned ${cardName} to attack Province ${provinceIndex + 1}`, 'other', 'player');
    relay({ type: 'assign-attacker', instanceId, provinceIndex });
    set({ battleAssignments: [...filtered, { instanceId, provinceIndex }] });
  },

  unassignFromBattle: (instanceId) => {
    const cardName = get().player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ?? 'personality';
    pushLog(`${cardName} removed from battle`, 'other', 'player');
    relay({ type: 'unassign-attacker', instanceId });
    set({ battleAssignments: get().battleAssignments.filter(a => a.instanceId !== instanceId) });
  },

  beginResolution: () => {
    const { battleAssignments } = get();
    if (battleAssignments.length === 0) {
      pushLog('No attackers assigned — ending battle', 'phase', 'system');
      set({ turnPhase: 'dynasty', battleStage: null, battleAssignments: [] });
      return;
    }
    pushLog('Infantry committed — defender may now assign units', 'phase', 'system');
    relay({ type: 'commit-infantry' });
    set({ battleStage: 'defender-assigning' });
  },

  commitDefenders: () => {
    pushLog('Defenders committed — Cavalry phase begins', 'phase', 'system');
    relay({ type: 'commit-defenders' });
    set({ battleStage: 'cavalry-assigning' });
  },

  commitCavalry: () => {
    pushLog('Cavalry committed — defender may assign Cavalry', 'phase', 'system');
    relay({ type: 'commit-cavalry' });
    set({ battleStage: 'defender-cavalry-assigning' });
  },

  commitDefenderCavalry: () => {
    pushLog('Defender Cavalry committed — proceeding to battle resolution', 'phase', 'system');
    relay({ type: 'commit-defender-cavalry' });
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

    if (side === 'player') relay({ type: 'pass-battle', side: 'player' });
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
        const { player, opponent, battleAssignments, defenderAssignments } = st;
        const provinceIndex = currentBattlefield!;
        const province = opponent.provinces[provinceIndex];
        if (!province || province.broken) return;

        const assignedIds = battleAssignments
          .filter(a => a.provinceIndex === provinceIndex)
          .map(a => a.instanceId);
        const attackers = player.personalitiesHome.filter(p => assignedIds.includes(p.instanceId));
        const attackingForce = attackers.reduce((sum, p) => sum + calcUnitForce(p, true), 0);

        const defenderIds = defenderAssignments
          .filter(d => d.provinceIndex === provinceIndex)
          .map(d => d.instanceId);
        const defenders = opponent.personalitiesHome.filter(p => defenderIds.includes(p.instanceId));
        const defendingForce = defenders.reduce((sum, p) => sum + calcUnitForce(p, true), 0);

        // Fortification: holdings with the Fortification keyword add their Force to this province's defense
        const fortificationForce = opponent.holdingsInPlay
          .filter(h =>
            h.fortificationProvince === provinceIndex &&
            h.card.keywords.some(k => k.toLowerCase().trim() === 'fortification'),
          )
          .reduce((sum, h) => sum + Math.max(0, Number(h.card.force) || 0), 0);

        if (fortificationForce > 0) {
          pushLog(`Fortification adds ${fortificationForce}F to Province ${provinceIndex + 1} defense`, 'battle', 'system');
        }
        // Battle outcome: army force determines win/loss; province strength only affects province break.
        // Tie = equal force with units on both sides.
        const isTie        = attackingForce === defendingForce && attackers.length > 0 && defenders.length > 0;
        const attackerWins = !isTie && attackingForce > defendingForce;
        // Province breaks only when attacker wins AND their force exceeds defending force + province strength
        const isBreached   = attackerWins && attackingForce > (defendingForce + opponent.provinceStrength + fortificationForce);

        const outcomeLabel = isTie        ? `TIE (${attackingForce}F each)`
          : attackerWins
            ? (isBreached
                ? `Attacker wins — Province ${provinceIndex + 1} BROKEN! (${attackingForce}F att vs ${defendingForce}F def + ${opponent.provinceStrength}s prov)`
                : `Attacker wins — province holds (${attackingForce}F att vs ${defendingForce}F def, prov needs >${opponent.provinceStrength + defendingForce})`)
            : `Defenders hold (${defendingForce}F def > ${attackingForce}F att)`;
        pushLog(outcomeLabel, 'phase', 'system');

        // Discard any region attached to the province if it breaks
        const brokenRegion = isBreached ? province.region : null;
        const newOpponentProvinces = opponent.provinces.map((p, i) =>
          i !== provinceIndex ? p : {
            ...p,
            broken: isBreached,
            card:   isBreached ? null : p.card,
            faceUp: isBreached ? false : p.faceUp,
            region: isBreached ? null : p.region,
          },
        );

        // ── Battle casualties and honor ──────────────────────────────────────────
        let newPlayer   = { ...player };
        let newOpponent = {
          ...opponent,
          provinces: newOpponentProvinces,
          dynastyDiscard: brokenRegion
            ? [...opponent.dynastyDiscard, { ...brokenRegion, location: 'dynastyDiscard' as ZoneId }]
            : opponent.dynastyDiscard,
        };

        const isResilient = (p: CardInstance) =>
          p.card.keywords.some(k => k.toLowerCase().trim() === 'resilient') && !p.resilientUsed;

        // Rehonoring rule: before a player gains Honor from kills, all dishonorable personalities
        // in their winning army are rehonored instead — substituting for the Honor gain.
        // In a tie, dishonorable personalities in each army are rehonored before being destroyed.
        const applyRehonoring = (
          allPs: CardInstance[],
          armyIds: string[],
          honorFromKills: number,
          who: string,
          side: 'player' | 'opponent',
        ): { honorGained: number; updatedPs: CardInstance[] } => {
          const dishonorableInArmy = allPs.filter(p => armyIds.includes(p.instanceId) && p.dishonored);
          if (dishonorableInArmy.length > 0 && honorFromKills > 0) {
            const names = dishonorableInArmy.map(p => p.card.name).join(', ');
            pushLog(`${who}: ${names} rehonored — substitutes for ${honorFromKills} Honor gain`, 'honor', side);
            return {
              honorGained: 0,
              updatedPs: allPs.map(p =>
                dishonorableInArmy.some(d => d.instanceId === p.instanceId)
                  ? { ...p, dishonored: false }
                  : p,
              ),
            };
          }
          return { honorGained: honorFromKills, updatedPs: allPs };
        };

        if (isTie) {
          // Both armies destroy each other; each side gains honor (or rehonors dishonorable instead)
          const atkResilient   = attackers.filter(isResilient);
          const defResilient   = defenders.filter(isResilient);
          const atkTrulyKilled = attackers.filter(p => !isResilient(p));
          const defTrulyKilled = defenders.filter(p => !isResilient(p));

          if (atkResilient.length > 0) pushLog(`Resilient saved (att): ${atkResilient.map(p => p.card.name).join(', ')}`, 'battle', 'system');
          if (defResilient.length > 0) pushLog(`Resilient saved (def): ${defResilient.map(p => p.card.name).join(', ')}`, 'battle', 'system');
          if (atkTrulyKilled.length > 0) pushLog(`Attackers killed: ${atkTrulyKilled.map(p => p.card.name + (p.dishonored ? ' ☠' : '')).join(', ')}`, 'battle', 'system');
          if (defTrulyKilled.length > 0) pushLog(`Defenders killed: ${defTrulyKilled.map(p => p.card.name + (p.dishonored ? ' ☠' : '')).join(', ')}`, 'battle', 'system');

          const atkDishonorKilled = atkTrulyKilled.filter(p => p.dishonored);
          const defDishonorKilled = defTrulyKilled.filter(p => p.dishonored);
          const atkPhLoss = atkDishonorKilled.reduce((s, p) => s + Math.max(0, Number(p.card.personalHonor) || 0), 0);
          const defPhLoss = defDishonorKilled.reduce((s, p) => s + Math.max(0, Number(p.card.personalHonor) || 0), 0);
          if (atkPhLoss > 0) pushLog(`You lose ${atkPhLoss} Honor (dishonorably dead)`, 'honor', 'player');
          if (defPhLoss > 0) pushLog(`Opponent loses ${defPhLoss} Honor (dishonorably dead)`, 'honor', 'opponent');

          // Rehonoring substitutes for kill-honor in a tie
          const { honorGained: atkHonorGained, updatedPs: atkPsAfterRehonor } = applyRehonoring(
            player.personalitiesHome, assignedIds, defTrulyKilled.length * 2, 'You', 'player',
          );
          const { honorGained: defHonorGained, updatedPs: defPsAfterRehonor } = applyRehonoring(
            opponent.personalitiesHome, defenderIds, atkTrulyKilled.length * 2, 'Opponent', 'opponent',
          );
          if (atkHonorGained > 0) pushLog(`You gain ${atkHonorGained} Honor (${defTrulyKilled.length} kill${defTrulyKilled.length !== 1 ? 's' : ''})`, 'honor', 'player');
          if (defHonorGained > 0) pushLog(`Opponent gains ${defHonorGained} Honor (${atkTrulyKilled.length} kill${atkTrulyKilled.length !== 1 ? 's' : ''})`, 'honor', 'opponent');

          const atkKilledIds = atkTrulyKilled.map(p => p.instanceId);
          const defKilledIds = defTrulyKilled.map(p => p.instanceId);
          newPlayer = {
            ...newPlayer,
            familyHonor: newPlayer.familyHonor + atkHonorGained - atkPhLoss,
            personalitiesHome: atkPsAfterRehonor
              .filter(p => !atkKilledIds.includes(p.instanceId))
              .map(p => atkResilient.some(r => r.instanceId === p.instanceId)
                ? { ...p, attachments: [], resilientUsed: true, bowed: true } : p),
            honorablyDead: [...player.honorablyDead, ...atkTrulyKilled.filter(p => !p.dishonored).map(p => ({ ...p, attachments: [] }))],
            dishonorablelyDead: [...player.dishonorablelyDead, ...atkDishonorKilled.map(p => ({ ...p, attachments: [] }))],
            fateDiscard: [...player.fateDiscard, ...atkTrulyKilled.flatMap(p => p.attachments), ...atkResilient.flatMap(p => p.attachments)],
          };
          newOpponent = {
            ...newOpponent,
            familyHonor: newOpponent.familyHonor + defHonorGained - defPhLoss,
            personalitiesHome: defPsAfterRehonor
              .filter(p => !defKilledIds.includes(p.instanceId))
              .map(p => defResilient.some(r => r.instanceId === p.instanceId)
                ? { ...p, attachments: [], resilientUsed: true } : p),
            honorablyDead: [...opponent.honorablyDead, ...defTrulyKilled.filter(p => !p.dishonored).map(p => ({ ...p, attachments: [] }))],
            dishonorablelyDead: [...opponent.dishonorablelyDead, ...defDishonorKilled.map(p => ({ ...p, attachments: [] }))],
            fateDiscard: [...opponent.fateDiscard, ...defTrulyKilled.flatMap(p => p.attachments), ...defResilient.flatMap(p => p.attachments)],
          };
        } else if (attackerWins) {
          // Attackers win → defenders die; attackers retreat home bowed (Conqueror exempt)
          const resilientDefenders = defenders.filter(isResilient);
          const defTrulyKilled     = defenders.filter(p => !isResilient(p));

          if (resilientDefenders.length > 0) pushLog(`Resilient saved: ${resilientDefenders.map(p => p.card.name).join(', ')} (attachments destroyed)`, 'battle', 'system');
          if (defTrulyKilled.length > 0) pushLog(`Defenders killed: ${defTrulyKilled.map(p => p.card.name + (p.dishonored ? ' ☠' : '')).join(', ')}`, 'battle', 'system');
          if (brokenRegion) pushLog(`Region ${brokenRegion.card.name} discarded (province broken)`, 'other', 'system');

          const defDishonorKilled = defTrulyKilled.filter(p => p.dishonored);
          const defPhLoss = defDishonorKilled.reduce((s, p) => s + Math.max(0, Number(p.card.personalHonor) || 0), 0);
          if (defPhLoss > 0) pushLog(`Opponent loses ${defPhLoss} Honor (dishonorably dead)`, 'honor', 'opponent');

          // Rehonoring substitutes for kill-honor
          const { honorGained, updatedPs: atkPsAfterRehonor } = applyRehonoring(
            player.personalitiesHome, assignedIds, defTrulyKilled.length * 2, 'You', 'player',
          );
          if (honorGained > 0) pushLog(`You gain ${honorGained} Honor (${defTrulyKilled.length} kill${defTrulyKilled.length !== 1 ? 's' : ''})`, 'honor', 'player');

          newPlayer = {
            ...newPlayer,
            familyHonor: newPlayer.familyHonor + honorGained,
            personalitiesHome: atkPsAfterRehonor.map(p => {
              if (!assignedIds.includes(p.instanceId)) return p;
              return { ...p, bowed: isConquerorUnit(p) ? p.bowed : true };
            }),
          };
          const defKilledIds = defTrulyKilled.map(p => p.instanceId);
          newOpponent = {
            ...newOpponent,
            familyHonor: newOpponent.familyHonor - defPhLoss,
            personalitiesHome: opponent.personalitiesHome
              .filter(p => !defKilledIds.includes(p.instanceId))
              .map(p => resilientDefenders.some(r => r.instanceId === p.instanceId)
                ? { ...p, attachments: [], resilientUsed: true } : p),
            honorablyDead: [...opponent.honorablyDead, ...defTrulyKilled.filter(p => !p.dishonored).map(p => ({ ...p, attachments: [] }))],
            dishonorablelyDead: [...opponent.dishonorablelyDead, ...defDishonorKilled.map(p => ({ ...p, attachments: [] }))],
            fateDiscard: [...opponent.fateDiscard, ...defTrulyKilled.flatMap(p => p.attachments), ...resilientDefenders.flatMap(p => p.attachments)],
          };
        } else {
          // Defenders win → attackers die; defenders stay home, do NOT bow
          const resilientAttackers = attackers.filter(isResilient);
          const atkTrulyKilled     = attackers.filter(p => !isResilient(p));

          if (resilientAttackers.length > 0) pushLog(`Resilient saved: ${resilientAttackers.map(p => p.card.name).join(', ')} (attachments destroyed)`, 'battle', 'system');
          if (atkTrulyKilled.length > 0) pushLog(`Attackers killed: ${atkTrulyKilled.map(p => p.card.name + (p.dishonored ? ' ☠' : '')).join(', ')}`, 'battle', 'system');

          const atkDishonorKilled = atkTrulyKilled.filter(p => p.dishonored);
          const atkPhLoss = atkDishonorKilled.reduce((s, p) => s + Math.max(0, Number(p.card.personalHonor) || 0), 0);
          if (atkPhLoss > 0) pushLog(`You lose ${atkPhLoss} Honor (dishonorably dead)`, 'honor', 'player');

          // Rehonoring substitutes for kill-honor
          const { honorGained, updatedPs: defPsAfterRehonor } = applyRehonoring(
            opponent.personalitiesHome, defenderIds, atkTrulyKilled.length * 2, 'Opponent', 'opponent',
          );
          if (honorGained > 0) pushLog(`Opponent gains ${honorGained} Honor (${atkTrulyKilled.length} kill${atkTrulyKilled.length !== 1 ? 's' : ''})`, 'honor', 'opponent');

          const atkKilledIds = atkTrulyKilled.map(p => p.instanceId);
          newPlayer = {
            ...newPlayer,
            familyHonor: newPlayer.familyHonor - atkPhLoss,
            personalitiesHome: player.personalitiesHome
              .filter(p => !atkKilledIds.includes(p.instanceId))
              .map(p => resilientAttackers.some(r => r.instanceId === p.instanceId)
                ? { ...p, attachments: [], resilientUsed: true, bowed: true } : p),
            honorablyDead: [...player.honorablyDead, ...atkTrulyKilled.filter(p => !p.dishonored).map(p => ({ ...p, attachments: [] }))],
            dishonorablelyDead: [...player.dishonorablelyDead, ...atkDishonorKilled.map(p => ({ ...p, attachments: [] }))],
            fateDiscard: [...player.fateDiscard, ...atkTrulyKilled.flatMap(p => p.attachments), ...resilientAttackers.flatMap(p => p.attachments)],
          };
          // Defenders stay home, don't bow — only update honor and personalities state
          newOpponent = {
            ...newOpponent,
            familyHonor: newOpponent.familyHonor + honorGained,
            personalitiesHome: defPsAfterRehonor,
          };
        }

        const remainingAssignments  = battleAssignments.filter(a => a.provinceIndex !== provinceIndex);
        const remainingDefenders    = defenderAssignments.filter(d => d.provinceIndex !== provinceIndex);

        if (remainingAssignments.length === 0) {
          pushLog('All battlefields resolved → Dynasty Phase', 'phase', 'system');
          set({
            turnPhase: 'dynasty', battleStage: null,
            battleAssignments: [], defenderAssignments: [],
            currentBattlefield: null, battleWindowPasses: 0,
            opponent: newOpponent,
            player:   newPlayer,
          });
        } else {
          pushLog('Battlefield resolved — select next battlefield to resolve', 'phase', 'system');
          set({
            battleStage: 'resolving', currentBattlefield: null,
            battleWindowPriority: 'opponent', battleWindowPasses: 0,
            battleAssignments: remainingAssignments,
            defenderAssignments: remainingDefenders,
            opponent: newOpponent,
            player:   newPlayer,
          });
        }
      }
    } else {
      pushLog(`${sideLabel} passed in the ${battleStage === 'engage' ? 'Engage' : 'Battle'} window`, 'priority', side);
      set({ battleWindowPasses: newCount, battleWindowPriority: otherSide });
    }
  },

  endAttackPhase: () => {
    const { player, opponent, battleAssignments } = get();
    const assignedIds = battleAssignments.map(a => a.instanceId);
    // Conqueror units don't bow on return home; also clear all tempForceBonus on both sides
    const newPersonalitiesHome = player.personalitiesHome.map(p => {
      const bowed = assignedIds.includes(p.instanceId) && !isConquerorUnit(p) ? true : p.bowed;
      return { ...p, bowed, tempForceBonus: 0 };
    });
    const newOpponentHome = opponent.personalitiesHome.map(p => ({ ...p, tempForceBonus: 0 }));
    pushLog('Attack Phase ended — unresolved attackers return home', 'phase', 'system');
    relay({ type: 'end-attack-phase' });
    set({
      turnPhase: 'dynasty',
      battleStage: null,
      battleAssignments: [],
      defenderAssignments: [],
      player:   { ...player,   personalitiesHome: newPersonalitiesHome },
      opponent: { ...opponent, personalitiesHome: newOpponentHome },
    });
  },

  assignDefender: (instanceId, provinceIndex) => {
    const { defenderAssignments, opponent, player } = get();
    const filtered = defenderAssignments.filter(d => d.instanceId !== instanceId);
    const cardName =
      opponent.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ??
      player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ??
      'personality';
    // In multiplayer, the player may call this with their own personality (acting as defender)
    const isPlayerUnit = player.personalitiesHome.some(p => p.instanceId === instanceId);
    const sideLabel = isPlayerUnit ? 'You' : 'Opponent';
    pushLog(`${sideLabel} assigned ${cardName} to defend Province ${provinceIndex + 1}`, 'other', isPlayerUnit ? 'player' : 'opponent');
    if (isPlayerUnit) relay({ type: 'assign-defender', instanceId, provinceIndex });
    set({ defenderAssignments: [...filtered, { instanceId, provinceIndex }] });
  },

  unassignFromDefense: (instanceId) => {
    const { opponent, player } = get();
    const cardName =
      player.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ??
      opponent.personalitiesHome.find(p => p.instanceId === instanceId)?.card.name ??
      'personality';
    pushLog(`${cardName} removed from defense`, 'other', 'player');
    set({ defenderAssignments: get().defenderAssignments.filter(d => d.instanceId !== instanceId) });
  },

  applyBattleKeyword: (sourceId, targetId, type, value) => {
    const { player, opponent } = get();
    const src = player.personalitiesHome.find(p => p.instanceId === sourceId);
    const tgt = opponent.personalitiesHome.find(p => p.instanceId === targetId);
    if (!src || !tgt) return;

    const typeLabel = type === 'fear' ? 'Fear' : type === 'melee' ? 'Melee Attack' : 'Ranged Attack';

    // Follower shield: any attached follower whose effective Force ≤ value must be
    // targeted before the personality. Bowed/unbowed state is irrelevant here —
    // bowing removes the follower's contribution to army totals, not its Force stat.
    const shieldFollower = tgt.attachments.find(att =>
      att.card.type === 'follower' && calcFollowerForce(att) <= value,
    );

    if (shieldFollower) {
      // Target the follower
      if (type === 'fear') {
        pushLog(
          `${src.card.name} Fear ${value} → bowed ${shieldFollower.card.name} (follower shield)`,
          'battle', 'player',
        );
        set({
          opponent: {
            ...opponent,
            personalitiesHome: opponent.personalitiesHome.map(p =>
              p.instanceId !== targetId ? p : {
                ...p,
                attachments: p.attachments.map(att =>
                  att.instanceId !== shieldFollower.instanceId ? att : { ...att, bowed: true },
                ),
              },
            ),
          },
        });
      } else {
        // Melee / Ranged — kill the follower
        pushLog(
          `${src.card.name} ${typeLabel} ${value} → killed ${shieldFollower.card.name} (follower shield)`,
          'battle', 'player',
        );
        set({
          opponent: {
            ...opponent,
            personalitiesHome: opponent.personalitiesHome.map(p =>
              p.instanceId !== targetId ? p : {
                ...p,
                attachments: p.attachments.filter(att => att.instanceId !== shieldFollower.instanceId),
              },
            ),
            fateDiscard: [
              { ...shieldFollower, location: 'fateDiscard' as ZoneId },
              ...opponent.fateDiscard,
            ],
          },
        });
      }
    } else {
      // No follower shield — target the personality itself
      const tgtForce = Math.max(0, Number(tgt.card.force) || 0);
      if (tgtForce > value) {
        pushLog(
          `${tgt.card.name} has Force ${tgtForce} > ${value} — not a valid ${typeLabel} target`,
          'battle', 'system',
        );
        return;
      }
      if (type === 'fear') {
        pushLog(`${src.card.name} Fear ${value} → bowed ${tgt.card.name}`, 'battle', 'player');
        set({
          opponent: {
            ...opponent,
            personalitiesHome: opponent.personalitiesHome.map(p =>
              p.instanceId !== targetId ? p : { ...p, bowed: true },
            ),
          },
        });
      } else {
        // Melee / Ranged — kill the personality
        const attachments = tgt.attachments;
        const isDishonored = tgt.dishonored;
        const phLoss = isDishonored ? Math.max(0, Number(tgt.card.personalHonor) || 0) : 0;
        pushLog(
          `${src.card.name} ${typeLabel} ${value} → killed ${tgt.card.name}${isDishonored ? ' ☠' : ''}`,
          'battle', 'player',
        );
        pushLog(`You gain 2 Honor for killing ${tgt.card.name}`, 'honor', 'player');
        if (phLoss > 0) {
          pushLog(`Opponent loses ${phLoss} Honor (${tgt.card.name} dishonorably dead)`, 'honor', 'opponent');
        }
        set({
          player: { ...player, familyHonor: player.familyHonor + 2 },
          opponent: {
            ...opponent,
            familyHonor: opponent.familyHonor - phLoss,
            personalitiesHome: opponent.personalitiesHome.filter(p => p.instanceId !== targetId),
            honorablyDead: isDishonored
              ? opponent.honorablyDead
              : [{ ...tgt, attachments: [] }, ...opponent.honorablyDead],
            dishonorablelyDead: isDishonored
              ? [{ ...tgt, attachments: [] }, ...opponent.dishonorablelyDead]
              : opponent.dishonorablelyDead,
            fateDiscard: [...attachments, ...opponent.fateDiscard],
          },
        });
      }
    }
  },

  activateTactician: (personalityId, fateCardInstanceId) => {
    // Delegate to useTacticalAdvantage which handles relay, once-per-turn, and chi death
    get().useTacticalAdvantage(personalityId, fateCardInstanceId, 'player');
  },

  reserveRecruit: (provinceIndex, sourcePersonalityId) => {
    const { player, battleStage, battleWindowPriority, currentBattlefield, battleAssignments } = get();

    if (battleStage !== 'battleWindow' && battleStage !== 'engage') return;
    if (battleWindowPriority !== 'player') return;

    // Once per turn per source personality
    if (player.abilitiesUsed.includes(sourcePersonalityId)) {
      pushLog('Reserve already used this turn by this personality', 'recruit', 'player');
      return;
    }

    const province = player.provinces[provinceIndex];
    if (!province || !province.faceUp || !province.card || province.broken) return;

    const inst = province.card;
    const cost = Math.max(0, Number(inst.card.cost) || 0);
    if (player.goldPool < cost) {
      pushLog(
        `Cannot Reserve recruit ${inst.card.name} — need ${cost}g (have ${player.goldPool}g)`,
        'recruit', 'player',
      );
      return;
    }

    const isHolding = inst.card.type === 'holding';
    const isPersonality = inst.card.type === 'personality';

    // Singular check
    if (isPersonality) {
      const isSingular = inst.card.keywords.some(k => k.toLowerCase().trim() === 'singular');
      if (isSingular && player.personalitiesHome.some(p => p.card.id === inst.card.id)) {
        pushLog(`Cannot Reserve recruit ${inst.card.name} — Singular (already in play)`, 'recruit', 'player');
        return;
      }
    }

    // Refill province face-down
    const [nextCard = null, ...restDynasty] = player.dynastyDeck;
    const newProvinceCard: CardInstance | null = nextCard
      ? { ...nextCard, location: `province${provinceIndex}` as ZoneId, faceUp: false, bowed: false }
      : null;

    const isFortification = isHolding && inst.card.keywords.some(k => k.toLowerCase() === 'fortification');
    const recruited: CardInstance = {
      ...inst,
      location: isHolding ? 'holdingsInPlay' as ZoneId : 'personalitiesHome' as ZoneId,
      bowed: isHolding && !isFortification,
    };

    const srcName = player.personalitiesHome.find(p => p.instanceId === sourcePersonalityId)?.card.name ?? 'personality';
    pushLog(`${srcName} Reserve — recruited ${inst.card.name} for ${cost}g`, 'recruit', 'player');

    // Auto-assign recruited personality to current battlefield
    const newBattleAssignments =
      isPersonality && currentBattlefield !== null
        ? [...battleAssignments, { instanceId: recruited.instanceId, provinceIndex: currentBattlefield }]
        : battleAssignments;

    set({
      battleAssignments: newBattleAssignments,
      player: {
        ...player,
        provinces: player.provinces.map((p, i) =>
          i !== provinceIndex ? p : { ...p, card: newProvinceCard, faceUp: false },
        ),
        dynastyDeck: restDynasty,
        personalitiesHome: isPersonality
          ? [...player.personalitiesHome, recruited]
          : player.personalitiesHome,
        holdingsInPlay: isHolding
          ? [...player.holdingsInPlay, recruited]
          : player.holdingsInPlay,
        goldPool: 0,
        abilitiesUsed: [...player.abilitiesUsed, sourcePersonalityId],
      },
    });
  },

  borderKeepCycle: (holdingInstanceId) => {
    const { player } = get();
    const bk = player.holdingsInPlay.find(h => h.instanceId === holdingInstanceId);
    if (!bk) return;
    if (player.oncePerGameAbilitiesUsed.includes(holdingInstanceId)) {
      pushLog('Border Keep: once-per-game ability already used this game', 'other', 'player');
      return;
    }
    pushLog('Border Keep: activated once-per-game province cycling', 'other', 'player');
    relay({ type: 'border-keep-cycle', holdingInstanceId });
    set({
      cyclingActive: 'player',
      player: {
        ...player,
        oncePerGameAbilitiesUsed: [...player.oncePerGameAbilitiesUsed, holdingInstanceId],
      },
    });
  },

  playRingToPermanent: (instanceId) => {
    const { player } = get();
    const card = player.hand.find(c => c.instanceId === instanceId);
    if (!card || card.card.type !== 'ring') return;

    const ringInPlay: CardInstance = { ...card, location: 'specialsInPlay' as ZoneId, bowed: false };
    const newSpecials = [...player.specialsInPlay, ringInPlay];

    pushLog(`You put ${card.card.name} into play`, 'other', 'player');

    const newPlayer: PlayerState = {
      ...player,
      hand: player.hand.filter(c => c.instanceId !== instanceId),
      specialsInPlay: newSpecials,
    };

    // Enlightenment: 5 rings with 5 distinct elemental keywords in specialsInPlay
    const ELEMENTS = new Set(['air', 'earth', 'fire', 'water', 'void']);
    const ringElements = new Set<string>();
    for (const c of newSpecials) {
      if (c.card.type !== 'ring') continue;
      // False Rings and rings that say "does not count towards" are excluded
      if (/does not count towards.*enlightenment/i.test(c.card.text)) continue;
      for (const kw of c.card.keywords) {
        const lc = kw.toLowerCase().trim();
        if (ELEMENTS.has(lc)) ringElements.add(lc);
      }
    }
    if (ringElements.size >= 5) {
      pushLog('You control five Rings with different elemental keywords — Enlightenment Victory!', 'honor', 'system');
      set({ player: newPlayer, gameResult: { winner: 'player', reason: 'enlightenment' } });
      return;
    }

    set({ player: newPlayer });
  },

  dishonorPersonality: (instanceId, target) => {
    const side = get()[target];
    const pers = side.personalitiesHome.find(p => p.instanceId === instanceId);
    if (!pers) return;

    const nowDishonored = !pers.dishonored;
    pushLog(
      `${target === 'player' ? 'Your' : "Opponent's"} ${pers.card.name} is ${nowDishonored ? 'dishonored' : 'restored (honor restored)'}`,
      'honor', target,
    );
    if (target === 'player') relay({ type: 'dishonor-personality', instanceId, target: 'player' });
    set({
      [target]: {
        ...side,
        personalitiesHome: side.personalitiesHome.map(p =>
          p.instanceId !== instanceId ? p : { ...p, dishonored: nowDishonored },
        ),
      },
    });
  },

  // ── Token system ─────────────────────────────────────────────────────────────

  addToken: (instanceId, token, target = 'player') => {
    const ps = get()[target];
    const newToken = { ...token, id: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
    const update = (p: CardInstance) =>
      p.instanceId === instanceId ? { ...p, tokens: [...p.tokens, newToken] } : p;
    if (target === 'player') relay({ type: 'add-token', instanceId, token: newToken });
    set({
      [target]: {
        ...ps,
        personalitiesHome: ps.personalitiesHome.map(update),
      },
    });
  },

  removeToken: (instanceId, tokenId, target = 'player') => {
    const ps = get()[target];
    const update = (p: CardInstance) =>
      p.instanceId === instanceId ? { ...p, tokens: p.tokens.filter(t => t.id !== tokenId) } : p;
    if (target === 'player') relay({ type: 'remove-token', instanceId, tokenId });
    set({
      [target]: {
        ...ps,
        personalitiesHome: ps.personalitiesHome.map(update),
      },
    });
  },

  transferToken: (fromInstanceId, toInstanceId, tokenId, target = 'player') => {
    const ps = get()[target];
    let movedToken: import('../types/cards').GameToken | undefined;
    const removeFrom = (p: CardInstance) => {
      if (p.instanceId !== fromInstanceId) return p;
      movedToken = p.tokens.find(t => t.id === tokenId);
      return { ...p, tokens: p.tokens.filter(t => t.id !== tokenId) };
    };
    const addTo = (p: CardInstance) =>
      p.instanceId === toInstanceId && movedToken
        ? { ...p, tokens: [...p.tokens, movedToken] }
        : p;

    const afterRemove = ps.personalitiesHome.map(removeFrom);
    const afterAdd    = afterRemove.map(addTo);
    if (target === 'player') relay({ type: 'transfer-token', fromInstanceId, toInstanceId, tokenId });
    set({ [target]: { ...ps, personalitiesHome: afterAdd } });
  },

  // ── Removal from play ────────────────────────────────────────────────────────

  destroyCard: (instanceId, target = 'player') => {
    const ps = get()[target];
    const who = target === 'player' ? 'Your' : "Opponent's";

    // Search personalitiesHome
    const personality = ps.personalitiesHome.find(p => p.instanceId === instanceId);
    if (personality) {
      const isDishonored = personality.dishonored;
      const phLoss = isDishonored ? Math.max(0, Number(personality.card.personalHonor) || 0) : 0;
      const deadPile: 'honorablyDead' | 'dishonorablelyDead' = isDishonored ? 'dishonorablelyDead' : 'honorablyDead';
      const attachFateDiscard: CardInstance[] = personality.attachments
        .filter(a => ['item', 'follower', 'spell'].includes(a.card.type))
        .map(a => ({ ...a, location: 'fateDiscard' as import('../types/cards').ZoneId }));

      pushLog(`${who} ${personality.card.name} is destroyed (→ ${isDishonored ? 'Dishonorably' : 'Honorably'} Dead)`, 'battle', target);
      if (target === 'player') relay({ type: 'destroy-card', instanceId });
      set({
        [target]: {
          ...ps,
          familyHonor: ps.familyHonor - phLoss,
          personalitiesHome: ps.personalitiesHome.filter(p => p.instanceId !== instanceId),
          [deadPile]: [...ps[deadPile], { ...personality, location: deadPile as import('../types/cards').ZoneId }],
          fateDiscard: [...ps.fateDiscard, ...attachFateDiscard],
        },
      });
      return;
    }

    // Search holdingsInPlay
    const holding = ps.holdingsInPlay.find(h => h.instanceId === instanceId);
    if (holding) {
      pushLog(`${who} ${holding.card.name} is destroyed`, 'battle', target);
      if (target === 'player') relay({ type: 'destroy-card', instanceId });
      set({
        [target]: {
          ...ps,
          holdingsInPlay: ps.holdingsInPlay.filter(h => h.instanceId !== instanceId),
          dynastyDiscard: [...ps.dynastyDiscard, { ...holding, location: 'dynastyDiscard' as import('../types/cards').ZoneId }],
        },
      });
      return;
    }

    // Search specialsInPlay
    const special = ps.specialsInPlay.find(s => s.instanceId === instanceId);
    if (special) {
      pushLog(`${who} ${special.card.name} is destroyed`, 'battle', target);
      if (target === 'player') relay({ type: 'destroy-card', instanceId });
      set({
        [target]: {
          ...ps,
          specialsInPlay: ps.specialsInPlay.filter(s => s.instanceId !== instanceId),
          dynastyDiscard: [...ps.dynastyDiscard, { ...special, location: 'dynastyDiscard' as import('../types/cards').ZoneId }],
        },
      });
    }
  },

  discardFromPlay: (instanceId, target = 'player') => {
    const ps = get()[target];
    const who = target === 'player' ? 'Your' : "Opponent's";

    const personality = ps.personalitiesHome.find(p => p.instanceId === instanceId);
    if (personality) {
      const attachFateDiscard: CardInstance[] = personality.attachments
        .filter(a => ['item', 'follower', 'spell'].includes(a.card.type))
        .map(a => ({ ...a, location: 'fateDiscard' as import('../types/cards').ZoneId }));
      pushLog(`${who} ${personality.card.name} discarded from play`, 'discard', target);
      if (target === 'player') relay({ type: 'discard-from-play', instanceId });
      set({
        [target]: {
          ...ps,
          personalitiesHome: ps.personalitiesHome.filter(p => p.instanceId !== instanceId),
          dynastyDiscard: [...ps.dynastyDiscard, { ...personality, location: 'dynastyDiscard' as import('../types/cards').ZoneId }],
          fateDiscard: [...ps.fateDiscard, ...attachFateDiscard],
        },
      });
      return;
    }

    const holding = ps.holdingsInPlay.find(h => h.instanceId === instanceId);
    if (holding) {
      pushLog(`${who} ${holding.card.name} discarded from play`, 'discard', target);
      if (target === 'player') relay({ type: 'discard-from-play', instanceId });
      set({
        [target]: {
          ...ps,
          holdingsInPlay: ps.holdingsInPlay.filter(h => h.instanceId !== instanceId),
          dynastyDiscard: [...ps.dynastyDiscard, { ...holding, location: 'dynastyDiscard' as import('../types/cards').ZoneId }],
        },
      });
      return;
    }

    const special = ps.specialsInPlay.find(s => s.instanceId === instanceId);
    if (special) {
      pushLog(`${who} ${special.card.name} discarded from play`, 'discard', target);
      if (target === 'player') relay({ type: 'discard-from-play', instanceId });
      set({
        [target]: {
          ...ps,
          specialsInPlay: ps.specialsInPlay.filter(s => s.instanceId !== instanceId),
          dynastyDiscard: [...ps.dynastyDiscard, { ...special, location: 'dynastyDiscard' as import('../types/cards').ZoneId }],
        },
      });
    }
  },

  removeFromGame: (instanceId, target = 'player') => {
    const ps = get()[target];
    const who = target === 'player' ? 'Your' : "Opponent's";

    const allZones: (keyof PlayerState)[] = ['personalitiesHome', 'holdingsInPlay', 'specialsInPlay'];
    for (const zone of allZones) {
      const arr = ps[zone] as CardInstance[];
      const card = arr.find(c => c.instanceId === instanceId);
      if (card) {
        pushLog(`${who} ${card.card.name} removed from game`, 'discard', target);
        if (target === 'player') relay({ type: 'remove-from-game', instanceId });
        const attachRemoved = card.attachments.map(a => ({ ...a, location: 'removed' as import('../types/cards').ZoneId }));
        set({
          [target]: {
            ...ps,
            [zone]: arr.filter(c => c.instanceId !== instanceId),
            removed: [...ps.removed, { ...card, location: 'removed' as import('../types/cards').ZoneId }, ...attachRemoved],
          },
        });
        return;
      }
    }
  },

  // ── Multiplayer ─────────────────────────────────────────────────────────────

  enterLobby: () => set({ phase: 'lobby', multiplayerMode: true }),

  loadFromServerState: (ownState, opponentState, firstPlayerIndex, myPlayerIndex) => {
    // In multiplayer, 'player' is always the local client regardless of index.
    // firstPlayerIndex determines who gets activePlayer = 'player' first.
    const activePlayer = firstPlayerIndex === myPlayerIndex ? 'player' : 'opponent';
    set({
      phase: 'playing',
      multiplayerMode: true,
      myPlayerIndex,
      player: ownState,
      opponent: opponentState,
      activePlayer,
      turnPhase: 'straighten',
      priority: activePlayer,
      consecutivePasses: 0,
      turnNumber: 1,
      gameLog: [],
      gameResult: null,
      imperialFavor: null,
      battleAssignments: [],
      defenderAssignments: [],
      battleStage: null,
      currentBattlefield: null,
      battleWindowPriority: 'player',
      battleWindowPasses: 0,
      cyclingActive: null,
    });
  },

  setRelayCallback: (fn) => { _relayFn = fn; },

  applyOpponentDrew: () => {
    const { opponent } = get();
    // We don't know which card; just add a placeholder to opponent hand count.
    // The opponent's actual hand content is private — we only track length.
    const fakeCard = opponent.fateDeck[0];
    if (!fakeCard) return;
    set({
      opponent: {
        ...opponent,
        // Shift a placeholder from deck to hand (card is face-down = unknown)
        hand: [...opponent.hand, { ...fakeCard, faceUp: false, location: 'hand' }],
        fateDeck: opponent.fateDeck.slice(1),
      },
    });
  },
});});

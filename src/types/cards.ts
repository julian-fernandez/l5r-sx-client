// ─── Raw JSON catalog shape (from cards_v3.json) ───────────────────────────

export interface CardCatalogEntry {
  cardid: string;
  title: string[];
  puretexttitle: string;
  formattedtitle: string;
  type: string[];
  clan: string[];
  force: (number | string)[];
  chi: (number | string)[];
  cost: (number | string)[];
  ph: (number | string)[];       // Personal Honor
  honor: (number | string)[];    // Honor Requirement
  focus: (number | string)[];
  goldProduction: (number | string)[];
  rarity: string[];
  set: string[];
  legality: string[];
  deck: string[];
  keywords: string[];
  text: string[];
  imagePath: string;
  printing: PrintingEntry[];
  printingprimary: string;
}

export interface PrintingEntry {
  printingid: string;
  set: string[][];
  artist: string[];
  flavor: string[];
  text: string[];
  rarity: string[];
}

// ─── Normalized card (used throughout the app) ───────────────────────────────

export type CardType =
  | 'personality'
  | 'holding'
  | 'region'
  | 'event'
  | 'celestial'
  | 'strategy'
  | 'spell'
  | 'item'
  | 'follower'
  | 'ring'
  | 'stronghold'
  | 'sensei'
  | 'ancestor'
  | 'unknown';

export type DeckSection = 'dynasty' | 'fate' | 'stronghold' | 'sensei' | 'pregame';

export interface NormalizedCard {
  id: string;
  name: string;
  type: CardType;
  clan: string | null;
  cost: number;
  force: number | string;
  chi: number | string;
  personalHonor: number | string;   // ph field
  honorRequirement: number | string; // honor field
  focus: number;
  goldProduction: number | string;
  keywords: string[];
  text: string;
  imagePath: string;
  deckSection: DeckSection;
  /** Starting Family Honor (strongholds only, parsed from text) */
  startingHonor?: number;
  /** Province Strength (strongholds only, parsed from text) */
  provinceStrength?: number;
  /** Gold modifier (sensei only, parsed from text) */
  senseiGoldMod?: number;
  /** Province strength modifier (sensei only, parsed from text) */
  senseiProvinceMod?: number;
  /** Honor modifier (sensei only, parsed from text) */
  senseiHonorMod?: number;
  /**
   * Gold cost parsed from the "Discipline [PAY X]" trait in the card text.
   * When set, the card may be played from the Fate discard pile by paying its
   * normal cost plus this additional cost; it is then removed from the game.
   * undefined = card has no Discipline trait.
   */
  disciplineCost?: number;
}

// ─── Game runtime types ───────────────────────────────────────────────────────

/**
 * A discrete modifier token placed on a card by a card effect.
 * Tokens persist until removed or the card leaves play.
 * Examples: Corruption tokens (−1C), Fire tokens (+1F/+1C).
 */
export interface GameToken {
  id: string;
  /** Human-readable label shown in the UI (e.g. "+2F", "Corrupt", "Poison") */
  label: string;
  /** Force modifier (positive or negative) */
  force?: number;
  /** Chi modifier (positive or negative) */
  chi?: number;
  /** Additional keywords granted to the carrying card */
  keywords?: string[];
}

export interface CardInstance {
  instanceId: string;      // unique per copy in play
  cardId: string;          // references NormalizedCard.id
  card: NormalizedCard;
  bowed: boolean;
  faceUp: boolean;
  location: ZoneId;
  attachments: CardInstance[];
  fateTokens: number;
  honorTokens: number;
  /**
   * Discrete modifier tokens placed on this card by card effects.
   * Each token may grant Force/Chi bonuses or additional keywords.
   * Cleared automatically when the card leaves play.
   */
  tokens: GameToken[];
  /**
   * Temporary Force bonus granted by Tactician or card effects this battle.
   * Added to calcUnitForce; cleared when the Attack Phase ends or a new turn begins.
   * Use positive values for bonuses, negative for penalties.
   */
  tempForceBonus: number;
  /**
   * Temporary Chi modifier granted or penalised by card effects this turn.
   * Added to calcEffectiveChi; cleared at the same points as tempForceBonus.
   * Use positive values for bonuses, negative for penalties.
   */
  tempChiBonus: number;
  /**
   * Keywords temporarily granted to this card by card effects.
   * These stack on top of the printed keywords; cleared each Straighten Phase.
   * Use hasEffectiveKeyword() to check both printed and temp keywords.
   */
  tempKeywords: string[];
  /**
   * True when the personality has been dishonored (by a card effect, manually, etc.).
   * Dishonored personalities that die become Dishonorably Dead instead of Honorably Dead,
   * and their controller loses Family Honor equal to the personality's printed Personal Honor.
   */
  dishonored: boolean;
  /**
   * True once a Resilient card has already survived battle resolution.
   * After the first use, the Resilient keyword no longer applies.
   */
  resilientUsed?: boolean;
  /**
   * For Fortification holdings: the province index this holding was recruited from.
   * Its Force is added to that province's defense total in battle.
   */
  fortificationProvince?: number;
}

export type ZoneId =
  | 'fateDeck'
  | 'dynastyDeck'
  | 'fateDiscard'
  | 'dynastyDiscard'
  | 'hand'
  | 'personalitiesHome'   // personalities at home (not in battle)
  | 'holdingsInPlay'      // holdings always stay in play, no "home" concept
  | 'specialsInPlay'      // celestials and rings in play
  | 'honorablyDead'       // personalities killed in battle (distinct from discard)
  | 'dishonorablelyDead'  // personalities killed by dishonor effects
  | 'province0'
  | 'province1'
  | 'province2'
  | 'province3'
  | 'removed';

// ─── Targeting system ────────────────────────────────────────────────────────

/** Which player's cards are considered when searching for valid targets. */
export type TargetSide = 'player' | 'opponent' | 'both';

/**
 * In-play zones that can contain targetable cards.
 * 'provinces' targets province cards (face-up dynasty cards in provinces).
 */
export type TargetZone =
  | 'personalitiesHome'
  | 'holdingsInPlay'
  | 'specialsInPlay'
  | 'hand'
  | 'dynastyDiscard'
  | 'fateDiscard'
  | 'provinces';

/**
 * Declarative description of which cards are legal targets for an effect.
 * All specified criteria are ANDed together; omitted fields are unconstrained.
 *
 * Used by:
 *  - requestTarget() to declare what needs selecting
 *  - getValidTargets() to enumerate every card that satisfies the filter
 *  - TargetingOverlay to highlight selectable cards
 */
export interface TargetFilter {
  /** Which player's cards are valid (default: 'both'). */
  side?: TargetSide;
  /** Restrict search to specific zones (default: all in-play zones). */
  zones?: TargetZone[];
  /** Card type must match one of these strings (case-insensitive). */
  cardType?: string | string[];
  /** Card must have ALL of these keywords (uses hasEffectiveKeyword). */
  keywords?: string[];
  /** Filter by bow state. */
  bowed?: boolean;
  /** Filter by dishonored state (personalities only). */
  dishonored?: boolean;
  /** Only personalities currently assigned to THIS province's battlefield. */
  atBattlefield?: number;
  /** Only personalities NOT assigned to any battlefield (at home). */
  atHome?: boolean;
  /** Only personalities with Force ≥ minForce. */
  minForce?: number;
  /** Only personalities with Force ≤ maxForce. */
  maxForce?: number;
  /** Only personalities with Chi ≥ minChi. */
  minChi?: number;
  /** Only personalities with Chi ≤ maxChi. */
  maxChi?: number;
  /** Only personalities with Personal Honor ≥ minPH. */
  minPH?: number;
  /** Exclude cards with these instanceIds (e.g. the source card). */
  exclude?: string[];
  /**
   * Arbitrary extra predicate — evaluated last, after all other criteria.
   * Keep this pure (no side effects); it may be called many times.
   */
  custom?: (inst: CardInstance, side: 'player' | 'opponent') => boolean;
}

/** One entry in the list of valid targets returned by getValidTargets(). */
export interface ValidTarget {
  instanceId: string;
  side: 'player' | 'opponent';
  /** True when the target is a province card (inst lives inside a Province, not a flat array). */
  isProvinceCard?: boolean;
  provinceIndex?: number;
}

export interface Province {
  index: number;
  card: CardInstance | null;
  faceUp: boolean;
  region: CardInstance | null;
  strength: number;
  /** True once the province has been broken in battle. Broken provinces cannot be attacked again. */
  broken: boolean;
}

// ─── Battle ───────────────────────────────────────────────────────────────────

/** One personality assigned to attack one of the opponent's provinces. */
export interface BattleAssignment {
  instanceId: string;
  provinceIndex: number;  // 0–3
}

/**
 * Color palette for up to 4 simultaneous battlefields.
 * Index matches provinceIndex.
 */
export const BATTLEFIELD_STYLES = [
  { badge: 'bg-sky-500 text-white',      ring: 'ring-sky-400',     border: 'border-sky-400',    label: 'sky'     },
  { badge: 'bg-emerald-500 text-white',  ring: 'ring-emerald-400', border: 'border-emerald-400', label: 'emerald' },
  { badge: 'bg-amber-500 text-black',    ring: 'ring-amber-400',   border: 'border-amber-400',   label: 'amber'   },
  { badge: 'bg-rose-500 text-white',     ring: 'ring-rose-400',    border: 'border-rose-400',    label: 'rose'    },
] as const;

export interface PlayerState {
  stronghold: NormalizedCard | null;
  sensei: NormalizedCard | null;
  /** Effective family honor (stronghold base + sensei mod) */
  familyHonor: number;
  /** Effective gold production of stronghold (base + sensei mod) */
  strongholdGoldProduction: number;
  /** Effective province strength (base + sensei mod) */
  provinceStrength: number;
  hand: CardInstance[];
  fateDeck: CardInstance[];
  dynastyDeck: CardInstance[];
  fateDiscard: CardInstance[];
  dynastyDiscard: CardInstance[];
  provinces: Province[];
  /** Personalities at home (not assigned to battle) */
  personalitiesHome: CardInstance[];
  /** Holdings in play — pregame (BK, BH) + recruited; holdings don't move between zones */
  holdingsInPlay: CardInstance[];
  /** Celestials and rings currently in play */
  specialsInPlay: CardInstance[];
  /**
   * Gold accumulated this phase by bowing the stronghold and holdings.
   * Resets whenever priority or phase changes (per Samurai Extended rules).
   */
  goldPool: number;
  /** Whether the stronghold is currently bowed (tracked separately since it isn't a CardInstance) */
  strongholdBowed: boolean;
  /**
   * Whether the Proclaim ability has been used this turn.
   * Proclaim may only be declared once per turn (resets each Straighten Phase).
   */
  proclaimUsed: boolean;
  /**
   * Whether this player has already used their once-per-game first-turn Cycle.
   * Set permanently to true when endCycling is called.
   */
  cyclingDone: boolean;
  /**
   * Instance IDs of cards whose once-per-turn activated ability has already been used.
   * Reset to [] at the start of each new turn (Straighten Phase).
   */
  abilitiesUsed: string[];
  /**
   * Instance IDs of cards whose once-per-GAME activated ability has been used.
   * Never reset; persists for the entire game.
   */
  oncePerGameAbilitiesUsed: string[];
  /**
   * Bonus added to this player's Family Honor ONLY when comparing Honor during
   * a Lobby action. Not an actual Honor gain; doesn't affect Family Honor itself.
   */
  lobbyBonus: number;
  /**
   * Whether this player has already used their once-per-turn Lobby player ability.
   * Reset to false at the start of each new turn (Straighten Phase).
   */
  lobbyUsed: boolean;
  /**
   * Personalities killed honorably in battle.
   * Distinct from the discard pile — many card effects specifically reference dead personalities.
   */
  honorablyDead: CardInstance[];
  /**
   * Personalities killed dishonorably (dishonor, poison, etc.).
   * Reserved for future card effects; currently not populated.
   */
  dishonorablelyDead: CardInstance[];
  /**
   * Cards removed from the game entirely (by Discipline, card effects, etc.).
   * Cards here are no longer in any active zone and cannot be retrieved.
   */
  removed: CardInstance[];
}

// ─── Game Log ────────────────────────────────────────────────────────────────

export type LogCategory =
  | 'draw' | 'bow' | 'gold' | 'recruit' | 'phase'
  | 'cycle' | 'discard' | 'priority' | 'battle' | 'honor' | 'other';

export interface LogEntry {
  id: string;
  turnNumber: number;
  phase: string;
  side: 'player' | 'opponent' | 'system';
  message: string;
  category: LogCategory;
}

// ─── Deck list (parsed from Sun and Moon text format) ───────────────────────

export interface DeckEntry {
  quantity: number;
  name: string;           // raw name from deck list
  card: NormalizedCard | null;
}

export interface ParsedDeck {
  stronghold: DeckEntry[];
  sensei: DeckEntry[];
  pregameHoldings: DeckEntry[];
  dynasty: DeckEntry[];   // personalities, holdings, regions, events, celestials
  fate: DeckEntry[];      // strategies, spells, items, followers, rings
  missing: string[];      // card names that couldn't be matched
  violations: string[];   // deckbuilding rule violations (Loyal, Unique)
}

// ─── Duel ─────────────────────────────────────────────────────────────────────

/**
 * One card played into the Focus pool during a duel.
 *
 * Cards may come from two sources:
 *  - Hand (face-down): identity hidden from opponent during Focus; revealed at Strike.
 *  - Top of Fate deck (face-up): immediately visible to both players.
 *
 * After Strike, all focused cards move to the owner's Fate discard pile.
 */
export interface FocusCard {
  /** Instance ID of the focused card (used to remove it from hand/deck after the duel). */
  instanceId: string;
  /** The card's printed Focus value — this is what gets added to the duelist's Chi. */
  focusValue: number;
  /** True when played face-down from hand; false when revealed face-up from deck top. */
  faceDown: boolean;
  /** Card name — revealed at Strike for face-down cards. */
  cardName: string;
}

/**
 * State for an active AEG-edition duel between two personalities.
 *
 * AEG duel sequence:
 *   1. CHALLENGE — the triggering card ability challenges a target personality.
 *      If `canRefuse` is true, the defender may decline (triggering card's text specifies the penalty).
 *   2. FOCUS — beginning with the DEFENDER, players alternate playing Focus cards:
 *        a. A card from hand, placed face-down (identity hidden until Strike).
 *        b. The top card of their Fate deck, placed face-up (immediately revealed).
 *      Both players may instead pass. Once both pass consecutively, proceed to Strike.
 *   3. STRIKE — compare (duelist Chi + sum of focused Focus values) for each side.
 *      Higher total wins. Personalities with the Duelist keyword win ties.
 *      If both or neither duelist has Duelist, the challenger wins ties.
 *   4. EFFECTS — the triggering card's text specifies what happens to the winner/loser
 *      (commonly: dishonor, bow, kill, or some card draw). Applied manually for now.
 */
export interface PendingDuel {
  /** Personality initiating the challenge. */
  challengerInstanceId: string;
  /** Personality receiving the challenge. */
  defenderInstanceId: string;
  /** Which side controls the challenger. */
  challengerSide: 'player' | 'opponent';
  /** Name of the card or effect that triggered the duel (displayed in the UI). */
  triggerCardName: string;
  /** Whether the defending player may refuse the duel. */
  canRefuse: boolean;
  /** 'challenge' = awaiting defender accept/refuse; 'focus' = Focus phase active. */
  stage: 'challenge' | 'focus';
  /** Whose turn it is to play a Focus card or pass (starts with the defender's side). */
  focusTurn: 'player' | 'opponent';
  /** Number of consecutive passes in the current Focus phase (2 → proceed to Strike). */
  focusPasses: number;
  /** Focus cards played by the local player. */
  playerFocusCards: FocusCard[];
  /** Focus cards played by the opponent. */
  opponentFocusCards: FocusCard[];
}

/**
 * Passed to the `onResolve` callback supplied to `initiateDuel()`.
 *
 * The callback is provided by whichever card ability triggered the duel and
 * is responsible for applying the effect text of that ability
 * (e.g. "bow the loser", "dishonor the loser", "if you win, draw a card").
 *
 * Trait bonuses (e.g. a personality that gains +1 honor for every duel they win)
 * should also be applied here — the caller has full context to do so.
 *
 * Note: Strike resolution (Chi + Focus comparison) and Focus card discarding
 * are handled by the engine before this callback fires.  The engine deliberately
 * does NOT auto-apply win/loss effects because those vary by card.
 */
export interface DuelResult {
  /** The duelist with the higher strike total (Chi + Focus). */
  winner: CardInstance;
  /** The duelist with the lower strike total. */
  loser: CardInstance;
  /** Side that controls the winner. */
  winnerSide: 'player' | 'opponent';
  /** Side that controls the loser. */
  loserSide: 'player' | 'opponent';
  /** True when the challenger's side won. */
  challengerWon: boolean;
  /** Challenger personality (convenience reference). */
  challenger: CardInstance;
  /** Defender personality (convenience reference). */
  defender: CardInstance;
  /** Final strike total for the challenger (Chi + sum of focused Focus values). */
  challengerTotal: number;
  /** Final strike total for the defender. */
  defenderTotal: number;
  /** True when the result was decided by the Duelist keyword (totals were equal). */
  resolvedByDuelist: boolean;
}

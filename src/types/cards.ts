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
}

// ─── Game runtime types ───────────────────────────────────────────────────────

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
   * Personalities killed honorably in battle.
   * Distinct from the discard pile — many card effects specifically reference dead personalities.
   */
  honorablyDead: CardInstance[];
  /**
   * Personalities killed dishonorably (dishonor, poison, etc.).
   * Reserved for future card effects; currently not populated.
   */
  dishonorablelyDead: CardInstance[];
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
}

import type { CardInstance, NormalizedCard, ZoneId } from '../types/cards';
import type { TurnPhase } from '../store/gameStore';

// ─── Timing & play validation ────────────────────────────────────────────────

/**
 * Extract timing window tags from a card, checking BOTH the text field and
 * the keywords array.  Text is the authoritative source because timing markers
 * ("Battle:", "Open:", …) appear in card text, and the keyword array may or
 * may not include them depending on the extraction process.
 *
 * Returns a lower-cased set: 'limited', 'open', 'battle', 'engage'.
 * A card with no timing tags defaults to Open (see canPlayFromHand).
 */
export function getCardTimings(card: NormalizedCard): Set<string> {
  const timings = new Set<string>();

  // Primary: scan card text for timing prefixes (most reliable source)
  if (card.text) {
    const re = /\b(Limited|Open|Battle|Engage):/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(card.text)) !== null) {
      timings.add(m[1].toLowerCase());
    }
  }

  // Secondary: also honour explicit timing keywords (e.g. keyword = "Battle")
  for (const kw of card.keywords) {
    const lc = kw.toLowerCase().trim();
    if (lc === 'limited' || lc.startsWith('limited:')) timings.add('limited');
    if (lc === 'open'    || lc.startsWith('open:'))    timings.add('open');
    if (lc === 'battle'  || lc.startsWith('battle:'))  timings.add('battle');
    if (lc === 'engage'  || lc.startsWith('engage:'))  timings.add('engage');
  }

  return timings;
}

// ─── Parsed abilities ────────────────────────────────────────────────────────

export type AbilityTiming = 'Limited' | 'Open' | 'Battle' | 'Engage';

export interface ParsedAbility {
  /** 'trait' = passive text before any timing marker; others = activated ability */
  timing: AbilityTiming | 'trait';
  /** Text that follows the timing marker (or the full trait text) */
  text: string;
}

/**
 * Split a card's text field into individual abilities / trait sections.
 *
 * L5R card text looks like:
 *   "Kharmic. Open: Do X. Battle: Do Y."
 *   → [{ timing: 'trait', text: 'Kharmic.' },
 *      { timing: 'Open',   text: 'Do X.'   },
 *      { timing: 'Battle', text: 'Do Y.'   }]
 */
export function parseCardAbilities(text: string): ParsedAbility[] {
  if (!text?.trim()) return [];
  const abilities: ParsedAbility[] = [];

  // Split wherever a timing keyword starts (positive look-ahead keeps the keyword)
  const segments = text.split(/(?=(?:Limited|Open|Battle|Engage):)/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(Limited|Open|Battle|Engage):\s*([\s\S]*)/);
    if (m) {
      abilities.push({ timing: m[1] as AbilityTiming, text: m[2].trim() });
    } else {
      abilities.push({ timing: 'trait', text: trimmed });
    }
  }
  return abilities;
}

/**
 * Returns true when a single ability timing window is currently open for the player.
 */
export function isTimingValid(
  timing: AbilityTiming,
  turnPhase: TurnPhase,
  battleStage: 'assigning' | 'resolving' | 'engage' | 'battleWindow' | null,
  activePlayer: 'player' | 'opponent',
  priority: 'player' | 'opponent',
  battleWindowPriority: 'player' | 'opponent',
): boolean {
  const myTurn = activePlayer === 'player';
  switch (timing) {
    case 'Engage':  return turnPhase === 'attack' && battleStage === 'engage'       && battleWindowPriority === 'player';
    case 'Battle':  return turnPhase === 'attack' && battleStage === 'battleWindow' && battleWindowPriority === 'player';
    case 'Limited': return turnPhase === 'action' && myTurn && priority === 'player';
    case 'Open':    return turnPhase === 'action' && priority === 'player';
  }
}

/**
 * Returns true when the player is allowed to play `card` from their hand.
 *
 * A card is playable if ANY of its abilities has a currently-valid timing window.
 * Cards with no timing keyword default to Open (Action phase only).
 *
 * Key rule: Open and Limited abilities are NEVER playable during Battle/Engage windows.
 */
export function canPlayFromHand(
  card: NormalizedCard,
  turnPhase: TurnPhase,
  battleStage: 'assigning' | 'resolving' | 'engage' | 'battleWindow' | null,
  activePlayer: 'player' | 'opponent',
  priority: 'player' | 'opponent',
  battleWindowPriority: 'player' | 'opponent',
): boolean {
  // Attachments equip during any action-phase window the player holds priority
  if (['item', 'follower', 'spell'].includes(card.type)) {
    return turnPhase === 'action' && priority === 'player';
  }
  if (card.type !== 'strategy') return false;

  const args = [turnPhase, battleStage, activePlayer, priority, battleWindowPriority] as const;

  // Try timing tags from keywords first (fast path)
  const kwTimings = getCardTimings(card);
  if (kwTimings.size > 0) {
    // Card is playable if ANY keyword timing is currently valid
    for (const t of kwTimings) {
      const cap = (t[0].toUpperCase() + t.slice(1)) as AbilityTiming;
      if (isTimingValid(cap, ...args)) return true;
    }
    return false;
  }

  // No timing keywords → default Open
  return isTimingValid('Open', ...args);
}

/**
 * Returns true when `att` (an attachment card) can legally be attached to
 * `personality` given the current attachments already on that personality.
 *
 * Rules enforced:
 *  - Spells   → Shugenja only
 *  - Weapons  → max 1 (or 2 for Kensai personalities)
 *  - Followers → unlimited
 *  - Other items → unlimited
 */
export function canAttachTo(att: NormalizedCard, personality: CardInstance): boolean {
  const pKws = personality.card.keywords.map(k => k.toLowerCase());

  if (att.type === 'spell') {
    return pKws.some(k => k.includes('shugenja'));
  }

  if (att.type === 'item') {
    const isWeapon = att.keywords.some(k => k.toLowerCase().includes('weapon'));
    if (isWeapon) {
      const isKensai    = pKws.some(k => k.includes('kensai'));
      const weaponCount = personality.attachments.filter(a =>
        a.card.type === 'item' &&
        a.card.keywords.some(k => k.toLowerCase().includes('weapon')),
      ).length;
      return weaponCount < (isKensai ? 2 : 1);
    }
    return true;
  }

  return true; // followers: no limit
}

/**
 * Returns true when `personality` qualifies as a Cavalry unit.
 *
 * Per CR p.66: the Personality AND every one of its Followers must have the
 * Cavalry keyword.  Non-Follower attachments (items, spells) are ignored.
 */
export function isCavalryUnit(personality: CardInstance): boolean {
  const hasCav = (kws: string[]) => kws.some(k => k.toLowerCase() === 'cavalry');
  if (!hasCav(personality.card.keywords)) return false;
  return personality.attachments
    .filter(att => att.card.type === 'follower')
    .every(follower => hasCav(follower.card.keywords));
}

/**
 * Returns true when the personality has the Conqueror keyword.
 * Conqueror units do not bow when they return home after winning a battle.
 */
export function isConquerorUnit(personality: CardInstance): boolean {
  return personality.card.keywords.some(k => k.toLowerCase().trim() === 'conqueror');
}

/**
 * Extract the numeric value from a keyword like "Fear 3" or "Melee Attack 2".
 * `kwType` should be the lowercase prefix to match (e.g. 'fear', 'melee attack').
 */
export function extractKeywordValue(keywords: string[], kwType: string): number | null {
  const lcType = kwType.toLowerCase();
  for (const kw of keywords) {
    const lc = kw.toLowerCase().trim();
    if (lc.startsWith(lcType)) {
      const rest = lc.slice(lcType.length).trim();
      const n = parseInt(rest, 10);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

export type BattleKeywordType = 'fear' | 'melee' | 'ranged' | 'reserve';

export interface BattleKeywordAbility {
  type: BattleKeywordType | 'tactician';
  value: number;  // focus value for tactician is resolved at activation time
  label: string;
}

/**
 * Returns all battle-usable keyword abilities on a personality card:
 * Fear X, Melee Attack X, Ranged Attack X, and Tactician.
 */
export function getBattleKeywordAbilities(card: NormalizedCard): BattleKeywordAbility[] {
  const abilities: BattleKeywordAbility[] = [];
  const kws = card.keywords;

  const fearVal = extractKeywordValue(kws, 'fear');
  if (fearVal !== null) abilities.push({ type: 'fear',   value: fearVal, label: `Fear ${fearVal}` });

  const meleeVal = extractKeywordValue(kws, 'melee attack');
  if (meleeVal !== null) abilities.push({ type: 'melee', value: meleeVal, label: `Melee Attack ${meleeVal}` });

  const rangedVal = extractKeywordValue(kws, 'ranged attack');
  if (rangedVal !== null) abilities.push({ type: 'ranged', value: rangedVal, label: `Ranged Attack ${rangedVal}` });

  if (kws.some(k => k.toLowerCase().trim() === 'tactician')) {
    abilities.push({ type: 'tactician', value: 0, label: 'Tactician' });
  }

  if (kws.some(k => k.toLowerCase().trim() === 'reserve')) {
    abilities.push({ type: 'reserve', value: 0, label: 'Reserve' });
  }

  return abilities;
}

/**
 * Calculate the Force a personality unit contributes to its army.
 *
 * Per the Comprehensive Rules (p.15):
 *
 * DURING battle resolution (`forResolution = true`):
 *   - A bowed Personality contributes 0 Force (the whole unit is excluded).
 *   - A bowed Follower does not contribute its own Force.
 *   - Item Force modifiers always apply to the Personality's Force stat,
 *     even if the Item itself is bowed — but if the Personality is bowed,
 *     the entire unit still contributes 0.
 *
 * OUTSIDE battle resolution (`forResolution = false`, used for display/other checks):
 *   - All cards in the unit contribute regardless of bowed state.
 *
 * Result is always clamped to a minimum of 0.
 */
export function calcUnitForce(personality: CardInstance, forResolution: boolean): number {
  const baseForce = Math.max(0, Number(personality.card.force) || 0);

  // If bowed during resolution, the whole unit contributes nothing
  if (forResolution && personality.bowed) return 0;

  // Start with personality's base force, then apply item modifiers (always)
  let force = baseForce;
  for (const att of personality.attachments) {
    const attType = att.card.type;
    const attForce = Number(att.card.force) || 0;

    if (attType === 'item') {
      // Item force is a modifier (can be negative); always applies to Personality's stat
      force += attForce;
    } else if (attType === 'follower') {
      // Follower force is independent — excluded when bowed during resolution
      const followerForce = Math.max(0, attForce);
      if (!forResolution || !att.bowed) {
        force += followerForce;
      }
    }
    // Spells have no Force stat contribution
  }

  // Tactician bonus — always added (even when bowed the unit contributes 0 anyway)
  force += personality.tempForceBonus;

  return Math.max(0, force);
}

/**
 * Effective Force of a follower for targeting purposes (Fear / Melee / Ranged checks).
 * Uses the follower's base Force stat plus any active modifiers (tempForceBonus, etc.).
 * Bowed/unbowed state is irrelevant here — bowing removes contribution to army totals
 * during resolution, but does not change the follower's Force stat itself.
 */
export function calcFollowerForce(follower: CardInstance): number {
  return Math.max(0, (Number(follower.card.force) || 0) + follower.tempForceBonus);
}

let instanceCounter = 0;

export function createInstance(card: NormalizedCard, location: ZoneId, faceUp = false): CardInstance {
  return {
    instanceId: `inst_${++instanceCounter}_${card.id}`,
    cardId: card.id,
    card,
    bowed: false,
    faceUp,
    location,
    attachments: [],
    fateTokens: 0,
    honorTokens: 0,
    tempForceBonus: 0,
    dishonored: false,
  };
}

/** Fisher-Yates in-place shuffle */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Expand a DeckEntry list (with quantities) into individual CardInstances */
export function expandDeck(
  entries: { card: NormalizedCard | null; quantity: number }[],
  location: ZoneId,
): CardInstance[] {
  const instances: CardInstance[] = [];
  for (const entry of entries) {
    if (!entry.card) continue;
    for (let i = 0; i < entry.quantity; i++) {
      instances.push(createInstance(entry.card, location));
    }
  }
  return instances;
}

import type { CardInstance, NormalizedCard, PlayerState, ZoneId } from '../types/cards';
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
    if (lc === 'limited'   || lc.startsWith('limited:'))   timings.add('limited');
    if (lc === 'open'      || lc.startsWith('open:'))      timings.add('open');
    if (lc === 'battle'    || lc.startsWith('battle:'))    timings.add('battle');
    if (lc === 'engage'    || lc.startsWith('engage:'))    timings.add('engage');
    if (lc === 'reaction'  || lc === 'interrupt')          timings.add('reaction');
  }

  return timings;
}

// ─── Parsed abilities ────────────────────────────────────────────────────────

/**
 * Timing windows for activated abilities.
 * 'Reaction' covers both "Reaction:" and "Interrupt:" card text (they are
 * equivalent in Samurai Extended).
 */
export type AbilityTiming = 'Limited' | 'Open' | 'Battle' | 'Engage' | 'Reaction';

export interface ParsedAbility {
  /** 'trait' = passive text before any timing marker; others = activated ability */
  timing: AbilityTiming | 'trait';
  /** Text that follows the timing marker (or the full trait text) */
  text: string;
}

/**
 * Split a card's text field into individual abilities / trait sections.
 *
 * Normalisation rules applied here:
 *  - "Interrupt:" → "Reaction:" (equivalent in Samurai Extended)
 *  - "Reaction: After engaging at …" → timing 'Engage' (those are Engage
 *    abilities masquerading as reactions; they fire in the Engage window)
 *
 * L5R card text looks like:
 *   "Kharmic. Open: Do X. Reaction: After Y: Do Z."
 *   → [{ timing: 'trait',    text: 'Kharmic.'      },
 *      { timing: 'Open',     text: 'Do X.'          },
 *      { timing: 'Reaction', text: 'After Y: Do Z.' }]
 */
export function parseCardAbilities(text: string): ParsedAbility[] {
  if (!text?.trim()) return [];
  const abilities: ParsedAbility[] = [];

  // Split wherever a timing keyword starts (look-ahead preserves the keyword)
  const segments = text.split(/(?=(?:Limited|Open|Battle|Engage|Reaction|Interrupt):)/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(Limited|Open|Battle|Engage|Reaction|Interrupt):\s*([\s\S]*)/);
    if (m) {
      const rawTiming = m[1];
      const body      = m[2].trim();

      // Normalise Interrupt → Reaction
      let timing: AbilityTiming = rawTiming === 'Interrupt' ? 'Reaction' : rawTiming as AbilityTiming;

      // "Reaction: After engaging at …" → Engage timing
      if (timing === 'Reaction' && /^after\s+engaging\s+at\b/i.test(body)) {
        timing = 'Engage';
      }

      abilities.push({ timing, text: body });
    } else {
      abilities.push({ timing: 'trait', text: trimmed });
    }
  }
  return abilities;
}

// ─── Reaction / Trigger system ───────────────────────────────────────────────

/**
 * Events that can fire a Reaction window.
 * Add new trigger types here as more card interactions are implemented.
 */
export type TriggerType =
  | 'battle-declared'           // attacker declares an attack on a province
  | 'battle-action-announced'   // a Battle action/ability is announced
  | 'battle-won'                // attacker wins a battle (force > defenders)
  | 'battle-lost'               // attacker loses a battle (or ties)
  | 'province-broken'           // a province is broken after a battle
  | 'personality-destroyed'     // any personality is destroyed by a card effect
  | 'personality-killed'        // a personality is killed in battle resolution
  | 'personality-recruited'     // a personality is recruited from a province
  | 'honor-gained'              // a player gains Family Honor
  | 'honor-lost'                // a player loses Family Honor
  ;

/** Contextual data passed with a trigger. */
export interface TriggerContext {
  /** Which side caused the trigger (attacker, acting player, etc.) */
  side: 'player' | 'opponent';
  /** Instance ID of the card most relevant to the trigger (e.g. killed personality) */
  cardInstanceId?: string;
  /** Province index relevant to the trigger */
  provinceIndex?: number;
  /** Numeric amount (e.g. honor gained/lost) */
  amount?: number;
}

/** A card that has a Reaction ability matching the fired trigger. */
export interface ReactionCandidate {
  /** Instance ID of the card holding the Reaction ability */
  instanceId: string;
  cardName: string;
  /** Full ability text after "Reaction:" */
  abilityText: string;
  /** Which zone the card is in */
  source: 'personalitiesHome' | 'holdingsInPlay' | 'hand' | 'fateDiscard';
  /** Which player controls this card */
  side: 'player' | 'opponent';
  /** Index into the card's parsed abilities array (for once-per-turn tracking) */
  abilityIndex: number;
}

/**
 * Trigger pattern table: maps regex patterns found in reaction ability text
 * (the part after "Reaction:") to TriggerTypes.
 *
 * The patterns are matched in order; the first match wins.
 */
const TRIGGER_PATTERNS: ReadonlyArray<[RegExp, TriggerType]> = [
  [/after\s+(you\s+)?announc(e|ing)\s+a\s+battle\s+action/i,     'battle-action-announced'],
  [/after\s+(you\s+)?declar(e|ing)\s+an?\s+attack/i,              'battle-declared'],
  [/after\s+(you\s+)?win(ning)?\s+a?\s+battle/i,                  'battle-won'],
  [/after\s+(you\s+)?los(e|ing)\s+a?\s+battle/i,                  'battle-lost'],
  [/after\s+a?\s+province\s+is\s+broken/i,                        'province-broken'],
  [/after\s+a\s+personality\s+is\s+(destroyed|killed)/i,          'personality-destroyed'],
  [/after\s+a\s+personality\s+is\s+killed\s+in\s+battle/i,        'personality-killed'],
  [/after\s+(you\s+)?recruit/i,                                    'personality-recruited'],
  [/after\s+(you\s+)?(gain|gains)\s+(family\s+)?honor/i,          'honor-gained'],
  [/after\s+(you\s+)?(lose|loses)\s+(family\s+)?honor/i,          'honor-lost'],
];

/**
 * Given the body text of a Reaction ability (after "Reaction:"), return the
 * TriggerType it responds to, or null if unrecognised.
 */
export function parseTriggerType(reactionText: string): TriggerType | null {
  for (const [pattern, type] of TRIGGER_PATTERNS) {
    if (pattern.test(reactionText)) return type;
  }
  return null;
}

/**
 * Scan all in-play cards (and hand/discard) for Reaction abilities that match
 * the given trigger type, filtering out any that have already been used this turn.
 *
 * Only the `player` side is scanned — opponent reactions in multiplayer must be
 * handled client-side on the opponent's machine to avoid revealing hidden info.
 * In solo mode, call this once for each side and merge the results.
 */
export function findReactionCandidates(
  triggerType: TriggerType,
  ps: PlayerState,
  side: 'player' | 'opponent',
): ReactionCandidate[] {
  const candidates: ReactionCandidate[] = [];

  const checkInstance = (inst: CardInstance, source: ReactionCandidate['source']) => {
    const abilityKey = (idx: number) => `${inst.instanceId}:r${idx}`;
    const abilities = parseCardAbilities(inst.card.text);
    abilities.forEach((ability, idx) => {
      if (ability.timing !== 'Reaction') return;
      if (parseTriggerType(ability.text) !== triggerType) return;
      if (ps.abilitiesUsed.includes(abilityKey(idx))) return; // once per turn
      candidates.push({
        instanceId:   inst.instanceId,
        cardName:     inst.card.name,
        abilityText:  ability.text,
        source,
        side,
        abilityIndex: idx,
      });
    });
  };

  // Personalities and their attachments
  for (const p of ps.personalitiesHome) {
    checkInstance(p, 'personalitiesHome');
    for (const att of p.attachments) checkInstance(att, 'personalitiesHome');
  }

  // Holdings
  for (const h of ps.holdingsInPlay) checkInstance(h, 'holdingsInPlay');

  // Hand cards (strategies, spells)
  for (const c of ps.hand) checkInstance(c, 'hand');

  // Fate discard (some cards react from discard)
  for (const c of ps.fateDiscard) checkInstance(c, 'fateDiscard');

  return candidates;
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
 *  - Spells       → Shugenja only
 *  - Armor        → max 1 per personality
 *  - Weapons      → max 1 (2 for Kensai, but never if either is Two-Handed)
 *  - Two-Handed   → requires no existing Weapons; Kensai still limited to 1
 *  - Followers    → unlimited
 *  - Other items  → unlimited
 */
export function canAttachTo(att: NormalizedCard, personality: CardInstance): boolean {
  const pKws = personality.card.keywords.map(k => k.toLowerCase());

  if (att.type === 'spell') {
    return pKws.some(k => k.includes('shugenja'));
  }

  if (att.type === 'item') {
    const attKws = att.keywords.map(k => k.toLowerCase());
    const isWeapon    = attKws.some(k => k.includes('weapon'));
    const isArmor     = attKws.some(k => k === 'armor');
    const isTwoHanded = attKws.some(k => k === 'two-handed');

    if (isArmor) {
      const hasArmor = personality.attachments.some(
        a => a.card.type === 'item' && a.card.keywords.some(k => k.toLowerCase() === 'armor'),
      );
      return !hasArmor;
    }

    if (isWeapon) {
      const isKensai = pKws.some(k => k.includes('kensai'));
      const existingWeapons = personality.attachments.filter(
        a => a.card.type === 'item' && a.card.keywords.some(k => k.toLowerCase().includes('weapon')),
      );
      const hasTwoHandedEquipped = existingWeapons.some(
        a => a.card.keywords.some(k => k.toLowerCase() === 'two-handed'),
      );

      // Two-Handed weapons cannot be combined with any other weapon, even for Kensai
      if (isTwoHanded) return existingWeapons.length === 0;
      // Can't equip alongside an existing Two-Handed weapon
      if (hasTwoHandedEquipped) return false;
      // Kensai may carry two non-Two-Handed weapons; others are limited to one
      return existingWeapons.length < (isKensai ? 2 : 1);
    }

    return true;
  }

  return true; // followers: no limit
}

/**
 * Returns true when a card has at least one ability marked as Repeatable.
 * Repeatable abilities ignore the once-per-turn `abilitiesUsed` throttle.
 *
 * Pattern: "Repeatable Open:", "Repeatable Limited:", "Kharmic Repeatable …"
 */
export function hasRepeatableAbility(card: NormalizedCard): boolean {
  if (!card.text) return false;
  return /\bRepeatable\b/i.test(card.text);
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
 * Returns true when the personality has the Tireless keyword.
 * Tireless units do not bow when returning home (win or loss); they may
 * also use Tireless-tagged abilities while bowed.
 */
export function isTirelessUnit(personality: CardInstance): boolean {
  return personality.card.keywords.some(k => k.toLowerCase().trim() === 'tireless');
}

/**
 * Returns true when the personality has the Shadowlands keyword.
 * Shadowlands personalities are immune to the Fear keyword effect.
 */
export function isShadowlandsUnit(personality: CardInstance): boolean {
  return personality.card.keywords.some(k => k.toLowerCase().trim() === 'shadowlands');
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

  // Token force bonuses (from card effects like "+2F" tokens)
  force += personality.tokens.reduce((s, t) => s + (t.force ?? 0), 0);

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
    tokens: [],
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

/**
 * Compute a personality's effective Chi stat.
 * Base Chi comes from the personality card; Items in the unit can modify it.
 * Chi Death fires when effective Chi ≤ 0.
 */
export function calcEffectiveChi(p: CardInstance): number {
  const baseChi   = Number(p.card.chi) || 0;
  const itemBonus = p.attachments.reduce((sum, a) => sum + (Number(a.card.chi) || 0), 0);
  const tokenBonus = p.tokens.reduce((s, t) => s + (t.chi ?? 0), 0);
  return baseChi + itemBonus + tokenBonus;
}

/**
 * Compute the effective gold cost for a card.
 *
 * Applies (in order):
 *  1. Clan discount: −2g when `applyDiscount` is true and the card's clan
 *     matches the player's stronghold clan. This is a player-chosen action,
 *     not auto-applied — pass `applyDiscount: true` only when the player
 *     explicitly triggers it.
 *
 * Returns a value ≥ 0. Add future cost-reduction effects here so every
 * code path that pays for a card uses a single source of truth.
 *
 * @param applyDiscount  Whether to apply the 2g same-clan discount (optional, default false).
 */
export function calcEffectiveCost(
  card: NormalizedCard,
  player: Pick<PlayerState, 'stronghold'>,
  { applyDiscount = false }: { applyDiscount?: boolean } = {},
): number {
  const base = Math.max(0, Number(card.cost) || 0);
  const cardClan   = card.clan?.toLowerCase() ?? '';
  const playerClan = (player.stronghold?.clan ?? '').toLowerCase();
  const canDiscount = Boolean(cardClan && playerClan && cardClan === playerClan);
  const discount    = applyDiscount && canDiscount ? 2 : 0;
  return Math.max(0, base - discount);
}

/**
 * Compute the effective province strength for a single province.
 *
 * Adds:
 *  - Base province strength (from stronghold + sensei modifier).
 *  - Fortification bonus: unbowed Fortification holdings whose
 *    `fortificationProvince` equals this province's index.
 *
 * This is the value that an attacker must exceed (plus defending Force)
 * in order to break the province.
 */
export function calcProvinceStrength(
  provinceIndex: number,
  defender: Pick<PlayerState, 'provinceStrength' | 'holdingsInPlay'>,
): number {
  const fortBonus = defender.holdingsInPlay
    .filter(h =>
      h.fortificationProvince === provinceIndex &&
      !h.bowed &&
      h.card.keywords.some(k => k.toLowerCase() === 'fortification'),
    )
    .reduce((sum, h) => sum + Math.max(0, Number(h.card.force) || 0), 0);
  return defender.provinceStrength + fortBonus;
}

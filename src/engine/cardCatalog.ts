import type { CardCatalogEntry, CardType, DeckSection, NormalizedCard } from '../types/cards';

const DYNASTY_TYPES = new Set<CardType>(['personality', 'holding', 'region', 'event', 'celestial']);
const FATE_TYPES = new Set<CardType>(['strategy', 'spell', 'item', 'follower', 'ring']);

function deriveDeckSection(type: CardType): DeckSection {
  if (DYNASTY_TYPES.has(type)) return 'dynasty';
  if (FATE_TYPES.has(type)) return 'fate';
  if (type === 'stronghold') return 'stronghold';
  if (type === 'sensei') return 'sensei';
  return 'dynasty'; // fallback
}

/**
 * Parse modifier values from sensei text, e.g. "(+1 Province Strength, -1 Gold Production)"
 */
function parseSenseiMods(text: string): {
  goldMod: number;
  provinceMod: number;
  honorMod: number;
} {
  const goldMatch = text.match(/([+-]\d+)\s*Gold Production/i);
  const provinceMatch = text.match(/([+-]\d+)\s*Province Strength/i);
  const honorMatch = text.match(/([+-]\d+)\s*(Family\s*)?Honor/i);

  return {
    goldMod: goldMatch ? parseInt(goldMatch[1]) : 0,
    provinceMod: provinceMatch ? parseInt(provinceMatch[1]) : 0,
    honorMod: honorMatch ? parseInt(honorMatch[1]) : 0,
  };
}

// ─── Stronghold stat lookup table ────────────────────────────────────────────
// Stats are printed on the card image, not in the JSON text.
// Confirmed values are listed here; unlisted strongholds fall back to defaults.
// Format: { startingHonor, provinceStrength }
// goldProduction is already in the JSON goldProduction field.
const STRONGHOLD_STATS: Record<string, { startingHonor: number; provinceStrength: number }> = {
  // Unicorn
  'Plains of the Maiden':               { startingHonor: 5,  provinceStrength: 7 },
  'Shiro Moto':                         { startingHonor: 5,  provinceStrength: 7 },
  'Kyuden Otaku':                       { startingHonor: 7,  provinceStrength: 6 },
  // Crab
  'Kyuden Hida':                        { startingHonor: 4,  provinceStrength: 7 },
  'Shiro Kuni':                         { startingHonor: 2,  provinceStrength: 8 },
  // Crane
  'Kyuden Kakita':                      { startingHonor: 8,  provinceStrength: 5 },
  'Kyuden Doji':                        { startingHonor: 9,  provinceStrength: 5 },
  // Dragon
  'Shiro Mirumoto':                     { startingHonor: 6,  provinceStrength: 6 },
  'Kyuden Togashi':                     { startingHonor: 8,  provinceStrength: 5 },
  // Lion
  'Shiro no Yojin':                     { startingHonor: 7,  provinceStrength: 6 },
  'Kyuden Ikoma':                       { startingHonor: 7,  provinceStrength: 6 },
  // Phoenix
  'Kyuden Isawa':                                    { startingHonor: 8,  provinceStrength: 5 },
  'Temple of Purity':                                { startingHonor: 7,  provinceStrength: 5 },
  'The Majestic Temple of the Phoenix':              { startingHonor: 7,  provinceStrength: 6 },
  // Scorpion
  'Kyuden Bayushi':                     { startingHonor: 4,  provinceStrength: 6 },
  'Shiro no Shosuro':                   { startingHonor: 3,  provinceStrength: 7 },
  // Mantis
  'Kyuden Gotei':                       { startingHonor: 5,  provinceStrength: 6 },
  // Spider / Shadowlands
  'The Ruins of Otosan Uchi':           { startingHonor: 1,  provinceStrength: 7 },
};

/**
 * Parse stronghold base stats. Checks the lookup table first,
 * then tries to extract from text, then falls back to safe defaults.
 */
function parseStrongholdStats(name: string, text: string): {
  startingHonor: number;
  provinceStrength: number;
} {
  // Lookup table wins if we have a confirmed entry
  const lookup = STRONGHOLD_STATS[name];
  if (lookup) return lookup;

  // Try to parse from text (some strongholds include stats in ability text)
  const honorMatch = text.match(/Family Honor[:\s]+(\d+)/i);
  const strengthMatch = text.match(/Province Strength[:\s]+(\d+)/i);

  return {
    startingHonor: honorMatch ? parseInt(honorMatch[1]) : 5,
    provinceStrength: strengthMatch ? parseInt(strengthMatch[1]) : 6,
  };
}

export function normalizeCard(raw: CardCatalogEntry): NormalizedCard {
  const type = (raw.type?.[0] ?? 'unknown').toLowerCase() as CardType;
  const text = raw.text?.[0] ?? '';

  const base: NormalizedCard = {
    id: raw.cardid,
    name: raw.title?.[0] ?? raw.puretexttitle ?? 'Unknown',
    type,
    clan: raw.clan?.[0] ?? null,
    cost: Number(raw.cost?.[0]) || 0,
    force: raw.force?.[0] ?? 0,
    chi: raw.chi?.[0] ?? 0,
    personalHonor: raw.ph?.[0] ?? 0,
    honorRequirement: raw.honor?.[0] ?? 0,
    focus: Number(raw.focus?.[0]) || 0,
    goldProduction: raw.goldProduction?.[0] ?? 0,
    keywords: raw.keywords ?? [],
    text,
    imagePath: raw.imagePath ?? '',
    deckSection: deriveDeckSection(type),
  };

  if (type === 'stronghold') {
    const stats = parseStrongholdStats(base.name, text);
    base.startingHonor = stats.startingHonor;
    base.provinceStrength = stats.provinceStrength;
  }

  if (type === 'sensei') {
    const mods = parseSenseiMods(text);
    base.senseiGoldMod = mods.goldMod;
    base.senseiProvinceMod = mods.provinceMod;
    base.senseiHonorMod = mods.honorMod;
  }

  return base;
}

// ─── Catalog singleton ────────────────────────────────────────────────────────

let catalog: NormalizedCard[] | null = null;
let catalogByName: Map<string, NormalizedCard[]> | null = null;

export async function loadCatalog(): Promise<NormalizedCard[]> {
  if (catalog) return catalog;

  const res = await fetch('/cards_v3.json');
  if (!res.ok) throw new Error(`Failed to load card catalog: ${res.status}`);
  const raw: CardCatalogEntry[] = await res.json();

  catalog = raw.map(normalizeCard);
  catalogByName = buildNameIndex(catalog);
  return catalog;
}

/**
 * Initialize the catalog from pre-loaded raw data.
 * Used server-side where `fetch` is not available and the JSON is read from disk.
 */
export function loadCatalogFromData(raw: CardCatalogEntry[]): NormalizedCard[] {
  catalog = raw.map(normalizeCard);
  catalogByName = buildNameIndex(catalog);
  return catalog;
}

function buildNameIndex(cards: NormalizedCard[]): Map<string, NormalizedCard[]> {
  const index = new Map<string, NormalizedCard[]>();

  for (const card of cards) {
    const key = normalizeNameForLookup(card.name);
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(card);
  }

  return index;
}

/**
 * Normalize a card name for fuzzy matching:
 * - lowercase
 * - collapse whitespace
 * - convert dashes/bullets to spaces
 * - expand "- exp" / "- exp2" → "experienced" / "experienced 2"
 */
export function normalizeNameForLookup(name: string): string {
  return name
    .toLowerCase()
    .replace(/&#149;|&#8226;|•/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bexp\s*(\d*)\b/g, (_, n) => `experienced${n ? ' ' + n : ''}`)
    .trim();
}

/**
 * Find the best matching card for a given deck list name.
 * Returns null if nothing matches.
 */
export function findCard(name: string): NormalizedCard | null {
  if (!catalogByName) return null;

  const normalized = normalizeNameForLookup(name);

  // Direct hit
  const direct = catalogByName.get(normalized);
  if (direct && direct.length > 0) {
    // Prefer exact name match first, then first result
    return direct.find(c => c.name.toLowerCase() === name.toLowerCase()) ?? direct[0];
  }

  // Fallback: partial scan (slower, only used when index misses)
  for (const [key, cards] of catalogByName.entries()) {
    if (key === normalized) return cards[0];
  }

  return null;
}

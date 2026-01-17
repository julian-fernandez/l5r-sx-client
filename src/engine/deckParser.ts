import type { DeckEntry, ParsedDeck } from '../types/cards';
import { findCard } from './cardCatalog';

type SectionKey = 'stronghold' | 'sensei' | 'pregameHoldings' | 'dynasty' | 'fate' | null;

const PREGAME_NAMES = ['border keep', 'bamboo harvesters'];

function isPregameName(name: string): boolean {
  const lower = name.toLowerCase();
  return PREGAME_NAMES.some(p => lower.startsWith(p));
}

function detectSection(line: string, currentSection: SectionKey): SectionKey {
  const lower = line.toLowerCase().replace(/^#\s*/, '');

  if (lower.startsWith('stronghold')) return 'stronghold';
  if (lower.startsWith('sensei')) return 'sensei';
  if (lower.startsWith('pregame')) return 'pregameHoldings';
  if (lower.startsWith('dynasty')) return 'dynasty';
  if (lower.startsWith('fate')) return 'fate';

  // Sub-headers within dynasty/fate (e.g. "# Personalities (22)") keep current section
  return currentSection;
}

/**
 * Parse a deck list in Sun and Moon format.
 *
 * Accepts lines of the form:
 *   # Section Header
 *   # Subsection (count)
 *   3 Card Name
 *   1 Card Name - exp
 *   1 Card Name - exp2
 */
export function parseDeck(text: string): ParsedDeck {
  const result: ParsedDeck = {
    stronghold: [],
    sensei: [],
    pregameHoldings: [],
    dynasty: [],
    fate: [],
    missing: [],
  };

  let section: SectionKey = null;
  const lines = text.split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Section header line
    if (line.startsWith('#')) {
      section = detectSection(line, section);
      continue;
    }

    // Card entry: "N Card Name"
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const quantity = parseInt(match[1], 10);
    const name = match[2].trim();
    const card = findCard(name);

    const entry: DeckEntry = { quantity, name, card };

    if (card === null) {
      result.missing.push(`${quantity}x ${name}`);
      // Still put it in the right bucket by section so counts are visible
    }

    // Pregame holdings can appear in Pregame Holdings section or be auto-detected by name
    if (section === 'pregameHoldings' || isPregameName(name)) {
      result.pregameHoldings.push(entry);
      continue;
    }

    // Route by explicit section first, then fall back to card type
    const cardType = card?.type ?? 'unknown';
    const cardSection = card?.deckSection ?? 'dynasty';

    if (section === 'stronghold' || cardType === 'stronghold') {
      result.stronghold.push(entry);
    } else if (section === 'sensei' || cardType === 'sensei') {
      result.sensei.push(entry);
    } else if (section === 'dynasty' || cardSection === 'dynasty') {
      result.dynasty.push(entry);
    } else if (section === 'fate' || cardSection === 'fate') {
      result.fate.push(entry);
    } else {
      result.dynasty.push(entry); // safe fallback
    }
  }

  return result;
}

/**
 * Server-side game initialization.
 *
 * Mirrors the buildPlayerState / buildProvinces logic from gameStore.ts so the
 * server is the single source of truth for deck order and initial hands.
 * The client receives its own full PlayerState and a redacted OpponentInfo.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import {
  loadCatalogFromData,
  normalizeCard,
} from '../../src/engine/cardCatalog.js';
import { parseDeck } from '../../src/engine/deckParser.js';
import {
  createInstance,
  shuffle,
  expandDeck,
} from '../../src/engine/gameActions.js';
import type { CardCatalogEntry, PlayerState, Province } from '../../src/types/cards.js';
import type { ServerDeckState, OpponentInfo, GameReadyPayload } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Catalog bootstrap ────────────────────────────────────────────────────────

let catalogLoaded = false;

export function ensureCatalogLoaded(): void {
  if (catalogLoaded) return;
  const jsonPath = resolve(__dirname, '../../public/cards_v3.json');
  const raw: CardCatalogEntry[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  loadCatalogFromData(raw);
  catalogLoaded = true;
  console.log(`[server] Card catalog loaded: ${raw.length} cards`);
}

// ─── Helpers (duplicated from gameStore.ts to keep server self-contained) ─────

function resolveStats(
  stronghold: PlayerState['stronghold'],
  sensei: PlayerState['sensei'],
) {
  return {
    familyHonor:
      (stronghold?.startingHonor ?? 5) + (sensei?.senseiHonorMod ?? 0),
    strongholdGoldProduction:
      (Number(stronghold?.goldProduction) || 5) + (sensei?.senseiGoldMod ?? 0),
    provinceStrength:
      (stronghold?.provinceStrength ?? 6) + (sensei?.senseiProvinceMod ?? 0),
  };
}

function buildProvinces(
  deck: ReturnType<typeof createInstance>[],
  strength: number,
): { provinces: Province[]; remaining: ReturnType<typeof createInstance>[] } {
  const remaining = [...deck];
  const provinces: Province[] = [];
  for (let i = 0; i < 4; i++) {
    const card = remaining.shift() ?? null;
    if (card) {
      card.location = `province${i}` as typeof card.location;
      card.faceUp = false;
    }
    provinces.push({ index: i, card, faceUp: false, region: null, strength, broken: false });
  }
  return { provinces, remaining };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InitResult {
  playerStates: [PlayerState, PlayerState];
  deckStates: [ServerDeckState, ServerDeckState];
  firstPlayerIndex: 0 | 1;
  payloads: [GameReadyPayload, GameReadyPayload];
}

/**
 * Parse both deck strings, shuffle, deal initial hands and provinces.
 * Returns full PlayerState for each player plus redacted OpponentInfo for each.
 *
 * @param deckStrings [player0DeckString, player1DeckString]
 */
export function initGame(deckStrings: [string, string]): InitResult | { error: string } {
  ensureCatalogLoaded();

  const parsedDecks = deckStrings.map(s => {
    try { return parseDeck(s); }
    catch (e) { return null; }
  });

  if (!parsedDecks[0]) return { error: 'Player 1 deck could not be parsed.' };
  if (!parsedDecks[1]) return { error: 'Player 2 deck could not be parsed.' };

  const playerStates: PlayerState[] = parsedDecks.map((deck, idx) => {
    const stronghold = deck!.stronghold[0]?.card ?? null;
    const sensei = deck!.sensei[0]?.card ?? null;
    const { familyHonor, strongholdGoldProduction, provinceStrength } =
      resolveStats(stronghold, sensei);

    const dynastyInstances = shuffle(expandDeck(deck!.dynasty, 'dynastyDeck'));
    const fateInstances    = shuffle(expandDeck(deck!.fate,    'fateDeck'));

    const { provinces, remaining: dynastyRemaining } =
      buildProvinces(dynastyInstances, provinceStrength);

    const hand    = fateInstances.slice(0, 5).map(c => ({ ...c, location: 'hand' as const, faceUp: true }));
    const fateDeck = fateInstances.slice(5);

    const holdingsInPlay = deck!.pregameHoldings.flatMap(e =>
      e.card ? [createInstance(e.card, 'holdingsInPlay', true)] : [],
    );

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
    } satisfies PlayerState;
  });

  // Determine first player: higher personal honor goes first; ties go to player 0
  const ph0 = playerStates[0].stronghold
    ? (playerStates[0].familyHonor ?? 0)
    : 0;
  const ph1 = playerStates[1].stronghold
    ? (playerStates[1].familyHonor ?? 0)
    : 0;
  const firstPlayerIndex: 0 | 1 = ph0 >= ph1 ? 0 : 1;

  const deckStates: [ServerDeckState, ServerDeckState] = [
    { fateDeck: [...playerStates[0].fateDeck], dynastyDeck: [...playerStates[0].dynastyDeck] },
    { fateDeck: [...playerStates[1].fateDeck], dynastyDeck: [...playerStates[1].dynastyDeck] },
  ];

  function toOpponentInfo(state: PlayerState): OpponentInfo {
    return {
      stronghold: state.stronghold,
      sensei: state.sensei,
      familyHonor: state.familyHonor,
      strongholdGoldProduction: state.strongholdGoldProduction,
      provinceStrength: state.provinceStrength,
      handCount: state.hand.length,
      fateDeckCount: state.fateDeck.length,
      dynastyDeckCount: state.dynastyDeck.length,
      fateDiscardCount: state.fateDiscard.length,
      dynastyDiscardCount: state.dynastyDiscard.length,
      // Provinces, personalities, holdings, specials are all visible
      provinces: state.provinces,
      holdingsInPlay: state.holdingsInPlay,
      personalitiesHome: state.personalitiesHome,
      specialsInPlay: state.specialsInPlay,
      honorablyDead: state.honorablyDead,
      dishonorablelyDead: state.dishonorablelyDead,
      goldPool: state.goldPool,
      strongholdBowed: state.strongholdBowed,
    };
  }

  const payloads: [GameReadyPayload, GameReadyPayload] = [
    {
      playerIndex: 0,
      firstPlayerIndex,
      ownState: playerStates[0],
      opponentInfo: toOpponentInfo(playerStates[1]),
    },
    {
      playerIndex: 1,
      firstPlayerIndex,
      ownState: playerStates[1],
      opponentInfo: toOpponentInfo(playerStates[0]),
    },
  ];

  return {
    playerStates: [playerStates[0], playerStates[1]],
    deckStates,
    firstPlayerIndex,
    payloads,
  };
}

/**
 * Draw the top card from a player's fate deck.
 * Updates the server deck state in place.
 * Returns the drawn card or null if the deck is empty.
 */
export function serverDrawFate(
  deckState: ServerDeckState,
): import('../../src/types/cards.js').CardInstance | null {
  const card = deckState.fateDeck.shift();
  return card ?? null;
}

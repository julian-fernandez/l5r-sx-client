/**
 * Test-game fixtures for the "goldfish / proof-of-concept" quick-start button.
 *
 * applyMidGameState transforms a freshly-built PlayerState into a believable
 * turn-3/4 board state so testers can immediately exercise every zone without
 * having to manually recruit cards.
 */

import type { CardInstance, PlayerState, ZoneId } from '../types/cards';

// ─── Deck strings ─────────────────────────────────────────────────────────────

export const UNICORN_TEST_DECK = `# Stronghold
1 Plains of the Maiden

# Sensei
1 Min-Hee Sensei

# Pregame Holdings
1 Border Keep - exp2
1 Bamboo Harvesters - exp

# Dynasty
# Personalities (22)
1 Utaku Liu Xeung - exp
3 Utaku Ji-Yun
3 Utaku Lishan
3 Utaku Mai
3 Utaku Ryoko
3 Utaku Sung-Ki
1 Utaku Ji-Yun - exp
3 Utaku Eun-ju
1 Utaku Kohana - exp
1 Moto Naleesh
# Holdings (12)
3 Small Farm
3 Stables
3 Spirit's Essence Dojo
1 Chugo Seido
1 Ageless Shrine
1 Traveling Peddler
# Celestials (2)
1 Jurojin's Blessing
1 Sadahako's Artistry
# Regions (2)
1 Shinden Shorai
1 The Second City
# Events (2)
1 Imperial Gift
1 Military Alliance

# Fate
# Strategies (35)
3 A Paragon's Strength
3 Cast Aside the Weak
3 Grateful Reward
3 Surety of Purpose
2 Two-Fold Virtue
3 The Perfect Moment
3 The Compassion of the Unicorn
1 Creating Order
3 Pure Intent
2 The Sound of Thunder
3 Riding in Harmony
3 Shinjo's Courage
3 A Noble End
# Items (1)
1 The Blessed Mantle of the Greensnakes
# Followers (3)
3 Utaku Elite Guard
# Rings (1)
1 Ring of the Void`;

export const SCORPION_TEST_DECK = `# Pre-Game - (4) [4 distinct]

# Holding - (2) [2 distinct]
1 Bamboo Harvesters
1 Border Keep

# Sensei - (1) [1 distinct]
1 Shika Sensei

# Stronghold - (1) [1 distinct]
1 The House of False Hope

# Dynasty - (40) [18 distinct]

# Celestial - (3) [3 distinct]
1 Bayushi's Guidance
1 Bayushi's Guidance - exp
1 The Moon's Imperative

# Event - (4) [3 distinct]
1 Harsh Choices
1 Reinforce the Line
2 War of the Spirit Realms

# Personality - (33) [12 distinct]
3 Bayushi Amorie
3 Bayushi Kanihime
3 Shosuro Kanako
1 Shosuro Kayo - exp
3 Shosuro Kiyofumi
3 Shosuro Nishu
3 Shosuro Ozu
3 Shosuro Sadao
3 Shosuro Saigyo
3 Shosuro Tagiso
2 Shosuro Tanihara
3 Soshi Mumoshi

# Fate - (40) [13 distinct]

# Follower - (10) [1 distinct]
10 Fading Shadows

# Strategy - (30) [12 distinct]
1 Contested Ground
3 Game of Sincerity
3 Help from the Shadows
3 Knife in the Darkness
3 No Hope
3 Nocturnal Attack
3 Shadow Plays
2 Smoke Cover
2 Surprising Resistance
3 The Second Feint
2 Thoughtless Sacrifice
2 Walk in Shadows`;

export const PHOENIX_TEST_DECK = `# Stronghold
1 The Majestic Temple of the Phoenix

# Sensei
1 Izuna Sensei

# Pregame Holdings
3 Glimpse of the Unicorn
2 Ominous Revelation

# Dynasty
# Events (5)
3 Glimpse of the Unicorn
2 Ominous Revelation

# Holdings (18)
2 The Ikoma Halls
3 Temple of Destiny
3 Honored Sensei
3 Ki-Rin's Shrine - exp2
3 The Ivory Courtroom
3 Temple of The Heavenly Crab
1 Forgotten Legacy

# Personalities (17)
3 Isawa Kaisei
3 Isawa Genma
3 Otomo Terumoto
3 Kitsuki Goto
2 Isawa Akime
3 Shiba Kintaro, the Remembered

# Fate
# Followers (8)
3 The Wind's Clarity
3 Words of Consecration
2 Compassion's Invocation

# Items (3)
3 Ritual Armor

# Strategies (29)
3 My Steel is Stronger
2 Amethyst Adjunct
3 Matsu Ki-Ai
3 Indifference
2 Usurpation
3 An Honored Guest
3 Wheels within Wheels
3 Pure Intent
2 Inexplicable Challenge
2 An Act of Disdain
3 Selfless Politics`;

// ─── Mid-game state transformer ───────────────────────────────────────────────

/**
 * Pull up to `n` cards of a given type from `arr`.
 * Returns [taken, rest].
 */
function pull(
  arr: CardInstance[],
  type: string,
  n: number,
): [CardInstance[], CardInstance[]] {
  const taken: CardInstance[] = [];
  const rest: CardInstance[] = [];
  for (const c of arr) {
    if (taken.length < n && c.card.type === type) taken.push(c);
    else rest.push(c);
  }
  return [taken, rest];
}

/**
 * Transform a freshly-built PlayerState into a turn-3/4 mid-game snapshot:
 *
 * - 2 personalities recruited to Home (one with a follower attachment)
 * - 1 dynasty holding in play (bowed — holdings enter play bowed)
 * - 1 personality dead in the Dynasty discard
 * - 4 strategies in the Fate discard
 * - Hand set to 4 fate cards
 * - Province 0 (player) or province 3 (opponent) broken
 * - Remaining provinces flipped face-up
 * - Cycling locked as done
 */
export function applyMidGameState(state: PlayerState, isOpponent: boolean): PlayerState {
  let dynastyDeck     = [...state.dynastyDeck];
  let fateDeck        = [...state.fateDeck];
  let dynastyDiscard  = [...state.dynastyDiscard];
  let fateDiscard     = [...state.fateDiscard];
  let personalitiesHome = [...state.personalitiesHome];
  let holdingsInPlay  = [...state.holdingsInPlay];
  let provinces       = state.provinces.map(p => ({ ...p }));

  // ── Dynasty ────────────────────────────────────────────────────────────────

  // Recruit 2 personalities to Home
  let persToHome: CardInstance[];
  [persToHome, dynastyDeck] = pull(dynastyDeck, 'personality', 2);
  personalitiesHome = [
    ...personalitiesHome,
    ...persToHome.map(p => ({
      ...p, location: 'personalitiesHome' as ZoneId, faceUp: true, bowed: false,
    })),
  ];

  // Recruit 1 holding into play (bowed — holdings always enter play bowed)
  let holdToPlay: CardInstance[];
  [holdToPlay, dynastyDeck] = pull(dynastyDeck, 'holding', 1);
  holdingsInPlay = [
    ...holdingsInPlay,
    ...holdToPlay.map(h => ({
      ...h, location: 'holdingsInPlay' as ZoneId, faceUp: true, bowed: true,
    })),
  ];

  // One personality has died — goes to dynasty discard
  let deadPers: CardInstance[];
  [deadPers, dynastyDeck] = pull(dynastyDeck, 'personality', 1);
  dynastyDiscard = [
    ...dynastyDiscard,
    ...deadPers.map(p => ({
      ...p, location: 'dynastyDiscard' as ZoneId, faceUp: true,
    })),
  ];

  // ── Fate ───────────────────────────────────────────────────────────────────

  // 4 strategies have been played already — in discard
  let discardedStrats: CardInstance[];
  [discardedStrats, fateDeck] = pull(fateDeck, 'strategy', 4);
  fateDiscard = [
    ...fateDiscard,
    ...discardedStrats.map(s => ({
      ...s, location: 'fateDiscard' as ZoneId, faceUp: true,
    })),
  ];

  // Current hand: 4 fate cards (face-down for opponent)
  const handCards = fateDeck.slice(0, 4).map(c => ({
    ...c, location: 'hand' as ZoneId, faceUp: !isOpponent,
  }));
  fateDeck = fateDeck.slice(4);

  // Attach one follower to the first personality at Home
  let followerArr: CardInstance[];
  [followerArr, fateDeck] = pull(fateDeck, 'follower', 1);
  if (personalitiesHome.length > 0 && followerArr.length > 0) {
    const att: CardInstance = {
      ...followerArr[0],
      location: 'personalitiesHome' as ZoneId,
      faceUp: true,
      bowed: false,
    };
    personalitiesHome = personalitiesHome.map((p, i) =>
      i === 0 ? { ...p, attachments: [...p.attachments, att] } : p,
    );
  }

  // ── Provinces ─────────────────────────────────────────────────────────────

  // Break one province — player's left-most (0), opponent's right-most (3)
  const brokenIdx = isOpponent ? 3 : 0;
  const brokenCard = provinces[brokenIdx]?.card;
  if (brokenCard) {
    dynastyDiscard = [
      ...dynastyDiscard,
      { ...brokenCard, location: 'dynastyDiscard' as ZoneId, faceUp: true },
    ];
  }

  if (isOpponent) {
    // Opponent: broken (3), face-up (0, 1), face-down (2) — mixed mid-game state
    provinces = provinces.map((p, i) => {
      if (i === brokenIdx) return { ...p, broken: true, card: null, faceUp: false };
      if (i === 2) return { ...p, faceUp: false }; // still face-down this turn
      return { ...p, faceUp: true };
    });
  } else {
    // Player: broken (0), all others face-down — waiting for the turn-start flip
    provinces = provinces.map((p, i) =>
      i === brokenIdx
        ? { ...p, broken: true, card: null, faceUp: false }
        : { ...p, faceUp: false },
    );
  }

  return {
    ...state,
    dynastyDeck,
    fateDeck,
    hand: handCards,
    fateDiscard,
    dynastyDiscard,
    personalitiesHome,
    holdingsInPlay,
    provinces,
    cyclingDone: true,
  };
}

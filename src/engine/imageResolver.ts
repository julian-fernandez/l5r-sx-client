import type { NormalizedCard } from '../types/cards';

/**
 * Order of set folders to try when resolving a card image,
 * most-recent-printing first (MRP preference per SX rules).
 */
const SET_FOLDER_PRIORITY = [
  'Twenty Festivals',
  'Ivory Edition',
  'Emperor Edition',
  'Emperor Edition Gempukku',
  'Emperor Edition Demo Decks',
  'Celestial Edition',
  'Celestial Edition 15th Anniversary',
  'Samurai Edition',
  'Samurai Edition Banzai',
  // Expansions roughly newest-first
  'Thunderous Acclaim',
  'Evil Portents',
  'A Line in the Sand',
  'The New Order',
  'The Currency of War',
  'The Coming Storm',
  'Aftermath',
  'A Matter of Honor',
  'Torn Asunder',
  'Coils of Madness',
  'Gates of Chaos',
  'Seeds of Decay',
  'The Shadow\'s Embrace',
  'Embers of War',
  'Second City',
  'Forgotten Legacy',
  'Before the Dawn',
  'The Dead of Winter',
  'Honor and Treachery',
  'Empire at War',
  'Battle of Kyuden Tonbo',
  'The Imperial Gift 3',
  'The Plague War',
  'Path of the Destroyer',
  'The Harbinger',
  'Celestial Edition 15th Anniversary',
  'The Imperial Gift 2',
  'Death at Koten',
  'Glory of the Empire',
  'The Heaven\'s Will',
  'The Imperial Gift 1',
  'Stronger Than Steel',
  'Honor\'s Veil',
  'Words and Deeds',
  'Test of the Emerald and Jade Championships',
  // Promotional
  'Promotional-Twenty Festivals',
  'Promotional-Ivory',
  'Promotional-Emperor',
  'Promotional–Emperor',
  'Promotional-Celestial',
  'Promotional–Celestial',
  'Promotional-Samurai',
  // Older sets as last resort
  'Khan\'s Defiance',
  'Path of Hope',
  'A Perfect Cut',
  'Wrath of the Emperor',
  'Rise of the Shogun',
  'Gold Edition',
  'Diamond Edition',
  'Lotus Edition',
];

/** Derive candidate filenames from a card name */
function candidateFilenames(card: NormalizedCard): string[] {
  const base = card.name;
  const candidates: string[] = [base];

  // Try puretexttitle equivalents via bullet/entity conversion
  const bulletVariants = [
    base.replace(/•/g, '&#149;'),
    base.replace(/&#149;/g, '•'),
    base.replace(/•/g, ' -'),
    base.replace(/&#8226;/g, ' -'),
  ];
  candidates.push(...bulletVariants);

  // Some experienced cards use " &#149; Experienced" in filename
  if (/experienced/i.test(base)) {
    const withBullet = base.replace(/\s+-\s+experienced/i, ' &#149; Experienced');
    candidates.push(withBullet);
  }

  return [...new Set(candidates)];
}

/**
 * Given a card, return a prioritized list of image URL paths to try.
 * The caller (React component) tries them in order until one loads.
 */
export function resolveImageCandidates(card: NormalizedCard): string[] {
  // If the JSON already has a resolved path, try it first
  const paths: string[] = [];
  if (card.imagePath) {
    paths.push(card.imagePath);
  }

  const names = candidateFilenames(card);

  for (const folder of SET_FOLDER_PRIORITY) {
    for (const name of names) {
      paths.push(`/images/${folder}/${name}.jpg`);
    }
  }

  return [...new Set(paths)];
}

import { useState } from 'react';
import type { NormalizedCard } from '../types/cards';
import { resolveImageCandidates } from '../engine/imageResolver';

interface Props {
  card: NormalizedCard;
  className?: string;
  alt?: string;
}

const CARD_BACK = '/images/cardback.jpg';

export function CardImage({ card, className = '', alt }: Props) {
  const candidates = resolveImageCandidates(card);
  const [index, setIndex] = useState(0);

  const src = candidates[index] ?? CARD_BACK;

  const handleError = () => {
    if (index < candidates.length - 1) {
      setIndex(i => i + 1);
    }
    // If all candidates exhausted, src stays as last attempt (broken img)
  };

  return (
    <img
      src={src}
      alt={alt ?? card.name}
      className={className}
      onError={handleError}
      loading="lazy"
      draggable={false}
    />
  );
}

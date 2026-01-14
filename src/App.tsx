import { useEffect } from 'react';
import type { ParsedDeck } from './types/cards';
import { loadCatalog } from './engine/cardCatalog';
import { useGameStore } from './store/gameStore';
import { DeckInput } from './components/DeckInput';
import { Board } from './components/Board';

export default function App() {
  const phase = useGameStore(s => s.phase);
  const player = useGameStore(s => s.player);
  const opponent = useGameStore(s => s.opponent);
  const activePlayer = useGameStore(s => s.activePlayer);
  const setCatalogLoaded = useGameStore(s => s.setCatalogLoaded);
  const loadGame = useGameStore(s => s.loadGame);
  const resetGame = useGameStore(s => s.resetGame);

  useEffect(() => {
    loadCatalog()
      .then(() => setCatalogLoaded(true))
      .catch(err => console.error('Failed to load card catalog:', err));
  }, [setCatalogLoaded]);

  function handleLoad(deck: ParsedDeck) {
    loadGame(deck);
  }

  return (
    <div className="min-h-screen bg-board-bg">
      {phase === 'setup' ? (
        <DeckInput onLoad={handleLoad} />
      ) : (
        <Board player={player} opponent={opponent} activePlayer={activePlayer} onReset={resetGame} />
      )}
    </div>
  );
}

import { useEffect, useCallback } from 'react';
import type { ParsedDeck, PlayerState } from './types/cards';
import { loadCatalog } from './engine/cardCatalog';
import { useGameStore, suppressRelay, unsuppressRelay } from './store/gameStore';
import { DeckInput } from './components/DeckInput';
import { Board } from './components/Board';
import { MultiplayerLobby } from './components/MultiplayerLobby';
import { useMultiplayer } from './hooks/useMultiplayer';
import type { GameReadyPayload, RelayedActionPayload, OpponentDrewPayload } from '../server/src/types';
import type { CardInstance } from './types/cards';

// ─── Read ?room= URL param (auto-join flow) ───────────────────────────────────
function getRoomCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('room') ?? '';
}

export default function App() {
  const phase              = useGameStore(s => s.phase);
  const player             = useGameStore(s => s.player);
  const opponent           = useGameStore(s => s.opponent);
  const activePlayer       = useGameStore(s => s.activePlayer);
  const multiplayerMode    = useGameStore(s => s.multiplayerMode);
  const setCatalogLoaded   = useGameStore(s => s.setCatalogLoaded);
  const loadGame           = useGameStore(s => s.loadGame);
  const resetGame          = useGameStore(s => s.resetGame);
  const enterLobby         = useGameStore(s => s.enterLobby);
  const loadFromServerState = useGameStore(s => s.loadFromServerState);
  const applyOpponentDrew  = useGameStore(s => s.applyOpponentDrew);
  const drawFateCard       = useGameStore(s => s.drawFateCard);

  // ── Load card catalog once ──────────────────────────────────────────────────
  useEffect(() => {
    loadCatalog()
      .then(() => setCatalogLoaded(true))
      .catch(err => console.error('Failed to load card catalog:', err));
  }, [setCatalogLoaded]);

  // ── Multiplayer callbacks ───────────────────────────────────────────────────
  const handleGameReady = useCallback((payload: GameReadyPayload) => {
    const { ownState, opponentInfo, playerIndex, firstPlayerIndex } = payload;

    // Reconstruct a minimal PlayerState for the opponent from OpponentInfo.
    // Hand cards are unknown; we create placeholder face-down instances.
    const opponentState: PlayerState = {
      stronghold: opponentInfo.stronghold,
      sensei: opponentInfo.sensei,
      familyHonor: opponentInfo.familyHonor,
      strongholdGoldProduction: opponentInfo.strongholdGoldProduction,
      provinceStrength: opponentInfo.provinceStrength,
      hand: Array.from({ length: opponentInfo.handCount }, (_, i) => ({
        instanceId: `opp-hand-${i}`,
        cardId: 'unknown',
        card: ownState.fateDeck[0]?.card ?? ownState.hand[0]?.card ?? null as never,
        bowed: false,
        faceUp: false,
        location: 'hand' as const,
        attachments: [],
        fateTokens: 0,
        honorTokens: 0,
        tempForceBonus: 0,
        dishonored: false,
      })),
      fateDeck: Array.from({ length: opponentInfo.fateDeckCount }, (_, i) => ({
        instanceId: `opp-fate-${i}`,
        cardId: 'unknown',
        card: null as never,
        bowed: false,
        faceUp: false,
        location: 'fateDeck' as const,
        attachments: [],
        fateTokens: 0,
        honorTokens: 0,
        tempForceBonus: 0,
        dishonored: false,
      })),
      dynastyDeck: Array.from({ length: opponentInfo.dynastyDeckCount }, (_, i) => ({
        instanceId: `opp-dynasty-${i}`,
        cardId: 'unknown',
        card: null as never,
        bowed: false,
        faceUp: false,
        location: 'dynastyDeck' as const,
        attachments: [],
        fateTokens: 0,
        honorTokens: 0,
        tempForceBonus: 0,
        dishonored: false,
      })),
      fateDiscard: [],
      dynastyDiscard: [],
      provinces: opponentInfo.provinces,
      personalitiesHome: opponentInfo.personalitiesHome,
      holdingsInPlay: opponentInfo.holdingsInPlay,
      specialsInPlay: opponentInfo.specialsInPlay,
      goldPool: opponentInfo.goldPool,
      strongholdBowed: opponentInfo.strongholdBowed,
      proclaimUsed: false,
      cyclingDone: false,
      abilitiesUsed: [],
      oncePerGameAbilitiesUsed: [],
      honorablyDead: opponentInfo.honorablyDead,
      dishonorablelyDead: opponentInfo.dishonorablelyDead,
    };

    loadFromServerState(ownState, opponentState, firstPlayerIndex, playerIndex);
  }, [loadFromServerState]);

  const handleDrawResult = useCallback((_card: CardInstance) => {
    // Server has decided which card we drew — apply it locally.
    // drawFateCard pops from the local fate deck (kept in sync with server's deck order).
    drawFateCard('player');
  }, [drawFateCard]);

  const handleOpponentDrew = useCallback((_payload: OpponentDrewPayload) => {
    applyOpponentDrew();
  }, [applyOpponentDrew]);

  const handleGameAction = useCallback((payload: RelayedActionPayload) => {
    // Actions from the opponent or relayed back to us are applied via the store.
    // For actions originating from this client (fromIndex === myPlayerIndex),
    // they were already applied locally — skip to avoid double-apply.
    const myIndex = useGameStore.getState().myPlayerIndex;
    if (payload.fromIndex === myIndex) return; // already applied locally

    // Apply the opponent's action to local state.
    // This is the relay: we mirror the opponent's action on our store.
    applyRelayedAction(payload.action);
  }, []);

  const handleOpponentDisconnected = useCallback(() => {
    console.warn('[mp] Opponent disconnected');
  }, []);

  const handleOpponentReconnected = useCallback(() => {
    console.log('[mp] Opponent reconnected');
  }, []);

  const handleReconnectOk = useCallback((payload: import('../server/src/types').ReconnectOkPayload) => {
    handleGameReady({
      playerIndex: payload.playerIndex,
      firstPlayerIndex: payload.firstPlayerIndex!,
      ownState: payload.ownState,
      opponentInfo: payload.opponentInfo,
    });
  }, [handleGameReady]);

  const mp = useMultiplayer({
    onGameReady: handleGameReady,
    onDrawResult: handleDrawResult,
    onOpponentDrew: handleOpponentDrew,
    onGameAction: handleGameAction,
    onOpponentDisconnected: handleOpponentDisconnected,
    onOpponentReconnected: handleOpponentReconnected,
    onReconnectOk: handleReconnectOk,
  });

  // ── Register relay callback when multiplayer is active ─────────────────────
  // The store's relay() helper calls this fn to forward local actions to the server.
  useEffect(() => {
    const store = useGameStore.getState();
    if (multiplayerMode) {
      store.setRelayCallback(mp.sendAction);
    } else {
      store.setRelayCallback(null);
    }
  }, [multiplayerMode, mp.sendAction]);

  // ── Route from URL (?room=) ─────────────────────────────────────────────────
  const urlRoomCode = getRoomCodeFromUrl();
  useEffect(() => {
    if (urlRoomCode && phase === 'setup') {
      enterLobby();
    }
  }, []); // run once on mount

  // ── Solo game load ──────────────────────────────────────────────────────────
  function handleLoad(deck: ParsedDeck) {
    loadGame(deck);
  }

  // ── Reset (works for both solo and multiplayer) ─────────────────────────────
  function handleReset() {
    mp.leave();
    resetGame();
  }

  // ── Relay local actions to server in multiplayer ────────────────────────────
  // This is done by the Board and sub-components via sendAction when multiplayerMode is true.
  // We expose mp.sendAction via context or prop drilling.

  return (
    <div className="min-h-screen bg-board-bg">
      {phase === 'setup' && (
        <DeckInput
          onLoad={handleLoad}
          onEnterMultiplayer={enterLobby}
        />
      )}
      {phase === 'lobby' && (
        <MultiplayerLobby
          status={mp.status}
          shareUrl={mp.shareUrl}
          roomId={mp.roomId}
          error={mp.error}
          initialRoomCode={urlRoomCode}
          onCreateRoom={mp.createRoom}
          onJoinRoom={mp.joinRoom}
          onBack={() => { mp.leave(); resetGame(); }}
        />
      )}
      {phase === 'playing' && (
        <Board
          player={player}
          opponent={opponent}
          activePlayer={activePlayer}
          onReset={handleReset}
          multiplayerMode={multiplayerMode}
          sendAction={multiplayerMode ? mp.sendAction : undefined}
        />
      )}
    </div>
  );
}

// ─── Apply a relayed opponent action to the local Zustand store ───────────────
// Suppress relay while applying so we don't echo the action back.
function applyRelayedAction(action: import('../server/src/types').SerializedAction) {
  suppressRelay();
  try {
    const store = useGameStore.getState();

    switch (action.type) {
      case 'bow-card':
        store.bowCard(action.instanceId, action.target === 'player' ? 'opponent' : 'player');
        break;
      case 'bow-stronghold':
        store.bowStronghold(action.target === 'player' ? 'opponent' : 'player');
        break;
      case 'advance-phase':
        store.advancePhase();
        break;
      case 'pass-priority':
        store.opponentAutoPass();
        break;
      case 'recruit':
        store.recruitFromProvince(action.provinceIndex, 'opponent', {
          discount: false,
          proclaim: action.proclaim,
        });
        break;
      case 'discard-province':
        store.discardFromProvince(action.provinceIndex, 'opponent');
        break;
      case 'discard-from-hand':
        store.discardHandCard(action.instanceId, 'opponent');
        break;
      case 'declare-battle':
        store.declareBattle();
        break;
      case 'assign-attacker':
        store.assignToBattlefield(action.instanceId, action.provinceIndex);
        break;
      case 'unassign-attacker':
        store.unassignFromBattle(action.instanceId);
        break;
      case 'assign-defender':
        store.assignDefender(action.instanceId, action.provinceIndex);
        break;
      case 'pass-battle':
        store.passBattlefieldAction(action.side === 'player' ? 'opponent' : 'player');
        break;
      case 'commit-infantry':
        store.beginResolution();
        break;
      case 'commit-defenders':
        store.commitDefenders();
        break;
      case 'commit-cavalry':
        store.commitCavalry();
        break;
      case 'commit-defender-cavalry':
        store.commitDefenderCavalry();
        break;
      case 'end-attack-phase':
        store.endAttackPhase();
        break;
      case 'play-from-hand':
        store.playFromHand(action.instanceId, 'opponent', action.targetId, action.abilityText);
        break;
      case 'commit-cycling':
        store.commitCycling(action.selectedIndices, 'opponent');
        break;
      case 'start-cycling':
        store.startCycling('opponent');
        break;
      case 'border-keep-cycle':
        store.borderKeepCycle(action.holdingInstanceId);
        break;
      case 'dishonor-personality':
        store.dishonorPersonality(
          action.instanceId,
          action.target === 'player' ? 'opponent' : 'player',
        );
        break;
      case 'use-kharmic':
        store.useKharmic(action.source, action.instanceId, 'opponent', action.provinceIndex);
        break;
      case 'lobby':
        store.lobby(action.personalityId, 'opponent');
        break;
      case 'use-favor-limited':
        store.useFavorLimited(action.discardCardInstanceId, 'opponent');
        break;
      case 'use-favor-battle':
        store.useFavorBattle(action.targetPersonalityId, 'opponent');
        break;
      case 'tactical-advantage':
        store.useTacticalAdvantage(action.personalityId, action.handCardInstanceId, 'opponent');
        break;
      case 'play-discipline':
        store.playDiscipline(action.fateDiscardInstanceId, action.attachTargetId, 'opponent');
        break;
      case 'add-token':
        store.addToken(action.instanceId, action.token, 'opponent');
        break;
      case 'remove-token':
        store.removeToken(action.instanceId, action.tokenId, 'opponent');
        break;
      case 'transfer-token':
        store.transferToken(action.fromInstanceId, action.toInstanceId, action.tokenId, 'opponent');
        break;
      case 'destroy-card':
        store.destroyCard(action.instanceId, 'opponent');
        break;
      case 'discard-from-play':
        store.discardFromPlay(action.instanceId, 'opponent');
        break;
      case 'remove-from-game':
        store.removeFromGame(action.instanceId, 'opponent');
        break;
      case 'draw-fate-cards':
        store.drawFateCards(action.count, 'opponent');
        break;
      case 'unbow-card':
        store.unbowCard(action.instanceId, 'opponent');
        break;
      case 'give-force-bonus':
        store.giveForceBonus(action.instanceId, action.amount, 'opponent');
        break;
      case 'move-home':
        store.moveHome(action.instanceId, 'opponent');
        break;
      case 'give-keyword':
        store.giveKeyword(action.instanceId, action.keyword, 'opponent');
        break;
      case 'remove-keyword':
        store.removeKeyword(action.instanceId, action.keyword, 'opponent');
        break;
      case 'bring-into-play':
        store.bringIntoPlay(action.instanceId, 'opponent', action.attachTargetId);
        break;
      case 'rehonor-personality':
        store.rehonorPersonality(action.instanceId, 'opponent');
        break;
      case 'give-chi-bonus':
        store.giveChiBonus(action.instanceId, action.amount, 'opponent');
        break;
      case 'return-to-hand':
        store.returnToHand(action.instanceId, 'opponent');
        break;
      case 'produce-gold':
        store.produceGold(action.amount, 'opponent');
        break;
      case 'duel-accept':
        store.acceptDuel();
        break;
      case 'duel-refuse':
        store.refuseDuel();
        break;
      case 'duel-focus-card':
        store.opponentFocusCard(action.focusValue, action.faceDown, action.instanceId, action.cardName);
        break;
      case 'duel-pass-focus':
        store.opponentPassFocus();
        break;
      default:
        // For unrecognized actions, do nothing — manual resolution handles complex effects
        break;
    }
  } finally {
    unsuppressRelay();
  }
}

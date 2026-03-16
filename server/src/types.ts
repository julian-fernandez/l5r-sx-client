import type { CardInstance, PlayerState } from '../../src/types/cards.js';

// ─── Room types ───────────────────────────────────────────────────────────────

export interface ConnectedPlayer {
  socketId: string;
  /** Stored in sessionStorage on the client; used to reclaim a slot on reconnect. */
  playerId: string;
  index: 0 | 1;
  deckString: string;
  connected: boolean;
}

export interface ServerDeckState {
  /** Remaining fate cards in server-authoritative order. */
  fateDeck: CardInstance[];
  /** Remaining dynasty cards in server-authoritative order. */
  dynastyDeck: CardInstance[];
}

export interface Room {
  id: string;
  players: ConnectedPlayer[];
  /** Server-side deck stacks (source of truth for draws). */
  deckStates: [ServerDeckState, ServerDeckState] | null;
  /** Snapshot of each player's full state for reconnection. */
  playerStates: [PlayerState, PlayerState] | null;
  /** Index (0 or 1) of the player who takes the first turn. */
  firstPlayerIndex: 0 | 1 | null;
  createdAt: number;
}

// ─── Socket event payloads ────────────────────────────────────────────────────

// Client → Server
export interface CreateRoomPayload {
  deckString: string;
}

export interface JoinRoomPayload {
  roomId: string;
  deckString: string;
}

export interface GameActionPayload {
  roomId: string;
  playerId: string;
  action: SerializedAction;
}

export interface ReconnectPayload {
  roomId: string;
  playerId: string;
}

export interface DrawFateCardPayload {
  roomId: string;
  playerId: string;
}

export interface SyncStatePayload {
  roomId: string;
  playerId: string;
  /** Full snapshot of this player's current state (for reconnection save). */
  state: PlayerState;
}

// Server → Client
export interface RoomCreatedPayload {
  roomId: string;
  playerId: string;
  shareUrl: string;
}

export interface GameReadyPayload {
  playerIndex: 0 | 1;
  firstPlayerIndex: 0 | 1;
  ownState: PlayerState;
  /** Opponent info without hidden data (hand is an array of nulls, decks are counts). */
  opponentInfo: OpponentInfo;
}

export interface OpponentInfo {
  stronghold: PlayerState['stronghold'];
  sensei: PlayerState['sensei'];
  familyHonor: number;
  strongholdGoldProduction: number;
  provinceStrength: number;
  handCount: number;
  fateDeckCount: number;
  dynastyDeckCount: number;
  fateDiscardCount: number;
  dynastyDiscardCount: number;
  provinces: PlayerState['provinces'];
  holdingsInPlay: PlayerState['holdingsInPlay'];
  personalitiesHome: PlayerState['personalitiesHome'];
  specialsInPlay: PlayerState['specialsInPlay'];
  honorablyDead: PlayerState['honorablyDead'];
  dishonorablelyDead: PlayerState['dishonorablelyDead'];
  goldPool: number;
  strongholdBowed: boolean;
}

export interface DrawResultPayload {
  card: CardInstance;
}

export interface OpponentDrewPayload {
  newHandCount: number;
  newDeckCount: number;
}

export interface RelayedActionPayload {
  action: SerializedAction;
  fromIndex: 0 | 1;
}

export interface ReconnectOkPayload {
  playerIndex: 0 | 1;
  firstPlayerIndex: 0 | 1;
  ownState: PlayerState;
  opponentInfo: OpponentInfo;
}

export interface ErrorPayload {
  message: string;
}

// ─── Serialized game actions ──────────────────────────────────────────────────

/**
 * Discriminated union of all game actions that travel over the wire.
 * The client emits these; the server relays them (or handles draw specially).
 */
export type SerializedAction =
  | { type: 'bow-card';          instanceId: string; target: 'player' | 'opponent' }
  | { type: 'bow-stronghold';    target: 'player' | 'opponent' }
  | { type: 'draw-fate';         target: 'player' | 'opponent' }
  | { type: 'advance-phase' }
  | { type: 'recruit';           provinceIndex: number; proclaim: boolean }
  | { type: 'discard-province';  provinceIndex: number }
  | { type: 'discard-from-hand'; instanceId: string }
  | { type: 'play-from-hand';    instanceId: string; targetId?: string; abilityText?: string }
  | { type: 'declare-battle' }
  | { type: 'assign-attacker';   instanceId: string; provinceIndex: number }
  | { type: 'unassign-attacker'; instanceId: string }
  | { type: 'assign-defender';   instanceId: string; provinceIndex: number }
  | { type: 'pass-battle';       side: 'player' | 'opponent' }
  | { type: 'end-attack-phase' }
  | { type: 'start-cycling' }
  | { type: 'toggle-cycle-province'; provinceIndex: number }
  | { type: 'end-cycling' }
  | { type: 'commit-cycling'; selectedIndices: number[] }
  | { type: 'border-keep-cycle'; holdingInstanceId: string }
  | { type: 'play-ring-permanent'; instanceId: string }
  | { type: 'dishonor-personality'; instanceId: string; target: 'player' | 'opponent' }
  | { type: 'use-holding-ability'; instanceId: string }
  | { type: 'apply-battle-keyword'; sourceId: string; targetId: string; kwType: string; value: number }
  | { type: 'activate-tactician'; personalityId: string; fateCardId: string }
  | { type: 'reserve-recruit';   provinceIndex: number; sourcePersonalityId: string }
  | { type: 'commit-infantry' }
  | { type: 'commit-defenders' }
  | { type: 'commit-cavalry' }
  | { type: 'commit-defender-cavalry' }
  | { type: 'pass-priority' }
  | { type: 'use-kharmic'; source: 'hand' | 'province'; instanceId: string; provinceIndex?: number }
  | { type: 'lobby'; personalityId: string }
  | { type: 'use-favor-limited'; discardCardInstanceId: string }
  | { type: 'use-favor-battle'; targetPersonalityId: string }
  | { type: 'tactical-advantage'; personalityId: string; handCardInstanceId: string }
  | { type: 'play-discipline'; fateDiscardInstanceId: string; attachTargetId?: string }
  | { type: 'add-token'; instanceId: string; token: { id: string; label: string; force?: number; chi?: number; keywords?: string[] } }
  | { type: 'remove-token'; instanceId: string; tokenId: string }
  | { type: 'transfer-token'; fromInstanceId: string; toInstanceId: string; tokenId: string }
  | { type: 'destroy-card'; instanceId: string }
  | { type: 'discard-from-play'; instanceId: string }
  | { type: 'remove-from-game'; instanceId: string }
  | { type: 'draw-fate-cards'; count: number }
  | { type: 'unbow-card'; instanceId: string }
  | { type: 'give-force-bonus'; instanceId: string; amount: number }
  | { type: 'move-home'; instanceId: string }
  | { type: 'give-keyword'; instanceId: string; keyword: string }
  | { type: 'remove-keyword'; instanceId: string; keyword: string }
  | { type: 'bring-into-play'; instanceId: string; attachTargetId?: string }
  | { type: 'rehonor-personality'; instanceId: string }
  | { type: 'give-chi-bonus'; instanceId: string; amount: number }
  | { type: 'return-to-hand'; instanceId: string }
  | { type: 'produce-gold'; amount: number }
  | { type: 'duel-accept' }
  | { type: 'duel-refuse' }
  | { type: 'duel-focus-card'; instanceId: string; focusValue: number; faceDown: boolean; cardName: string }
  | { type: 'duel-pass-focus' }
  | { type: 'sync-state' } // client asks server to snapshot their state
  ;

export type GameStatus = 'lobby' | 'selecting_word' | 'drawing' | 'round_end' | 'game_over';

export type WordDifficulty = 'easy' | 'medium' | 'hard';

export type WordCategory = 'all' | 'animals' | 'food' | 'objects' | 'places' | 'actions' | 'pop_culture';

export type ArcadeGameMode =
  | 'multiplayer_draw'
  | 'uno_party'
  | 'ai_sketch_guess'
  | 'trivia_dash'
  | 'bugtong_bugtong'
  | 'four_pics_one_word'
  | 'anagram_rush'
  | 'emoji_charades'
  | 'speed_duel'
  | 'memory_rush'
  | 'bomb_chain'
  | 'spelling_bee'
  | 'pixel_reveal'
  | 'blindfold_maestro'
  | 'sound_mystery'
  | 'reflex_neon'
  | 'color_clash'
  | 'cyber_typing'
  | 'simon_sequence'
  | 'math_sprint'
  | 'emoji_match'
  | 'whack_doodle'
  | 'tower_stack'
  | 'chess_game'
  | 'ngip_mega_wheel'
  | 'ngip_vault_hacker'
  | 'lucky_9';

export type GameSkinId = 'classic' | 'uno_neon' | 'cyber_gold';

export interface UserCosmetics {
  owned: GameSkinId[];
  equipped: Partial<Record<ArcadeGameMode, GameSkinId>>;
  ownedUntil?: Partial<Record<GameSkinId, number>>;
}

// Currency Types (GW 4 Gems: Diamond, Amethyst, Jade, Ruby)
export type CurrencyType = 'diamond' | 'amethyst' | 'jade' | 'ruby';

export interface UserWallet {
  diamonds: string; // BigInt strings to support 1,000,000,000,000,000,000,000+
  amethysts: string;
  jades: string;
  rubies: string;
}

export interface BettingConfig {
  enabled: boolean;
  currency: CurrencyType;
  amount: string; // Bet per player as BigInt string
  totalPot: string; // Accumulated pot for the winner
}

export interface WordChoice {
  word: string;
  difficulty: WordDifficulty;
  points: number;
  category: string;
  hint?: string;
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  losses?: number;
  totalScore: number;
  wordsGuessed: number;
  drawingsCompleted: number;
  highestRoundScore: number;
  fastestGuessSec?: number;
  aiDrawsBeaten?: number;
  emojiPuzzlesSolved?: number;
  memoryStarsEarned?: number;
  duelsWon?: number;
  bombsDefused?: number;
  pixelsGuessed?: number;
  blindfoldScores?: number;
  unoWins?: number;
  unoCardsPlayed?: number;
  soundsIdentified?: number;
  reflexCombosHit?: number;
  lucky9Wins?: number;
  currentStreak?: number;
  bestStreak?: number;
}

export interface Player {
  id: string;
  socketId?: string;
  username: string;
  avatar: string;
  color: string;
  isHost: boolean;
  isDrawing: boolean;
  hasGuessed: boolean;
  score: number;
  roundScore: number;
  guessTime?: number; // seconds elapsed when guessed
  streak: number;
  isConnected: boolean;
  stats?: PlayerStats;
  wallet?: UserWallet;
  isNgip?: boolean;
  cosmetics?: UserCosmetics;
}

export type UnoTeamMode = 'ffa' | '2v2' | '3v3' | '4v4' | '5v5';
export type UnoTeam = 'red' | 'blue';

export interface RoomSettings {
  gameMode?: ArcadeGameMode;
  unoTeamMode?: UnoTeamMode;
  roundDuration: number; // 30, 45, 60, 80, 90
  maxRounds: number; // 2, 3, 5, 7
  maxPlayers: number; // 2 to 10
  wordCategory: WordCategory;
  customWords: string[];
  isPrivate: boolean;
  allowHints: boolean;
  botPlayersEnabled?: boolean;
  betting?: BettingConfig;
}

export interface RoomSummary {
  id: string;
  name: string;
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: GameStatus;
  isPrivate: boolean;
  roundDuration: number;
  currentRound: number;
  maxRounds: number;
  gameMode?: ArcadeGameMode;
  betting?: BettingConfig;
}

export interface DrawPoint {
  x: number; // 0 to 1000 scale
  y: number; // 0 to 1000 scale
}

export interface StrokeData {
  id: string;
  type: 'stroke';
  color: string;
  size: number;
  points: DrawPoint[];
}

export interface FillData {
  id: string;
  type: 'fill';
  color: string;
  x: number;
  y: number;
}

export interface ClearData {
  id: string;
  type: 'clear';
}

export type CanvasAction = StrokeData | FillData | ClearData;

export type MessageType = 
  | 'chat' 
  | 'system' 
  | 'correct_guess' 
  | 'close_guess' 
  | 'drawer_turn' 
  | 'reaction' 
  | 'word_reveal'
  | 'bet_won';

export interface MessageReaction {
  emoji: string;
  count: number;
  users: { userId: string; username: string }[];
}

export interface ChatMessage {
  id: string;
  senderId?: string;
  senderName: string;
  senderColor?: string;
  senderAvatar?: string;
  isNgip?: boolean;
  text: string;
  type: MessageType;
  timestamp: number;
  pointsAwarded?: number;
  rewardText?: string;
  reactions?: Record<string, string[]>; // emoji -> array of userIds
  scope?: 'room' | 'global';
  profile?: ChatProfile;
}

export interface ChatProfile {
  id: string;
  username: string;
  avatar: string;
  color?: string;
  stats: Pick<PlayerStats, 'gamesPlayed' | 'wins' | 'losses' | 'totalScore'>;
  isNgip?: boolean;
}

export interface DailyMission {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'play' | 'win' | 'chat' | 'arcade' | 'social';
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
  reward: {
    diamonds?: string;
    amethysts?: string;
    jades?: string;
    rubies?: string;
    xp: number;
  };
}

export interface GameChessSnapshot {
  board: Array<Array<{ type: string; color: 'w' | 'b' } | null>>;
  turn: 'w' | 'b';
  winner: 'w' | 'b' | null;
  gameState: 'playing' | 'checkmate' | 'draw' | 'king_lost';
  lastMove: { from: string; to: string } | null;
  moveHistory: Array<{ from: string; to: string; piece: { type: string; color: 'w' | 'b' }; captured?: { type: string; color: 'w' | 'b' } | null; notation: string }>;
  capturedByWhite: Array<{ type: string; color: 'w' | 'b' }>;
  capturedByBlack: Array<{ type: string; color: 'w' | 'b' }>;
}

export interface GameState {
  roomId: string;
  roomCode: string;
  roomName: string;
  status: GameStatus;
  currentRound: number;
  totalRounds: number;
  drawerId: string | null;
  drawerName: string | null;
  word: string; // blanked out for guessers during drawing
  wordLength: number;
  revealedIndices: number[];
  hint: string;
  wordChoices: WordChoice[];
  timeLeft: number;
  totalTime: number;
  players: Player[];
  settings: RoomSettings;
  winner?: Player | null;
  chess?: GameChessSnapshot;
  roundSummary?: {
    word: string;
    drawerBonus: number;
    correctGuessers: { playerId: string; name: string; scoreGained: number; time: number }[];
  };
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatar: string;
  score: number;
  wins: number;
  losses?: number;
  gamesPlayed: number;
  wordsGuessed: number;
  rank: number;
  winRate: number;
  lastActive: string;
  level: number;
  wallet?: UserWallet;
  isNgip?: boolean;
}

export interface PlayerActivity {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  type: 'match_win' | 'level_up' | 'high_score' | 'wager_won' | 'badge_unlocked' | 'game_played';
  title: string;
  description: string;
  gameMode?: string;
  pointsEarned?: number;
  currencyEarned?: {
    currency: CurrencyType;
    amount: string;
  };
  timestamp: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  avatar: string;
  color: string;
  bio?: string;
  createdAt: string;
  stats: PlayerStats;
  level: number;
  xp: number;
  unlockedBadges: string[];
  isAdmin?: boolean;
  isNgip?: boolean;
  darkMode?: boolean;
  recentActivities?: PlayerActivity[];
  wallet?: UserWallet;
  lastNgipSalaryClaim?: string;
  cosmetics?: UserCosmetics;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL?: string;
}

export type LeaderboardTimeframe = 'all-time' | 'weekly' | 'wins';

// Emoji Charades Types
export interface EmojiPuzzle {
  id: string;
  emojis: string[];
  answer: string;
  category: 'Movies' | 'Food' | 'Idioms' | 'Pop Culture' | 'Animals' | 'Video Games' | 'Places';
  difficulty: 'easy' | 'medium' | 'hard';
  hint: string;
  points: number;
}

// Memory Rush Types
export interface MemorySceneItem {
  name: string;
  color: string;
  shape: 'circle' | 'rect' | 'triangle' | 'star' | 'cloud' | 'tree' | 'sun' | 'house';
  x: number;
  y: number;
  size: number;
}

export interface MemoryScene {
  id: string;
  title: string;
  theme: string;
  items: MemorySceneItem[];
  backgroundColor: string;
  targetCount: number;
}

// Lucky 9 (1v1 Card Game) Types
export type Lucky9Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds';

export interface Lucky9Card {
  id: string;
  suit: Lucky9Suit;
  rank: string; // 'A', '2'-'10', 'J', 'Q', 'K'
  value: number; // Ace=1, 2-9=face value, 10/J/Q/K=0
  isRevealed?: boolean;
}

export type Lucky9RoundStatus =
  | 'waiting_for_opponent'
  | 'betting'
  | 'dealing'
  | 'player_turn'
  | 'opponent_turn'
  | 'evaluating'
  | 'round_over';

export interface Lucky9PlayerState {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  cards: Lucky9Card[];
  score: number; // 0 - 9
  bet: number;
  coins: number;
  hasHit: boolean;
  hasStood: boolean;
  isNatural: boolean;
  naturalType?: 'natural_9' | 'natural_8';
}

export interface Lucky9GameState {
  status: Lucky9RoundStatus;
  currentTurnPlayerId: string | null;
  pot: number;
  bankerMessage: string;
  winnerId: string | null | 'tie';
  winnerMessage: string | null;
  roundNumber: number;
}

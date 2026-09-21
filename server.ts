import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import {
  GameState,
  Player,
  RoomSettings,
  RoomSummary,
  CanvasAction,
  ChatMessage,
  LeaderboardEntry,
  WordChoice,
  UserProfile,
  ChatProfile,
  ArcadeGameMode,
  Lucky9Card,
  Lucky9Suit,
  Lucky9RoundStatus,
} from './src/types';
import { getRandomWordChoices } from './src/data/words';
import {
  DUEL_PROMPTS,
  TRIVIA_QUESTIONS,
  ANAGRAM_PUZZLES,
  TriviaQuestion,
  AnagramPuzzle,
} from './src/data/arcadeData';
import { isValidEnglishWord, SYLLABLE_PROMPTS } from './src/utils/dictionary';
import { EMOJI_PUZZLES } from './src/data/emojiPuzzles';
import { BUGTONG_QUESTIONS, BugtongQuestion } from './src/data/bugtongData';
import { FOUR_PICS_PUZZLES, FourPicsPuzzle } from './src/data/fourPicsData';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.json());

// Initialize Firebase Admin if credentials provided
let firestore: Firestore | null = null;
try {
  // If GOOGLE_APPLICATION_CREDENTIALS is set, the default credential provider works.
  // Otherwise, if a JSON string is provided in FIREBASE_SERVICE_ACCOUNT_JSON, initialize from that.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    initializeApp({
      credential: applicationDefault(),
    });
    firestore = getFirestore();
    console.log('[Firebase] Initialized via GOOGLE_APPLICATION_CREDENTIALS file.');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({
      credential: cert(svc),
    });
    firestore = getFirestore();
    console.log('[Firebase] Initialized via FIREBASE_SERVICE_ACCOUNT_JSON env var.');
  } else {
    console.log('[Firebase] GOOGLE_APPLICATION_CREDENTIALS not set — running in in-memory-only mode.');
  }
} catch (err) {
  console.error('[Firebase] Initialization error:', err);
  firestore = null;
}

// In-Memory Database for Global Persistence (fallback)
interface GlobalStatsStore {
  leaderboard: LeaderboardEntry[];
  users: Map<string, UserProfile>;
}

const GLOBAL_STORE: GlobalStatsStore = {
  leaderboard: [],
  users: new Map<string, UserProfile>(),
};

// Rooms Registry
export type UnoColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
export type UnoType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
export type UnoTeamMode = 'ffa' | '2v2' | '3v3' | '4v4' | '5v5';
export type UnoTeam = 'red' | 'blue';

export interface UnoCard {
  id: string;
  color: UnoColor;
  type: UnoType;
  value: number | null; // 0-9
  score: number;
}

export interface ServerUnoGame {
  deck: UnoCard[];
  discardPile: UnoCard[];
  activeColor: UnoColor;
  currentTurnPlayerId: string;
  direction: 1 | -1;
  playerHands: Map<string, UnoCard[]>;
  playerTeams: Map<string, UnoTeam>;
  teamMode: UnoTeamMode;
  calledUno: Set<string>;
  historyLog: { text: string; color: string }[];
  cardsPlayed: number;
  winner?: { id: string; name: string; avatar: string } | null;
  winningTeam?: UnoTeam | null;
  finalScore?: number;
  status: 'playing' | 'game_over';
}

export interface ServerTriviaGame {
  questions: TriviaQuestion[];
  currentIndex: number;
  timeLeft: number;
  playerScores: Map<string, number>;
  playerStreaks: Map<string, number>;
  playerAnswers: Map<string, { optionIndex: number; isCorrect: boolean; points: number }>;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'round_end' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
  finalScores?: Array<{ id: string; name: string; avatar: string; score: number }>;
}

interface ServerBugtongGame {
  questions: BugtongQuestion[];
  currentIndex: number;
  timeLeft: number;
  playerScores: Map<string, number>;
  playerCorrectCounts: Map<string, number>;
  playerAnswers: Map<string, { optionIndex: number; isCorrect: boolean; points: number }>;
  playerTeams: Map<string, 'red' | 'blue'>;
  teamScores: { red: number; blue: number };
  teamMode: UnoTeamMode;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'round_end' | 'game_over';
  winner?: { id: string; name: string; avatar: string; score: number } | null;
}

interface ServerFourPicsGame {
  puzzles: FourPicsPuzzle[];
  currentIndex: number;
  timeLeft: number;
  activeAnswererId: string | null;
  scores: Map<string, number>;
  correctCounts: Map<string, number>;
  answers: Map<string, { answer: string; correct: boolean; points: number }>;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'round_end' | 'game_over';
  winner?: { id: string; name: string; score: number } | null;
}

interface PexelsPhotoSearchResponse {
  photos?: Array<{ src?: { large2x?: string; large?: string; medium?: string } }>;
}

export interface ServerBombGame {
  prompt: string;
  timeLeft: number;
  totalTime: number;
  currentTurnPlayerId: string;
  usedWords: string[];
  playerLives: Map<string, number>;
  playerScores: Map<string, number>;
  defusedCount: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'exploded' | 'victory';
  winner?: { id: string; name: string; avatar: string } | null;
}

export interface ServerDuelGame {
  topic: string;
  timeLeft: number;
  phase: 'dueling' | 'judging' | 'results';
  playerSubmissions: Map<string, { strokeCount: number; detailScore: number }>;
  timerInterval?: NodeJS.Timeout;
  winner?: { id: string; name: string; avatar: string } | null;
  finalResults?: { player1: any; player2: any; winnerId: string | null };
}

export interface ServerAnagramGame {
  puzzles: AnagramPuzzle[];
  currentIndex: number;
  scrambledLetters: string[];
  playerScores: Map<string, number>;
  playerStreaks: Map<string, number>;
  timeLeft: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
  history: Array<{ word: string; solvedBy: string; points: number }>;
}

export interface ServerEmojiGame {
  puzzles: any[];
  currentIndex: number;
  playerScores: Map<string, number>;
  timeLeft: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
}

interface ServerChessGame {
  board: Array<Array<{ type: string; color: 'w' | 'b' } | null>>;
  turn: 'w' | 'b';
  winner: 'w' | 'b' | null;
  gameState: 'playing' | 'checkmate' | 'draw' | 'king_lost';
  lastMove: { from: string; to: string } | null;
  moveHistory: Array<{ from: string; to: string; piece: { type: string; color: 'w' | 'b' }; captured?: { type: string; color: 'w' | 'b' } | null; notation: string }>;
  capturedByWhite: Array<{ type: string; color: 'w' | 'b' }>;
  capturedByBlack: Array<{ type: string; color: 'w' | 'b' }>;
}

interface ServerArcadeRace {
  mode: ArcadeGameMode;
  status: 'playing' | 'game_over';
  timeLeft: number;
  scores: Map<string, number>;
  finished: Set<string>;
  timerInterval?: NodeJS.Timeout;
}

export interface ServerLucky9Game {
  deck: Lucky9Card[];
  playerHands: Map<string, Lucky9Card[]>;
  bets: Map<string, number>;
  coins: Map<string, number>;
  pot: number;
  currentTurnPlayerId: string | null;
  bankerMessage: string;
  roundNumber: number;
  status: Lucky9RoundStatus;
  winner: string | null | 'tie';
  winnerReason: string | null;
}

interface ServerRoom {
  id: string;
  code: string;
  name: string;
  hostSocketId: string;
  settings: RoomSettings;
  state: GameState;
  drawingHistory: CanvasAction[];
  messages: ChatMessage[];
  timerInterval?: NodeJS.Timeout;
  currentTurnWord: string;
  currentWordPoints: number;
  wordSelected: boolean;
  drawerIndex: number;
  playersWhoGuessed: Set<string>;
  unoGame?: ServerUnoGame;
  triviaGame?: ServerTriviaGame;
  bugtongGame?: ServerBugtongGame;
  fourPicsGame?: ServerFourPicsGame;
  bombGame?: ServerBombGame;
  duelGame?: ServerDuelGame;
  anagramGame?: ServerAnagramGame;
  emojiGame?: ServerEmojiGame;
  chessGame?: ServerChessGame;
  lucky9Game?: ServerLucky9Game;
  arcadeRace?: ServerArcadeRace;
}

const ROOMS = new Map<string, ServerRoom>();
const GLOBAL_CHAT_MESSAGES: ChatMessage[] = [];

function getChatProfile(player: Pick<Player, 'id' | 'username' | 'avatar' | 'color' | 'stats' | 'isNgip'>): ChatProfile {
  return {
    id: player.id,
    username: player.username,
    avatar: player.avatar,
    color: player.color,
    isNgip: player.isNgip,
    stats: {
      gamesPlayed: player.stats?.gamesPlayed || 0,
      wins: player.stats?.wins || 0,
      losses: player.stats?.losses || Math.max(0, (player.stats?.gamesPlayed || 0) - (player.stats?.wins || 0)),
      totalScore: player.stats?.totalScore || 0,
    },
  };
}

function clearRoomMessagesForUser(userId: string, room: ServerRoom) {
  room.messages = room.messages.filter(message => message.senderId !== userId);
  io.to(room.id).emit('chat:messages_cleared', { userId });
}

function clearGlobalMessagesForUser(userId: string) {
  for (let index = GLOBAL_CHAT_MESSAGES.length - 1; index >= 0; index -= 1) {
    if (GLOBAL_CHAT_MESSAGES[index].senderId === userId) GLOBAL_CHAT_MESSAGES.splice(index, 1);
  }
  io.emit('global:messages_cleared', { userId });
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeRoomSettings(settings: Partial<RoomSettings> = {}): RoomSettings {
  const maxPlayers = Math.min(Math.max(Number(settings.maxPlayers) || 8, 2), 10);
  return {
    roundDuration: Number(settings.roundDuration) || 60,
    maxRounds: Number(settings.maxRounds) || 3,
    maxPlayers,
    wordCategory: settings.wordCategory || 'all',
    customWords: Array.isArray(settings.customWords) ? settings.customWords : [],
    isPrivate: Boolean(settings.isPrivate),
    allowHints: settings.allowHints !== false,
    botPlayersEnabled: false,
    betting: settings.betting,
    gameMode: (settings.gameMode || 'multiplayer_draw') as ArcadeGameMode,
  };
}

// Firestore helpers
async function saveRoomToFirestore(room: ServerRoom) {
  if (!firestore) return;
  try {
    const doc = {
      id: room.id,
      code: room.code,
      name: room.name,
      settings: room.settings,
      state: {
        ...room.state,
        // Avoid storing large or circular objects; sanitize players
        players: room.state.players.map(p => ({
          id: p.id,
          username: p.username,
          avatar: p.avatar,
          color: p.color,
          score: p.score,
          isHost: p.isHost,
          isConnected: p.isConnected,
        })),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };
    await firestore.collection('rooms').doc(room.id).set(doc, { merge: true });
  } catch (err) {
    console.error('Failed to save room to Firestore:', err);
  }
}

async function deleteRoomFromFirestore(roomId: string) {
  if (!firestore) return;
  try {
    await firestore.collection('rooms').doc(roomId).delete();
  } catch (err) {
    console.error('Failed to delete room from Firestore:', err);
  }
}

async function saveActivityToFirestore(activity: any) {
  if (!firestore) return;
  try {
    await firestore.collection('activities').add({
      ...activity,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to save activity to Firestore:', err);
  }
}

async function saveLeaderboardEntryToFirestore(entry: LeaderboardEntry) {
  if (!firestore) return;
  try {
    await firestore.collection('leaderboard').doc(entry.userId).set({
      userId: entry.userId,
      username: entry.username,
      avatar: entry.avatar,
      score: entry.score,
      wins: entry.wins,
      gamesPlayed: entry.gamesPlayed,
      wordsGuessed: entry.wordsGuessed,
      rank: entry.rank,
      winRate: entry.winRate,
      level: entry.level,
      lastActive: entry.lastActive,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('Failed to save leaderboard entry to Firestore:', err);
  }
}

function updateGlobalLeaderboard(player: Player, won: boolean) {
  let entry = GLOBAL_STORE.leaderboard.find(e => e.userId === player.id || e.username.toLowerCase() === player.username.toLowerCase());
  
  if (entry) {
    entry.score += player.score;
    entry.gamesPlayed += 1;
    if (won) entry.wins += 1;
    entry.wordsGuessed += (player.stats?.wordsGuessed || 0);
    entry.winRate = Math.round((entry.wins / entry.gamesPlayed) * 100);
    entry.lastActive = 'Just now';
    entry.level = Math.floor(entry.score / 800) + 1;
    entry.avatar = player.avatar || entry.avatar;
  } else {
    entry = {
      userId: player.id,
      username: player.username,
      avatar: player.avatar,
      score: player.score,
      wins: won ? 1 : 0,
      gamesPlayed: 1,
      wordsGuessed: player.stats?.wordsGuessed || 0,
      rank: 0,
      winRate: won ? 100 : 0,
      lastActive: 'Just now',
      level: Math.floor(player.score / 800) + 1,
    };
    GLOBAL_STORE.leaderboard.push(entry);
  }

  // Recalculate ranks
  GLOBAL_STORE.leaderboard.sort((a, b) => b.score - a.score);
  GLOBAL_STORE.leaderboard.forEach((item, index) => {
    item.rank = index + 1;
  });

  // Broadcast updated leaderboard globally
  io.emit('leaderboard:update', GLOBAL_STORE.leaderboard);

  // Persist leaderboard entry for the player
  saveLeaderboardEntryToFirestore(entry).catch(() => {});
}

function getMaskedHint(word: string, revealedIndices: number[]): string {
  return word
    .split('')
    .map((char, index) => {
      if (char === ' ') return '  ';
      if (revealedIndices.includes(index)) return char;
      return '_';
    })
    .join(' ');
}

function sanitizeWordForComparison(w: string): string {
  return w.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

function calculateLevenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => Array(an + 1).fill(0));
  for (let i = 0; i <= an; ++i) matrix[0][i] = i;
  for (let i = 0; i <= bn; ++i) matrix[i][0] = i;
  for (let i = 1; i <= bn; ++i) {
    for (let j = 1; j <= an; ++j) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1) // insertion / deletion
        );
      }
    }
  }
  return matrix[bn][an];
}

function isBotPlayer(player: Player): boolean {
  return typeof player.id === 'string' && player.id.startsWith('bot_');
}

function getConnectedHumanPlayers(room: ServerRoom): Player[] {
  return room.state.players.filter(player => player.isConnected && !isBotPlayer(player));
}

function getPublicRoomsList(): RoomSummary[] {
  const publicRooms: RoomSummary[] = [];
  ROOMS.forEach(room => {
    const activeCount = getConnectedHumanPlayers(room).length;
    // Only return non-private rooms with active players and open slots
    if (!room.settings.isPrivate && room.state.status === 'lobby' && activeCount > 0 && activeCount < room.settings.maxPlayers) {
      publicRooms.push({
        id: room.id,
        name: room.name,
        code: room.code,
        hostName: room.state.players.find(p => p.isHost && p.isConnected)?.username || room.state.players.find(p => p.isConnected)?.username || 'Host',
        playerCount: activeCount,
        maxPlayers: room.settings.maxPlayers,
        status: room.state.status,
        isPrivate: room.settings.isPrivate,
        roundDuration: room.settings.roundDuration,
        currentRound: room.state.currentRound,
        maxRounds: room.state.totalRounds,
        gameMode: room.settings.gameMode,
        betting: room.settings.betting,
      });
    }
  });
  return publicRooms;
}

// ==================== UNO MULTIPLAYER SERVER ENGINE ====================
function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  const colors: UnoColor[] = ['red', 'blue', 'green', 'yellow'];

  colors.forEach((color) => {
    // 1 Zero card per color
    deck.push({
      id: `${color}_0_${Math.random().toString(36).substring(2, 7)}`,
      color,
      type: 'number',
      value: 0,
      score: 0,
    });

    // 2 of each 1-9 per color
    for (let v = 1; v <= 9; v++) {
      deck.push({
        id: `${color}_${v}_a_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'number',
        value: v,
        score: v,
      });
      deck.push({
        id: `${color}_${v}_b_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'number',
        value: v,
        score: v,
      });
    }

    // 2 Skips, 2 Reverses, 2 Draw Twos per color
    for (let i = 0; i < 2; i++) {
      deck.push({
        id: `${color}_skip_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'skip',
        value: null,
        score: 20,
      });
      deck.push({
        id: `${color}_reverse_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'reverse',
        value: null,
        score: 20,
      });
      deck.push({
        id: `${color}_draw2_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'draw2',
        value: null,
        score: 20,
      });
    }
  });

  // 4 Wilds & 4 Wild Draw Fours
  for (let i = 0; i < 4; i++) {
    deck.push({
      id: `wild_${i}_${Math.random().toString(36).substring(2, 7)}`,
      color: 'wild',
      type: 'wild',
      value: null,
      score: 50,
    });
    deck.push({
      id: `wild4_${i}_${Math.random().toString(36).substring(2, 7)}`,
      color: 'wild',
      type: 'wild4',
      value: null,
      score: 50,
    });
  }

  // Shuffle deck using Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function initUnoGame(room: ServerRoom) {
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 2) return;

  const deck = createUnoDeck();
  const playerHands = new Map<string, UnoCard[]>();
  const playerTeams = new Map<string, UnoTeam>();
  const rawTeamMode = room.settings.unoTeamMode || 'ffa';
  const isTeam = ['2v2', '3v3', '4v4', '5v5'].includes(rawTeamMode);
  const teamMode: UnoTeamMode = isTeam ? rawTeamMode : 'ffa';

  // In team mode, assign alternating slots: 0 -> red, 1 -> blue, 2 -> red, 3 -> blue, ...
  activePlayers.forEach((p, idx) => {
    playerHands.set(p.id, deck.splice(0, 7));
    if (isTeam) {
      playerTeams.set(p.id, idx % 2 === 0 ? 'red' : 'blue');
    }
  });

  // Pick top non-wild4 card for discard pile
  let topCard = deck.pop()!;
  while (topCard.type === 'wild4') {
    deck.unshift(topCard);
    topCard = deck.pop()!;
  }

  const startColor: UnoColor = topCard.color === 'wild' ? 'red' : topCard.color;

  room.unoGame = {
    deck,
    discardPile: [topCard],
    activeColor: startColor,
    currentTurnPlayerId: activePlayers[0].id,
    direction: 1,
    playerHands,
    playerTeams,
    teamMode,
    calledUno: new Set<string>(),
    historyLog: [
      {
        text: `Match started! ${isTeam ? `[${teamMode.toUpperCase()} Team Battle] ` : ''}Top card: ${
          topCard.color === 'wild' ? 'Wild' : topCard.color.toUpperCase()
        } ${topCard.type === 'number' ? topCard.value : topCard.type.toUpperCase()}`,
        color: startColor,
      },
    ],
    cardsPlayed: 0,
    winner: null,
    winningTeam: null,
    finalScore: 0,
    status: 'playing',
  };

  const firstTeamLabel = isTeam ? ` [Team ${playerTeams.get(activePlayers[0].id) === 'red' ? 'Red 🔴' : 'Blue 🔵'}]` : '';
  broadcastUnoState(room, `Match started! ${activePlayers[0].username}'s turn${firstTeamLabel}`);
}

function broadcastUnoState(room: ServerRoom, banner?: string) {
  if (!room.unoGame) return;
  const game = room.unoGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const topDiscard = game.discardPile[game.discardPile.length - 1] || null;

  let redTotalCards = 0;
  let blueTotalCards = 0;
  activePlayers.forEach(pl => {
    const tm = game.playerTeams.get(pl.id);
    const count = (game.playerHands.get(pl.id) || []).length;
    if (tm === 'red') redTotalCards += count;
    if (tm === 'blue') blueTotalCards += count;
  });

  activePlayers.forEach(p => {
    const socketId = p.socketId;
    if (!socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const myHand = game.playerHands.get(p.id) || [];
    const playerSummaries = activePlayers.map(pl => ({
      id: pl.id,
      name: pl.username,
      avatar: pl.avatar,
      color: pl.color,
      isBot: pl.id.startsWith('bot_'),
      team: game.playerTeams.get(pl.id) || null,
      cardCount: (game.playerHands.get(pl.id) || []).length,
      calledUno: game.calledUno.has(pl.id),
      cards: pl.id === p.id ? myHand : [],
    }));

    socket.emit('uno:state', {
      players: playerSummaries,
      myCards: myHand,
      myTeam: game.playerTeams.get(p.id) || null,
      teamMode: game.teamMode,
      teamCardCounts: { red: redTotalCards, blue: blueTotalCards },
      discardPile: game.discardPile,
      topDiscard,
      activeColor: game.activeColor,
      currentTurnPlayerId: game.currentTurnPlayerId,
      direction: game.direction,
      deckCount: game.deck.length,
      historyLog: game.historyLog,
      cardsPlayed: game.cardsPlayed,
      actionBanner: banner || null,
      winner: game.winner || null,
      winningTeam: game.winningTeam || null,
      finalScore: game.finalScore || 0,
      status: game.status,
    });
  });
}

function drawCardsFromUnoDeck(room: ServerRoom, playerId: string, count: number): UnoCard[] {
  if (!room.unoGame) return [];
  const game = room.unoGame;
  const drawn: UnoCard[] = [];
  const hand = game.playerHands.get(playerId) || [];

  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      if (game.discardPile.length > 1) {
        const top = game.discardPile[game.discardPile.length - 1];
        const rest = game.discardPile.slice(0, game.discardPile.length - 1);
        game.deck = rest.sort(() => Math.random() - 0.5);
        game.discardPile = [top];
      } else {
        break;
      }
    }
    const card = game.deck.pop();
    if (card) {
      drawn.push(card);
      hand.push(card);
    }
  }

  game.playerHands.set(playerId, hand);
  if (hand.length > 1) {
    game.calledUno.delete(playerId);
  }
  return drawn;
}

// ==================== LUCKY 9 ENGINE ====================
function createServerLucky9Deck(): Lucky9Card[] {
  const suits: Lucky9Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Lucky9Card[] = [];

  suits.forEach(suit => {
    ranks.forEach(rank => {
      let value = 0;
      if (rank === 'A') value = 1;
      else if (['10', 'J', 'Q', 'K'].includes(rank)) value = 0;
      else value = parseInt(rank, 10);

      deck.push({
        id: `${suit}_${rank}_${Math.random().toString(36).substring(2, 7)}`,
        suit,
        rank,
        value,
      });
    });
  });

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function calcServerLucky9Score(cards: Lucky9Card[]): number {
  return cards.reduce((sum, c) => sum + c.value, 0) % 10;
}

function checkServerLucky9Natural(cards: Lucky9Card[]): 'natural_9' | 'natural_8' | null {
  if (cards.length !== 2) return null;
  const score = calcServerLucky9Score(cards);
  if (score === 9) return 'natural_9';
  if (score === 8) return 'natural_8';
  return null;
}

const GLOBAL_LUCKY9_USER_COINS = new Map<string, number>();
const DEFAULT_LUCKY9_COINS = 25000;

function getLucky9UserCoins(userId: string): number {
  if (!GLOBAL_LUCKY9_USER_COINS.has(userId)) {
    GLOBAL_LUCKY9_USER_COINS.set(userId, DEFAULT_LUCKY9_COINS);
  }
  return GLOBAL_LUCKY9_USER_COINS.get(userId)!;
}

function setLucky9UserCoins(userId: string, amount: number) {
  GLOBAL_LUCKY9_USER_COINS.set(userId, Math.max(0, amount));
}

function initLucky9Game(room: ServerRoom) {
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length === 0) return;

  const isWaitingForOpponent = activePlayers.length < 2;
  const deck = createServerLucky9Deck();
  const playerHands = new Map<string, Lucky9Card[]>();
  const bets = new Map<string, number>();
  const coins = room.lucky9Game?.coins || new Map<string, number>();

  activePlayers.forEach(p => {
    playerHands.set(p.id, []);
    const playerCoins = coins.has(p.id) ? (coins.get(p.id) ?? 0) : getLucky9UserCoins(p.id);
    coins.set(p.id, playerCoins);
    setLucky9UserCoins(p.id, playerCoins);

    const prevBet = room.lucky9Game?.bets?.get(p.id) || 1000;
    bets.set(p.id, Math.min(prevBet, playerCoins > 0 ? playerCoins : 0));
  });

  room.lucky9Game = {
    deck,
    playerHands,
    bets,
    coins,
    pot: 0,
    currentTurnPlayerId: null,
    bankerMessage: isWaitingForOpponent
      ? `Banker: Room #${room.code} is open! Waiting for a challenger to take seat at the table. Share room code #${room.code} to begin!`
      : 'Welcome to Lucky 9 1v1! Both players are seated. Stakes are live: place your bets and click Deal to challenge the table!',
    roundNumber: isWaitingForOpponent ? 1 : (room.lucky9Game?.roundNumber || 0) + 1,
    status: isWaitingForOpponent ? ('waiting_for_opponent' as any) : 'betting',
    winner: null,
    winnerReason: null,
  };

  broadcastLucky9State(room);
}

function broadcastLucky9State(room: ServerRoom, banner?: string) {
  if (!room.lucky9Game) return;
  const game = room.lucky9Game;
  const activePlayers = room.state.players.filter(p => p.isConnected);

  activePlayers.forEach(p => {
    const socketId = p.socketId;
    if (!socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const myHand = game.playerHands.get(p.id) || [];
    const isRoundOver = game.status === 'round_over';

    const playerSummaries = activePlayers.map(pl => {
      const plHand = game.playerHands.get(pl.id) || [];
      const isMe = pl.id === p.id;
      const plCoins = game.coins.get(pl.id) ?? getLucky9UserCoins(pl.id);
      return {
        id: pl.id,
        name: pl.username,
        avatar: pl.avatar,
        color: pl.color,
        isBot: pl.id.startsWith('bot_'),
        cardCount: plHand.length,
        bet: game.bets.get(pl.id) || 0,
        coins: plCoins,
        score: calcServerLucky9Score(plHand),
        cards: isMe || isRoundOver ? plHand : plHand.map(c => ({ ...c, isRevealed: false })),
      };
    });

    socket.emit('lucky9:state', {
      players: playerSummaries,
      myCards: myHand,
      pot: game.pot,
      currentTurnPlayerId: game.currentTurnPlayerId,
      bankerMessage: game.bankerMessage,
      roundNumber: game.roundNumber,
      status: game.status,
      winner: game.winner,
      winnerReason: game.winnerReason,
      actionBanner: banner || null,
    });
  });
}

function clearAllRoomTimers(room: ServerRoom) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = undefined;
  }
  if (room.triviaGame?.timerInterval) {
    clearInterval(room.triviaGame.timerInterval);
    room.triviaGame.timerInterval = undefined;
  }
  if (room.bugtongGame?.timerInterval) {
    clearInterval(room.bugtongGame.timerInterval);
    room.bugtongGame.timerInterval = undefined;
  }
  if (room.fourPicsGame?.timerInterval) {
    clearInterval(room.fourPicsGame.timerInterval);
    room.fourPicsGame.timerInterval = undefined;
  }
  if (room.bombGame?.timerInterval) {
    clearInterval(room.bombGame.timerInterval);
    room.bombGame.timerInterval = undefined;
  }
  if (room.duelGame?.timerInterval) {
    clearInterval(room.duelGame.timerInterval);
    room.duelGame.timerInterval = undefined;
  }
  if (room.anagramGame?.timerInterval) {
    clearInterval(room.anagramGame.timerInterval);
    room.anagramGame.timerInterval = undefined;
  }
  if (room.emojiGame?.timerInterval) {
    clearInterval(room.emojiGame.timerInterval);
    room.emojiGame.timerInterval = undefined;
  }
}

// ==================== WORD BOMB MULTIPLAYER SERVER ENGINE ====================
function initBombGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const promptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
  const playerLives = new Map<string, number>();
  const playerScores = new Map<string, number>();

  activePlayers.forEach(p => {
    playerLives.set(p.id, 3);
    playerScores.set(p.id, 0);
  });

  const duration = 10;
  room.bombGame = {
    prompt: promptObj.prompt,
    timeLeft: duration,
    totalTime: duration,
    currentTurnPlayerId: activePlayers[0].id,
    usedWords: [],
    playerLives,
    playerScores,
    defusedCount: 0,
    status: 'playing',
    winner: null,
  };

  broadcastBombState(room, `💣 Match started! ${activePlayers[0].username} has the bomb!`);
  startBombTimer(room);
}

function startBombTimer(room: ServerRoom) {
  if (!room.bombGame) return;
  if (room.bombGame.timerInterval) clearInterval(room.bombGame.timerInterval);

  room.bombGame.timerInterval = setInterval(() => {
    if (!room.bombGame || room.bombGame.status !== 'playing') {
      if (room.bombGame?.timerInterval) clearInterval(room.bombGame.timerInterval);
      return;
    }

    room.bombGame.timeLeft -= 1;

    if (room.bombGame.timeLeft <= 0) {
      // Bomb explodes on active player!
      const explodedPlayerId = room.bombGame.currentTurnPlayerId;
      const playerObj = room.state.players.find(p => p.id === explodedPlayerId);
      const currentLives = (room.bombGame.playerLives.get(explodedPlayerId) || 1) - 1;
      room.bombGame.playerLives.set(explodedPlayerId, Math.max(0, currentLives));

      io.to(room.id).emit('bomb:sound', { sound: 'explode' });

      // Check remaining alive players
      const alivePlayers = room.state.players.filter(p => p.isConnected && (room.bombGame?.playerLives.get(p.id) || 0) > 0);

      if (alivePlayers.length <= 1) {
        // Victory condition!
        const winnerPlayer = alivePlayers[0] || playerObj || room.state.players[0];
        room.bombGame.status = 'victory';
        room.bombGame.winner = { id: winnerPlayer.id, name: winnerPlayer.username, avatar: winnerPlayer.avatar };
        if (room.bombGame.timerInterval) clearInterval(room.bombGame.timerInterval);

        const winScore = 500 + (room.bombGame.defusedCount * 50);
        winnerPlayer.score = (winnerPlayer.score || 0) + winScore;
        updateGlobalLeaderboard(winnerPlayer, true);

        broadcastBombState(room, `👑 ${winnerPlayer.username} survived the Word Bomb Royale! (+${winScore} pts)`);
        io.to(room.id).emit('bomb:sound', { sound: 'victory' });
        return;
      }

      // Next alive player
      const nextPromptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
      room.bombGame.prompt = nextPromptObj.prompt;

      const activeList = room.state.players.filter(p => p.isConnected);
      const currentIdx = activeList.findIndex(p => p.id === explodedPlayerId);
      let nextIdx = (currentIdx + 1) % activeList.length;
      while ((room.bombGame.playerLives.get(activeList[nextIdx].id) || 0) <= 0) {
        nextIdx = (nextIdx + 1) % activeList.length;
      }

      const nextPlayer = activeList[nextIdx];
      room.bombGame.currentTurnPlayerId = nextPlayer.id;
      const baseTime = Math.max(6, 10 - Math.floor(room.bombGame.defusedCount / 5));
      room.bombGame.timeLeft = baseTime;
      room.bombGame.totalTime = baseTime;

      broadcastBombState(room, `💥 BOOM! ${playerObj?.username || 'Player'} exploded! Bomb passed to ${nextPlayer.username}!`);
    } else {
      io.to(room.id).emit('bomb:tick', { timeLeft: room.bombGame.timeLeft });
    }
  }, 1000);
}

function broadcastBombState(room: ServerRoom, banner?: string) {
  if (!room.bombGame) return;
  const game = room.bombGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);

  const playersState = activePlayers.map(p => ({
    id: p.id,
    name: p.username,
    avatar: p.avatar,
    color: p.color,
    lives: game.playerLives.get(p.id) ?? 3,
    score: game.playerScores.get(p.id) ?? 0,
    isCurrentTurn: p.id === game.currentTurnPlayerId,
    isEliminated: (game.playerLives.get(p.id) ?? 3) <= 0,
  }));

  io.to(room.id).emit('bomb:state', {
    prompt: game.prompt,
    timeLeft: game.timeLeft,
    totalTime: game.totalTime,
    currentTurnPlayerId: game.currentTurnPlayerId,
    usedWords: game.usedWords,
    defusedCount: game.defusedCount,
    status: game.status,
    winner: game.winner,
    players: playersState,
    banner: banner || null,
  });
}

// ==================== TRIVIA DASH MULTIPLAYER SERVER ENGINE ====================
function initTriviaGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  // Shuffle TRIVIA_QUESTIONS and take 8
  const shuffled = [...TRIVIA_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 8);
  const playerScores = new Map<string, number>();
  const playerStreaks = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
    playerStreaks.set(p.id, 0);
  });

  room.triviaGame = {
    questions: shuffled,
    currentIndex: 0,
    timeLeft: 15,
    playerScores,
    playerStreaks,
    playerAnswers: new Map(),
    status: 'playing',
    winner: null,
  };

  broadcastTriviaState(room, `🧠 Trivia Dash Royale! Question 1 of ${shuffled.length}`);
  startTriviaQuestionTimer(room);
}

function startTriviaQuestionTimer(room: ServerRoom) {
  if (!room.triviaGame) return;
  if (room.triviaGame.timerInterval) clearInterval(room.triviaGame.timerInterval);

  room.triviaGame.timerInterval = setInterval(() => {
    if (!room.triviaGame || room.triviaGame.status !== 'playing') {
      if (room.triviaGame?.timerInterval) clearInterval(room.triviaGame.timerInterval);
      return;
    }

    room.triviaGame.timeLeft -= 1;

    if (room.triviaGame.timeLeft <= 0) {
      endTriviaRound(room);
    } else {
      io.to(room.id).emit('trivia:tick', { timeLeft: room.triviaGame.timeLeft });
    }
  }, 1000);
}

function endTriviaRound(room: ServerRoom) {
  if (!room.triviaGame) return;
  if (room.triviaGame.timerInterval) clearInterval(room.triviaGame.timerInterval);

  room.triviaGame.status = 'round_end';
  const currentQ = room.triviaGame.questions[room.triviaGame.currentIndex];
  broadcastTriviaState(room, `✅ Correct Answer: ${currentQ.options[currentQ.correctIndex]}`);

  // Transition after 3.5 seconds to next question or game over
  setTimeout(() => {
    if (!room.triviaGame) return;

    if (room.triviaGame.currentIndex >= room.triviaGame.questions.length - 1) {
      // Game Over
      room.triviaGame.status = 'game_over';
      const activePlayers = room.state.players.filter(p => p.isConnected);
      const finalRankings = activePlayers
        .map(p => ({
          id: p.id,
          name: p.username,
          avatar: p.avatar,
          score: room.triviaGame?.playerScores.get(p.id) || 0,
        }))
        .sort((a, b) => b.score - a.score);

      room.triviaGame.finalScores = finalRankings;
      const winner = finalRankings[0];
      if (winner) {
        room.triviaGame.winner = winner;
        const winnerPlayer = room.state.players.find(p => p.id === winner.id);
        if (winnerPlayer) {
          winnerPlayer.score = (winnerPlayer.score || 0) + winner.score;
          updateGlobalLeaderboard(winnerPlayer, true);
        }
      }

      broadcastTriviaState(room, `🏆 Match Finished! ${winner ? `${winner.name} won with ${winner.score} pts!` : ''}`);
      io.to(room.id).emit('trivia:sound', { sound: 'victory' });
    } else {
      // Next Question
      room.triviaGame.currentIndex += 1;
      room.triviaGame.timeLeft = 15;
      room.triviaGame.playerAnswers.clear();
      room.triviaGame.status = 'playing';
      broadcastTriviaState(room, `Question ${room.triviaGame.currentIndex + 1} of ${room.triviaGame.questions.length}`);
      startTriviaQuestionTimer(room);
    }
  }, 3500);
}

function broadcastTriviaState(room: ServerRoom, banner?: string) {
  if (!room.triviaGame) return;
  const game = room.triviaGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentQ = game.questions[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
      streak: game.playerStreaks.get(p.id) || 0,
      hasAnswered: game.playerAnswers.has(p.id),
      lastAnswer: game.status === 'round_end' || game.status === 'game_over' ? game.playerAnswers.get(p.id) : undefined,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('trivia:state', {
    currentIndex: game.currentIndex,
    totalQuestions: game.questions.length,
    currentQuestion: currentQ,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    finalScores: game.finalScores,
    leaderboard,
    banner: banner || null,
  });
}

// ==================== BUGTONG-BUGTONG MULTIPLAYER SERVER ENGINE ====================
function initBugtongGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const shuffled = [...BUGTONG_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 10);
  const playerScores = new Map<string, number>();
  const playerCorrectCounts = new Map<string, number>();
  const playerTeams = new Map<string, 'red' | 'blue'>();
  const rawTeamMode = room.settings.unoTeamMode || 'ffa';
  activePlayers.forEach((player, index) => {
    playerScores.set(player.id, 0);
    playerCorrectCounts.set(player.id, 0);
    playerTeams.set(player.id, index % 2 === 0 ? 'red' : 'blue');
  });
  room.bugtongGame = {
    questions: shuffled,
    currentIndex: 0,
    timeLeft: 20,
    playerScores,
    playerCorrectCounts,
    playerAnswers: new Map(),
    playerTeams,
    teamScores: { red: 0, blue: 0 },
    teamMode: rawTeamMode,
    status: 'playing',
    winner: null,
  };
  broadcastBugtongState(room, `Bugtong-Bugtong! Tanong 1 of ${shuffled.length}`);
  startBugtongQuestionTimer(room);
}

function startBugtongQuestionTimer(room: ServerRoom) {
  if (!room.bugtongGame) return;
  room.bugtongGame.timerInterval = setInterval(() => {
    const game = room.bugtongGame;
    if (!game || game.status !== 'playing') return;
    game.timeLeft -= 1;
    if (game.timeLeft <= 0) endBugtongRound(room);
    else io.to(room.id).emit('bugtong:tick', { timeLeft: game.timeLeft });
  }, 1000);
}

function endBugtongRound(room: ServerRoom) {
  const game = room.bugtongGame;
  if (!game || game.status !== 'playing') return;
  if (game.timerInterval) clearInterval(game.timerInterval);
  game.status = 'round_end';
  const current = game.questions[game.currentIndex];
  broadcastBugtongState(room, `Sagot: ${current.options[current.correctIndex]}`);
  setTimeout(() => {
    if (!room.bugtongGame) return;
    const active = room.state.players.filter(player => player.isConnected);
    if (game.currentIndex >= game.questions.length - 1) {
      game.status = 'game_over';
      const rankings = active.map(player => {
        const score = (game.playerCorrectCounts.get(player.id) || 0) * 10;
        game.playerScores.set(player.id, score);
        const team = game.playerTeams.get(player.id);
        if (team) game.teamScores[team] += score;
        player.score = (player.score || 0) + score;
        return { id: player.id, name: player.username, avatar: player.avatar, score };
      }).sort((a, b) => b.score - a.score);
      game.winner = rankings[0] || null;
      broadcastBugtongState(room, game.winner ? `Panalo si ${game.winner.name}!` : 'Tapos na ang laro!');
      return;
    }
    game.currentIndex += 1;
    game.timeLeft = 20;
    game.playerAnswers.clear();
    game.status = 'playing';
    broadcastBugtongState(room, `Tanong ${game.currentIndex + 1} of ${game.questions.length}`);
    startBugtongQuestionTimer(room);
  }, 2500);
}

function broadcastBugtongState(room: ServerRoom, banner?: string) {
  const game = room.bugtongGame;
  if (!game) return;
  const question = game.questions[game.currentIndex];
  io.to(room.id).emit('bugtong:state', {
    currentIndex: game.currentIndex,
    totalQuestions: game.questions.length,
    question: { id: question.id, category: question.category, question: question.question, options: question.options },
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    teamMode: game.teamMode,
    teamScores: game.teamScores,
    leaderboard: room.state.players.filter(player => player.isConnected).map(player => ({ id: player.id, name: player.username, avatar: player.avatar, color: player.color, team: game.playerTeams.get(player.id) || null, score: game.playerScores.get(player.id) || 0, hasAnswered: game.playerAnswers.has(player.id) })).sort((a, b) => b.score - a.score),
    banner: banner || null,
  });
}

// ==================== 4 PICS 1 WORD MULTIPLAYER SERVER ENGINE ====================
async function loadPexelsImages(word: string, fallback: [string, string, string, string]): Promise<[string, string, string, string]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return fallback;
  try {
    const query = encodeURIComponent(word.split(' ')[0].toLowerCase());
    const response = await fetch(`https://api.pexels.com/v1/search?query=${query}&per_page=4&page=1`, {
      headers: { Authorization: apiKey },
    });
    if (!response.ok) return fallback;
    const data = await response.json() as PexelsPhotoSearchResponse;
    const photos = (data.photos || []).map((photo) => photo.src?.large2x || photo.src?.large || photo.src?.medium).filter((url): url is string => Boolean(url));
    return photos.length === 4 ? photos as [string, string, string, string] : fallback;
  } catch (error) {
    console.warn('Pexels image lookup failed; using local fallback images.', error);
    return fallback;
  }
}

async function initFourPicsGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const players = room.state.players.filter(player => player.isConnected);
  const puzzles = await Promise.all([...FOUR_PICS_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 10).map(async (puzzle) => ({
    ...puzzle,
    images: await loadPexelsImages(puzzle.word, puzzle.images),
  })));
  const scores = new Map<string, number>();
  const correctCounts = new Map<string, number>();
  players.forEach(player => {
    scores.set(player.id, 0);
    correctCounts.set(player.id, 0);
  });
  const teamMode = room.settings.unoTeamMode || 'ffa';
  room.fourPicsGame = { puzzles, currentIndex: 0, timeLeft: 25, activeAnswererId: teamMode === 'ffa' ? null : players[0]?.id || null, scores, correctCounts, answers: new Map(), status: 'playing', winner: null };
  broadcastFourPicsState(room, '4 Pics 1 Word started!');
  startFourPicsTimer(room);
}

function startFourPicsTimer(room: ServerRoom) {
  const game = room.fourPicsGame;
  if (!game) return;
  game.timerInterval = setInterval(() => {
    if (!room.fourPicsGame || room.fourPicsGame.status !== 'playing') return;
    room.fourPicsGame.timeLeft -= 1;
    if (room.fourPicsGame.timeLeft <= 0) endFourPicsRound(room);
    else io.to(room.id).emit('fourpics:tick', { timeLeft: room.fourPicsGame.timeLeft });
  }, 1000);
}

function endFourPicsRound(room: ServerRoom) {
  const game = room.fourPicsGame;
  if (!game || game.status !== 'playing') return;
  if (game.timerInterval) clearInterval(game.timerInterval);
  game.status = 'round_end';
  const answer = game.puzzles[game.currentIndex].word;
  broadcastFourPicsState(room, `Answer: ${answer}`);
  setTimeout(() => {
    if (!room.fourPicsGame) return;
    if (game.currentIndex >= game.puzzles.length - 1) {
      game.status = 'game_over';
      const winnerEntry = room.state.players.filter(player => player.isConnected).map(player => {
        const score = (game.correctCounts.get(player.id) || 0) * 10;
        game.scores.set(player.id, score);
        player.score = (player.score || 0) + score;
        return { id: player.id, name: player.username, score };
      }).sort((a, b) => b.score - a.score)[0];
      game.winner = winnerEntry || null;
      broadcastFourPicsState(room, winnerEntry ? `${winnerEntry.name} wins!` : 'Game complete!');
      return;
    }
    game.currentIndex += 1;
    game.timeLeft = 25;
    game.answers.clear();
    game.status = 'playing';
    const players = room.state.players.filter(player => player.isConnected);
    const teamMode = room.settings.unoTeamMode || 'ffa';
    game.activeAnswererId = teamMode === 'ffa' ? null : players[game.currentIndex % Math.max(players.length, 1)]?.id || null;
    broadcastFourPicsState(room, `Round ${game.currentIndex + 1} of ${game.puzzles.length}`);
    startFourPicsTimer(room);
  }, 2500);
}

function broadcastFourPicsState(room: ServerRoom, banner?: string) {
  const game = room.fourPicsGame;
  if (!game) return;
  const puzzle = game.puzzles[game.currentIndex];
  io.to(room.id).emit('fourpics:state', {
    currentIndex: game.currentIndex,
    totalRounds: game.puzzles.length,
    puzzle: { id: puzzle.id, images: puzzle.images, hint: puzzle.hint },
    timeLeft: game.timeLeft,
    activeAnswererId: game.activeAnswererId,
    status: game.status,
    winner: game.winner,
    leaderboard: room.state.players.filter(player => player.isConnected).map(player => ({ id: player.id, name: player.username, avatar: player.avatar, score: game.scores.get(player.id) || 0, hasAnswered: game.answers.has(player.id) })).sort((a, b) => b.score - a.score),
    banner: banner || null,
  });
}

// ==================== SPEED DUEL MULTIPLAYER SERVER ENGINE ====================
function initDuelGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const topic = DUEL_PROMPTS[Math.floor(Math.random() * DUEL_PROMPTS.length)];
  room.drawingHistory = [];

  room.duelGame = {
    topic,
    timeLeft: 30,
    phase: 'dueling',
    playerSubmissions: new Map(),
    winner: null,
  };

  broadcastDuelState(room, `🎨 Speed Duel: Draw "${topic}"! 30 seconds on the clock!`);
  startDuelTimer(room);
}

function startDuelTimer(room: ServerRoom) {
  if (!room.duelGame) return;
  if (room.duelGame.timerInterval) clearInterval(room.duelGame.timerInterval);

  room.duelGame.timerInterval = setInterval(() => {
    if (!room.duelGame || room.duelGame.phase !== 'dueling') {
      if (room.duelGame?.timerInterval) clearInterval(room.duelGame.timerInterval);
      return;
    }

    room.duelGame.timeLeft -= 1;

    if (room.duelGame.timeLeft <= 0) {
      if (room.duelGame.timerInterval) clearInterval(room.duelGame.timerInterval);
      room.duelGame.phase = 'judging';
      broadcastDuelState(room, `🤖 AI Judges are rating both masterworks...`);

      // Evaluate after 3 seconds
      setTimeout(() => {
        if (!room.duelGame) return;
        const activePlayers = room.state.players.filter(p => p.isConnected);
        const p1 = activePlayers[0];
        const p2 = activePlayers[1] || activePlayers[0];

        const score1 = room.duelGame.playerSubmissions.get(p1.id)?.detailScore || Math.floor(70 + Math.random() * 25);
        const score2 = p2.id !== p1.id ? (room.duelGame.playerSubmissions.get(p2.id)?.detailScore || Math.floor(70 + Math.random() * 25)) : 0;

        let winnerId: string | null = null;
        if (score1 > score2) winnerId = p1.id;
        else if (score2 > score1) winnerId = p2.id;

        const winnerPlayer = activePlayers.find(p => p.id === winnerId);
        room.duelGame.phase = 'results';
        room.duelGame.winner = winnerPlayer ? { id: winnerPlayer.id, name: winnerPlayer.username, avatar: winnerPlayer.avatar } : null;
        room.duelGame.finalResults = {
          player1: { id: p1.id, name: p1.username, avatar: p1.avatar, score: score1 },
          player2: { id: p2.id, name: p2.username, avatar: p2.avatar, score: score2 },
          winnerId,
        };

        if (winnerPlayer) {
          winnerPlayer.score = (winnerPlayer.score || 0) + 300;
          updateGlobalLeaderboard(winnerPlayer, true);
        }

        broadcastDuelState(room, `🏆 ${winnerPlayer ? `${winnerPlayer.username} wins the Speed Duel!` : 'It’s a tie!'}`);
        io.to(room.id).emit('duel:sound', { sound: 'victory' });
      }, 3000);
    } else {
      io.to(room.id).emit('duel:tick', { timeLeft: room.duelGame.timeLeft });
    }
  }, 1000);
}

function broadcastDuelState(room: ServerRoom, banner?: string) {
  if (!room.duelGame) return;
  const game = room.duelGame;

  io.to(room.id).emit('duel:state', {
    topic: game.topic,
    timeLeft: game.timeLeft,
    phase: game.phase,
    winner: game.winner,
    finalResults: game.finalResults,
    banner: banner || null,
  });
}

// ==================== ANAGRAM RUSH MULTIPLAYER SERVER ENGINE ====================
function initAnagramGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const shuffledPuzzles = [...ANAGRAM_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 6);
  const playerScores = new Map<string, number>();
  const playerStreaks = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
    playerStreaks.set(p.id, 0);
  });

  const curr = shuffledPuzzles[0];
  const scrambled = curr.word.split('').sort(() => Math.random() - 0.5);
  // Guarantee not identical to original
  if (scrambled.join('') === curr.word && curr.word.length > 2) {
    [scrambled[0], scrambled[1]] = [scrambled[1], scrambled[0]];
  }

  room.anagramGame = {
    puzzles: shuffledPuzzles,
    currentIndex: 0,
    scrambledLetters: scrambled,
    playerScores,
    playerStreaks,
    timeLeft: 25,
    status: 'playing',
    winner: null,
    history: [],
  };

  broadcastAnagramState(room, `🔤 Anagram Rush: Unscramble the word!`);
  startAnagramTimer(room);
}

function startAnagramTimer(room: ServerRoom) {
  if (!room.anagramGame) return;
  if (room.anagramGame.timerInterval) clearInterval(room.anagramGame.timerInterval);

  room.anagramGame.timerInterval = setInterval(() => {
    if (!room.anagramGame || room.anagramGame.status !== 'playing') {
      if (room.anagramGame?.timerInterval) clearInterval(room.anagramGame.timerInterval);
      return;
    }

    room.anagramGame.timeLeft -= 1;

    if (room.anagramGame.timeLeft <= 0) {
      // Time expired on this puzzle -> advance to next
      advanceAnagramPuzzle(room, null);
    } else {
      io.to(room.id).emit('anagram:tick', { timeLeft: room.anagramGame.timeLeft });
    }
  }, 1000);
}

function advanceAnagramPuzzle(room: ServerRoom, solvedByName: string | null) {
  if (!room.anagramGame) return;
  const game = room.anagramGame;
  const currentP = game.puzzles[game.currentIndex];

  if (game.currentIndex >= game.puzzles.length - 1) {
    // Game Over
    game.status = 'game_over';
    if (game.timerInterval) clearInterval(game.timerInterval);

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const rankings = activePlayers
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        score: game.playerScores.get(p.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const topWinner = rankings[0];
    if (topWinner) {
      game.winner = topWinner;
      const winnerPlayer = room.state.players.find(p => p.id === topWinner.id);
      if (winnerPlayer) {
        winnerPlayer.score = (winnerPlayer.score || 0) + topWinner.score;
        updateGlobalLeaderboard(winnerPlayer, true);
      }
    }

    broadcastAnagramState(room, `🏆 Game Over! ${topWinner ? `${topWinner.name} won!` : ''}`);
    io.to(room.id).emit('anagram:sound', { sound: 'victory' });
  } else {
    game.currentIndex += 1;
    const nextP = game.puzzles[game.currentIndex];
    const scrambled = nextP.word.split('').sort(() => Math.random() - 0.5);
    if (scrambled.join('') === nextP.word && nextP.word.length > 2) {
      [scrambled[0], scrambled[1]] = [scrambled[1], scrambled[0]];
    }

    game.scrambledLetters = scrambled;
    game.timeLeft = 25;
    broadcastAnagramState(room, solvedByName ? `🎉 ${solvedByName} solved "${currentP.word}"! Next puzzle!` : `⏰ Time’s up! Answer was "${currentP.word}". Next puzzle!`);
    startAnagramTimer(room);
  }
}

function broadcastAnagramState(room: ServerRoom, banner?: string) {
  if (!room.anagramGame) return;
  const game = room.anagramGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentP = game.puzzles[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('anagram:state', {
    currentIndex: game.currentIndex,
    totalPuzzles: game.puzzles.length,
    scrambledLetters: game.scrambledLetters,
    category: currentP?.category || 'General',
    hint: currentP?.hint || '',
    difficulty: currentP?.difficulty || 'Medium',
    points: currentP?.points || 150,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    leaderboard,
    banner: banner || null,
  });
}

// ==================== EMOJI CHARADES MULTIPLAYER SERVER ENGINE ====================
function initEmojiGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const shuffledPuzzles = [...EMOJI_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 8);
  const playerScores = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
  });

  room.emojiGame = {
    puzzles: shuffledPuzzles,
    currentIndex: 0,
    playerScores,
    timeLeft: 30,
    status: 'playing',
    winner: null,
  };

  broadcastEmojiState(room, `🎬 Emoji Charades! Guess the movie or pop culture title!`);
  startEmojiTimer(room);
}

function startEmojiTimer(room: ServerRoom) {
  if (!room.emojiGame) return;
  if (room.emojiGame.timerInterval) clearInterval(room.emojiGame.timerInterval);

  room.emojiGame.timerInterval = setInterval(() => {
    if (!room.emojiGame || room.emojiGame.status !== 'playing') {
      if (room.emojiGame?.timerInterval) clearInterval(room.emojiGame.timerInterval);
      return;
    }

    room.emojiGame.timeLeft -= 1;

    if (room.emojiGame.timeLeft <= 0) {
      advanceEmojiPuzzle(room, null);
    } else {
      io.to(room.id).emit('emoji:tick', { timeLeft: room.emojiGame.timeLeft });
    }
  }, 1000);
}

function advanceEmojiPuzzle(room: ServerRoom, solvedByName: string | null) {
  if (!room.emojiGame) return;
  const game = room.emojiGame;
  const currentP = game.puzzles[game.currentIndex];

  if (game.currentIndex >= game.puzzles.length - 1) {
    // Game Over
    game.status = 'game_over';
    if (game.timerInterval) clearInterval(game.timerInterval);

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const rankings = activePlayers
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        score: game.playerScores.get(p.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const topWinner = rankings[0];
    if (topWinner) {
      game.winner = topWinner;
      const winnerPlayer = room.state.players.find(p => p.id === topWinner.id);
      if (winnerPlayer) {
        winnerPlayer.score = (winnerPlayer.score || 0) + topWinner.score;
        updateGlobalLeaderboard(winnerPlayer, true);
      }
    }

    broadcastEmojiState(room, `🏆 Game Over! ${topWinner ? `${topWinner.name} won!` : ''}`);
    io.to(room.id).emit('emoji:sound', { sound: 'victory' });
  } else {
    game.currentIndex += 1;
    game.timeLeft = 30;
    broadcastEmojiState(room, solvedByName ? `🎉 ${solvedByName} guessed "${currentP.answer}"! Next puzzle!` : `⏰ Time’s up! Answer was "${currentP.answer}". Next puzzle!`);
    startEmojiTimer(room);
  }
}

function broadcastEmojiState(room: ServerRoom, banner?: string) {
  if (!room.emojiGame) return;
  const game = room.emojiGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentP = game.puzzles[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('emoji:state', {
    currentIndex: game.currentIndex,
    totalPuzzles: game.puzzles.length,
    emojis: currentP?.emojis || [],
    category: currentP?.category || 'General',
    hint: currentP?.hint || '',
    points: currentP?.points || 100,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    leaderboard,
    banner: banner || null,
  });
}

function getNextUnoIndex(current: number, step: number, direction: 1 | -1, total: number): number {
  if (total <= 0) return 0;
  let next = (current + step * direction) % total;
  if (next < 0) next += total;
  return next;
}

// REST APIs
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', activeRooms: ROOMS.size, timestamp: Date.now() });
});

app.get('/api/leaderboard', (req: Request, res: Response) => {
  res.json({ leaderboard: GLOBAL_STORE.leaderboard });
});

app.get('/api/rooms', (req: Request, res: Response) => {
  res.json({ rooms: getPublicRoomsList() });
});

// Socket.io Real-time Event Management
io.on('connection', (socket: Socket) => {
  let currentRoomId: string | null = null;
  let currentPlayerId: string | null = null;
  let globalPlayerId: string | null = null;

  // Send initial leaderboard and public rooms list immediately
  socket.emit('leaderboard:update', GLOBAL_STORE.leaderboard);
  socket.emit('rooms:list', getPublicRoomsList());
  socket.emit('global:history', GLOBAL_CHAT_MESSAGES);

  // Allow client to request latest public rooms on demand
  socket.on('rooms:get', () => {
    socket.emit('rooms:list', getPublicRoomsList());
  });

  // 1. Create Room
  socket.on('room:create', async (
    { player, settings, roomName }: { player: Player; settings: RoomSettings; roomName: string },
    acknowledge?: (response: { ok: boolean; message?: string }) => void,
  ) => {
    const normalizedSettings = normalizeRoomSettings(settings);
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    const code = generateRoomCode();

    const hostPlayer: Player = {
      ...player,
      socketId: socket.id,
      isHost: true,
      isDrawing: false,
      hasGuessed: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      isConnected: true,
    };

    const newRoom: ServerRoom = {
      id: roomId,
      code,
      name: roomName || `${player.username}'s Game`,
      hostSocketId: socket.id,
      settings: {
        ...normalizedSettings,
        // Multiplayer rooms always use real participants. Solo AI remains
        // available through the separate VS AI arcade flow.
        botPlayersEnabled: false,
      },
      state: {
        roomId,
        roomCode: code,
        roomName: roomName || `${player.username}'s Game`,
        status: 'lobby',
        currentRound: 1,
        totalRounds: settings.maxRounds || 3,
        drawerId: null,
        drawerName: null,
        word: '',
        wordLength: 0,
        revealedIndices: [],
        hint: '',
        wordChoices: [],
        timeLeft: settings.roundDuration || 60,
        totalTime: settings.roundDuration || 60,
        players: [hostPlayer],
        // Keep the state and server-normalized settings in sync. Arcade clients
        // use this roster/config after the host starts a room match.
        settings: {
          ...normalizedSettings,
          botPlayersEnabled: false,
        },
      },
      drawingHistory: [],
      messages: [],
      currentTurnWord: '',
      currentWordPoints: 100,
      wordSelected: false,
      drawerIndex: 0,
      playersWhoGuessed: new Set<string>(),
    };

    // Ensure no accidental bot players are present when bots are not enabled
    newRoom.state.players = newRoom.state.players.filter(p => !isBotPlayer(p));

    ROOMS.set(roomId, newRoom);
    currentRoomId = roomId;
    currentPlayerId = player.id;

    socket.join(roomId);
    socket.emit('room:joined', { room: newRoom.state, isHost: true });
    socket.emit('canvas:history', newRoom.drawingHistory);
    broadcastPublicRoomsList();

    if (newRoom.settings.gameMode === 'lucky_9') {
      initLucky9Game(newRoom);
    }

    acknowledge?.({ ok: true });

    // Persist room to Firestore (best-effort, async)
    await saveRoomToFirestore(newRoom);
    await saveActivityToFirestore({ type: 'room_create', roomId: newRoom.id, by: player.id, roomName: newRoom.name }).catch(() => {});
  });

  // 2. Join Room by Code or ID
  socket.on('room:join', async ({ roomIdentifier, player }: { roomIdentifier: string; player: Player }) => {
    const search = roomIdentifier.trim().toUpperCase();
    let room: ServerRoom | undefined;

    ROOMS.forEach(r => {
      if (r.id === roomIdentifier || r.code === search) {
        room = r;
      }
    });

    if (!room) {
      socket.emit('room:error', { message: 'Room not found. Check code or ID.' });
      return;
    }

    // Multiplayer rooms accept real participants only.
    if (isBotPlayer(player)) {
      socket.emit('room:error', { message: 'Multiplayer rooms accept real players only.' });
      return;
    }

    // Check if player rejoining
    const existingIndex = room.state.players.findIndex(p => p.id === player.id);
    if (existingIndex < 0 && room.state.status !== 'lobby') {
      socket.emit('room:error', { message: 'This game has already started. Join the next round.' });
      return;
    }
    if (existingIndex < 0 && getConnectedHumanPlayers(room).length >= room.settings.maxPlayers) {
      socket.emit('room:error', { message: 'Room is full.' });
      return;
    }
    const newPlayer: Player = {
      ...player,
      socketId: socket.id,
      isHost: existingIndex >= 0 ? room.state.players[existingIndex].isHost : room.state.players.length === 0,
      isDrawing: existingIndex >= 0 ? room.state.players[existingIndex].isDrawing : false,
      hasGuessed: existingIndex >= 0 ? room.state.players[existingIndex].hasGuessed : false,
      score: existingIndex >= 0 ? room.state.players[existingIndex].score : 0,
      roundScore: 0,
      streak: existingIndex >= 0 ? room.state.players[existingIndex].streak : 0,
      isConnected: true,
    };

    if (existingIndex >= 0) {
      room.state.players[existingIndex] = newPlayer;
    } else {
      room.state.players.push(newPlayer);
    }

    currentRoomId = room.id;
    currentPlayerId = player.id;

    socket.join(room.id);
    socket.emit('room:joined', { room: room.state, isHost: newPlayer.isHost });
    socket.emit('canvas:history', room.drawingHistory);

    // Announce player joined
    const joinMsg: ChatMessage = {
      id: 'sys_' + Date.now(),
      senderName: 'System',
      text: `👋 ${newPlayer.username} joined the game!`,
      type: 'system',
      timestamp: Date.now(),
          scope: 'room',
          profile: getChatProfile(newPlayer),
    };
    io.to(room.id).emit('chat:message', joinMsg);
    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    broadcastPublicRoomsList();

    if (room.settings.gameMode === 'lucky_9') {
      initLucky9Game(room);
    }

    // Save updated room
    await saveRoomToFirestore(room);
    await saveActivityToFirestore({ type: 'player_join', roomId: room.id, playerId: newPlayer.id }).catch(() => {});
  });

  // 3. Quick Match / Auto Join
  socket.on('room:quick_join', ({ player }: { player: Player }) => {
    let targetRoom: ServerRoom | undefined;
    ROOMS.forEach(r => {
      if (!r.settings.isPrivate && getConnectedHumanPlayers(r).length < r.settings.maxPlayers && r.state.status === 'lobby') {
        targetRoom = r;
      }
    });

    if (targetRoom) {
      // Join existing
      socket.emit('room:join_ready', { roomIdentifier: targetRoom.id });
    } else {
      // Auto-create public lobby
      const defaultSettings: RoomSettings = normalizeRoomSettings({
        roundDuration: 60,
        maxRounds: 3,
        maxPlayers: 8,
        wordCategory: 'all',
        customWords: [],
        isPrivate: false,
        allowHints: true,
        botPlayersEnabled: false,
      });
      const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
      const code = generateRoomCode();
      const hostPlayer: Player = {
        ...player,
        socketId: socket.id,
        isHost: true,
        isDrawing: false,
        hasGuessed: false,
        score: 0,
        roundScore: 0,
        streak: 0,
        isConnected: true,
      };

      const newRoom: ServerRoom = {
        id: roomId,
        code,
        name: `Public Arena #${code.substring(0, 3)}`,
        hostSocketId: socket.id,
        settings: defaultSettings,
        state: {
          roomId,
          roomCode: code,
          roomName: `Public Arena #${code.substring(0, 3)}`,
          status: 'lobby',
          currentRound: 1,
          totalRounds: 3,
          drawerId: null,
          drawerName: null,
          word: '',
          wordLength: 0,
          revealedIndices: [],
          hint: '',
          wordChoices: [],
          timeLeft: 60,
          totalTime: 60,
          players: [hostPlayer],
          settings: defaultSettings,
        },
        drawingHistory: [],
        messages: [],
        currentTurnWord: '',
        currentWordPoints: 100,
        wordSelected: false,
        drawerIndex: 0,
        playersWhoGuessed: new Set<string>(),
      };

      ROOMS.set(roomId, newRoom);
      socket.join(roomId);
      socket.emit('room:joined', { room: newRoom.state, isHost: true });
      broadcastPublicRoomsList();

      // Save created room
      saveRoomToFirestore(newRoom).catch(() => {});
      saveActivityToFirestore({ type: 'room_quick_create', roomId: newRoom.id }).catch(() => {});
    }
  });

  // 4. Start Game (Host only) — dispatcher by gameMode
  socket.on('game:start', async () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const caller = room.state.players.find(p => p.id === currentPlayerId);
    if (!caller?.isHost) {
      socket.emit('room:error', { message: 'Only host can start the game.' });
      return;
    }

    // Determine requested game mode (server-first)
    const rawGameMode = (room.settings && (room.settings as any).gameMode) || (room.state.settings && (room.state.settings as any).gameMode) || 'multiplayer_draw';
    const gameMode = typeof rawGameMode === 'string' ? rawGameMode.toLowerCase() : 'multiplayer_draw';

    // Never let an AI entry occupy a multiplayer slot. Remove legacy or
    // previously-added bot records before validating the real-player roster.
    const hadBots = room.state.players.some(isBotPlayer);
    if (hadBots) {
      room.state.players = room.state.players.filter(player => !isBotPlayer(player));
      room.settings.botPlayersEnabled = false;
      if (room.state.settings) room.state.settings.botPlayersEnabled = false;
      io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    }

    const activePlayers = getConnectedHumanPlayers(room);
    const minimumPlayers = 2;
    if (activePlayers.length < minimumPlayers) {
      socket.emit('room:error', {
        message: 'Need at least 2 connected real players to start this multiplayer game.',
      });
      return;
    }

    const GAME_MODE_TITLES: Record<string, string> = {
      uno_party: '🃏 UNO Party Showdown',
      trivia_dash: '⚡ Trivia Dash 60s',
      bugtong_bugtong: '🧠 Bugtong-Bugtong',
      four_pics_one_word: '🖼️ 4 Pics 1 Word',
      anagram_rush: '🔤 Anagram Rush',
      bomb_chain: '💥 Word Bomb Chain',
      ai_sketch_guess: '🤖 AI Sketch Guesser',
      speed_duel: '⚔️ 1v1 Speed Duel',
      pixel_reveal: '🔍 Pixel Reveal Mystery',
      blindfold_maestro: '🙈 Blindfold Maestro',
      emoji_charades: '🎭 Emoji Charades',
      sound_mystery: '🎵 Sound & Audio Mystery',
      reflex_neon: '⚡ Neon Reflex Blitz',
      color_clash: '🎨 Color Clash Matrix',
      cyber_typing: '⌨️ Cyber Typing Rush',
      simon_sequence: '🎶 Simon Sequence Matrix',
      math_sprint: '🔢 Math Sprint 60s',
      emoji_match: '🧩 Emoji Tile Match',
      whack_doodle: '🔨 Whack-a-Doodle',
      tower_stack: '🏗️ Cyber Tower Stacker',
      ngip_mega_wheel: '🎡 Mega Jackpot Wheel',
      ngip_vault_hacker: '🔐 Cyber Vault Hacker',
      lucky_9: '🎴 Lucky 9 (1v1)',
      multiplayer_draw: '🎨 Multiplayer Drawing Arena',
    };

    if (gameMode === 'multiplayer_draw' || gameMode === 'drawing') {
      if (activePlayers.length < 2) {
        socket.emit('room:error', {
          message: 'Need at least 2 connected real players to start Drawing Arena. Invite a friend with the Room Code.',
        });
        return;
      }

      // Reset scores & rounds
      room.state.currentRound = 1;
      room.state.players.forEach(p => {
        p.score = 0;
        p.roundScore = 0;
        p.hasGuessed = false;
        p.streak = 0;
      });
      room.drawerIndex = 0;

      await saveActivityToFirestore({ type: 'game_start_drawing', roomId: room.id, by: caller.id }).catch(() => {});
      startTurnCycle(room);
      broadcastPublicRoomsList();
      await saveRoomToFirestore(room);
    } else {
      // Non-drawing multiplayer arcade game (UNO Party, Trivia Dash, Word Bomb, etc.)
      if (room.timerInterval) clearInterval(room.timerInterval);

      // Transition room status to active playing
      room.state.status = 'drawing';
      room.drawingHistory = [];
      room.currentTurnWord = '';
      room.currentWordPoints = 0;
      room.wordSelected = false;

      const title = GAME_MODE_TITLES[gameMode] || gameMode;

      io.to(room.id).emit('room:state', sanitizeStateForClient(room));
      io.to(room.id).emit('chat:message', {
        id: 'start_' + Date.now(),
        senderName: 'Game Master',
        text: `🎮 ${title} match has started! Good luck to all players!`,
        type: 'system',
        timestamp: Date.now(),
      });

      if (gameMode === 'uno_party') {
        initUnoGame(room);
      } else if (gameMode === 'trivia_dash') {
        initTriviaGame(room);
      } else if (gameMode === 'bugtong_bugtong') {
        initBugtongGame(room);
      } else if (gameMode === 'four_pics_one_word') {
        initFourPicsGame(room);
      } else if (gameMode === 'bomb_chain') {
        initBombGame(room);
      } else if (gameMode === 'speed_duel') {
        initDuelGame(room);
      } else if (gameMode === 'anagram_rush') {
        initAnagramGame(room);
      } else if (gameMode === 'emoji_charades') {
        initEmojiGame(room);
      } else if (gameMode === 'chess_game') {
        initChessGame(room);
      } else if (gameMode === 'lucky_9') {
        initLucky9Game(room);
      } else {
        initArcadeRace(room);
      }

      await saveActivityToFirestore({ type: `game_start_${gameMode}`, roomId: room.id, by: caller.id }).catch(() => {});
      await saveRoomToFirestore(room);
      broadcastPublicRoomsList();
    }
  });

  // Generic multiplayer bridge for arcade modes that use local interaction
  // rules but still need shared timing and live player scores.
  socket.on('arcade:race_get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    if (!room.arcadeRace) initArcadeRace(room);
    else broadcastArcadeRaceState(room);
  });

  socket.on('arcade:score', ({ score, finished }: { score: number; finished?: boolean }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    const race = room?.arcadeRace;
    if (!room || !race || race.status !== 'playing') return;
    const safeScore = Math.max(0, Math.min(Number(score) || 0, 1_000_000));
    race.scores.set(currentPlayerId, safeScore);
    const player = room.state.players.find(item => item.id === currentPlayerId);
    if (player) player.score = safeScore;
    if (finished) race.finished.add(currentPlayerId);
    const activePlayerIds = getConnectedHumanPlayers(room).map(item => item.id);
    if (activePlayerIds.length > 0 && activePlayerIds.every(id => race.finished.has(id))) {
      race.status = 'game_over';
      if (race.timerInterval) clearInterval(race.timerInterval);
      race.timeLeft = Math.max(0, race.timeLeft);
      room.state.status = 'game_over';
    }
    broadcastArcadeRaceState(room);
    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
  });

  // 5. Word Selection by Drawer
  socket.on('word:select', ({ choice }: { choice: WordChoice }) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || room.state.status !== 'selecting_word') return;

    if (room.state.drawerId !== currentPlayerId) return;

    room.currentTurnWord = choice.word;
    room.currentWordPoints = choice.points;
    room.wordSelected = true;
    room.state.word = choice.word;
    room.state.wordLength = choice.word.length;
    room.state.hint = choice.hint || '';
    room.state.revealedIndices = [];

    // Clear previous timer and begin drawing phase
    if (room.timerInterval) clearInterval(room.timerInterval);
    beginDrawingPhase(room);

    // Save room state
    saveRoomToFirestore(room).catch(() => {});
  });

  // 6. Drawing Events (Broadcast to room)
  socket.on('draw:action', (action: CanvasAction) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || room.state.status !== 'drawing') return;

    // In speed_duel or canvas_collab, allow any player to draw
    const isFreeDrawMode = room.settings.gameMode === 'speed_duel';
    if (!isFreeDrawMode && room.state.drawerId !== currentPlayerId) return;

    if (action.type === 'clear') {
      room.drawingHistory = [];
    } else {
      room.drawingHistory.push(action);
    }

    // Broadcast stroke to all OTHER clients in the room
    socket.to(currentRoomId).emit('draw:action', action);
  });

  socket.on('chess:move', (payload: {
    playerId?: string;
    board?: Array<Array<{ type: string; color: 'w' | 'b' } | null>>;
    turn?: 'w' | 'b';
    winner?: 'w' | 'b' | null;
    gameState?: 'playing' | 'checkmate' | 'draw' | 'king_lost';
    lastMove?: { from: string; to: string } | null;
    moveHistory?: Array<{ from: string; to: string; piece: { type: string; color: 'w' | 'b' }; captured?: { type: string; color: 'w' | 'b' } | null; notation: string }>;
    capturedByWhite?: Array<{ type: string; color: 'w' | 'b' }>;
    capturedByBlack?: Array<{ type: string; color: 'w' | 'b' }>;
  }) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || room.settings.gameMode !== 'chess_game') return;
    if (!room.chessGame) {
      initChessGame(room);
    }

    const player = room.state.players.find((p) => p.id === (payload.playerId || currentPlayerId));
    if (!player) return;

    room.chessGame = {
      board: payload.board || room.chessGame.board,
      turn: payload.turn || room.chessGame.turn,
      winner: payload.winner ?? room.chessGame.winner,
      gameState: payload.gameState || room.chessGame.gameState,
      lastMove: payload.lastMove ?? room.chessGame.lastMove,
      moveHistory: payload.moveHistory || room.chessGame.moveHistory,
      capturedByWhite: payload.capturedByWhite || room.chessGame.capturedByWhite,
      capturedByBlack: payload.capturedByBlack || room.chessGame.capturedByBlack,
    };

    room.state.chess = {
      board: room.chessGame.board,
      turn: room.chessGame.turn,
      winner: room.chessGame.winner,
      gameState: room.chessGame.gameState,
      lastMove: room.chessGame.lastMove,
      moveHistory: room.chessGame.moveHistory,
      capturedByWhite: room.chessGame.capturedByWhite,
      capturedByBlack: room.chessGame.capturedByBlack,
    };

    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
  });

  // 7. Clear Canvas
  socket.on('canvas:clear', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const isFreeDrawMode = room.settings.gameMode === 'speed_duel';
    if (!isFreeDrawMode && room.state.drawerId !== currentPlayerId) return;

    room.drawingHistory = [];
    io.to(currentRoomId).emit('canvas:clear');
  });

  // ==================== 7b. UNO MULTIPLAYER SOCKET HANDLERS ====================
  // Sync request on component mount or reconnect
  socket.on('uno:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.unoGame) {
      initUnoGame(room);
    } else {
      broadcastUnoState(room);
    }
  });

  // Card Play Event
  socket.on('uno:play_card', ({ cardId, chosenWildColor }: { cardId: string; chosenWildColor?: UnoColor }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.unoGame) {
      initUnoGame(room);
      return;
    }

    const game = room.unoGame;
    if (game.status !== 'playing') return;

    // Validate turn
    if (game.currentTurnPlayerId !== currentPlayerId) {
      console.log(`[UNO] Play rejected: not player's turn (Turn: ${game.currentTurnPlayerId}, Sender: ${currentPlayerId})`);
      return;
    }

    const hand = game.playerHands.get(currentPlayerId);
    if (!hand) return;

    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = hand[cardIndex];
    hand.splice(cardIndex, 1);
    game.playerHands.set(currentPlayerId, hand);
    game.discardPile.push(card);
    game.cardsPlayed += 1;

    const nextColor: UnoColor = chosenWildColor || (card.color === 'wild' ? 'red' : card.color);
    game.activeColor = nextColor;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    const senderName = senderPlayer?.username || 'Player';

    const cardLabel = `${card.color === 'wild' ? 'Wild' : card.color.toUpperCase()} ${card.type === 'number' ? card.value : card.type.toUpperCase()}`;
    game.historyLog.unshift({
      text: `${senderName} played ${cardLabel}${chosenWildColor ? ` (picked ${chosenWildColor.toUpperCase()})` : ''}`,
      color: nextColor,
    });
    if (game.historyLog.length > 12) game.historyLog.pop();

    // Check Win Condition
    if (hand.length === 0) {
      const activePlayers = room.state.players.filter(p => p.isConnected);
      const playerTeam = game.playerTeams.get(currentPlayerId);
      let totalScore = 0;

      if (game.teamMode !== 'ffa' && playerTeam) {
        // Team win! Sum cards of OPPOSING team
        game.playerHands.forEach((otherHand, pId) => {
          const otherTeam = game.playerTeams.get(pId);
          if (otherTeam !== playerTeam) {
            otherHand.forEach(c => totalScore += c.score);
          }
        });
        game.winningTeam = playerTeam;
      } else {
        game.playerHands.forEach((otherHand) => {
          otherHand.forEach(c => totalScore += c.score);
        });
      }

      game.status = 'game_over';
      game.winner = { id: senderPlayer!.id, name: senderName, avatar: senderPlayer!.avatar };
      game.finalScore = totalScore;
      game.currentTurnPlayerId = '';

      const winBanner = game.winningTeam
        ? `🏆 TEAM ${game.winningTeam === 'red' ? 'RED 🔴' : 'BLUE 🔵'} WINS THE UNO CLASH! (${senderName} laid the final card! +${totalScore} pts)`
        : `🏆 ${senderName} won the UNO Showdown! (+${totalScore} pts)`;

      broadcastUnoState(room, winBanner);
      io.to(room.id).emit('uno:sound', { sound: 'victory' });

      if (game.winningTeam) {
        activePlayers.forEach(p => {
          if (game.playerTeams.get(p.id) === game.winningTeam) {
            p.score = (p.score || 0) + totalScore;
            updateGlobalLeaderboard(p, true);
          }
        });
      } else if (senderPlayer) {
        senderPlayer.score = (senderPlayer.score || 0) + totalScore;
        updateGlobalLeaderboard(senderPlayer, true);
      }
      return;
    }

    // Action cards processing
    let advanceSteps = 1;
    let actionBanner: string | undefined;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const currentIdx = activePlayers.findIndex(p => p.id === currentPlayerId);

    if (card.type === 'skip') {
      const skippedIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      actionBanner = `⛔ ${activePlayers[skippedIdx].username} was SKIPPED!`;
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'reverse') {
      if (activePlayers.length === 2) {
        actionBanner = `🔄 Reverse! ${senderName} plays again!`;
        advanceSteps = 2;
      } else {
        game.direction = (game.direction * -1) as 1 | -1;
        actionBanner = `🔄 Rotation REVERSED!`;
        advanceSteps = 1;
      }
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'draw2') {
      const victimIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      const victim = activePlayers[victimIdx];
      actionBanner = `💥 ${victim.username} draws +2 cards and is skipped!`;
      drawCardsFromUnoDeck(room, victim.id, 2);
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'draw' });
    } else if (card.type === 'wild') {
      actionBanner = `🌈 Active color changed to ${nextColor.toUpperCase()}!`;
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'wild4') {
      const victimIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      const victim = activePlayers[victimIdx];
      actionBanner = `💥 WILD +4! ${victim.username} draws 4 cards and is skipped!`;
      drawCardsFromUnoDeck(room, victim.id, 4);
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'draw' });
    } else {
      io.to(room.id).emit('uno:sound', { sound: 'play' });
    }

    const nextTurnIdx = getNextUnoIndex(currentIdx, advanceSteps, game.direction, activePlayers.length);
    game.currentTurnPlayerId = activePlayers[nextTurnIdx].id;

    broadcastUnoState(room, actionBanner);
  });

  // Draw Card Event
  socket.on('uno:draw_card', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const game = room.unoGame;
    if (game.status !== 'playing') return;
    if (game.currentTurnPlayerId !== currentPlayerId) return;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    const senderName = senderPlayer?.username || 'Player';

    const drawn = drawCardsFromUnoDeck(room, currentPlayerId, 1);
    const drawnCard = drawn[0] || null;

    game.historyLog.unshift({
      text: `${senderName} drew 1 card from deck`,
      color: game.activeColor,
    });
    if (game.historyLog.length > 12) game.historyLog.pop();

    broadcastUnoState(room, `${senderName} drew 1 card`);
    socket.emit('uno:drawn_card_result', { card: drawnCard });
    io.to(room.id).emit('uno:sound', { sound: 'draw' });
  });

  // Pass Turn Event
  socket.on('uno:pass_turn', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const game = room.unoGame;
    if (game.status !== 'playing') return;
    if (game.currentTurnPlayerId !== currentPlayerId) return;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const currentIdx = activePlayers.findIndex(p => p.id === currentPlayerId);
    const nextTurnIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
    game.currentTurnPlayerId = activePlayers[nextTurnIdx].id;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    broadcastUnoState(room, `${senderPlayer?.username || 'Player'} passed turn`);
  });

  // Shout UNO Event
  socket.on('uno:call_uno', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const hand = room.unoGame.playerHands.get(currentPlayerId) || [];
    if (hand.length <= 2) {
      room.unoGame.calledUno.add(currentPlayerId);
      const sender = room.state.players.find(p => p.id === currentPlayerId);
      broadcastUnoState(room, `📣 ${sender?.username || 'Player'} SHOUTED UNO!`);
      io.to(room.id).emit('uno:sound', { sound: 'uno_call' });
    }
  });

  // Catch Uno Event
  socket.on('uno:catch_uno', ({ targetPlayerId }: { targetPlayerId: string }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const targetHand = room.unoGame.playerHands.get(targetPlayerId) || [];
    if (targetHand.length === 1 && !room.unoGame.calledUno.has(targetPlayerId)) {
      const targetPlayer = room.state.players.find(p => p.id === targetPlayerId);
      const catcher = room.state.players.find(p => p.id === currentPlayerId);
      drawCardsFromUnoDeck(room, targetPlayerId, 2);
      broadcastUnoState(room, `🚨 CAUGHT! ${catcher?.username} caught ${targetPlayer?.username} forgetting UNO! (+2 Penalty)`);
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    }
  });

  // Rematch / Play Another Match
  socket.on('uno:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initUnoGame(room);
  });

  // ==================== LUCKY 9 MULTIPLAYER HANDLERS ====================
  socket.on('lucky9:join_game', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.lucky9Game) {
      initLucky9Game(room);
    } else {
      const activePlayers = room.state.players.filter(p => p.isConnected);
      activePlayers.forEach(p => {
        if (!room.lucky9Game!.coins.has(p.id)) {
          const c = getLucky9UserCoins(p.id);
          room.lucky9Game!.coins.set(p.id, c);
        }
        if (!room.lucky9Game!.bets.has(p.id)) {
          const c = room.lucky9Game!.coins.get(p.id) || 1000;
          room.lucky9Game!.bets.set(p.id, Math.min(1000, c));
        }
      });
      broadcastLucky9State(room);
    }
  });

  socket.on('lucky9:bet', ({ amount }: { amount: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.lucky9Game) return;
    const game = room.lucky9Game;
    if (game.status !== 'betting') return;

    const userCoins = game.coins.get(currentPlayerId) ?? getLucky9UserCoins(currentPlayerId);
    if (userCoins <= 0) {
      socket.emit('room:error', { message: 'You have 0 coins left.' });
      return;
    }
    const validAmount = Math.max(1, Math.min(amount, userCoins));
    game.bets.set(currentPlayerId, validAmount);
    broadcastLucky9State(room);
  });

  socket.on('lucky9:deal', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.lucky9Game) return;
    const game = room.lucky9Game;
    if (game.status !== 'betting') return;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    if (activePlayers.length < 2) {
      socket.emit('room:error', { message: 'Need 2 players for 1v1 Lucky 9.' });
      return;
    }

    const p1 = activePlayers[0];
    const p2 = activePlayers[1];
    const c1 = game.coins.get(p1.id) ?? getLucky9UserCoins(p1.id);
    const c2 = game.coins.get(p2.id) ?? getLucky9UserCoins(p2.id);

    if (c1 <= 0 || c2 <= 0) {
      const brokePlayer = c1 <= 0 ? p1.username : p2.username;
      game.bankerMessage = `Banker: ${brokePlayer} has 0 coins left and cannot place a bet!`;
      broadcastLucky9State(room);
      return;
    }

    // Both players wager an equal bet in 1v1
    const b1 = Math.min(game.bets.get(p1.id) || 1000, c1);
    const b2 = Math.min(game.bets.get(p2.id) || 1000, c2);
    const matchBet = Math.min(b1, b2);

    if (matchBet <= 0) {
      game.bankerMessage = 'Banker: Both players need coins to bet.';
      broadcastLucky9State(room);
      return;
    }

    // Deduct bet from both players immediately (stakes are held in pot)
    const newC1 = c1 - matchBet;
    const newC2 = c2 - matchBet;
    game.coins.set(p1.id, newC1);
    game.coins.set(p2.id, newC2);
    setLucky9UserCoins(p1.id, newC1);
    setLucky9UserCoins(p2.id, newC2);

    game.bets.set(p1.id, matchBet);
    game.bets.set(p2.id, matchBet);

    const totalPot = matchBet * 2;
    game.pot = totalPot;
    game.deck = createServerLucky9Deck();

    // Deal 2 initial cards to each player
    const c1_1 = game.deck.pop()!;
    const c1_2 = game.deck.pop()!;
    game.playerHands.set(p1.id, [c1_1, c1_2]);

    const c2_1 = game.deck.pop()!;
    const c2_2 = game.deck.pop()!;
    game.playerHands.set(p2.id, [c2_1, c2_2]);

    game.status = 'dealing';
    game.bankerMessage = `Banker: Dealing cards! Both players staked ${matchBet.toLocaleString()} coins (Total Pot: ${totalPot.toLocaleString()}). Loser will forfeit their bet!`;
    broadcastLucky9State(room);

    // Natural check
    setTimeout(() => {
      const h1 = game.playerHands.get(p1.id) || [];
      const h2 = game.playerHands.get(p2.id) || [];
      const nat1 = checkServerLucky9Natural(h1);
      const nat2 = checkServerLucky9Natural(h2);

      if (nat1 || nat2) {
        game.status = 'round_over';
        if (nat1 === 'natural_9' && nat2 === 'natural_9') {
          game.winner = 'tie';
          game.winnerReason = 'Both players dealt Natural 9! Push (Tie).';
          game.bankerMessage = 'Banker: Incredible! Both players dealt Natural 9! Bets are refunded.';
          const refund = Math.floor(totalPot / 2);
          const c1Cur = (game.coins.get(p1.id) ?? 0) + refund;
          const c2Cur = (game.coins.get(p2.id) ?? 0) + refund;
          game.coins.set(p1.id, c1Cur);
          game.coins.set(p2.id, c2Cur);
          setLucky9UserCoins(p1.id, c1Cur);
          setLucky9UserCoins(p2.id, c2Cur);
        } else if (nat1 === 'natural_9') {
          game.winner = p1.id;
          game.winnerReason = `${p1.username} wins with Natural 9!`;
          game.bankerMessage = `Banker: Lucky 9! ${p1.username} wins ${matchBet.toLocaleString()} coins from ${p2.username}! Total pot awarded.`;
          const c1Cur = (game.coins.get(p1.id) ?? 0) + totalPot;
          game.coins.set(p1.id, c1Cur);
          setLucky9UserCoins(p1.id, c1Cur);
        } else if (nat2 === 'natural_9') {
          game.winner = p2.id;
          game.winnerReason = `${p2.username} wins with Natural 9!`;
          game.bankerMessage = `Banker: Lucky 9! ${p2.username} wins ${matchBet.toLocaleString()} coins from ${p1.username}! Total pot awarded.`;
          const c2Cur = (game.coins.get(p2.id) ?? 0) + totalPot;
          game.coins.set(p2.id, c2Cur);
          setLucky9UserCoins(p2.id, c2Cur);
        } else if (nat1 === 'natural_8' && nat2 === 'natural_8') {
          game.winner = 'tie';
          game.winnerReason = 'Both players dealt Natural 8! Push (Tie).';
          game.bankerMessage = 'Banker: Both players hold Natural 8. It is a draw! Bets returned.';
          const refund = Math.floor(totalPot / 2);
          const c1Cur = (game.coins.get(p1.id) ?? 0) + refund;
          const c2Cur = (game.coins.get(p2.id) ?? 0) + refund;
          game.coins.set(p1.id, c1Cur);
          game.coins.set(p2.id, c2Cur);
          setLucky9UserCoins(p1.id, c1Cur);
          setLucky9UserCoins(p2.id, c2Cur);
        } else if (nat1 === 'natural_8') {
          game.winner = p1.id;
          game.winnerReason = `${p1.username} wins with Natural 8!`;
          game.bankerMessage = `Banker: ${p1.username} wins ${matchBet.toLocaleString()} coins from ${p2.username} with Natural 8!`;
          const c1Cur = (game.coins.get(p1.id) ?? 0) + totalPot;
          game.coins.set(p1.id, c1Cur);
          setLucky9UserCoins(p1.id, c1Cur);
        } else if (nat2 === 'natural_8') {
          game.winner = p2.id;
          game.winnerReason = `${p2.username} wins with Natural 8!`;
          game.bankerMessage = `Banker: ${p2.username} wins ${matchBet.toLocaleString()} coins from ${p1.username} with Natural 8!`;
          const c2Cur = (game.coins.get(p2.id) ?? 0) + totalPot;
          game.coins.set(p2.id, c2Cur);
          setLucky9UserCoins(p2.id, c2Cur);
        }
        broadcastLucky9State(room);
        return;
      }

      // No Naturals: Proceed to Player 1 Turn
      game.status = 'player_turn';
      game.currentTurnPlayerId = p1.id;
      const s1 = calcServerLucky9Score(h1);
      if (s1 <= 4) {
        game.bankerMessage = `Banker: ${p1.username}'s score is ${s1} (0-4). Rule: Must Hit (Draw 3rd Card).`;
      } else if (s1 === 5) {
        game.bankerMessage = `Banker: ${p1.username}'s score is 5. Rule: Choice to Hit or Stand.`;
      } else {
        game.bankerMessage = `Banker: ${p1.username}'s score is ${s1} (6-7). Rule: Must Stand. Turn moves to ${p2.username}.`;
        game.currentTurnPlayerId = p2.id;
      }
      broadcastLucky9State(room);
    }, 1200);
  });

  socket.on('lucky9:hit', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.lucky9Game) return;
    const game = room.lucky9Game;
    if (game.status !== 'player_turn' || game.currentTurnPlayerId !== currentPlayerId) return;

    const hand = game.playerHands.get(currentPlayerId) || [];
    if (hand.length >= 3) return;

    const card = game.deck.pop();
    if (card) hand.push(card);
    game.playerHands.set(currentPlayerId, hand);

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const p1 = activePlayers[0];
    const p2 = activePlayers[1];

    if (currentPlayerId === p1?.id) {
      // Move to Player 2
      game.currentTurnPlayerId = p2?.id || null;
      const h2 = game.playerHands.get(p2?.id || '') || [];
      const s2 = calcServerLucky9Score(h2);
      if (s2 <= 4) {
        game.bankerMessage = `Banker: ${p2?.username}'s score is ${s2}. Must Hit (Draw 3rd Card).`;
      } else if (s2 === 5) {
        game.bankerMessage = `Banker: ${p2?.username}'s score is 5. Choice to Hit or Stand.`;
      } else {
        game.bankerMessage = `Banker: ${p2?.username}'s score is ${s2}. Stands. Proceeding to showdown!`;
        resolveLucky9Showdown(room);
        return;
      }
      broadcastLucky9State(room);
    } else {
      // Player 2 hit -> Showdown
      resolveLucky9Showdown(room);
    }
  });

  socket.on('lucky9:stand', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.lucky9Game) return;
    const game = room.lucky9Game;
    if (game.status !== 'player_turn' || game.currentTurnPlayerId !== currentPlayerId) return;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const p1 = activePlayers[0];
    const p2 = activePlayers[1];

    if (currentPlayerId === p1?.id) {
      // Move to Player 2
      game.currentTurnPlayerId = p2?.id || null;
      const h2 = game.playerHands.get(p2?.id || '') || [];
      const s2 = calcServerLucky9Score(h2);
      if (s2 <= 4) {
        game.bankerMessage = `Banker: ${p1.username} stands. ${p2?.username}'s score is ${s2}. Must Hit.`;
      } else if (s2 === 5) {
        game.bankerMessage = `Banker: ${p1.username} stands. ${p2?.username} may Hit or Stand.`;
      } else {
        game.bankerMessage = `Banker: Both players stand. Proceeding to showdown!`;
        resolveLucky9Showdown(room);
        return;
      }
      broadcastLucky9State(room);
    } else {
      // Player 2 stands -> Showdown
      resolveLucky9Showdown(room);
    }
  });

  function resolveLucky9Showdown(room: ServerRoom) {
    if (!room.lucky9Game) return;
    const game = room.lucky9Game;
    const activePlayers = room.state.players.filter(p => p.isConnected);
    const p1 = activePlayers[0];
    const p2 = activePlayers[1];

    const h1 = game.playerHands.get(p1?.id || '') || [];
    const h2 = game.playerHands.get(p2?.id || '') || [];
    const s1 = calcServerLucky9Score(h1);
    const s2 = calcServerLucky9Score(h2);
    const matchBet = Math.floor(game.pot / 2);

    game.status = 'round_over';
    game.currentTurnPlayerId = null;

    if (s1 > s2) {
      game.winner = p1.id;
      game.winnerReason = `${p1.username} score ${s1} beats ${p2.username} score ${s2}!`;
      game.bankerMessage = `Banker: Showdown! ${p1.username} (${s1} pts) beats ${p2.username} (${s2} pts). ${p1.username} wins ${matchBet.toLocaleString()} coins from ${p2.username}!`;
      const c1Cur = (game.coins.get(p1.id) ?? 0) + game.pot;
      game.coins.set(p1.id, c1Cur);
      setLucky9UserCoins(p1.id, c1Cur);
      setLucky9UserCoins(p2.id, game.coins.get(p2.id) ?? 0);
    } else if (s2 > s1) {
      game.winner = p2.id;
      game.winnerReason = `${p2.username} score ${s2} beats ${p1.username} score ${s1}!`;
      game.bankerMessage = `Banker: Showdown! ${p2.username} (${s2} pts) beats ${p1.username} (${s1} pts). ${p2.username} wins ${matchBet.toLocaleString()} coins from ${p1.username}!`;
      const c2Cur = (game.coins.get(p2.id) ?? 0) + game.pot;
      game.coins.set(p2.id, c2Cur);
      setLucky9UserCoins(p2.id, c2Cur);
      setLucky9UserCoins(p1.id, game.coins.get(p1.id) ?? 0);
    } else {
      game.winner = 'tie';
      game.winnerReason = `Push! Both players tied at ${s1} points.`;
      game.bankerMessage = `Banker: Standoff! Both players scored ${s1} points. Bets refunded!`;
      const refund = Math.floor(game.pot / 2);
      const c1Cur = (game.coins.get(p1.id) ?? 0) + refund;
      const c2Cur = (game.coins.get(p2.id) ?? 0) + refund;
      game.coins.set(p1.id, c1Cur);
      game.coins.set(p2.id, c2Cur);
      setLucky9UserCoins(p1.id, c1Cur);
      setLucky9UserCoins(p2.id, c2Cur);
    }

    broadcastLucky9State(room);
  }

  socket.on('lucky9:new_round', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initLucky9Game(room);
  });

  // ==================== 7c. WORD BOMB MULTIPLAYER HANDLERS ====================
  socket.on('bomb:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.bombGame) {
      initBombGame(room);
    } else {
      broadcastBombState(room);
    }
  });

  socket.on('bomb:submit_word', ({ word }: { word: string }) => {
    if (!currentRoomId || !currentPlayerId || !word) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.bombGame || room.bombGame.status !== 'playing') return;

    const game = room.bombGame;
    // Check turn
    if (game.currentTurnPlayerId !== currentPlayerId) {
      socket.emit('bomb:error', { message: 'Not your turn!' });
      return;
    }

    const cleanWord = word.trim().toUpperCase();
    if (!cleanWord.includes(game.prompt)) {
      socket.emit('bomb:error', { message: `Must contain "${game.prompt}"!` });
      return;
    }

    if (game.usedWords.includes(cleanWord)) {
      socket.emit('bomb:error', { message: `"${cleanWord}" was already used!` });
      return;
    }

    if (!isValidEnglishWord(cleanWord)) {
      socket.emit('bomb:error', { message: `"${cleanWord}" is not recognized in the dictionary.` });
      return;
    }

    // Word is VALID!
    game.usedWords.push(cleanWord);
    game.defusedCount += 1;

    const basePts = 100 + (cleanWord.length * 15) + (game.timeLeft * 10);
    const currScore = (game.playerScores.get(currentPlayerId) || 0) + basePts;
    game.playerScores.set(currentPlayerId, currScore);

    const playerObj = room.state.players.find(p => p.id === currentPlayerId);
    if (playerObj) {
      playerObj.score = (playerObj.score || 0) + basePts;
    }

    io.to(room.id).emit('bomb:sound', { sound: 'defuse' });

    // Pick next prompt & pass bomb to next alive player
    const nextPromptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
    game.prompt = nextPromptObj.prompt;

    const activeList = room.state.players.filter(p => p.isConnected);
    const currentIdx = activeList.findIndex(p => p.id === currentPlayerId);
    let nextIdx = (currentIdx + 1) % activeList.length;
    while ((game.playerLives.get(activeList[nextIdx].id) || 0) <= 0) {
      nextIdx = (nextIdx + 1) % activeList.length;
    }

    const nextPlayer = activeList[nextIdx];
    game.currentTurnPlayerId = nextPlayer.id;
    const baseTime = Math.max(5, 10 - Math.floor(game.defusedCount / 4));
    game.timeLeft = baseTime;
    game.totalTime = baseTime;

    broadcastBombState(room, `🎉 ${playerObj?.username || 'Player'} played "${cleanWord}" (+${basePts} pts)! Bomb passed to ${nextPlayer.username}!`);
  });

  socket.on('bomb:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initBombGame(room);
  });

  // Legacy relay support for Word Bomb
  socket.on('bomb:word_submit', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:word_submit', data);
  });

  socket.on('bomb:explode', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:explode', data);
  });

  socket.on('bomb:game_end', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:game_end', data);
  });

  // ==================== 7d. TRIVIA DASH MULTIPLAYER HANDLERS ====================
  socket.on('trivia:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.triviaGame) {
      initTriviaGame(room);
    } else {
      broadcastTriviaState(room);
    }
  });

  socket.on('trivia:answer', ({ optionIndex }: { optionIndex: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.triviaGame || room.triviaGame.status !== 'playing') return;

    const game = room.triviaGame;
    if (game.playerAnswers.has(currentPlayerId)) return; // Already answered

    const currentQ = game.questions[game.currentIndex];
    const isCorrect = optionIndex === currentQ.correctIndex;

    let earned = 0;
    if (isCorrect) {
      const currentStreak = (game.playerStreaks.get(currentPlayerId) || 0) + 1;
      game.playerStreaks.set(currentPlayerId, currentStreak);
      earned = currentQ.points + Math.floor(game.timeLeft * 8) + (currentStreak > 1 ? currentStreak * 25 : 0);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }
    } else {
      game.playerStreaks.set(currentPlayerId, 0);
    }

    game.playerAnswers.set(currentPlayerId, {
      optionIndex,
      isCorrect,
      points: earned,
    });

    socket.emit('trivia:answer_result', { isCorrect, points: earned, correctIndex: currentQ.correctIndex });

    // If all connected players have answered, immediately end the round
    const activeCount = room.state.players.filter(p => p.isConnected).length;
    if (game.playerAnswers.size >= activeCount) {
      endTriviaRound(room);
    } else {
      broadcastTriviaState(room);
    }
  });

  socket.on('trivia:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initTriviaGame(room);
  });

  // ==================== 7e. BUGTONG-BUGTONG MULTIPLAYER HANDLERS ====================
  socket.on('bugtong:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    if (!room.bugtongGame) initBugtongGame(room);
    else broadcastBugtongState(room);
  });

  socket.on('bugtong:answer', ({ optionIndex }: { optionIndex: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    const game = room?.bugtongGame;
    if (!room || !game || game.status !== 'playing' || game.playerAnswers.has(currentPlayerId)) return;
    const question = game.questions[game.currentIndex];
    const validIndex = Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex <= 3;
    const isCorrect = validIndex && optionIndex === question.correctIndex;
    const earned = 0;
    if (isCorrect) game.playerCorrectCounts.set(currentPlayerId, (game.playerCorrectCounts.get(currentPlayerId) || 0) + 1);
    game.playerAnswers.set(currentPlayerId, { optionIndex: validIndex ? optionIndex : -1, isCorrect, points: earned });
    socket.emit('bugtong:answer_result', { isCorrect, points: earned, correctIndex: question.correctIndex });
    const activeCount = room.state.players.filter(player => player.isConnected).length;
    if (game.playerAnswers.size >= activeCount) endBugtongRound(room);
    else broadcastBugtongState(room);
  });

  socket.on('bugtong:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (room) initBugtongGame(room);
  });

  // ==================== 7g. 4 PICS 1 WORD MULTIPLAYER HANDLERS ====================
  socket.on('fourpics:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    if (!room.fourPicsGame) initFourPicsGame(room);
    else broadcastFourPicsState(room);
  });

  socket.on('fourpics:answer', ({ answer }: { answer: string }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    const game = room?.fourPicsGame;
    if (!room || !game || game.status !== 'playing' || game.answers.has(currentPlayerId)) return;
    if (game.activeAnswererId && game.activeAnswererId !== currentPlayerId) {
      socket.emit('fourpics:answer_result', { correct: false, points: 0, message: 'You are supporting your selected teammate this round.' });
      return;
    }
    const normalized = String(answer || '').trim().toUpperCase();
    const correct = normalized === game.puzzles[game.currentIndex].word;
    const points = 0;
    if (correct) game.correctCounts.set(currentPlayerId, (game.correctCounts.get(currentPlayerId) || 0) + 1);
    game.answers.set(currentPlayerId, { answer: normalized, correct, points });
    socket.emit('fourpics:answer_result', { correct, points, message: correct ? 'Correct! Your answer was recorded.' : 'Not quite. Try again next round.' });
    if (correct || game.activeAnswererId) endFourPicsRound(room);
    else broadcastFourPicsState(room);
  });

  socket.on('fourpics:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (room) initFourPicsGame(room);
  });

  // ==================== 7h. SPEED DUEL MULTIPLAYER HANDLERS ====================
  socket.on('duel:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.duelGame) {
      initDuelGame(room);
    } else {
      broadcastDuelState(room);
    }
  });

  socket.on('duel:submit_strokes', ({ strokeCount, detailScore }: { strokeCount: number; detailScore: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.duelGame) return;

    room.duelGame.playerSubmissions.set(currentPlayerId, { strokeCount, detailScore });
  });

  socket.on('duel:scores', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('duel:scores', data);
  });

  socket.on('duel:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initDuelGame(room);
  });

  // ==================== 7f. ANAGRAM RUSH MULTIPLAYER HANDLERS ====================
  socket.on('anagram:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.anagramGame) {
      initAnagramGame(room);
    } else {
      broadcastAnagramState(room);
    }
  });

  socket.on('anagram:submit_word', ({ word }: { word: string }) => {
    if (!currentRoomId || !currentPlayerId || !word) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.anagramGame || room.anagramGame.status !== 'playing') return;

    const game = room.anagramGame;
    const currentP = game.puzzles[game.currentIndex];
    const cleanWord = word.trim().toUpperCase();

    if (cleanWord === currentP.word.toUpperCase()) {
      // Solved!
      const earned = currentP.points + Math.floor(game.timeLeft * 5);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }

      io.to(room.id).emit('anagram:sound', { sound: 'solve' });
      advanceAnagramPuzzle(room, pObj?.username || 'Player');
    } else {
      socket.emit('anagram:error', { message: 'Incorrect! Try another word.' });
    }
  });

  socket.on('anagram:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initAnagramGame(room);
  });

  // ==================== 7g. EMOJI CHARADES MULTIPLAYER HANDLERS ====================
  socket.on('emoji:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.emojiGame) {
      initEmojiGame(room);
    } else {
      broadcastEmojiState(room);
    }
  });

  socket.on('emoji:guess', ({ guess }: { guess: string }) => {
    if (!currentRoomId || !currentPlayerId || !guess) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.emojiGame || room.emojiGame.status !== 'playing') return;

    const game = room.emojiGame;
    const currentP = game.puzzles[game.currentIndex];
    const sanitizedG = sanitizeWordForComparison(guess);
    const sanitizedA = sanitizeWordForComparison(currentP.answer);

    if (sanitizedG === sanitizedA) {
      // Solved!
      const earned = (currentP.points || 100) + Math.floor(game.timeLeft * 4);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }

      io.to(room.id).emit('emoji:sound', { sound: 'solve' });
      advanceEmojiPuzzle(room, pObj?.username || 'Player');
    } else {
      socket.emit('emoji:error', { message: 'Not quite! Keep guessing.' });
    }
  });

  socket.on('emoji:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initEmojiGame(room);
  });

  // ==================== 7h. UNIVERSAL MINI-GAME SCORE SYNC ====================
  socket.on('game:score_sync', ({ score, detail, finished }: { score: number; detail?: any; finished?: boolean }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const playerObj = room.state.players.find(p => p.id === currentPlayerId);
    if (playerObj) {
      playerObj.score = Math.max(playerObj.score || 0, score);
      if (finished) {
        updateGlobalLeaderboard(playerObj, true);
      }
    }

    // Broadcast live room ranking to all participants
    const leaderboard = room.state.players
      .filter(p => p.isConnected)
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        color: p.color,
        score: p.score || 0,
      }))
      .sort((a, b) => b.score - a.score);

    io.to(room.id).emit('game:leaderboard_update', { leaderboard, detail });
  });

  // 8. Chat / Guess Submission
  socket.on('chat:send', ({ text }: { text: string }) => {
    if (!currentRoomId || !text || text.trim().length === 0) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    const cleanInput = text.trim();
    const isDrawingPhase = room.state.status === 'drawing';
    const isDrawer = room.state.drawerId === sender.id;
    const alreadyGuessed = room.playersWhoGuessed.has(sender.id);

    // If drawing phase, check if input is a guess
    if (isDrawingPhase && !isDrawer && !alreadyGuessed) {
      const sanitizedGuess = sanitizeWordForComparison(cleanInput);
      const sanitizedTarget = sanitizeWordForComparison(room.currentTurnWord);

      if (sanitizedGuess === sanitizedTarget) {
        // CORRECT GUESS!
        room.playersWhoGuessed.add(sender.id);
        sender.hasGuessed = true;

        // Calculate score
        const timeRatio = Math.max(0.15, room.state.timeLeft / room.state.totalTime);
        const speedBonus = Math.round(room.currentWordPoints * timeRatio);
        const streakBonus = sender.streak * 25;
        const totalPointsGained = speedBonus + streakBonus;

        sender.roundScore = totalPointsGained;
        sender.score += totalPointsGained;
        sender.streak += 1;
        sender.guessTime = room.state.totalTime - room.state.timeLeft;

        // Notify Room that player guessed
        const correctMsg: ChatMessage = {
          id: 'guess_' + Date.now(),
          senderId: sender.id,
          senderName: sender.username,
          senderColor: sender.color,
          senderAvatar: sender.avatar,
          text: `🎉 ${sender.username} guessed the word! (+${totalPointsGained} pts)`,
          type: 'correct_guess',
          timestamp: Date.now(),
          pointsAwarded: totalPointsGained,
          scope: 'room',
          profile: getChatProfile(sender),
        };
        io.to(room.id).emit('chat:message', correctMsg);

        // Update player stats
        if (!sender.stats) {
          sender.stats = {
            gamesPlayed: 1,
            wins: 0,
            totalScore: totalPointsGained,
            wordsGuessed: 1,
            drawingsCompleted: 0,
            highestRoundScore: totalPointsGained,
          };
        } else {
          sender.stats.wordsGuessed += 1;
          sender.stats.totalScore += totalPointsGained;
          if (totalPointsGained > sender.stats.highestRoundScore) {
            sender.stats.highestRoundScore = totalPointsGained;
          }
        }

        // Broadcast room state
        io.to(room.id).emit('room:state', sanitizeStateForClient(room));

        // Check if ALL non-drawing players have guessed
        const nonDrawingPlayers = room.state.players.filter(p => p.id !== room.state.drawerId && p.isConnected);
        if (room.playersWhoGuessed.size >= nonDrawingPlayers.length) {
          // Everyone guessed! End round immediately
          if (room.timerInterval) clearInterval(room.timerInterval);
          endTurnCycle(room, 'Everyone guessed the word!');
        }
        return;
      }

      // Check if CLOSE guess (Levenshtein distance <= 2)
      const levDist = calculateLevenshtein(sanitizedGuess, sanitizedTarget);
      if (levDist > 0 && levDist <= 2 && sanitizedTarget.length >= 4) {
        socket.emit('chat:message', {
          id: 'close_' + Date.now(),
          senderName: 'Hint Master',
          text: `🔥 "${cleanInput}" is very close! Keep guessing!`,
          type: 'close_guess',
          timestamp: Date.now(),
        });
        return;
      }
    }

    // Standard Chat Message Broadcast
    const chatMsg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      senderId: sender.id,
      senderName: sender.username,
      senderColor: sender.color,
      senderAvatar: sender.avatar,
      text: cleanInput,
      type: 'chat',
      timestamp: Date.now(),
      reactions: {},
      scope: 'room',
      profile: getChatProfile(sender),
    };
    if (!room.messages) room.messages = [];
    room.messages.push(chatMsg);
    // Keep max 100 recent messages per room
    if (room.messages.length > 100) room.messages.shift();

    io.to(room.id).emit('chat:message', chatMsg);
  });

  socket.on('global:chat_send', ({ text, player }: { text: string; player: Player }) => {
    const cleanInput = String(text || '').trim();
    if (!cleanInput || !player?.id) return;
    globalPlayerId = player.id;

    const chatMsg: ChatMessage = {
      id: 'global_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      senderId: player.id,
      senderName: player.username || 'Player',
      senderColor: player.color,
      senderAvatar: player.avatar,
      isNgip: player.isNgip,
      text: cleanInput,
      type: 'chat',
      timestamp: Date.now(),
      scope: 'global',
      profile: getChatProfile(player),
      reactions: {},
    };
    GLOBAL_CHAT_MESSAGES.push(chatMsg);
    if (GLOBAL_CHAT_MESSAGES.length > 100) GLOBAL_CHAT_MESSAGES.shift();
    io.emit('chat:message', chatMsg);
  });

  // 9. Message Tapback Reaction (iMessage Style Double Tap)
  socket.on('chat:react_message', ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    if (!currentRoomId || !messageId || !emoji) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    if (!room.messages) room.messages = [];
    const targetMsg = room.messages.find(m => m.id === messageId);
    if (!targetMsg) return;

    if (!targetMsg.reactions) targetMsg.reactions = {};

    const userList = targetMsg.reactions[emoji] || [];
    const existingIndex = userList.indexOf(sender.id);

    if (existingIndex >= 0) {
      // Toggle off if already reacted
      userList.splice(existingIndex, 1);
      if (userList.length === 0) {
        delete targetMsg.reactions[emoji];
      } else {
        targetMsg.reactions[emoji] = userList;
      }
    } else {
      // Add reaction
      userList.push(sender.id);
      targetMsg.reactions[emoji] = userList;
    }

    // Broadcast updated reactions for this message to ALL players in the room
    io.to(room.id).emit('chat:message_reaction_update', {
      messageId,
      reactions: targetMsg.reactions,
      reactedBy: {
        userId: sender.id,
        username: sender.username,
        emoji,
      },
    });
  });

  // 9b. Quick Emoji Reaction (Floating arena reactions)
  socket.on('reaction:send', ({ emoji }: { emoji: string }) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    io.to(room.id).emit('reaction:broadcast', {
      senderName: sender.username,
      emoji,
      id: 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
    });
  });

  // 10. Live Profile & Avatar Update
  socket.on('player:profile_update', ({ player }: { player: { id: string; username: string; avatar: string; color?: string; cosmetics?: Player['cosmetics']; stats?: Player['stats']; isNgip?: boolean } }) => {
    if (!player || !player.id) return;

    // Update in current active room
    if (currentRoomId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const p = room.state.players.find(pl => pl.id === player.id);
        if (p) {
          p.username = player.username || p.username;
          p.avatar = player.avatar || p.avatar;
          if (player.color) p.color = player.color;
          if (player.cosmetics) p.cosmetics = player.cosmetics;
          if (player.stats) p.stats = player.stats;
          if (typeof player.isNgip === 'boolean') p.isNgip = player.isNgip;
          io.to(room.id).emit('room:state', sanitizeStateForClient(room));
          saveRoomToFirestore(room).catch(() => {});
        }
      }
    }

    const profile: ChatProfile = {
      id: player.id,
      username: player.username || 'Player',
      avatar: player.avatar || '1',
      color: player.color,
      isNgip: player.isNgip,
      stats: {
        gamesPlayed: player.stats?.gamesPlayed || 0,
        wins: player.stats?.wins || 0,
        losses: player.stats?.losses || 0,
        totalScore: player.stats?.totalScore || 0,
      },
    };
    const updateMessageProfile = (message: ChatMessage) => {
      if (message.senderId !== profile.id) return;
      message.senderName = profile.username;
      message.senderAvatar = profile.avatar;
      message.senderColor = profile.color;
      message.isNgip = profile.isNgip;
      message.profile = profile;
    };
    ROOMS.forEach(room => room.messages.forEach(updateMessageProfile));
    GLOBAL_CHAT_MESSAGES.forEach(updateMessageProfile);
    io.emit('chat:profile_update', { profile });

    // Update in global leaderboard store
    const entry = GLOBAL_STORE.leaderboard.find(
      e => e.userId === player.id || e.username.toLowerCase() === (player.username || '').toLowerCase()
    );
    if (entry) {
      if (player.username) entry.username = player.username;
      if (player.avatar) entry.avatar = player.avatar;
      io.emit('leaderboard:update', GLOBAL_STORE.leaderboard);
      saveLeaderboardEntryToFirestore(entry).catch(() => {});
    }
  });

  // 11. Explicit Leave Room Handler
  socket.on('room:leave', async () => {
    if (currentRoomId && currentPlayerId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const pIndex = room.state.players.findIndex(p => p.id === currentPlayerId);
        if (pIndex >= 0) {
          const departingPlayer = room.state.players[pIndex];
          departingPlayer.isConnected = false;
          clearRoomMessagesForUser(departingPlayer.id, room);

          // If the room owner / host leaves, close the room immediately and return all players to lobby
          if (departingPlayer.isHost) {
            if (room.timerInterval) clearInterval(room.timerInterval);

            // Notify all players in room that the host left and room is dissolved
            io.to(room.id).emit('room:closed', {
              reason: `👑 Room host ${departingPlayer.username || 'Host'} left. The room has been closed.`,
              hostName: departingPlayer.username || 'Host',
            });

            // Disband sockets from room
            io.in(room.id).socketsLeave(room.id);

            // Delete room completely
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
            broadcastPublicRoomsList();
            socket.leave(currentRoomId);
            currentRoomId = null;
            return;
          }

          if (room.state.drawerId === departingPlayer.id && room.state.status === 'drawing') {
            if (room.timerInterval) clearInterval(room.timerInterval);
            endTurnCycle(room, 'Drawer left the game.');
          }

          io.to(room.id).emit('chat:message', {
            id: 'sys_' + Date.now(),
            senderName: 'System',
            text: `🚪 ${departingPlayer.username} left the room.`,
            type: 'system',
            timestamp: Date.now(),
          });

          // Remove room if no active players
          const activeCount = room.state.players.filter(p => p.isConnected).length;
          if (activeCount === 0) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
          } else {
            io.to(room.id).emit('room:state', sanitizeStateForClient(room));
            await saveRoomToFirestore(room).catch(() => {});
            if (room.settings.gameMode === 'lucky_9') {
              initLucky9Game(room);
            }
          }
          broadcastPublicRoomsList();
        }
        socket.leave(currentRoomId);
        currentRoomId = null;
      }
    }
  });

  // 12. Disconnect Handler
  socket.on('disconnect', async () => {
    if (globalPlayerId) clearGlobalMessagesForUser(globalPlayerId);
    if (currentRoomId && currentPlayerId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const pIndex = room.state.players.findIndex(p => p.id === currentPlayerId);
        if (pIndex >= 0) {
          const departingPlayer = room.state.players[pIndex];
          departingPlayer.isConnected = false;
          clearRoomMessagesForUser(departingPlayer.id, room);
          clearGlobalMessagesForUser(departingPlayer.id);

          // If the room owner / host disconnected, close the room immediately and kick players to lobby
          if (departingPlayer.isHost) {
            if (room.timerInterval) clearInterval(room.timerInterval);

            // Notify all players in room that the host disconnected and room is dissolved
            io.to(room.id).emit('room:closed', {
              reason: `👑 Room host ${departingPlayer.username || 'Host'} disconnected. The room has been closed.`,
              hostName: departingPlayer.username || 'Host',
            });

            // Disband sockets from room
            io.in(room.id).socketsLeave(room.id);

            // Delete room completely
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
            broadcastPublicRoomsList();
            return;
          }

          // If was drawer in active turn, skip turn
          if (room.state.drawerId === departingPlayer.id && room.state.status === 'drawing') {
            if (room.timerInterval) clearInterval(room.timerInterval);
            endTurnCycle(room, 'Drawer left the game.');
          }

          io.to(room.id).emit('chat:message', {
            id: 'sys_' + Date.now(),
            senderName: 'System',
            text: `🚪 ${departingPlayer.username} left the room.`,
            type: 'system',
            timestamp: Date.now(),
          });

          // Clean empty rooms
          const activeCount = room.state.players.filter(p => p.isConnected).length;
          if (activeCount === 0) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
          } else {
            io.to(room.id).emit('room:state', sanitizeStateForClient(room));
            await saveRoomToFirestore(room).catch(() => {});
            if (room.settings.gameMode === 'lucky_9') {
              initLucky9Game(room);
            }
          }
          broadcastPublicRoomsList();
        }
      }
    }
  });
});

// Broadcast Helper
function broadcastPublicRoomsList() {
  io.emit('rooms:list', getPublicRoomsList());
}

// Game Turn & Round Engine (drawing mode)
function startTurnCycle(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 2) {
    room.state.status = 'lobby';
    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    io.to(room.id).emit('chat:message', {
      id: 'sys_' + Date.now(),
      senderName: 'System',
      text: '⚠️ Not enough players to continue. Returning to lobby.',
      type: 'system',
      timestamp: Date.now(),
    });
    saveRoomToFirestore(room).catch(() => {});
    return;
  }

  // Pick Drawer
  if (room.drawerIndex >= activePlayers.length) {
    room.drawerIndex = 0;
    room.state.currentRound += 1;
  }

  // Check Game Over
  if (room.state.currentRound > room.state.totalRounds) {
    handleGameOver(room);
    return;
  }

  const drawer = activePlayers[room.drawerIndex];
  room.state.drawerId = drawer.id;
  room.state.drawerName = drawer.username;

  // Reset player turn statuses
  room.state.players.forEach(p => {
    p.isDrawing = p.id === drawer.id;
    p.hasGuessed = false;
    p.roundScore = 0;
  });

  room.playersWhoGuessed.clear();
  room.drawingHistory = [];
  room.wordSelected = false;

  // Generate 3 word choices
  const choices = getRandomWordChoices(room.settings.wordCategory);
  room.state.wordChoices = choices;
  room.state.status = 'selecting_word';
  room.state.timeLeft = 12; // 12 seconds to choose a word
  room.state.totalTime = 12;
  room.state.word = '';
  room.state.hint = '';
  room.state.revealedIndices = [];

  io.to(room.id).emit('canvas:clear');
  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Drawer notification
  const drawerSocket = io.sockets.sockets.get(drawer.socketId || '');
  if (drawerSocket) {
    drawerSocket.emit('drawer:turn_start', { choices });
  }

  io.to(room.id).emit('chat:message', {
    id: 'turn_' + Date.now(),
    senderName: 'Game Master',
    text: `🎨 Round ${room.state.currentRound}/${room.state.totalRounds}: ${drawer.username} is choosing a word!`,
    type: 'drawer_turn',
    timestamp: Date.now(),
  });

  // Timer for word selection
  room.timerInterval = setInterval(() => {
    room.state.timeLeft -= 1;
    if (room.state.timeLeft <= 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      if (!room.wordSelected) {
        // Auto-select medium choice
        const autoChoice = choices[1] || choices[0];
        room.currentTurnWord = autoChoice.word;
        room.currentWordPoints = autoChoice.points;
        room.wordSelected = true;
        room.state.word = autoChoice.word;
        room.state.wordLength = autoChoice.word.length;
        room.state.hint = autoChoice.hint || '';
        beginDrawingPhase(room);
      }
    } else {
      io.to(room.id).emit('room:timer', { timeLeft: room.state.timeLeft });
    }
  }, 1000);
}

function beginDrawingPhase(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'drawing';
  room.state.timeLeft = room.settings.roundDuration;
  room.state.totalTime = room.settings.roundDuration;
  room.state.revealedIndices = [];

  const drawer = room.state.players.find(p => p.id === room.state.drawerId);

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Bot simulation only when explicitly enabled
  triggerBotSimulationIfNeeded(room);

  // Interval for drawing turn
  room.timerInterval = setInterval(() => {
    room.state.timeLeft -= 1;

    // Hint letter reveal calculation
    if (room.settings.allowHints && room.state.wordLength > 3) {
      const timeRemainingPercent = room.state.timeLeft / room.state.totalTime;
      if (timeRemainingPercent <= 0.5 && room.state.revealedIndices.length === 0) {
        const availableIndices = room.currentTurnWord
          .split('')
          .map((c, i) => (c !== ' ' ? i : -1))
          .filter(i => i >= 0);
        if (availableIndices.length > 0) {
          const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          room.state.revealedIndices.push(randomIndex);
          io.to(room.id).emit('room:hint_update', {
            revealedIndices: room.state.revealedIndices,
            maskedHint: getMaskedHint(room.currentTurnWord, room.state.revealedIndices),
          });
        }
      } else if (timeRemainingPercent <= 0.25 && room.state.revealedIndices.length === 1 && room.state.wordLength >= 6) {
        const availableIndices = room.currentTurnWord
          .split('')
          .map((c, i) => (c !== ' ' && !room.state.revealedIndices.includes(i) ? i : -1))
          .filter(i => i >= 0);
        if (availableIndices.length > 0) {
          const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          room.state.revealedIndices.push(randomIndex);
          io.to(room.id).emit('room:hint_update', {
            revealedIndices: room.state.revealedIndices,
            maskedHint: getMaskedHint(room.currentTurnWord, room.state.revealedIndices),
          });
        }
      }
    }

    if (room.state.timeLeft <= 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      endTurnCycle(room, `Time is up! The word was "${room.currentTurnWord}"`);
    } else {
      io.to(room.id).emit('room:timer', { timeLeft: room.state.timeLeft });
    }
  }, 1000);
}

function triggerBotSimulationIfNeeded(room: ServerRoom) {
  // Don't simulate bots unless the room explicitly enabled them
  if (!room.settings.botPlayersEnabled) return;

  const bots = room.state.players.filter(p => typeof p.id === 'string' && p.id.startsWith('bot_'));
  if (bots.length === 0) return;

  bots.forEach(bot => {
    if (bot.id === room.state.drawerId) {
      // Bot is drawing: emit some sample doodles
      setTimeout(() => {
        if (room.state.status === 'drawing' && room.state.drawerId === bot.id) {
          const samplePoints = [
            { x: 300, y: 300 },
            { x: 400, y: 320 },
            { x: 500, y: 300 },
            { x: 450, y: 500 },
            { x: 350, y: 500 },
            { x: 300, y: 300 },
          ];
          const strokeAction: CanvasAction = {
            id: 'bot_stroke_' + Date.now(),
            type: 'stroke',
            color: '#3B82F6',
            size: 4,
            points: samplePoints,
          };
          room.drawingHistory.push(strokeAction);
          io.to(room.id).emit('draw:action', strokeAction);
        }
      }, 2000);
    } else {
      // Bot is guessing: simulate guess after realistic delay
      const guessDelay = (Math.floor(Math.random() * 15) + 8) * 1000;
      setTimeout(() => {
        if (room.state.status === 'drawing' && !room.playersWhoGuessed.has(bot.id)) {
          room.playersWhoGuessed.add(bot.id);
          bot.hasGuessed = true;
          const score = Math.round(room.currentWordPoints * 0.7);
          bot.score += score;
          bot.roundScore = score;
          io.to(room.id).emit('chat:message', {
            id: 'bot_guess_' + Date.now(),
            senderName: bot.username,
            senderAvatar: bot.avatar,
            text: `🎉 ${bot.username} guessed the word! (+${score} pts)`,
            type: 'correct_guess',
            timestamp: Date.now(),
            pointsAwarded: score,
          });
          io.to(room.id).emit('room:state', sanitizeStateForClient(room));
        }
      }, guessDelay);
    }
  });
}

function endTurnCycle(room: ServerRoom, reason: string) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'round_end';
  const drawer = room.state.players.find(p => p.id === room.state.drawerId);

  // Calculate drawer bonus (points for each player who guessed)
  const guesserCount = room.playersWhoGuessed.size;
  const nonDrawingCount = Math.max(1, room.state.players.filter(p => p.id !== room.state.drawerId && p.isConnected).length);
  let drawerBonus = 0;

  if (drawer && guesserCount > 0) {
    const guessRatio = guesserCount / nonDrawingCount;
    drawerBonus = Math.round(room.currentWordPoints * 0.6 * guessRatio);
    drawer.score += drawerBonus;
    drawer.roundScore = drawerBonus;
    if (drawer.stats) drawer.stats.drawingsCompleted += 1;
  }

  // Build round summary
  const correctGuessers = room.state.players
    .filter(p => room.playersWhoGuessed.has(p.id))
    .map(p => ({
      playerId: p.id,
      name: p.username,
      scoreGained: p.roundScore,
      time: p.guessTime || 0,
    }));

  room.state.roundSummary = {
    word: room.currentTurnWord,
    drawerBonus,
    correctGuessers,
  };

  io.to(room.id).emit('chat:message', {
    id: 'reveal_' + Date.now(),
    senderName: 'Game Master',
    text: `✨ Word revealed: "${room.currentTurnWord}"! ${reason}`,
    type: 'word_reveal',
    timestamp: Date.now(),
  });

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Save room snapshot and activity
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'round_end', roomId: room.id, reason }).catch(() => {});

  // Advance drawer index
  room.drawerIndex += 1;

  // 6 seconds delay before next turn
  setTimeout(() => {
    if (ROOMS.has(room.id)) {
      startTurnCycle(room);
    }
  }, 6000);
}

function handleGameOver(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'game_over';

  // Sort players by score
  const sortedPlayers = [...room.state.players].sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0] || null;
  room.state.winner = winner;

  // Update global leaderboard and player lifetime stats
  sortedPlayers.forEach((player, idx) => {
    const isWinner = idx === 0 && player.score > 0;
    updateGlobalLeaderboard(player, isWinner);
  });

  io.to(room.id).emit('chat:message', {
    id: 'gameover_' + Date.now(),
    senderName: 'Game Master',
    text: `🏆 GAME OVER! 🥇 Winner: ${winner?.username} with ${winner?.score} points!`,
    type: 'system',
    timestamp: Date.now(),
  });

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Save final room (and optionally archive)
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'game_over', roomId: room.id, winner: winner?.id }).catch(() => {});
}

// Sanitize State: Mask secret word for guessers during drawing phase
function createStandardChessBoard(): Array<Array<{ type: string; color: 'w' | 'b' } | null>> {
  const board: Array<Array<{ type: string; color: 'w' | 'b' } | null>> = Array.from({ length: 8 }, () => Array(8).fill(null));

  const pieces: Array<string> = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  pieces.forEach((type, col) => {
    board[0][col] = { type, color: 'b' };
    board[7][col] = { type, color: 'w' };
  });

  for (let col = 0; col < 8; col += 1) {
    board[1][col] = { type: 'p', color: 'b' };
    board[6][col] = { type: 'p', color: 'w' };
  }

  return board;
}

function initChessGame(room: ServerRoom) {
  room.state.status = 'drawing';
  room.state.currentRound = 1;
  room.chessGame = {
    board: createStandardChessBoard(),
    turn: 'w',
    winner: null,
    gameState: 'playing',
    lastMove: null,
    moveHistory: [],
    capturedByWhite: [],
    capturedByBlack: [],
  };
  room.state.chess = {
    board: room.chessGame.board,
    turn: room.chessGame.turn,
    winner: room.chessGame.winner,
    gameState: room.chessGame.gameState,
    lastMove: room.chessGame.lastMove,
    moveHistory: room.chessGame.moveHistory,
    capturedByWhite: room.chessGame.capturedByWhite,
    capturedByBlack: room.chessGame.capturedByBlack,
  };
  io.to(room.id).emit('room:state', sanitizeStateForClient(room));
}

function sanitizeStateForClient(room: ServerRoom): GameState {
  const isDrawing = room.state.status === 'drawing';
  const maskedWord = isDrawing
    ? getMaskedHint(room.currentTurnWord, room.state.revealedIndices)
    : room.currentTurnWord;

  return {
    ...room.state,
    word: maskedWord,
    chess: room.chessGame
      ? {
          board: room.chessGame.board,
          turn: room.chessGame.turn,
          winner: room.chessGame.winner,
          gameState: room.chessGame.gameState,
          lastMove: room.chessGame.lastMove,
          moveHistory: room.chessGame.moveHistory,
          capturedByWhite: room.chessGame.capturedByWhite,
          capturedByBlack: room.chessGame.capturedByBlack,
        }
      : undefined,
  };
}

function broadcastArcadeRaceState(room: ServerRoom) {
  const race = room.arcadeRace;
  if (!race) return;
  const scores = Array.from(race.scores.entries()).map(([id, score]) => ({ id, score }));
  io.to(room.id).emit('arcade:race_state', {
    mode: race.mode,
    status: race.status,
    timeLeft: race.timeLeft,
    scores,
  });
}

function initArcadeRace(room: ServerRoom) {
  if (room.arcadeRace?.timerInterval) clearInterval(room.arcadeRace.timerInterval);
  const mode = room.settings.gameMode || 'multiplayer_draw';
  const scores = new Map<string, number>();
  getConnectedHumanPlayers(room).forEach(player => scores.set(player.id, player.score || 0));
  const race: ServerArcadeRace = {
    mode,
    status: 'playing',
    timeLeft: 60,
    scores,
    finished: new Set<string>(),
  };
  room.arcadeRace = race;
  race.timerInterval = setInterval(() => {
    race.timeLeft -= 1;
    if (race.timeLeft <= 0) {
      race.timeLeft = 0;
      race.status = 'game_over';
      if (race.timerInterval) clearInterval(race.timerInterval);
    }
    broadcastArcadeRaceState(room);
    if (race.status === 'game_over') {
      room.state.status = 'game_over';
      io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    }
  }, 1000);
  broadcastArcadeRaceState(room);
}

/**
 * UNO stub: put room in UNO state (not a full engine yet).
 * Replace with a full implementation when ready.
 */
function startUnoGame(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'drawing';
  // UNO doesn't use drawing state/word; clear to avoid confusion
  room.drawingHistory = [];
  room.currentTurnWord = '';
  room.currentWordPoints = 0;
  room.wordSelected = false;
  // Broadcast UNO state
  io.to(room.id).emit('room:state', sanitizeStateForClient(room));
  io.to(room.id).emit('chat:message', {
    id: 'uno_' + Date.now(),
    senderName: 'Game Master',
    text: `🃏 UNO lobby ready. (This is a server stub — full UNO engine not implemented yet.)`,
    type: 'system',
    timestamp: Date.now(),
  });

  // Save room snapshot and activity (best-effort)
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'uno_lobby', roomId: room.id }).catch(() => {});
}

// Start Server and Vite Middleware
async function startServer() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Guess What? Game Server running on port ${PORT}`);
  });
}

startServer();
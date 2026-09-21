import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  GameState,
  ChatMessage,
  CanvasAction,
  LeaderboardEntry,
  RoomSummary,
  RoomSettings,
  WordChoice,
  Player,
  ArcadeGameMode,
  ChatProfile,
} from '../types';
import { getSocket, getServerUrl, setCustomServerUrl, reconnectSocket } from '../services/socket';
import { useAuth } from './AuthContext';
import { soundManager } from '../utils/soundEffects';
import { subscribeToFirestoreLeaderboard } from '../services/firebase';
import confetti from 'canvas-confetti';

interface ReactionItem {
  id: string;
  senderName: string;
  emoji: string;
  x: number;
}

interface GameContextType {
  gameState: GameState | null;
  messages: ChatMessage[];
  globalMessages: ChatMessage[];
  drawingHistory: CanvasAction[];
  isHost: boolean;
  isDrawer: boolean;
  currentPlayer: Player | null;
  globalLeaderboard: LeaderboardEntry[];
  publicRooms: RoomSummary[];
  reactions: ReactionItem[];
  errorMessage: string | null;
  isConnected: boolean;
  serverUrl: string;
  updateServerUrl: (url: string | null) => void;
  clearError: () => void;
  createRoom: (settings: RoomSettings, roomName?: string) => void;
  joinRoom: (roomIdentifier: string) => void;
  quickJoin: (mode?: ArcadeGameMode) => void;
  startGame: () => void;
  selectWord: (choice: WordChoice) => void;
  sendCanvasAction: (action: CanvasAction) => void;
  clearCanvas: () => void;
  sendMessage: (text: string) => void;
  sendGlobalMessage: (text: string) => void;
  sendReaction: (emoji: string) => void;
  reactToMessage: (messageId: string, emoji: string) => void;
  leaveRoom: () => void;
  fetchPublicRooms: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateStats } = useAuth();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [globalMessages, setGlobalMessages] = useState<ChatMessage[]>([]);
  const [drawingHistory, setDrawingHistory] = useState<CanvasAction[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(() => getSocket().connected);
  const [serverUrl, setServerUrlState] = useState<string>(() => getServerUrl());

  const userRef = useRef(user);
  userRef.current = user;
  const updateStatsRef = useRef(updateStats);
  updateStatsRef.current = updateStats;

  const prevRoundRef = useRef<number>(1);
  const prevStatusRef = useRef<string>('lobby');

  const currentPlayer = gameState && user
    ? gameState.players.find(p => p.id === user.id) || null
    : null;

  const isDrawer = Boolean(gameState && user && gameState.drawerId === user.id);

  // Clear error notice
  const clearError = () => setErrorMessage(null);

  // Socket listener bindings
  useEffect(() => {
    const socket = getSocket();

    const handleRoomState = (state: GameState) => {
      setGameState(prevState => {
        // Trigger sounds & confetti on state transitions
        if (prevState) {
          if (prevState.status !== 'drawing' && state.status === 'drawing') {
            soundManager.playTurnStart();
          }
          // If drawer just finished a drawing round
          if (prevState.status === 'drawing' && (state.status === 'round_end' || state.status === 'selecting_word')) {
            const currentUser = userRef.current;
            if (currentUser && prevState.drawerId === currentUser.id) {
              updateStatsRef.current(
                { drawingsCompleted: 1 },
                false,
                'Drawing Room'
              );
            }
          }
          if (prevState.status !== 'game_over' && state.status === 'game_over') {
            soundManager.playVictory();
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
            // Update stats
            const currentUser = userRef.current;
            if (currentUser) {
              const myResult = state.players.find(p => p.id === currentUser.id || p.username === currentUser.username);
              const isWinner = state.winner?.id === currentUser.id || state.winner?.username === currentUser.username;
              const myScore = myResult?.score || 0;
              updateStatsRef.current(
                {
                  gamesPlayed: 1,
                  wins: isWinner ? 1 : 0,
                  losses: isWinner ? 0 : 1,
                  totalScore: myScore,
                },
                isWinner,
                'Multiplayer Drawing'
              );
            }
          }
        }
        return state;
      });
    };

    const handleRoomJoined = ({ room, isHost: hostStatus }: { room: GameState; isHost: boolean }) => {
      window.dispatchEvent(new CustomEvent('guesswhat:score_context', { detail: 'multiplayer' }));
      setGameState(room);
      setIsHost(hostStatus);
      setMessages([]);
      setDrawingHistory([]);
      setErrorMessage(null);
    };

    const handleDrawAction = (action: CanvasAction) => {
      if (action.type === 'clear') {
        setDrawingHistory([]);
      } else {
        setDrawingHistory(prev => [...prev, action]);
      }
    };

    const handleCanvasClear = () => {
      setDrawingHistory([]);
    };

    const handleCanvasHistory = (history: CanvasAction[]) => {
      setDrawingHistory(history);
    };

    const handleChatMessage = (msg: ChatMessage) => {
      if (msg.scope === 'global') {
        setGlobalMessages(prev => [...prev, msg].slice(-100));
        return;
      }
      setMessages(prev => [...prev, msg]);

      if (msg.type === 'correct_guess') {
        soundManager.playCorrectGuess();
        confetti({
          particleCount: 40,
          spread: 50,
          origin: { y: 0.7 },
        });

        const currentUser = userRef.current;
        if (currentUser && (msg.senderId === currentUser.id || msg.senderName === currentUser.username)) {
          const pts = msg.pointsAwarded || 100;
          updateStatsRef.current(
            {
              wordsGuessed: 1,
              totalScore: pts,
              highestRoundScore: pts,
            },
            false,
            'Multiplayer Drawing'
          );
        }
      } else if (msg.type === 'close_guess') {
        soundManager.playCloseGuess();
      }
    };

    const handleGlobalMessagesCleared = ({ userId }: { userId: string }) => {
      setGlobalMessages(prev => prev.filter(message => message.senderId !== userId));
    };

    const handleGlobalHistory = (history: ChatMessage[]) => {
      setGlobalMessages(history.slice(-100));
    };

    const handleRoomMessagesCleared = ({ userId }: { userId: string }) => {
      setMessages(prev => prev.filter(message => message.senderId !== userId));
    };

    const handleChatProfileUpdate = ({ profile }: { profile: ChatProfile }) => {
      const updateMessages = (items: ChatMessage[]) => items.map(message => (
        message.senderId === profile.id
          ? {
              ...message,
              senderName: profile.username,
              senderAvatar: profile.avatar,
              senderColor: profile.color,
              isNgip: profile.isNgip,
              profile,
            }
          : message
      ));
      setMessages(updateMessages);
      setGlobalMessages(updateMessages);
    };

    const handleReactionBroadcast = ({ senderName, emoji, id }: { senderName: string; emoji: string; id: string }) => {
      const rxItem: ReactionItem = {
        id,
        senderName,
        emoji,
        x: Math.random() * 70 + 15, // random percentage for animation
      };
      setReactions(prev => [...prev, rxItem]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== id));
      }, 2500);
    };

    const handleLeaderboardUpdate = (socketLb: LeaderboardEntry[]) => {
      setGlobalLeaderboard(prev => {
        if (!socketLb || socketLb.length === 0) return prev;
        const map = new Map<string, LeaderboardEntry>();
        prev.forEach(e => map.set(e.userId || e.username, e));
        socketLb.forEach(e => {
          const key = e.userId || e.username;
          const existing = map.get(key);
          map.set(key, {
            ...existing,
            ...e,
            avatar: e.avatar || existing?.avatar || e.avatar,
          });
        });
        const merged = Array.from(map.values()).sort((a, b) => b.score - a.score);
        return merged.map((item, idx) => ({ ...item, rank: idx + 1 }));
      });
    };

    const handleRoomsList = (rooms: RoomSummary[]) => {
      setPublicRooms(rooms);
    };

    const handleRoomJoinReady = ({ roomIdentifier }: { roomIdentifier: string }) => {
      joinRoom(roomIdentifier);
    };

    const handleRoomTimer = ({ timeLeft }: { timeLeft: number }) => {
      setGameState(prev => (prev ? { ...prev, timeLeft } : null));
      if (timeLeft <= 10 && timeLeft > 0) {
        soundManager.playUrgentTick();
      } else if (timeLeft % 10 === 0 && timeLeft > 0) {
        soundManager.playTick();
      }
    };

    const handleHintUpdate = ({ revealedIndices, maskedHint }: { revealedIndices: number[]; maskedHint: string }) => {
      setGameState(prev =>
        prev
          ? {
              ...prev,
              revealedIndices,
              word: maskedHint,
            }
          : null
      );
    };

    const handleRoomError = ({ message }: { message: string }) => {
      setErrorMessage(message);
    };

    const handleRoomClosed = (data: { reason: string; hostName?: string }) => {
      window.dispatchEvent(new CustomEvent('guesswhat:score_context', { detail: 'local' }));
      setGameState(null);
      setDrawingHistory([]);
      setMessages([]);
      setIsHost(false);
      setErrorMessage(data?.reason || 'The room host has left. The room has been closed.');
      fetchPublicRooms();
    };

    const handleMessageReactionUpdate = ({
      messageId,
      reactions,
    }: {
      messageId: string;
      reactions: Record<string, string[]>;
    }) => {
      setMessages(prev =>
        prev.map(msg => (msg.id === messageId ? { ...msg, reactions } : msg))
      );
    };

    const handleConnect = () => {
      setIsConnected(true);
      fetchPublicRooms();
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleConnectError = () => {
      setIsConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    socket.on('room:state', handleRoomState);
    socket.on('room:joined', handleRoomJoined);
    socket.on('draw:action', handleDrawAction);
    socket.on('canvas:clear', handleCanvasClear);
    socket.on('canvas:history', handleCanvasHistory);
    socket.on('chat:message', handleChatMessage);
    socket.on('global:messages_cleared', handleGlobalMessagesCleared);
    socket.on('global:history', handleGlobalHistory);
    socket.on('chat:messages_cleared', handleRoomMessagesCleared);
    socket.on('chat:profile_update', handleChatProfileUpdate);
    socket.on('chat:message_reaction_update', handleMessageReactionUpdate);
    socket.on('reaction:broadcast', handleReactionBroadcast);
    socket.on('leaderboard:update', handleLeaderboardUpdate);
    socket.on('rooms:list', handleRoomsList);
    socket.on('room:join_ready', handleRoomJoinReady);
    socket.on('room:timer', handleRoomTimer);
    socket.on('room:hint_update', handleHintUpdate);
    socket.on('room:error', handleRoomError);
    socket.on('room:closed', handleRoomClosed);

    // Initial fetch of public rooms
    fetchPublicRooms();

    // Subscribe to real-time Firestore leaderboard updates
    const unsubscribeFirestoreLb = subscribeToFirestoreLeaderboard((fbLeaderboard) => {
      if (fbLeaderboard && fbLeaderboard.length > 0) {
        setGlobalLeaderboard(fbLeaderboard);
      }
    });

    return () => {
      unsubscribeFirestoreLb();
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room:state', handleRoomState);
      socket.off('room:joined', handleRoomJoined);
      socket.off('draw:action', handleDrawAction);
      socket.off('canvas:clear', handleCanvasClear);
      socket.off('canvas:history', handleCanvasHistory);
      socket.off('chat:message', handleChatMessage);
      socket.off('global:messages_cleared', handleGlobalMessagesCleared);
      socket.off('global:history', handleGlobalHistory);
      socket.off('chat:messages_cleared', handleRoomMessagesCleared);
      socket.off('chat:profile_update', handleChatProfileUpdate);
      socket.off('chat:message_reaction_update', handleMessageReactionUpdate);
      socket.off('reaction:broadcast', handleReactionBroadcast);
      socket.off('leaderboard:update', handleLeaderboardUpdate);
      socket.off('rooms:list', handleRoomsList);
      socket.off('room:join_ready', handleRoomJoinReady);
      socket.off('room:timer', handleRoomTimer);
      socket.off('room:hint_update', handleHintUpdate);
      socket.off('room:error', handleRoomError);
      socket.off('room:closed', handleRoomClosed);
    };
  }, [user, updateStats]);

  // Sync profile changes to live socket server
  useEffect(() => {
    if (user) {
      const socket = getSocket();
      socket.emit('player:profile_update', {
        player: {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          color: user.color,
          cosmetics: user.cosmetics,
          stats: user.stats,
        },
      });
    }
  }, [user?.id, user?.username, user?.avatar, user?.color, user?.cosmetics, user?.stats]);

  const updateServerUrl = useCallback((_newUrl: string | null) => {
    // Standard origin is always used for the full-stack server
    const socket = reconnectSocket();
    setIsConnected(socket.connected);
    fetchPublicRooms();
  }, []);

  const fetchPublicRooms = useCallback(() => {
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('rooms:get');
    }
    fetch(`${getServerUrl()}/api/rooms`)
      .then(res => res.json())
      .then(data => {
        if (data.rooms) setPublicRooms(data.rooms);
      })
      .catch(() => {
        // Silently catch in case backend is starting
      });
  }, []);

  // Periodic polling for public rooms when in lobby
  useEffect(() => {
    if (!gameState) {
      fetchPublicRooms();
      const interval = setInterval(fetchPublicRooms, 2500);
      return () => clearInterval(interval);
    }
  }, [gameState, fetchPublicRooms]);

  const createRoom = (settings: RoomSettings, roomName?: string) => {
    const socket = getSocket();
    const activeId = user?.id || 'player_' + Math.random().toString(36).substring(2, 9);
    const activeName = user?.username || 'Player';
    const activeAvatar = user?.avatar || 'avatar_neon_bot';
    const activeColor = user?.color || '#6366F1';
    const player: Player = {
      id: activeId,
      username: activeName,
      avatar: activeAvatar,
      color: activeColor,
      isHost: true,
      isDrawing: false,
      hasGuessed: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      isConnected: true,
      stats: user?.stats,
    };

    // Strictly real players only in multiplayer rooms (just like UNO)
    const cleanSettings: RoomSettings = {
      ...settings,
      botPlayersEnabled: false,
    };

    const payload = { player, settings: cleanSettings, roomName: roomName || `${activeName}'s Game` };
    const emitCreate = () => {
      socket.timeout(8000).emit('room:create', payload, (timeoutError: Error | null, response?: { ok?: boolean; message?: string }) => {
        if (timeoutError) {
          setErrorMessage('Could not reach the game server. Please try creating the room again.');
        } else if (!response?.ok) {
          setErrorMessage(response?.message || 'The room could not be created.');
        }
      });
    };

    if (socket.connected) {
      emitCreate();
    } else {
      socket.once('connect', emitCreate);
      socket.connect();
    }
  };

  const joinRoom = (roomIdentifier: string) => {
    if (!roomIdentifier.trim()) return;
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }
    const activeId = user?.id || 'player_' + Math.random().toString(36).substring(2, 9);
    const activeName = user?.username || 'Player';
    const activeAvatar = user?.avatar || 'avatar_neon_bot';
    const activeColor = user?.color || '#6366F1';
    const player: Player = {
      id: activeId,
      username: activeName,
      avatar: activeAvatar,
      color: activeColor,
      isHost: false,
      isDrawing: false,
      hasGuessed: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      isConnected: true,
      stats: user?.stats,
    };
    socket.emit('room:join', { roomIdentifier: roomIdentifier.trim(), player });
  };

  const quickJoin = (mode?: ArcadeGameMode) => {
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }
    const activeId = user?.id || 'player_' + Math.random().toString(36).substring(2, 9);
    const activeName = user?.username || 'Player';
    const activeAvatar = user?.avatar || 'avatar_neon_bot';
    const activeColor = user?.color || '#6366F1';
    const player: Player = {
      id: activeId,
      username: activeName,
      avatar: activeAvatar,
      color: activeColor,
      isHost: false,
      isDrawing: false,
      hasGuessed: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      isConnected: true,
      stats: user?.stats,
    };
    socket.emit('room:quick_join', { player, gameMode: mode });
  };

  const startGame = () => {
    const socket = getSocket();
    socket.emit('game:start');
  };

  const selectWord = (choice: WordChoice) => {
    const socket = getSocket();
    socket.emit('word:select', { choice });
  };

  const sendCanvasAction = (action: CanvasAction) => {
    const socket = getSocket();
    if (action.type === 'clear') {
      setDrawingHistory([]);
    } else {
      setDrawingHistory(prev => [...prev, action]);
    }
    socket.emit('draw:action', action);
  };

  const clearCanvas = () => {
    const socket = getSocket();
    setDrawingHistory([]);
    socket.emit('canvas:clear');
  };

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const socket = getSocket();
    socket.emit('chat:send', { text: text.trim() });
  };

  const sendGlobalMessage = (text: string) => {
    if (!text.trim()) return;
    const activeUser = userRef.current;
    if (!activeUser) return;
    getSocket().emit('global:chat_send', {
      text: text.trim(),
      player: {
        id: activeUser.id,
        username: activeUser.username,
        avatar: activeUser.avatar,
        color: activeUser.color,
        isNgip: activeUser.isNgip,
        stats: activeUser.stats,
      },
    });
  };

  const sendReaction = (emoji: string) => {
    const socket = getSocket();
    socket.emit('reaction:send', { emoji });
  };

  const reactToMessage = (messageId: string, emoji: string) => {
    const socket = getSocket();
    socket.emit('chat:react_message', { messageId, emoji });
  };

  const leaveRoom = () => {
    const socket = getSocket();
    socket.emit('room:leave');
    window.dispatchEvent(new CustomEvent('guesswhat:score_context', { detail: 'local' }));
    setGameState(null);
    setDrawingHistory([]);
    setMessages([]);
    setIsHost(false);
    fetchPublicRooms();
  };

  return (
    <GameContext.Provider
      value={{
        gameState,
        messages,
          globalMessages,
        drawingHistory,
        isHost,
        isDrawer,
        currentPlayer,
        globalLeaderboard,
        publicRooms,
        reactions,
        errorMessage,
        isConnected,
        serverUrl,
        updateServerUrl,
        clearError,
        createRoom,
        joinRoom,
        quickJoin,
        startGame,
        selectWord,
        sendCanvasAction,
        clearCanvas,
        sendMessage,
        sendGlobalMessage,
        sendReaction,
        reactToMessage,
        leaveRoom,
        fetchPublicRooms,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

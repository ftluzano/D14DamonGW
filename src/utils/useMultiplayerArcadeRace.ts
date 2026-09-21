import { useEffect, useRef } from 'react';
import { ArcadeGameMode } from '../types';
import { useGame } from '../context/GameContext';
import { getSocket } from '../services/socket';

export function useMultiplayerArcadeRace(mode: ArcadeGameMode, score: number, finished = false): boolean {
  const { gameState } = useGame();
  const lastScoreRef = useRef<number | null>(null);
  const isMultiplayer = gameState?.settings.gameMode === mode;

  useEffect(() => {
    if (!isMultiplayer || !gameState) {
      lastScoreRef.current = null;
      return;
    }

    const socket = getSocket();
    const requestState = () => socket.emit('arcade:race_get_state');
    const publishScore = () => {
      if (lastScoreRef.current === score && !finished) return;
      lastScoreRef.current = score;
      socket.emit('arcade:score', { score, finished });
    };

    requestState();
    publishScore();
    socket.on('connect', requestState);
    return () => socket.off('connect', requestState);
  }, [isMultiplayer, gameState?.roomId, mode, score, finished]);

  return Boolean(isMultiplayer);
}

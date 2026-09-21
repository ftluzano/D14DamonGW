import { useEffect, useRef } from 'react';
import { useGame } from '../context/GameContext';

export function useMultiplayerAutoStart(startGame: () => void): boolean {
  const { gameState } = useGame();
  const hasStartedRef = useRef(false);
  const isMultiplayerRoom = Boolean(gameState?.roomId);

  useEffect(() => {
    if (!isMultiplayerRoom || gameState?.status !== 'drawing') {
      hasStartedRef.current = false;
      return;
    }

    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      startGame();
    }
  }, [gameState?.roomId, gameState?.status, isMultiplayerRoom, startGame]);

  return isMultiplayerRoom;
}

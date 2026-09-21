import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

// Clean up any stale custom server URL so socket always connects to the local full-stack server
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('guess_what_server_url');
  } catch {
    // Ignore storage access errors
  }
}

export function getServerUrl(): string {
  const configuredServerUrl = import.meta.env.VITE_GAME_SERVER_URL?.trim();
  if (configuredServerUrl) {
    return configuredServerUrl.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function setCustomServerUrl(_url: string | null): void {
  // No custom external server needed; full-stack server runs on the same origin
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('guess_what_server_url');
    } catch {
      // Ignore
    }
  }
  reconnectSocket();
}

export function isUsingCustomServerUrl(): boolean {
  return false;
}

export function reconnectSocket(): Socket {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  return getSocket();
}

export function getSocket(): Socket {
  if (!socketInstance) {
    const targetUrl = getServerUrl();
    socketInstance = io(targetUrl, {
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socketInstance.on('connect', () => {
      console.log('⚡ Connected to Guess What? game server with ID:', socketInstance?.id);
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('⚠️ Socket connection error to', targetUrl, err.message);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from game server:', reason);
    });
  }
  return socketInstance;
}



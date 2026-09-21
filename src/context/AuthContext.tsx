import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, PlayerStats, FirebaseConfig, PlayerActivity, ArcadeGameMode, GameSkinId, UserCosmetics } from '../types';
import {
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  ensureAnonymousAuth,
  logoutFirebase,
  saveProfileToFirestore,
  fetchProfileFromFirestore,
  subscribeToUserProfile,
  fetchAllUsersFromFirestore,
  subscribeToAllUsersFromFirestore,
  adminUpdateUserProfileInFirestore,
  adminResetAllUsersStatsInFirestore,
  deleteUserAccountFromFirestore,
  adminDeleteUserFromFirestore,
  isFirebaseConfigured,
  getFirebaseAuth,
  initFirebaseService,
  logActivityToFirestore,
  checkUsernameAvailability,
} from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { PRESET_AVATARS } from '../utils/avatarIcons';
import { soundManager } from '../utils/soundEffects';
import { INITIAL_DEFAULT_WALLET } from '../utils/currencyUtils';

const STORAGE_KEY_USER = 'guess_what_current_user';
export const ADMIN_EMAILS = [
  'kyledesillarico@gmail.com',
  'kyledsllrc@gmail.com',
];
export const OWNER_ADMIN_EMAIL = ADMIN_EMAILS[0];

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isFirebaseConnected: boolean;
  isAdmin: boolean;
  isNgip: boolean;
  darkMode: boolean;
  toggleDarkMode: (explicitVal?: boolean) => void;
  activities: PlayerActivity[];
  allRegisteredUsers: UserProfile[];
  connectCustomFirebase: (config: FirebaseConfig) => boolean;
  loginGuest: (username: string, avatar: string, color?: string) => void;
  loginWithFirebaseGoogle: () => Promise<void>;
  loginWithFirebaseEmail: (email: string, pass: string) => Promise<void>;
  registerWithFirebaseEmail: (email: string, pass: string, username: string, avatar?: string, color?: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  adminDeleteUser: (targetUserId: string) => Promise<void>;
  updateStats: (statDelta: Partial<PlayerStats>, wonGame?: boolean, gameTitle?: string) => void;
  logPlayerActivity: (activity: Omit<PlayerActivity, 'id' | 'userId' | 'username' | 'avatar' | 'timestamp'>) => void;
  updateAvatar: (avatar: string, color?: string) => void;
  updateUsername: (username: string) => Promise<{ success: boolean; error?: string }>;
  isUsernameAvailable: (username: string, excludeUserId?: string) => Promise<{ available: boolean; reason?: string }>;
  overrideStats: (newStats: Partial<PlayerStats>, newLevel?: number, newXp?: number) => void;
  resetUserStats: () => void;
  resetAllUsersStats: () => Promise<number>;
  unlockAllAchievements: () => void;
  toggleAdminRole: () => void;
  toggleUserNgip: (targetUserId: string, ngipState: boolean) => Promise<void>;
  adminOverrideOtherUserStats: (targetUserId: string, newStats: Partial<PlayerStats>, level?: number) => Promise<void>;
  purchaseOrEquipSkin: (mode: ArcadeGameMode, skinId: GameSkinId, durationDays?: 7 | 15 | 30) => boolean;
}

const DEFAULT_AVATARS = PRESET_AVATARS.map((a) => a.id);
const DEFAULT_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

export const AVATAR_OPTIONS = DEFAULT_AVATARS;
export const COLOR_OPTIONS = DEFAULT_COLORS;

type ScoreContext = 'local' | 'multiplayer' | 'vs_ai';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeStats(s?: Partial<PlayerStats>): PlayerStats {
  const stats: PlayerStats = {
    gamesPlayed: s?.gamesPlayed || 0,
    wins: s?.wins || 0,
    losses: typeof s?.losses === 'number' ? s.losses : Math.max(0, (s?.gamesPlayed || 0) - (s?.wins || 0)),
    totalScore: s?.totalScore || 0,
    wordsGuessed: s?.wordsGuessed || 0,
    drawingsCompleted: s?.drawingsCompleted || 0,
    highestRoundScore: s?.highestRoundScore || 0,
    bombsDefused: s?.bombsDefused || 0,
    pixelsGuessed: s?.pixelsGuessed || 0,
    blindfoldScores: s?.blindfoldScores || 0,
    unoWins: s?.unoWins || 0,
    unoCardsPlayed: s?.unoCardsPlayed || 0,
    currentStreak: s?.currentStreak || 0,
    bestStreak: s?.bestStreak || 0,
  };
  if (typeof s?.fastestGuessSec === 'number' && !isNaN(s.fastestGuessSec)) {
    stats.fastestGuessSec = s.fastestGuessSec;
  }
  if (typeof s?.aiDrawsBeaten === 'number') stats.aiDrawsBeaten = s.aiDrawsBeaten;
  if (typeof s?.emojiPuzzlesSolved === 'number') stats.emojiPuzzlesSolved = s.emojiPuzzlesSolved;
  if (typeof s?.memoryStarsEarned === 'number') stats.memoryStarsEarned = s.memoryStarsEarned;
  if (typeof s?.duelsWon === 'number') stats.duelsWon = s.duelsWon;
  if (typeof s?.soundsIdentified === 'number') stats.soundsIdentified = s.soundsIdentified;
  if (typeof s?.reflexCombosHit === 'number') stats.reflexCombosHit = s.reflexCombosHit;
  return stats;
}

function normalizeUserProfile(p: Partial<UserProfile> & { id: string; username: string }): UserProfile {
  const stats = normalizeStats(p.stats);
  const xp = typeof p.xp === 'number' ? p.xp : stats.totalScore || 0;
  const level = p.level && p.level > 0 ? p.level : Math.max(1, Math.floor(xp / 600) + 1);
  const badges = Array.isArray(p.unlockedBadges) && p.unlockedBadges.length > 0 ? p.unlockedBadges : ['Newbie Artist'];
  const email = p.email || undefined;
  
  // OWNER ACCESS IS EXCLUSIVELY RESTRICTED TO AUTHORIZED ADMIN EMAILS
  const isOwnerEmail = Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase().trim()));
  const isAdmin = Boolean((p.isAdmin && isOwnerEmail) || isOwnerEmail);
  const isNgip = Boolean(isOwnerEmail || p.isNgip === true);
  const darkMode = typeof p.darkMode === 'boolean' ? p.darkMode : true;
  const cosmetics: UserCosmetics = {
    owned: Array.from(new Set([
      'classic',
      ...((p.cosmetics?.owned || []) as GameSkinId[]).filter((skinId) => {
        if (skinId === 'classic') return true;
        const expiresAt = p.cosmetics?.ownedUntil?.[skinId];
        return typeof expiresAt === 'number' && expiresAt > Date.now();
      }),
    ])),
    equipped: { ...(p.cosmetics?.equipped || {}) },
    ownedUntil: { ...(p.cosmetics?.ownedUntil || {}) },
  };

  Object.entries(cosmetics.equipped).forEach(([mode, skinId]) => {
    if (skinId && !cosmetics.owned.includes(skinId)) {
      delete cosmetics.equipped[mode as ArcadeGameMode];
    }
  });

  return {
    id: p.id,
    username: p.username || 'Player',
    email,
    avatar: p.avatar || DEFAULT_AVATARS[0],
    color: p.color || DEFAULT_COLORS[0],
    bio: p.bio,
    createdAt: p.createdAt || new Date().toISOString(),
    stats,
    level,
    xp,
    unlockedBadges: badges,
    isAdmin,
    isNgip,
    darkMode,
    wallet: p.wallet || INITIAL_DEFAULT_WALLET,
    cosmetics,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activities, setActivities] = useState<PlayerActivity[]>([]);
  const [allRegisteredUsers, setAllRegisteredUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [scoreContext, setScoreContext] = useState<ScoreContext>('local');

  useEffect(() => {
    const handleScoreContext = (event: Event) => {
      const nextContext = (event as CustomEvent<ScoreContext>).detail;
      if (nextContext === 'local' || nextContext === 'multiplayer' || nextContext === 'vs_ai') {
        setScoreContext(nextContext);
      }
    };
    window.addEventListener('guesswhat:score_context', handleScoreContext);
    return () => window.removeEventListener('guesswhat:score_context', handleScoreContext);
  }, []);

  // Initialize Dark Mode: check localStorage or default to true
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const savedMode = localStorage.getItem('guess_what_dark_mode');
      if (savedMode !== null) return savedMode === 'true';
    } catch {
      // ignore
    }
    return true;
  });

  // Apply dark mode class to HTML / body elements
  const applyDarkModeToDOM = (isDark: boolean) => {
    if (typeof document !== 'undefined') {
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('dark');
      }
    }
  };

  // Sync DOM whenever darkMode state changes
  useEffect(() => {
    applyDarkModeToDOM(darkMode);
  }, [darkMode]);

  // Toggle or explicitly set dark mode, and persist to user profile in Firestore
  const toggleDarkMode = (explicitVal?: boolean) => {
    const nextMode = typeof explicitVal === 'boolean' ? explicitVal : !darkMode;
    setDarkMode(nextMode);
    applyDarkModeToDOM(nextMode);
    try {
      localStorage.setItem('guess_what_dark_mode', String(nextMode));
    } catch (e) {
      console.warn('LocalStorage darkmode save issue', e);
    }
    if (user) {
      const updated: UserProfile = {
        ...user,
        darkMode: nextMode,
      };
      saveUser(updated);
    }
  };

  // Check if current user is owner/admin
  const isAdmin = Boolean(
    user?.isAdmin ||
    (user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase().trim()))
  );

  const isNgip = Boolean(user?.isNgip || isAdmin);

  useEffect(() => {
    setIsFirebaseConnected(isFirebaseConfigured());

    const hydrateRegisteredUsers = async () => {
      if (!isFirebaseConfigured()) return;
      try {
        const liveUsers = await fetchAllUsersFromFirestore();
        if (liveUsers && liveUsers.length > 0) {
          setAllRegisteredUsers(liveUsers.map(normalizeUserProfile));
        }
      } catch (error) {
        console.warn('Failed to hydrate registered users from Firestore:', error);
      }
    };

    hydrateRegisteredUsers();

    // 1. Subscribe to all registered/active user accounts for admin panel
    const unsubUsers = subscribeToAllUsersFromFirestore((liveUsers) => {
      if (liveUsers && liveUsers.length > 0) {
        setAllRegisteredUsers(liveUsers.map(normalizeUserProfile));
      }
    });

    // 2. Hydrate local profile
    try {
      const savedUserStr = localStorage.getItem(STORAGE_KEY_USER);
      if (savedUserStr) {
        const parsed = JSON.parse(savedUserStr);
        setUser(normalizeUserProfile(parsed));
      }
    } catch (e) {
      console.error('Failed to load local user', e);
    }

    // 3. Listen to Firebase Auth state
    const auth = getFirebaseAuth();
    if (auth) {
      const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
          try {
            const cloudProfile = await fetchProfileFromFirestore(fbUser.uid);
            if (cloudProfile) {
              const merged = normalizeUserProfile({
                ...cloudProfile,
                id: fbUser.uid,
                email: fbUser.email || cloudProfile.email,
                username: cloudProfile.username || fbUser.displayName || 'Player',
              });
              saveUser(merged);
            } else {
              setUser((prev) => {
                const current = prev || {
                  id: fbUser.uid,
                  username: fbUser.displayName || 'Player',
                  email: fbUser.email || undefined,
                  avatar: DEFAULT_AVATARS[0],
                  color: DEFAULT_COLORS[0],
                  createdAt: new Date().toISOString(),
                  stats: {
                    gamesPlayed: 0,
                    wins: 0,
                    totalScore: 0,
                    wordsGuessed: 0,
                    drawingsCompleted: 0,
                    highestRoundScore: 0,
                  },
                  level: 1,
                  xp: 0,
                  unlockedBadges: ['Newbie Artist'],
                };
                const updated = normalizeUserProfile({
                  ...current,
                  id: fbUser.uid,
                  email: fbUser.email || current.email,
                  username: current.username || fbUser.displayName || 'Player',
                });
                saveUser(updated);
                return updated;
              });
            }
          } catch (err) {
            console.warn('Firestore profile sync error on auth state change:', err);
          }
        }
        setIsLoading(false);
      });

      return () => {
        unsubAuth();
        unsubUsers();
      };
    } else {
      setIsLoading(false);
      return () => unsubUsers();
    }
  }, []);

  // Subscribe to real-time updates for the current user's profile in Firestore
  useEffect(() => {
    if (!user?.id || user.id.startsWith('guest_')) return;
    const unsub = subscribeToUserProfile(user.id, (cloudProfile) => {
      if (cloudProfile) {
        setUser((prev) => {
          if (!prev) return normalizeUserProfile(cloudProfile);
          if (
            cloudProfile.level === prev.level &&
            cloudProfile.xp === prev.xp &&
            cloudProfile.isNgip === prev.isNgip &&
            cloudProfile.stats?.totalScore === prev.stats?.totalScore &&
            cloudProfile.stats?.wins === prev.stats?.wins &&
            cloudProfile.stats?.losses === prev.stats?.losses &&
            cloudProfile.stats?.gamesPlayed === prev.stats?.gamesPlayed &&
            cloudProfile.stats?.wordsGuessed === prev.stats?.wordsGuessed &&
            JSON.stringify(cloudProfile.cosmetics || {}) === JSON.stringify(prev.cosmetics || {})
          ) {
            return prev;
          }
          return normalizeUserProfile({
            ...prev,
            ...cloudProfile,
            stats: normalizeStats({
              ...prev.stats,
              ...cloudProfile.stats,
            }),
          });
        });
      }
    });

    return () => unsub();
  }, [user?.id]);

  const saveUser = (updated: UserProfile) => {
    const normalized = normalizeUserProfile(updated);
    setUser(normalized);
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(normalized));
    } catch (e) {
      console.error('Failed to save user to local storage', e);
    }
    saveProfileToFirestore(normalized);
  };

  const logPlayerActivity = (
    activity: Omit<PlayerActivity, 'id' | 'userId' | 'username' | 'avatar' | 'timestamp'>
  ) => {
    if (!user) return;
    const newAct: PlayerActivity = {
      ...activity,
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      timestamp: new Date().toISOString(),
    };

    setActivities((prev) => [newAct, ...prev.slice(0, 49)]);
    logActivityToFirestore(newAct);
  };

  const updateStats = (
    statDelta: Partial<PlayerStats>,
    wonGame?: boolean,
    gameTitle?: string
  ) => {
    if (!user) return;

    const current = normalizeStats(user.stats);
    const requestedScore = Math.max(0, statDelta.totalScore || 0);
    const addedScore = scoreContext === 'vs_ai'
      ? 0
      : scoreContext === 'multiplayer' && requestedScore > 0
        ? Math.min(100, Math.max(30, requestedScore))
        : requestedScore;
    
    // Determine win/loss states
    const hasExplicitWinFlag = wonGame === true || (typeof statDelta.wins === 'number' && statDelta.wins > 0);
    const hasExplicitLossFlag = wonGame === false || (typeof statDelta.losses === 'number' && statDelta.losses > 0);
    const isExplicitMatchCompletion =
      statDelta.gamesPlayed !== undefined ||
      wonGame !== undefined ||
      statDelta.wins !== undefined ||
      statDelta.losses !== undefined;

    const gamesPlayedDelta = statDelta.gamesPlayed !== undefined
      ? statDelta.gamesPlayed
      : (isExplicitMatchCompletion ? 1 : 0);

    const winsDelta = hasExplicitWinFlag
      ? (typeof statDelta.wins === 'number' && statDelta.wins > 0 ? statDelta.wins : 1)
      : 0;

    const lossesDelta = hasExplicitLossFlag && !hasExplicitWinFlag
      ? (typeof statDelta.losses === 'number' && statDelta.losses > 0 ? statDelta.losses : (gamesPlayedDelta > winsDelta ? gamesPlayedDelta - winsDelta : 1))
      : 0;

    const newWins = current.wins + winsDelta;
    const newLosses = Math.max(0, current.losses + lossesDelta);
    const newGamesPlayed = Math.max(current.gamesPlayed + gamesPlayedDelta, newWins + newLosses);

    const nextStreak = hasExplicitWinFlag ? (current.currentStreak || 0) + 1 : (hasExplicitLossFlag ? 0 : (current.currentStreak || 0));
    const bestStreak = Math.max(current.bestStreak || 0, nextStreak);

    const updatedStats: PlayerStats = {
      ...current,
      gamesPlayed: newGamesPlayed,
      wins: newWins,
      losses: newLosses,
      totalScore: current.totalScore + addedScore,
      wordsGuessed: current.wordsGuessed + (statDelta.wordsGuessed || 0),
      drawingsCompleted: current.drawingsCompleted + (statDelta.drawingsCompleted || 0),
      highestRoundScore: Math.max(current.highestRoundScore, statDelta.highestRoundScore || 0, addedScore),
      fastestGuessSec:
        statDelta.fastestGuessSec !== undefined
          ? current.fastestGuessSec
            ? Math.min(current.fastestGuessSec, statDelta.fastestGuessSec)
            : statDelta.fastestGuessSec
          : current.fastestGuessSec,
      aiDrawsBeaten: (current.aiDrawsBeaten || 0) + (statDelta.aiDrawsBeaten || 0),
      emojiPuzzlesSolved: (current.emojiPuzzlesSolved || 0) + (statDelta.emojiPuzzlesSolved || 0),
      memoryStarsEarned: (current.memoryStarsEarned || 0) + (statDelta.memoryStarsEarned || 0),
      duelsWon: (current.duelsWon || 0) + (statDelta.duelsWon || 0),
      bombsDefused: (current.bombsDefused || 0) + (statDelta.bombsDefused || 0),
      pixelsGuessed: (current.pixelsGuessed || 0) + (statDelta.pixelsGuessed || 0),
      blindfoldScores: (current.blindfoldScores || 0) + (statDelta.blindfoldScores || 0),
      unoWins: (current.unoWins || 0) + (statDelta.unoWins || 0),
      unoCardsPlayed: (current.unoCardsPlayed || 0) + (statDelta.unoCardsPlayed || 0),
      soundsIdentified: (current.soundsIdentified || 0) + (statDelta.soundsIdentified || 0),
      reflexCombosHit: (current.reflexCombosHit || 0) + (statDelta.reflexCombosHit || 0),
      currentStreak: nextStreak,
      bestStreak: bestStreak,
    };

    const newXp = (user.xp || 0) + addedScore;
    const oldLevel = user.level || 1;
    const newLevel = Math.max(1, Math.floor(newXp / 600) + 1);

    const newlyUnlocked: string[] = [];
    const currentBadges = new Set(user.unlockedBadges || ['Newbie Artist']);

    if (newWins >= 1 && !currentBadges.has('Champion')) {
      newlyUnlocked.push('Champion');
    }
    if (updatedStats.wordsGuessed >= 25 && !currentBadges.has('Sharp Guesser')) {
      newlyUnlocked.push('Sharp Guesser');
    }
    if (updatedStats.drawingsCompleted >= 15 && !currentBadges.has('Master Artist')) {
      newlyUnlocked.push('Master Artist');
    }
    if (newLevel >= 10 && !currentBadges.has('Word Prodigy')) {
      newlyUnlocked.push('Word Prodigy');
    }
    if (nextStreak >= 5 && !currentBadges.has('Lightning Speed')) {
      newlyUnlocked.push('Lightning Speed');
    }

    const mergedBadges = Array.from(new Set([...Array.from(currentBadges), ...newlyUnlocked]));

    const updatedUser: UserProfile = {
      ...user,
      stats: updatedStats,
      xp: newXp,
      level: newLevel,
      unlockedBadges: mergedBadges,
    };

    saveUser(updatedUser);

    if (hasExplicitWinFlag) {
      logPlayerActivity({
        type: 'match_win',
        title: `Won ${gameTitle || 'Match'}!`,
        description: `${user.username} secured victory with ${addedScore} Points!`,
        gameMode: gameTitle || 'Game',
        pointsEarned: addedScore,
      });
    } else if (addedScore > 0) {
      logPlayerActivity({
        type: 'game_played',
        title: `Scored in ${gameTitle || 'Match'}`,
        description: `${user.username} scored ${addedScore} Points and gained EXP!`,
        gameMode: gameTitle || 'Game',
        pointsEarned: addedScore,
      });
    }

    if (newLevel > oldLevel) {
      logPlayerActivity({
        type: 'level_up',
        title: `Level Up! Reached Level ${newLevel}`,
        description: `${user.username} ranked up to Level ${newLevel}!`,
        pointsEarned: 300,
      });
    }

    for (const b of newlyUnlocked) {
      logPlayerActivity({
        type: 'badge_unlocked',
        title: `Badge Unlocked: ${b}`,
        description: `${user.username} earned the ${b} badge!`,
      });
    }
  };

  const loginGuest = (username: string, avatar: string, color?: string) => {
    const trimmed = username.trim() || `Player_${Math.floor(100 + Math.random() * 900)}`;
    const updated: UserProfile = normalizeUserProfile(
      user
        ? {
            ...user,
            username: trimmed,
            avatar: avatar || user.avatar,
            color: color || user.color,
          }
        : {
            id: 'guest_' + Math.random().toString(36).substring(2, 9),
            username: trimmed,
            avatar: avatar || DEFAULT_AVATARS[0],
            color: color || DEFAULT_COLORS[0],
            createdAt: new Date().toISOString(),
            stats: {
              gamesPlayed: 0,
              wins: 0,
              losses: 0,
              totalScore: 0,
              wordsGuessed: 0,
              drawingsCompleted: 0,
              highestRoundScore: 0,
            },
            level: 1,
            xp: 0,
            unlockedBadges: ['Newbie Artist'],
          }
    );
    saveUser(updated);
  };

  const loginWithFirebaseGoogle = async () => {
    const fbUser = await loginWithGoogle();
    if (fbUser) {
      const cloudProfile = await fetchProfileFromFirestore(fbUser.uid);
      if (cloudProfile) {
        const normalized = normalizeUserProfile({
          ...cloudProfile,
          id: fbUser.uid,
          email: fbUser.email || cloudProfile.email,
          username: cloudProfile.username || fbUser.displayName || 'Player',
        });
        saveUser(normalized);
        setIsFirebaseConnected(true);
        return;
      }

      let chosenName = (fbUser.displayName || user?.username || 'Player').trim();
      // Ensure unique username for Google user if not already set in cloud
      const check = await checkUsernameAvailability(chosenName, fbUser.uid);
      if (!check.available) {
        chosenName = `${chosenName.slice(0, 15)}_${Math.floor(100 + Math.random() * 900)}`;
      }

      const profile: UserProfile = normalizeUserProfile({
        id: fbUser.uid,
        username: chosenName,
        email: fbUser.email || undefined,
        avatar: user?.avatar || fbUser.photoURL || DEFAULT_AVATARS[0],
        color: user?.color || DEFAULT_COLORS[0],
        createdAt: new Date().toISOString(),
        stats: user?.stats,
        level: user?.level,
        xp: user?.xp,
        unlockedBadges: user?.unlockedBadges,
      });
      saveUser(profile);
      setIsFirebaseConnected(true);
    }
  };

  const loginWithFirebaseEmail = async (email: string, pass: string) => {
    const fbUser = await loginWithEmail(email, pass);
    if (fbUser) {
      const cloudProfile = await fetchProfileFromFirestore(fbUser.uid);
      if (cloudProfile) {
        const normalized = normalizeUserProfile({
          ...cloudProfile,
          id: fbUser.uid,
          email: fbUser.email || cloudProfile.email,
          username: cloudProfile.username || fbUser.displayName || email.split('@')[0],
        });
        saveUser(normalized);
        setIsFirebaseConnected(true);
        return;
      }

      const profile: UserProfile = normalizeUserProfile({
        id: fbUser.uid,
        username: fbUser.displayName || email.split('@')[0],
        email: fbUser.email || email,
        avatar: user?.avatar || DEFAULT_AVATARS[0],
        color: user?.color || DEFAULT_COLORS[0],
        createdAt: new Date().toISOString(),
        stats: user?.stats,
        level: user?.level,
        xp: user?.xp,
        unlockedBadges: user?.unlockedBadges,
      });
      saveUser(profile);
      setIsFirebaseConnected(true);
    }
  };

  const registerWithFirebaseEmail = async (
    email: string,
    pass: string,
    username: string,
    avatar?: string,
    color?: string
  ) => {
    const cleanName = (username || '').trim();
    if (!cleanName) {
      throw new Error('Please enter a player username.');
    }
    if (cleanName.length < 2) {
      throw new Error('Player username must be at least 2 characters long.');
    }
    if (cleanName.length > 20) {
      throw new Error('Player username cannot exceed 20 characters.');
    }

    // Check in-memory list first
    const inMemoryMatch = allRegisteredUsers.some(
      (u) => u.username.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (inMemoryMatch) {
      throw new Error(`The username "${cleanName}" is already taken by another player. Please choose a unique username.`);
    }

    // Check against Firestore database
    const availability = await checkUsernameAvailability(cleanName);
    if (!availability.available) {
      throw new Error(availability.reason || `The username "${cleanName}" is already taken.`);
    }

    const fbUser = await registerWithEmail(email, pass);
    if (fbUser) {
      const chosenAvatar = avatar || user?.avatar || DEFAULT_AVATARS[0];
      const chosenColor = color || user?.color || DEFAULT_COLORS[0];

      const profile: UserProfile = normalizeUserProfile({
        id: fbUser.uid,
        username: cleanName,
        email: fbUser.email || email,
        avatar: chosenAvatar,
        color: chosenColor,
        createdAt: new Date().toISOString(),
        stats: {
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          totalScore: 0,
          wordsGuessed: 0,
          drawingsCompleted: 0,
          highestRoundScore: 0,
        },
        level: 1,
        xp: 0,
        unlockedBadges: ['Newbie Artist'],
      });
      saveUser(profile);
      setIsFirebaseConnected(true);
    }
  };

  const logout = async () => {
    await logoutFirebase();
    const guest = normalizeUserProfile({
      id: 'guest_' + Math.random().toString(36).substring(2, 9),
      username: `Player_${Math.floor(100 + Math.random() * 900)}`,
      avatar: DEFAULT_AVATARS[0],
      color: DEFAULT_COLORS[0],
      createdAt: new Date().toISOString(),
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalScore: 0,
        wordsGuessed: 0,
        drawingsCompleted: 0,
        highestRoundScore: 0,
      },
      level: 1,
      xp: 0,
      unlockedBadges: ['Newbie Artist'],
    });
    saveUser(guest);
  };

  /**
   * Instantly delete the current player's account from Firebase database (users & leaderboard),
   * remove local storage credentials, and reset to a new clean guest account.
   */
  const deleteAccount = async () => {
    if (!user) return;
    const userIdToDelete = user.id;
    const userNameToDelete = user.username;

    console.log(`🗑️ Deleting account for user: ${userNameToDelete} (ID: ${userIdToDelete})`);

    // 1. Permanently delete from Firebase (users & leaderboard & auth)
    await deleteUserAccountFromFirestore(userIdToDelete);

    // 2. Remove from active registered users state
    setAllRegisteredUsers((prev) => prev.filter((u) => u.id !== userIdToDelete));

    // 3. Clear localStorage user key
    try {
      localStorage.removeItem(STORAGE_KEY_USER);
    } catch (e) {
      console.warn('Failed to remove user from localStorage', e);
    }

    // 4. Reset to clean fresh guest user
    const freshGuest = normalizeUserProfile({
      id: 'guest_' + Math.random().toString(36).substring(2, 9),
      username: `Player_${Math.floor(100 + Math.random() * 900)}`,
      avatar: DEFAULT_AVATARS[0],
      color: DEFAULT_COLORS[0],
      createdAt: new Date().toISOString(),
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalScore: 0,
        wordsGuessed: 0,
        drawingsCompleted: 0,
        highestRoundScore: 0,
      },
      level: 1,
      xp: 0,
      unlockedBadges: ['Newbie Artist'],
    });

    setUser(freshGuest);
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(freshGuest));
    } catch (e) {
      console.warn('Failed to set fresh guest in localStorage', e);
    }

    soundManager.playCorrect();
    console.log(`✅ Account ${userNameToDelete} successfully deleted from Firebase.`);
  };

  /**
   * Admin function: delete any user record from Firebase and state
   */
  const adminDeleteUser = async (targetUserId: string) => {
    await adminDeleteUserFromFirestore(targetUserId);
    setAllRegisteredUsers((prev) => prev.filter((u) => u.id !== targetUserId));
    if (user && user.id === targetUserId) {
      await logout();
    }
  };

  const updateAvatar = (avatar: string, color?: string) => {
    if (!user) return;
    saveUser({
      ...user,
      avatar,
      color: color || user.color,
    });
  };

  const updateUsername = async (username: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No active user session.' };
    const cleanName = username.trim();
    if (!cleanName) {
      return { success: false, error: 'Username cannot be empty.' };
    }
    if (cleanName === user.username) {
      return { success: true };
    }
    if (cleanName.length < 2) {
      return { success: false, error: 'Username must be at least 2 characters long.' };
    }
    if (cleanName.length > 20) {
      return { success: false, error: 'Username cannot exceed 20 characters.' };
    }

    // Check in-memory list first
    const inMemoryMatch = allRegisteredUsers.some(
      (u) => u.id !== user.id && u.username.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (inMemoryMatch) {
      return {
        success: false,
        error: `The username "${cleanName}" is already taken by another player. Please choose a different unique username.`,
      };
    }

    // Check Firestore database
    const check = await checkUsernameAvailability(cleanName, user.id);
    if (!check.available) {
      return {
        success: false,
        error: check.reason || `The username "${cleanName}" is already taken.`,
      };
    }

    saveUser({
      ...user,
      username: cleanName,
    });

    return { success: true };
  };

  const isUsernameAvailable = async (name: string, excludeUserId?: string) => {
    return checkUsernameAvailability(name, excludeUserId || user?.id);
  };

  // Admin function: Toggle งip for any user
  const toggleUserNgip = async (targetUserId: string, ngipState: boolean) => {
    let target = allRegisteredUsers.find((u) => u.id === targetUserId);
    if (!target && user?.id === targetUserId) {
      target = user;
    }

    const updates: Partial<UserProfile> = {
      isNgip: ngipState,
    };

    const persistedProfile = target
      ? normalizeUserProfile({ ...target, ...updates })
      : null;

    await adminUpdateUserProfileInFirestore(targetUserId, updates);

    if (persistedProfile) {
      await saveProfileToFirestore(persistedProfile);
    }

    if (user && user.id === targetUserId) {
      const updated: UserProfile = { ...user, ...updates };
      saveUser(updated);
    }
    // Update state in allRegisteredUsers only after DB confirms it was saved
    setAllRegisteredUsers((prev) =>
      prev.map((u) => (u.id === targetUserId ? { ...u, ...updates } : u))
    );

    logPlayerActivity({
      type: 'badge_unlocked',
      title: ngipState ? `👑 VIP งip Granted to ${target?.username || 'Player'}` : `VIP งip Revoked from ${target?.username || 'Player'}`,
      description: ngipState ? `Granted VIP privileges & Rainbow chroma style by Owner Admin.` : `VIP status revoked by Admin.`,
    });
  };

  // Admin function: Override other user's level / stats in Firestore
  const adminOverrideOtherUserStats = async (
    targetUserId: string,
    newStats: Partial<PlayerStats>,
    level?: number
  ) => {
    let target = allRegisteredUsers.find((u) => u.id === targetUserId);
    if (!target && user?.id === targetUserId) {
      target = user;
    }
    if (!target) return;

    const mergedStats = {
      ...normalizeStats(target.stats),
      ...newStats,
    };
    const targetLevel = level !== undefined ? level : target.level;
    const targetXp = (targetLevel - 1) * 600;

    if (user && user.id === targetUserId) {
      saveUser({ ...user, stats: mergedStats, level: targetLevel, xp: targetXp });
    }

    setAllRegisteredUsers((prev) =>
      prev.map((u) =>
        u.id === targetUserId
          ? { ...u, stats: mergedStats, level: targetLevel, xp: targetXp }
          : u
      )
    );

    await adminUpdateUserProfileInFirestore(targetUserId, {
      stats: mergedStats,
      level: targetLevel,
      xp: targetXp,
    });
  };

  // Admin function: Override player statistics & level
  const overrideStats = (
    newStats: Partial<PlayerStats>,
    newLevel?: number,
    newXp?: number
  ) => {
    if (!user) return;
    const currentStats = user.stats;
    const mergedStats: PlayerStats = {
      gamesPlayed: newStats.gamesPlayed !== undefined ? newStats.gamesPlayed : currentStats.gamesPlayed,
      wins: newStats.wins !== undefined ? newStats.wins : currentStats.wins,
      losses: newStats.losses !== undefined ? newStats.losses : (currentStats.losses || 0),
      totalScore: newStats.totalScore !== undefined ? newStats.totalScore : currentStats.totalScore,
      wordsGuessed: newStats.wordsGuessed !== undefined ? newStats.wordsGuessed : currentStats.wordsGuessed,
      drawingsCompleted: newStats.drawingsCompleted !== undefined ? newStats.drawingsCompleted : currentStats.drawingsCompleted,
      highestRoundScore: newStats.highestRoundScore !== undefined ? newStats.highestRoundScore : currentStats.highestRoundScore,
      currentStreak: newStats.currentStreak !== undefined ? newStats.currentStreak : (currentStats.currentStreak || 0),
      bestStreak: newStats.bestStreak !== undefined ? newStats.bestStreak : (currentStats.bestStreak || 0),
    };
    const targetFastest = newStats.fastestGuessSec !== undefined ? newStats.fastestGuessSec : currentStats.fastestGuessSec;
    if (typeof targetFastest === 'number' && !isNaN(targetFastest)) {
      mergedStats.fastestGuessSec = targetFastest;
    }

    const targetLevel = newLevel !== undefined ? newLevel : user.level;
    const targetXp = newXp !== undefined ? newXp : (targetLevel - 1) * 600;

    saveUser({
      ...user,
      stats: mergedStats,
      level: Math.max(1, targetLevel),
      xp: Math.max(0, targetXp),
    });
  };

  // Admin function: Reset stats to zero for current user
  const resetUserStats = () => {
    if (!user) return;
    saveUser({
      ...user,
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalScore: 0,
        wordsGuessed: 0,
        drawingsCompleted: 0,
        highestRoundScore: 0,
        fastestGuessSec: 0,
        currentStreak: 0,
        bestStreak: 0,
      },
      level: 1,
      xp: 0,
    });
  };

  // Master Admin function: Reset ALL users' stats across Firestore and local state (Wins, Losses, Matches, Points, Winrate only)
  const resetAllUsersStats = async (): Promise<number> => {
    const zeroStats: PlayerStats = {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      totalScore: 0,
      wordsGuessed: 0,
      drawingsCompleted: 0,
      highestRoundScore: 0,
      fastestGuessSec: 0,
      unoWins: 0,
      unoCardsPlayed: 0,
      bombsDefused: 0,
      pixelsGuessed: 0,
      blindfoldScores: 0,
      currentStreak: 0,
      bestStreak: 0,
    };

    // 1. Reset in Firestore database
    const count = await adminResetAllUsersStatsInFirestore();

    // 2. Reset locally for current user
    if (user) {
      const updatedSelf: UserProfile = {
        ...user,
        stats: zeroStats,
        level: 1,
        xp: 0,
      };
      saveUser(updatedSelf);
    }

    // 3. Reset all accounts in local memory state
    setAllRegisteredUsers((prev) =>
      prev.map((u) => ({
        ...u,
        stats: zeroStats,
        level: 1,
        xp: 0,
      }))
    );

    return count;
  };

  // Admin function: Unlock all badges
  const unlockAllAchievements = () => {
    if (!user) return;
    saveUser({
      ...user,
      unlockedBadges: [
        'Newbie Artist',
        'Sharp Guesser',
        'Word Prodigy',
        'Champion',
        'Master Artist',
        'Lightning Speed',
        'VIP High Roller',
        'Owner Superadmin',
        'Legendary Oracle',
        'Arcade God',
      ],
    });
  };

  const toggleAdminRole = () => {
    if (!user) return;
    saveUser({
      ...user,
      isAdmin: !user.isAdmin,
    });
  };

  const purchaseOrEquipSkin = (mode: ArcadeGameMode, skinId: GameSkinId, durationDays: 7 | 15 | 30 = 7): boolean => {
    if (!user) return false;
    const cosmetics = user.cosmetics || { owned: ['classic' as GameSkinId], equipped: {} };
    const expiresAt = cosmetics.ownedUntil?.[skinId];
    const isOwned = skinId === 'classic' || (cosmetics.owned.includes(skinId) && typeof expiresAt === 'number' && expiresAt > Date.now());
    if (isOwned) {
      saveUser({ ...user, cosmetics: { ...cosmetics, equipped: { ...cosmetics.equipped, [mode]: skinId } } });
      return true;
    }
    const priceByDuration: Record<7 | 15 | 30, number> = { 7: 5000, 15: 10000, 30: 15000 };
    const price = priceByDuration[durationDays];
    if ((user.stats.totalScore || 0) < price) return false;
    const nextOwned = Array.from(new Set([...cosmetics.owned, skinId]));
    const nextOwnedUntil = { ...(cosmetics.ownedUntil || {}), [skinId]: Date.now() + durationDays * 24 * 60 * 60 * 1000 };
    saveUser({
      ...user,
      stats: { ...user.stats, totalScore: user.stats.totalScore - price },
      cosmetics: {
        owned: nextOwned,
        equipped: { ...cosmetics.equipped, [mode]: skinId },
        ownedUntil: nextOwnedUntil,
      },
    });
    return true;
  };

  const connectCustomFirebase = (config: FirebaseConfig): boolean => {
    const success = initFirebaseService(config);
    setIsFirebaseConnected(success);
    if (success && user) {
      saveProfileToFirestore(user);
    }
    return success;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isFirebaseConnected,
        isAdmin,
        isNgip,
        darkMode,
        toggleDarkMode,
        activities,
        allRegisteredUsers,
        connectCustomFirebase,
        loginGuest,
        loginWithFirebaseGoogle,
        loginWithFirebaseEmail,
        registerWithFirebaseEmail,
        logout,
        deleteAccount,
        adminDeleteUser,
        updateStats,
        logPlayerActivity,
        updateAvatar,
        updateUsername,
        isUsernameAvailable,
        overrideStats,
        resetUserStats,
        resetAllUsersStats,
        unlockAllAchievements,
        toggleAdminRole,
        toggleUserNgip,
        adminOverrideOtherUserStats,
        purchaseOrEquipSkin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

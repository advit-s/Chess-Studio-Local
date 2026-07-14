import type { AppSettings, SavedGame } from '../types/chess';

const KEY = 'chess-studio-local-games-v2';
const LEGACY_KEY = 'chess-studio-local-games-v1';
const SETTINGS_KEY = 'chess-studio-local-settings-v2';
const LEGACY_SETTINGS_KEY = 'chess-studio-local-settings-v1';

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('Ignored invalid Chess Studio storage data.', error);
    return undefined;
  }
}

function isSavedGame(value: unknown): value is SavedGame {
  if (!value || typeof value !== 'object') return false;
  const game = value as Partial<SavedGame>;
  return (
    typeof game.id === 'string' &&
    typeof game.name === 'string' &&
    typeof game.pgn === 'string' &&
    typeof game.fen === 'string' &&
    typeof game.createdAt === 'string' &&
    typeof game.updatedAt === 'string' &&
    typeof game.result === 'string' &&
    typeof game.moveCount === 'number'
  );
}

export function loadGames(): SavedGame[] {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    const value = parseJson(stored);
    return Array.isArray(value) ? value.filter(isSavedGame).slice(0, 100) : [];
  } catch (error) {
    console.warn('Saved games are unavailable in this browser session.', error);
    return [];
  }
}

export function saveGames(games: SavedGame[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(games));
    return true;
  } catch (error) {
    console.error('Could not save the local game archive.', error);
    return false;
  }
}

export function upsertGame(game: SavedGame): { success: boolean; games: SavedGame[] } {
  const current = loadGames();
  const next = [game, ...current.filter((item) => item.id !== game.id)].slice(0, 100);
  const success = saveGames(next);
  return { success, games: next };
}

export function deleteSavedGame(id: string): { success: boolean; games: SavedGame[] } {
  const current = loadGames();
  const next = current.filter((item) => item.id !== id);
  const success = saveGames(next);
  return { success, games: success ? next : current };
}

const finiteNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
};

export function loadSettings(fallback: AppSettings): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    const value = parseJson(stored);
    if (!value || typeof value !== 'object') return fallback;
    const settings = value as Partial<AppSettings>;
    return {
      depth: finiteNumber(settings.depth, fallback.depth, 8, 24),
      multiPv: finiteNumber(settings.multiPv, fallback.multiPv, 1, 5),
      engineMoveTime: finiteNumber(settings.engineMoveTime, fallback.engineMoveTime, 100, 10_000),
      analysisEnabled: typeof settings.analysisEnabled === 'boolean'
        ? settings.analysisEnabled
        : fallback.analysisEnabled,
      orientation: settings.orientation === 'black' ? 'black' : 'white',
      engineColor: settings.engineColor === 'w' ? 'w' : 'b',
      theme: settings.theme === 'light' ? 'light' : 'dark',
    };
  } catch (error) {
    console.warn('Settings are unavailable in this browser session.', error);
    return fallback;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Could not save Chess Studio settings.', error);
  }
}

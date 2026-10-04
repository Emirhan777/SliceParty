export const GAME_URL = process.env.EXPO_PUBLIC_GAME_URL || 'https://emirhan777.github.io/SliceParty/';
export const GAME_ID = 'ninja';
export const MAX_PLAYERS = 2;
export type Point = { x: number; y: number; vx?: number; vy?: number };
export type Hud = { score?: number; best?: number; lives?: number; combo?: number; status?: string };

export function parseRoom(input: string): string {
  const value = input.trim();
  if (/^\d{6}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const web = ['https:', 'http:'].includes(url.protocol) && url.pathname.endsWith('/play.html');
    const native = url.protocol === 'sliceparty:' && url.hostname === 'join' && ['', '/'].includes(url.pathname);
    if ((!web && !native) || url.username || url.password || url.searchParams.getAll('room').length !== 1) throw new Error();
    const room = url.searchParams.get('room') || '';
    if (/^\d{6}$/.test(room)) return room;
  } catch {}
  throw new Error('Scan the game QR code or enter the six-digit room code.');
}

export function claimPlayer(players: Record<string, { slot: number }> | null, pid: string) {
  const current = players || {};
  if (current[pid]) return current;
  const taken = new Set(Object.values(current).map(p => p?.slot));
  let slot = 0;
  while (taken.has(slot) && slot < MAX_PLAYERS) slot++;
  if (slot >= MAX_PLAYERS) return undefined;
  return { ...current, [pid]: { slot, joinedAt: { '.sv': 'timestamp' } } };
}

// Expo's native rotation is radians; the shared browser tracker uses degrees.
export function motionDegrees(rotation: { alpha: number; beta: number } | null) {
  if (!rotation || !Number.isFinite(rotation.alpha) || !Number.isFinite(rotation.beta)) return null;
  return [rotation.alpha * 180 / Math.PI, rotation.beta * 180 / Math.PI] as const;
}

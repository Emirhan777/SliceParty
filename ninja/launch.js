// Shared, one-use handoff from an app to a big-screen browser.
export const LAUNCH_TTL_MS = 10 * 60 * 1000;

export function parseLaunch(hash) {
  const match = /^#launch=(\d{6})\.([a-f0-9]{32})$/.exec(hash);
  return match ? { code: match[1], token: match[2] } : null;
}

export function claimLaunch(room, token, now = Date.now()) {
  if (room?.game !== 'ninja' || room.status !== 'waiting-screen'
    || room.launch?.token !== token || !(room.launch.expiresAt > now)) return undefined;
  return { ...room, status: 'lobby', launch: { ...room.launch, claimed: true } };
}

export function cancelLaunch(room, token) {
  // Never delete a room after a screen has taken ownership, even in a race.
  return room?.game === 'ninja' && room.status === 'waiting-screen'
    && room.launch?.token === token ? null : undefined;
}

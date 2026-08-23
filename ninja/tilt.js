// Phone orientation -> a normalized (0..1) point on the big screen.
//
// Ported from the PenDraw prototype (app/game.js), with three changes that a
// slashing game needs and a drawing app does not:
//   * Much higher gains. PenDraw needed ~112 degrees of yaw to cross the screen,
//     which is a body turn. A slash has to be a wrist flick, so a full sweep is
//     ~33 degrees instead.
//   * recenter() anchors the current pose to the screen CENTRE (0.5, 0.5).
//     PenDraw anchored to the left edge because you start a drawing there.
//   * A user-facing sensitivity multiplier, persisted on the phone.

// Gains are "screens per PI radians": normX moves by GAIN for a PI-radian turn.
export const YAW_GAIN = 5.5;   // left/right (x)
export const PITCH_GAIN = 5.0; // up/down (y)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Yaw wraps at +/-PI. Wrap a DIFFERENCE into [-PI, PI] so a tiny real movement
// across the wrap line never registers as a full 2*PI jump to the far edge.
export function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// A calibration says: this raw orientation maps to this on-screen anchor.
export const CENTER_CAL = { yaw0: 0, pitch0: 0, anchorX: 0.5, anchorY: 0.5 };

// Make the CURRENT pose mean "screen centre". Called whenever the player hits
// Center, and once automatically at the start of every run.
export const centerCal = (yaw, pitch) => ({ yaw0: yaw, pitch0: pitch, anchorX: 0.5, anchorY: 0.5 });

export function toNorm(yaw, pitch, cal = CENTER_CAL, sens = 1) {
  const dYaw = wrapPi(yaw - cal.yaw0);
  const x = clamp(cal.anchorX - (dYaw * YAW_GAIN * sens) / Math.PI, 0, 1);
  const y = clamp(cal.anchorY - ((pitch - cal.pitch0) * PITCH_GAIN * sens) / Math.PI, 0, 1);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Sensitivity, persisted per phone.
// ---------------------------------------------------------------------------
const SENS_KEY = "ninja.sens";
export const SENS_MIN = 0.5, SENS_MAX = 2.0;

export function loadSens() {
  try {
    const v = parseFloat(localStorage.getItem(SENS_KEY));
    return Number.isFinite(v) ? clamp(v, SENS_MIN, SENS_MAX) : 1;
  } catch { return 1; }
}
export function saveSens(v) {
  try { localStorage.setItem(SENS_KEY, String(clamp(v, SENS_MIN, SENS_MAX))); } catch {}
}

// ---------------------------------------------------------------------------
// Tracker: turns a stream of deviceorientation events into {x, y, vx, vy}
// samples. Velocity is measured HERE, on the phone, where timing is clean —
// the screen uses it to extrapolate through network lag.
// ---------------------------------------------------------------------------
export function createTracker() {
  let cal = CENTER_CAL;
  let sens = loadSens();
  let needsCenter = true;
  let prev = null; // { x, y, t }

  return {
    get sensitivity() { return sens; },
    set sensitivity(v) { sens = clamp(v, SENS_MIN, SENS_MAX); saveSens(sens); },

    // Ask for a recentre on the next sample (we need a live reading to do it).
    center() { needsCenter = true; },

    // alpha/beta in DEGREES, straight off the deviceorientation event.
    // Returns { x, y, vx, vy } in normalized units and units/second, or null
    // if the event carried nothing usable.
    push(alphaDeg, betaDeg, now = performance.now()) {
      if (alphaDeg == null || betaDeg == null) return null;
      const yaw = (alphaDeg * Math.PI) / 180;
      const pitch = (betaDeg * Math.PI) / 180;

      if (needsCenter) { cal = centerCal(yaw, pitch); needsCenter = false; prev = null; }

      const { x, y } = toNorm(yaw, pitch, cal, sens);

      let vx = 0, vy = 0;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0.001 && dt < 0.25) { vx = (x - prev.x) / dt; vy = (y - prev.y) / dt; }
      }
      prev = { x, y, t: now };
      return { x, y, vx, vy };
    },

    // Touch fallback shares the same output shape, so nothing downstream cares
    // whether the sword is driven by a gyro or a finger.
    pushPoint(x, y, now = performance.now()) {
      x = clamp(x, 0, 1); y = clamp(y, 0, 1);
      let vx = 0, vy = 0;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0.001 && dt < 0.25) { vx = (x - prev.x) / dt; vy = (y - prev.y) / dt; }
      }
      prev = { x, y, t: now };
      return { x, y, vx, vy };
    },

    reset() { prev = null; },
  };
}

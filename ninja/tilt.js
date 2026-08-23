// Phone orientation -> a point on the big screen.
//
// The obvious implementation reads alpha (compass) for x and beta (pitch) for y.
// It works right up until you hold the phone the way you actually hold a sword -
// upright - and then it falls apart. At beta = 90 degrees alpha and gamma
// describe the same physical rotation, so the sensor fusion is free to trade one
// for the other, and alpha on its own stops meaning anything. A one-degree
// wobble of the wrist can swing alpha by ten degrees, which throws the blade a
// third of the way across the screen. That is the "blade jumps around" bug, and
// no amount of smoothing downstream can fix it, because the jump is in the input.
//
// So don't read Euler angles. Rebuild the rotation matrix and ask a question
// that has one unambiguous answer regardless of how the phone is held:
//
//     WHICH WAY IS THE BACK OF THE PHONE POINTING?
//
// That direction is a vector. It moves smoothly, it has no singularity anywhere
// you would actually aim, and it is precisely what you are doing when you point
// a phone at a screen. Its azimuth drives x, its elevation drives y.
//
// A happy side effect: the answer does not depend on how the phone is rotated
// about that pointing axis, so spinning it in your hand no longer moves the
// blade at all.
//
// Measured by tools/tilt-test.mjs.

const DEG = Math.PI / 180;

// Gains are "screens per PI radians": the point moves by GAIN for a PI-radian
// turn, so a full sweep of the screen takes about 33 degrees - a flick of the
// wrist rather than a turn of the body.
export const YAW_GAIN = 5.5;   // left/right (x)
export const PITCH_GAIN = 5.0; // up/down (y)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Angles wrap at +/-PI. Wrap a DIFFERENCE into [-PI, PI] so a tiny real movement
// across the wrap line never registers as a full turn to the opposite edge.
export function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Direction the back of the phone points, in Earth coordinates
// (x = east, y = north, z = up).
//
// This is the negated third column of the device->Earth rotation matrix
// R = Rz(alpha) . Rx(beta) . Ry(gamma). Every one of alpha, beta and gamma
// contributes, which is the entire point: the combination is well behaved even
// where the individual angles are not.
export function pointingVector(alphaDeg, betaDeg, gammaDeg) {
  const a = alphaDeg * DEG, b = betaDeg * DEG, g = gammaDeg * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  return {
    x: -(cA * sG + sA * sB * cG),
    y: -(sA * sG - cA * sB * cG),
    z: -(cB * cG),
  };
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
// Velocity estimation.
//
// The screen extrapolates along this to hide network lag, so a bad estimate is
// worse than none: differentiating two samples 2ms apart turns a rounding error
// into a velocity of hundreds of screens per second, and the screen dutifully
// flings the blade across the display. Hence a minimum baseline, a hard ceiling,
// and a little smoothing.
// ---------------------------------------------------------------------------
const MIN_V_DT = 0.012;   // seconds; below this, wait for a longer baseline
const MAX_V_DT = 0.25;    // a longer gap than this means the stream stalled
const V_MAX = 8;          // screens per second
const V_SMOOTH = 0.45;

// ---------------------------------------------------------------------------
// Tracker: a stream of deviceorientation events in, {x, y, vx, vy} samples out.
// Velocity is measured HERE, on the phone, where the timing is clean.
// ---------------------------------------------------------------------------
export function createTracker() {
  let sens = loadSens();
  let cal = null;             // { az, el } - the pose that means "screen centre"
  let needsCenter = true;
  let lastAz = 0;
  let prev = null;            // { x, y, t }
  let vx = 0, vy = 0;

  function measure(x, y, now) {
    if (prev) {
      const dt = (now - prev.t) / 1000;
      if (dt >= MIN_V_DT && dt < MAX_V_DT) {
        const nvx = clamp((x - prev.x) / dt, -V_MAX, V_MAX);
        const nvy = clamp((y - prev.y) / dt, -V_MAX, V_MAX);
        vx += (nvx - vx) * V_SMOOTH;
        vy += (nvy - vy) * V_SMOOTH;
        prev = { x, y, t: now };
      }
      // Too soon to differentiate: keep the older baseline and try again next time.
    } else {
      prev = { x, y, t: now };
    }
    return { x, y, vx, vy };
  }

  return {
    get sensitivity() { return sens; },
    set sensitivity(v) { sens = clamp(v, SENS_MIN, SENS_MAX); saveSens(sens); },

    // Ask for a recentre on the next sample (we need a live reading to do it).
    center() { needsCenter = true; },

    // alpha/beta/gamma in DEGREES, straight off the deviceorientation event.
    // Returns { x, y, vx, vy }, or null if the event carried nothing usable.
    push(alphaDeg, betaDeg, gammaDeg, now = performance.now()) {
      if (alphaDeg == null || betaDeg == null) return null;
      const p = pointingVector(alphaDeg, betaDeg, gammaDeg ?? 0);

      const el = Math.asin(clamp(p.z, -1, 1));
      // Aimed at the ceiling or the floor, the azimuth of the pointing vector is
      // undefined - the same kind of singularity, but moved somewhere you never
      // aim. Hold the last good bearing rather than let it spin.
      const horiz = Math.hypot(p.x, p.y);
      const az = horiz > 0.12 ? Math.atan2(p.x, p.y) : lastAz;
      lastAz = az;

      if (needsCenter) {
        cal = { az, el };
        needsCenter = false;
        prev = null; vx = 0; vy = 0;
      }

      const x = clamp(0.5 + (wrapPi(az - cal.az) * YAW_GAIN * sens) / Math.PI, 0, 1);
      const y = clamp(0.5 - ((el - cal.el) * PITCH_GAIN * sens) / Math.PI, 0, 1);
      return measure(x, y, now);
    },

    // Touch fallback shares the same output shape, so nothing downstream cares
    // whether the sword is driven by a gyro or a finger.
    pushPoint(x, y, now = performance.now()) {
      return measure(clamp(x, 0, 1), clamp(y, 0, 1), now);
    },

    reset() { prev = null; vx = 0; vy = 0; },
  };
}

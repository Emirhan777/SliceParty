// Phone orientation -> a point on the big screen.
//
// This is PenDrawOnline's mapping, ported as-is from its web/player.html, because
// it is the one that holds steady in a real hand. It reads two numbers straight
// off the deviceorientation event and nothing else:
//
//     alpha  (turning left / right)   -> x
//     beta   (tipping up / down)      -> y
//
// No accelerometer, no devicemotion, no velocity, no prediction, no rebuilt
// rotation matrix. Wherever the phone points when you press PLAY (or Center)
// becomes the middle of the screen, and turning away from that pose moves the
// point a fixed amount per degree.
//
// An earlier version rebuilt the rotation matrix and aimed along the direction
// the back of the phone points. That is steadier if the phone is held straight
// up like a microphone - but nobody holds it that way here. The cast pad and the
// rune card are ON the phone screen, so you tip it back to look at them, which
// is PenDraw's pose, and in that pose the matrix version was the shaky one. It
// also produced a velocity that the big screen extrapolated along, and every
// wobble in that velocity became a jump of the tip. tools/tilt-test.mjs has the
// pose-by-pose numbers.

const DEG = Math.PI / 180;

// Gains are "screens per PI radians" - PenDraw's numbers exactly. A 112-degree
// turn sweeps the screen from edge to edge; a 60-degree tip sweeps it top to
// bottom. Low on purpose: gain multiplies the sensor's own dither along with the
// hand, so a high gain is a shaky pointer.
export const YAW_GAIN = 1.6;   // left/right (x)
export const PITCH_GAIN = 3.0; // up/down (y)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Angles wrap at +/-PI. Wrap a DIFFERENCE into [-PI, PI] so a tiny real movement
// across the wrap line never registers as a full turn to the opposite edge.
export function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// PenDraw's tiltToNorm(). `cal` is the pose that means "screen centre", in
// radians. `gains` exists so the tests can try other values; the game never
// passes it.
export function orientationToPoint(alphaDeg, betaDeg, cal, gains = {}) {
  const yawGain = gains.yawGain ?? YAW_GAIN;
  const pitchGain = gains.pitchGain ?? PITCH_GAIN;
  const yaw = alphaDeg * DEG, pitch = betaDeg * DEG;
  return {
    x: clamp(0.5 - (wrapPi(yaw - cal.yaw) * yawGain) / Math.PI, 0, 1),
    y: clamp(0.5 - ((pitch - cal.pitch) * pitchGain) / Math.PI, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Tracker: a stream of deviceorientation events in, {x, y} points out.
//
// vx / vy are always zero. The wire format still has room for them, but nothing
// is estimated: the big screen draws each point where it lands, the way
// PenDraw's screen does.
// ---------------------------------------------------------------------------
export function createTracker(gains = {}) {
  let cal = null;             // { yaw, pitch } - the pose that means "screen centre"
  let needsCenter = true;

  return {
    // Ask for a recentre on the next sample (it needs a live reading to do it).
    center() { needsCenter = true; },

    // alpha/beta in DEGREES, straight off the deviceorientation event. gamma
    // is accepted optionally (e.g. from play.html) for compatibility.
    // Returns { x, y, vx, vy }, or null if the event carried nothing usable.
    push(alphaDeg, betaDeg, gammaDeg = 0) {
      if (alphaDeg == null || betaDeg == null) return null;
      if (needsCenter) {
        cal = { yaw: alphaDeg * DEG, pitch: betaDeg * DEG };
        needsCenter = false;
      }
      const p = orientationToPoint(alphaDeg, betaDeg, cal, gains);
      return { x: p.x, y: p.y, vx: 0, vy: 0 };
    },

    // Touch fallback shares the same output shape, so nothing downstream cares
    // whether the wand is driven by a gyro or a finger.
    pushPoint(x, y) {
      return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), vx: 0, vy: 0 };
    },

    reset() {},
  };
}

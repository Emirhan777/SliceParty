import type { Point } from './protocol';
type Wire = Point & { vx: number; vy: number; t: number };
type Timing = { now?: () => number; schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; cancel?: (id: ReturnType<typeof setTimeout>) => void };

// Match the browser's 30ms cadence and 0.005 deadband; flush the final sample
// even if a swing ends between send windows. Never accumulate an input queue.
export function createSwordSender(write: (point: Wire) => void, {
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
}: Timing = {}) {
  let last: Point | null = null, pending: Point | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, lastAt = -Infinity, disposed = false;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; pending = null; };
  function flush() {
    timer = null;
    if (disposed || !pending) return;
    last = pending; pending = null; lastAt = now();
    write({ ...last, vx: 0, vy: 0, t: Date.now() });
  }
  return {
    send(point: Point) {
      if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const sample = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
      const elapsed = now() - lastAt;
      if (last && Math.hypot(sample.x - last.x, sample.y - last.y) < .005 && elapsed < 250) { clear(); return; }
      pending = sample;
      if (!last || elapsed >= 30) { if (timer !== null) cancel(timer); flush(); }
      else if (timer === null) timer = schedule(flush, 30 - elapsed);
    },
    destroy() { disposed = true; clear(); },
  };
}

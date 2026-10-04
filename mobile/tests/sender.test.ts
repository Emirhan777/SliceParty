import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSwordSender } from '../src/sender';

function setup() {
  let time = 0, pending: (() => void) | null = null;
  const writes: Parameters<Parameters<typeof createSwordSender>[0]>[0][] = [];
  const sender = createSwordSender(p => writes.push(p), {
    now: () => time,
    schedule: fn => { pending = fn; return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel: () => { pending = null; },
  });
  return { sender, writes, at(t: number) { time = t; }, flush() { const fn = pending; pending = null; fn?.(); } };
}
test('send immediately, coalesce movement, and flush the final swing endpoint', () => {
  const s = setup();
  s.sender.send({ x: .5, y: .5 });
  s.at(5); s.sender.send({ x: .6, y: .5 });
  s.at(10); s.sender.send({ x: .8, y: .5 });
  assert.equal(s.writes.length, 1);
  s.at(30); s.flush();
  assert.equal(s.writes.length, 2);
  assert.equal(s.writes[1].x, .8);
  assert.equal(s.writes[1].vx, 0);
});
test('out-and-back cancels stale movement; keepalive still sends', () => {
  const s = setup(); s.sender.send({ x: .5, y: .5 });
  s.at(5); s.sender.send({ x: .8, y: .5 });
  s.at(10); s.sender.send({ x: .5, y: .5 });
  s.at(30); s.flush(); assert.equal(s.writes.length, 1);
  s.at(251); s.sender.send({ x: .5, y: .5 }); assert.equal(s.writes.length, 2);
});
test('disconnect cancels queued movement and rejects future samples', () => {
  const s = setup(); s.sender.send({ x: .5, y: .5 });
  s.at(5); s.sender.send({ x: .9, y: .5 }); s.sender.destroy();
  s.at(30); s.flush(); s.sender.send({ x: .1, y: .1 });
  assert.equal(s.writes.length, 1);
});
test('drop invalid sensor points, clamp bounds, and never send velocity prediction', () => {
  const s = setup(); s.sender.send({ x: NaN, y: .5 }); assert.equal(s.writes.length, 0);
  s.sender.send({ x: -1, y: 2, vx: 100 });
  assert.equal(s.writes[0].x, 0); assert.equal(s.writes[0].y, 1); assert.equal(s.writes[0].vx, 0);
});

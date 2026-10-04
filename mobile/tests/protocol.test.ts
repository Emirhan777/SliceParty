import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimPlayer, motionDegrees, parseRoom } from '../src/protocol';
import { createTracker } from '../../ninja/tilt';

test('join existing browser QR links, six-digit codes, and app deep links', () => {
  for (const value of [' 123456 ', 'https://game.example/play.html?room=123456', 'http://192.168.1.2:3001/play.html?room=123456', 'https://game.example/sub/play.html?room=123456', 'sliceparty://join?room=123456']) assert.equal(parseRoom(value), '123456');
});
test('reject malformed or ambiguous room links', () => {
  for (const value of ['12345', 'abcdef', 'https://game.example/?room=123456', 'javascript:123456', 'sliceparty://other?room=123456', 'https://user:secret@game.example/play.html?room=123456', 'https://game.example/play.html?room=123456&room=654321', 'https://game.example/play.html?room=../rooms']) assert.throws(() => parseRoom(value));
});
test('atomic player claims preserve players, select a free slot, and reject a third sword', () => {
  const first = claimPlayer(null, 'first')!;
  assert.equal(first.first.slot, 0);
  const second = claimPlayer(first, 'second')!;
  assert.equal(second.second.slot, 1);
  assert.deepEqual(second.first, first.first);
  assert.equal(claimPlayer(second, 'third'), undefined);
  assert.equal(claimPlayer(second, 'first'), second);
});
test('native sensor radians drive the exact browser mapping', () => {
  const native = createTracker(), browser = createTracker();
  for (let i = 0; i < 300; i++) {
    if (i === 150) { native.center(); browser.center(); }
    const alpha = .7 * Math.sin(i * .09), beta = Math.PI / 4 + .3 * Math.cos(i * .07);
    const degrees = motionDegrees({ alpha, beta })!;
    assert.deepEqual(native.push(...degrees), browser.push(alpha * 180 / Math.PI, beta * 180 / Math.PI));
  }
  assert.equal(motionDegrees(null), null);
  assert.equal(motionDegrees({ alpha: NaN, beta: 1 }), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { createAutoScrollController } = await import('../lib/auto-scroll-controller.ts');

test('content growth stays pinned to the newest message while following', () => {
  let scrollCount = 0;
  const controller = createAutoScrollController({
    getDistanceFromBottom: () => 240,
    scrollToBottom: () => {
      scrollCount += 1;
    },
  });

  controller.handleContentResize();

  assert.equal(scrollCount, 1);
});

test('manual scrolling pauses following until the user returns near the bottom', () => {
  let distanceFromBottom = 240;
  let scrollCount = 0;
  const controller = createAutoScrollController({
    getDistanceFromBottom: () => distanceFromBottom,
    scrollToBottom: () => {
      scrollCount += 1;
    },
  });

  controller.handleScroll();
  controller.handleContentResize();

  assert.equal(scrollCount, 0);

  distanceFromBottom = 20;
  controller.handleScroll();
  controller.handleContentResize();

  assert.equal(scrollCount, 1);
});

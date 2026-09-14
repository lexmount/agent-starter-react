import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('auto-scroll receives the mounted element ref instead of its initial null value', async () => {
  const component = await readFile('components/livekit/scroll-area/scroll-area.tsx', 'utf8');
  const hook = await readFile('components/livekit/scroll-area/hooks/useAutoScroll.ts', 'utf8');

  assert.match(component, /useAutoScroll\(scrollContentRef\)/);
  assert.doesNotMatch(component, /useAutoScroll\(scrollContentRef\.current\)/);
  assert.match(hook, /const scrollContentContainer = scrollContentRef\.current/);
});

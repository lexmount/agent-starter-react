import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shadcn config points at the imported Tailwind CSS file', async () => {
  const config = JSON.parse(await readFile('components.json', 'utf8'));
  const layout = await readFile('app/layout.tsx', 'utf8');

  assert.equal(config.tailwind.css, 'styles/globals.css');
  assert.match(layout, /import '@\/styles\/globals\.css'/);
});

test('README matches the documented LexVoice environment source', async () => {
  const readme = await readFile('README.md', 'utf8');
  const envExample = await readFile('.env.example', 'utf8');

  assert.match(envExample, /documentation-only/);
  assert.match(readme, /\.\.\/lex-voice\/\.env/);
  assert.doesNotMatch(readme, /copy `\.env\.example`/i);
});

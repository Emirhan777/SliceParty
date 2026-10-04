// Publish only the browser game; development credentials and native builds stay local.
import { mkdir, cp, writeFile } from 'node:fs/promises';
const out = new URL('../dist/site/', import.meta.url);
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'play.html', 'firebase-config.js', 'privacy.html', 'support.html', 'ninja']) {
  await cp(new URL('../' + name, import.meta.url), new URL(name, out), { recursive: true });
}
await writeFile(new URL('.nojekyll', out), '');
console.log('Slice Party site prepared in dist/site');

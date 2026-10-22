// Renders every song offline in a real browser (OfflineAudioContext) at low and full intensity and checks
// the result: no NaN, not silent, no clipping before the limiter, and loudness within a band so no song
// jumps out of the mix. Prints a table; exit code is non-zero on failure.
// Usage: node tools/audiocheck.mjs [--bars=8] [song ...]
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
for (const p of ['playwright', path.join(ROOT, '../tree/node_modules/playwright')]) {
  try { pw = require(p); break; } catch (e) { /* try next */ }
}
if (!pw) { console.error('playwright not found'); process.exit(2); }
const BARS = +((process.argv.find(a => a.startsWith('--bars=')) || '--bars=8').slice(7));
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));

const browser = await pw.chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForFunction(() => window.MB && MB.music && MB.songs);
const ids = only.length ? only : await page.evaluate(() => Object.keys(MB.songs.list));
const rows = [];
for (const id of ids) {
  for (const I of [0.3, 1]) rows.push(await page.evaluate(([id, I, bars]) => MB.music.renderOffline(id, { bars, I }).then(r => Object.assign(r, { I })), [id, I, BARS]));
}
await browser.close();

const db = v => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1).padStart(6);
let fail = 0;
console.log('song        I     rms dB  peak dB  layers');
for (const r of rows) {
  const why = r.bad ? 'NaN' : r.rms < 0.01 ? 'silent' : r.peak > 0.95 ? 'clips' : r.rms > 0.25 ? 'too loud' : '';
  if (why) fail++;
  console.log(`${r.id.padEnd(10)} ${r.I.toFixed(1)}  ${db(r.rms)}  ${db(r.peak)}   ${r.on.join(' ')}${why ? '   FAIL ' + why : ''}`);
}
if (errors.length) { console.log('page errors:', errors.join(' | ')); fail++; }
console.log(fail ? fail + ' failure(s)' : 'all passed');
process.exit(fail ? 1 : 0);

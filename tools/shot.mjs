// Screenshot a local page with Playwright.
// Usage: node tools/shot.mjs <path-or-url> <out.png> [width] [height] [--wait=ms] [--eval=js]
// Playwright is borrowed from ../tree/node_modules when it is not installed here.
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

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const [target, out, w = '1600', h = '900'] = args;
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(path.resolve(ROOT, target.split('?')[0])).href + (target.includes('?') ? '?' + target.split('?')[1] : '');

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
if (flags.eval) await page.evaluate(flags.eval);
await page.waitForTimeout(+(flags.wait || 400));
await page.screenshot({ path: out });
await browser.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
console.log('saved', out);

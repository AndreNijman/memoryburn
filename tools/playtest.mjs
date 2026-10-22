// End-to-end playtest through real browser input (mouse clicks + keyboard), asserting the screen flow.
// Usage: node tools/playtest.mjs [--shots=dir]     Exit code is non-zero on any failure or page error.
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
const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').slice(8);

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  (' + detail + ')' : '')); };
const screen = () => page.evaluate(() => MB.app.screen);
const sim = f => page.evaluate(f);
const wait = ms => page.waitForTimeout(ms);
async function until(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(50); } return false; }
async function click(x, y) { await page.mouse.move(x, y); await wait(60); await page.mouse.down(); await wait(40); await page.mouse.up(); await wait(120); }
async function shot(name) { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); }

await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?debug&seed=4242');
check('boot: menu', await until(async () => (await page.evaluate(() => window.MB && MB.app && MB.app.screen)) === 'menu'));
await wait(300);

await click(960, 726);                       // Start Run
check('menu -> chars', (await screen()) === 'chars', await screen());
await click(300, 330);                       // first character card (Netrunner)
check('chars -> difficulty', (await screen()) === 'difficulty', await screen());
await click(590, 580);                       // Normal
check('difficulty -> intro story', (await screen()) === 'intro', await screen());
for (let i = 0; i < 6 && (await screen()) === 'intro'; i++) { await page.keyboard.press('Space'); await wait(150); }
check('intro -> play', (await screen()) === 'play', await screen());
check('run: Netrunner on Normal', await sim(() => MB.app.sim.players[0].arch === 0 && MB.app.sim.difficulty === 'Normal'));

// movement + dash through held keys
const x0 = await sim(() => MB.app.sim.players[0].x);
await page.keyboard.down('KeyD'); await wait(500); await page.keyboard.up('KeyD');
const x1 = await sim(() => MB.app.sim.players[0].x);
check('input: holding D moves right', x1 > x0 + 40, Math.round(x1 - x0) + 'px');
await page.keyboard.down('KeyA'); await page.keyboard.press('Space'); await wait(80);
check('input: Space dashes', await sim(() => MB.app.sim.players[0].dash_cd > 0));
await page.keyboard.up('KeyA');
await wait(1500);
check('play: auto-fire shoots something', await sim(() => MB.app.sim.kills > 0 || MB.app.sim.bullets.length > 0), await sim(() => MB.app.sim.kills + ' kills'));
await shot('pt_play');

// pause and resume
await page.keyboard.press('Escape'); await wait(120);
check('Esc -> pause', (await screen()) === 'pause');
const tick = await sim(() => MB.app.sim.tick); await wait(300);
check('pause freezes the sim', (await sim(() => MB.app.sim.tick)) === tick);
await click(960 - 300, 212);                 // Options tab
await shot('pt_pause_options');
await click(960 + 300 * 0 + 0, 212);         // Legend tab
await shot('pt_pause_legend');
await page.keyboard.press('Escape'); await wait(120);
check('Esc -> play', (await screen()) === 'play');

// debug skip to the shop
await page.keyboard.press('Digit8'); await wait(200);
check('debug 8 -> shop', (await screen()) === 'shop', await screen());
await page.keyboard.press('Digit9'); await wait(100);
const cash0 = await sim(() => MB.app.sim.players[0].cash);
check('debug 9 adds eddies', cash0 >= 100, cash0);
const items1 = await sim(() => MB.app.sim.players[0].shop.items[1]);
await click(837, 621);                       // lock card 2
check('shop: lock click locks without buying', await sim(() => MB.app.sim.players[0].shop.locks[1] && MB.app.sim.players[0].items.length === 0));
await click(224, 620);                       // buy card 1
check('shop: buy click buys', await sim(() => MB.app.sim.players[0].items.length === 1));
await click(220, 1020);                      // reroll
check('shop: reroll keeps the locked card', await sim(i => MB.app.sim.players[0].shop.items[1] === i, items1) || (await sim(() => MB.app.sim.players[0].shop.items[1])) === items1);
await shot('pt_shop');
await click(1630, 1013);                     // Contract Start
check('shop -> preview', (await screen()) === 'preview', await screen());
const beats = await sim(() => MB.app.story ? MB.app.story.beats.length : 0);
for (let i = 0; i < beats * 2; i++) { await page.keyboard.press('Space'); await wait(150); }  // reveal + advance each beat
check('story end shows the briefing (no same-press deploy)', (await screen()) === 'preview' && (await sim(() => MB.app.story)) === null, beats + ' beat(s), screen ' + (await screen()));
await shot('pt_briefing');
await page.keyboard.press('Space'); await wait(200);
check('preview -> play wave 2', (await screen()) === 'play' && (await sim(() => MB.app.sim.wave)) === 2, await screen());

// death -> game over -> retry
await sim(() => { const p = MB.app.sim.players[0]; MB.app.sim.biome = 'Neon Grid'; p.hp = 0; p.iframe = 0; }); // Reactor Core's drain floors HP at 1
check('death -> gameover', await until(async () => (await screen()) === 'gameover', 4000), await screen());
await wait(800);
await shot('pt_gameover');
await click(1185, 865);                      // Menu
check('gameover -> menu', (await screen()) === 'menu', await screen());

// settings persist
await sim(() => { MB.app.settings.vfx = 75; MB.app.saveSettings(); });
await page.reload();
await until(async () => (await page.evaluate(() => window.MB && MB.app && MB.app.screen)) === 'menu');
check('settings persist across reload', (await sim(() => MB.app.settings.vfx)) === 75);
await sim(() => { localStorage.clear(); });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? failures + ' failure(s)' : 'all passed');
process.exit(failures ? 1 : 0);

// Two-browser co-op playtest through real clicks and keys, against a local relay (or MB_RELAY).
//   node tools/mp-playtest.mjs [--shots=dir]      exit code is non-zero on any failure or page error
// Host and guest are separate browser contexts (separate storage, like two machines). The host creates a lobby from
// the Co-op screen, the guest joins by typing the code, picks a runner and readies, the host starts; the story gate
// holds the run until the guest finishes the intro; the guest moves the host's copy of their runner, buys in the
// shop, both deploy into contract 2; then the guest leaves and the host's autopilot takes the runner.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRelay, stopRelay } from './relay-dev.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
for (const p of ['playwright', path.join(ROOT, '../tree/node_modules/playwright')]) {
  try { pw = require(p); break; } catch (e) { /* try next */ }
}
if (!pw) { console.error('playwright not found'); process.exit(2); }
const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').slice(8);

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null ? '  (' + detail + ')' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));

let browser;
try {
  const relay = await startRelay();
  console.log('relay at', relay);
  browser = await pw.chromium.launch();
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href + '?debug&relay=' + encodeURIComponent(relay);
  const errors = [];
  async function open(label, skipStory) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(skip => {
      try { localStorage.setItem('memoryburn.settings.v1', JSON.stringify({ skipStory: skip, masterVol: 0 })); } catch (e) { /* ignore */ }
    }, skipStory);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(label + ': ' + String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    await page.goto(url);
    const p = {
      page,
      ev: f => page.evaluate(f),
      screen: () => page.evaluate(() => MB.app.screen),
      async until(f, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(f)) return true; await wait(50); } return false; },
      async click(x, y) { await page.mouse.move(x, y); await wait(50); await page.mouse.down(); await wait(40); await page.mouse.up(); await wait(120); },
      async shot(name) { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); },
    };
    await p.until(() => window.MB && MB.app && MB.app.screen === 'menu');
    await wait(200);
    return p;
  }
  const A = await open('host', true), B = await open('guest', false);

  // host: Co-op -> name -> Host
  await A.click(960, 832);
  check('menu -> co-op', (await A.screen()) === 'coop', await A.screen());
  await A.click(960, 254); await A.page.keyboard.type('Hosty');
  await A.click(420, 862);
  check('host: lobby opens', await A.until(() => MB.app.screen === 'lobby' && MB.net.lobby && MB.net.lobby.code), await A.screen());
  const code = await A.ev(() => MB.net.lobby.code);
  check('host: lobby has a code', /^[A-Z0-9]{5}$/.test(code), code);
  await A.shot('mp_host_lobby');

  // guest: Co-op -> name -> code -> Join
  await B.click(960, 832);
  await B.click(960, 254); await B.page.keyboard.type('Guesty');
  check('guest: name typed', (await B.ev(() => MB.app.screen)) === 'coop');
  await B.click(1000, 512); await B.page.keyboard.type(code.toLowerCase());
  await B.shot('mp_guest_coop');
  await B.click(1000, 862);
  check('guest: joins the lobby by code', await B.until(() => MB.app.screen === 'lobby' && MB.net.lobby && MB.net.lobby.players.length === 2), await B.screen());
  check('host: sees the guest', await A.until(() => MB.net.lobby.players.some(p => p.name === 'Guesty' && p.slot === 1)));

  // guest picks a runner and readies; host starts
  await B.click(1493, 345);
  check('guest: pick reaches the host', await A.until(() => MB.net.lobby.players.find(p => p.name === 'Guesty').arch === 2));
  check('host: cannot start before the guest is ready', !(await A.ev(() => MB.net.canStart().ok)));
  await B.click(1430, 995);
  check('host: guest ready', await A.until(() => MB.net.canStart().ok));
  await A.shot('mp_host_lobby_ready');
  await A.click(1430, 995);
  check('both: run starts', await A.until(() => MB.app.coop && MB.app.sim) && await B.until(() => MB.app.coop && MB.app.sim));
  check('host: skips the story, guest reads it', (await A.screen()) === 'play' && (await B.screen()) === 'intro', (await A.screen()) + '/' + (await B.screen()));
  await wait(500);
  check('story gate: the host holds the run for the guest', (await A.ev(() => MB.app.sim.tick)) === 0 && (await A.ev(() => MB.net.holding())) === 1);
  await A.shot('mp_host_waiting');
  for (let i = 0; i < 14 && (await B.screen()) === 'intro'; i++) { await B.page.keyboard.press('Space'); await wait(150); }
  check('guest: intro -> play', (await B.screen()) === 'play', await B.screen());
  check('story gate opens', await A.until(() => MB.app.sim.tick > 30));
  check('guest: mirror follows the host', await B.until(() => MB.app.sim.remote && MB.app.sim.tick > 20 && MB.app.slot === 1));
  check('guest: guest runner is the picked one', (await B.ev(() => MB.app.sim.players[1].arch)) === 2);
  await B.ev(() => { MB.app.settings.skipStory = true; }); // keep later briefings short

  // guest input moves the host's copy of the guest runner
  const x0 = await A.ev(() => MB.app.sim.players[1].x);
  await B.page.keyboard.down('KeyD'); await wait(300);
  // own-runner prediction: averaged over a few samples, the guest draws its runner nearer the host's live position
  // than its delayed mirror is (on localhost the mirror is only a frame or two behind)
  let dPred = 0, dMir = 0, nPred = 0;
  for (let k = 0; k < 10; k++) {
    const g = await B.ev(() => { const q = MB.net.predicted(); return { q: q && q.x, m: MB.app.sim.players[1].x }; });
    const hx = await A.ev(() => MB.app.sim.players[1].x);
    if (g.q != null) { nPred++; dPred += Math.abs(g.q - hx); } dMir += Math.abs(g.m - hx);
    await wait(30);
  }
  check('guest: own runner is drawn ahead of the delayed mirror', nPred === 10 && dPred < dMir, nPred + ' samples, ' + Math.round(dPred / 10) + ' vs ' + Math.round(dMir / 10) + ' px from the host');
  await B.page.keyboard.up('KeyD');
  const x1 = await A.ev(() => MB.app.sim.players[1].x);
  check('guest: D moves their runner on the host', x1 > x0 + 80, Math.round(x0) + ' -> ' + Math.round(x1));
  await wait(300);
  const gx = await B.ev(() => MB.app.sim.players[1].x), hx = await A.ev(() => MB.app.sim.players[1].x);
  check('guest: sees their runner where the host has it', Math.abs(gx - hx) < 60, Math.round(gx) + ' vs ' + Math.round(hx));
  check('guest: sees enemies and hears the fight', (await B.ev(() => MB.app.sim.enemies.length)) > 0 && (await B.ev(() => MB.audio.stats().played)) > 0);
  await B.shot('mp_guest_play');
  check('guest: Esc opens a menu that does not stop the run', await (async () => {
    await B.page.keyboard.press('Escape'); await wait(200);
    const t0 = await A.ev(() => MB.app.sim.tick); await wait(400);
    const ok = (await B.screen()) === 'pause' && (await A.ev(() => MB.app.sim.tick)) > t0 + 10;
    await B.page.keyboard.press('Escape'); await wait(150);
    return ok && (await B.screen()) === 'play';
  })());

  // end the contract (host debug key) -> shop on both
  await A.page.keyboard.press('Digit8');
  check('both: shop', await A.until(() => MB.app.screen === 'shop') && await B.until(() => MB.app.screen === 'shop'), (await A.screen()) + '/' + (await B.screen()));
  await A.ev(() => { MB.app.sim.players[1].cash += 300; MB.net.hostChanged(); });
  check('guest: sheet shows the new eddies', await B.until(() => MB.app.sim.players[1].cash >= 300));
  const items0 = await B.ev(() => MB.app.sim.players[1].items.length);
  await B.click(224, 621);
  check('guest: buy click buys on the host', await A.until(() => MB.app.sim.players[1].items.length > 0));
  check('guest: mirror shows the item', await B.until(() => MB.app.sim.players[1].items.length > 0), items0);
  check('guest: bought card shows SOLD', await B.until(() => MB.app.sim.players[1].shop.items[0] === null));
  await B.shot('mp_guest_shop');
  await B.click(1630, 1013);
  check('guest: ready reaches the host', await A.until(() => MB.app.sim.players[1].ready));
  await A.click(1630, 1013);
  check('both: briefing', await A.until(() => MB.app.screen === 'preview') && await B.until(() => MB.app.screen === 'preview'), (await A.screen()) + '/' + (await B.screen()));
  await B.page.keyboard.press('Space');
  check('host: sees the guest deployed', await A.until(() => MB.app.sim.players[1].ready));
  await A.page.keyboard.press('Space');
  check('both: contract 2', await A.until(() => MB.app.screen === 'play' && MB.app.sim.wave === 2) && await B.until(() => MB.app.screen === 'play' && MB.app.sim.wave === 2));

  // guest leaves from the pause menu -> host's autopilot takes the runner
  await B.page.keyboard.press('Escape'); await wait(150);
  await B.click(1557, 226); // Quit tab
  await B.click(960, 635);  // Leave
  check('guest: back at the menu', await B.until(() => MB.app.screen === 'menu' && MB.net.state === 'idle'), await B.screen());
  check('host: autopilot takes the dropped runner', await A.until(() => MB.net.botSlot(1) && MB.app.toasts.some(t => /dropped/.test(t.msg))));
  await A.shot('mp_host_after_drop');
  const bx = await A.ev(() => MB.app.sim.players[1].x); await wait(800);
  check('host: the dropped runner keeps moving', (await A.ev(() => MB.app.sim.players[1].x)) !== bx);

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  if (browser) await browser.close();
  stopRelay();
}
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);

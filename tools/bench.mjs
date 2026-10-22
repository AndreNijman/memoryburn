// Performance benchmark: a crowded late wave in a real browser, measuring per-frame JS cost by subsystem
// plus a CPU profile of the hottest functions. Numbers are relative (headless Chromium rasterises on the CPU).
// Usage: node tools/bench.mjs [--secs=8] [--wave=12] [--dpr=1] [--profile] [--off=floor,ground,top,weather,hud,world] [--smooth=low|medium|high] [--res=100 (0 = Auto)] [--arch=1]
// 'busy' is the time spent inside requestAnimationFrame callbacks (with software canvas this includes raster).
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
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? +a.split('=')[1] : d; };
const ARCH = arg('arch', 1), RES = arg('res', 100), SECS = arg('secs', 8), WAVE = arg('wave', 12), DPR = arg('dpr', 1), PROFILE = process.argv.includes('--profile');
const OFF = ((process.argv.find(a => a.startsWith('--off=')) || '').slice(6)).split(',').filter(Boolean);

const browser = await pw.chromium.launch({ args: process.env.BENCH_ARGS ? process.env.BENCH_ARGS.split(' ') : [] }); // e.g. BENCH_ARGS='--enable-gpu --ignore-gpu-blocklist'
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { // time every rAF callback
  const raf = window.requestAnimationFrame.bind(window);
  window.__busy = [];
  window.requestAnimationFrame = cb => raf(ts => { const a = performance.now(); cb(ts); window.__busy.push(performance.now() - a); });
});
const SMOOTH = (process.argv.find(a => a.startsWith('--smooth=')) || '').slice(9);
if (SMOOTH) await page.addInitScript(q => { // force imageSmoothingQuality to compare raster cost
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'imageSmoothingQuality');
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'imageSmoothingQuality', { get: d.get, set() { d.set.call(this, q); }, configurable: true });
}, SMOOTH);
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?screen=play&seed=4242&arch=' + ARCH);
await page.waitForFunction(() => window.MB && MB.app && MB.app.screen === 'play');

// late wave, immortal player, timer frozen so the arena keeps filling
await page.evaluate(([wave, off, res]) => {
  const s = MB.app.sim, p = s.players[0];
  MB.app.settings.resolution = res;
  s.wave = wave; p.max_hp = 1e9; p.hp = 1e9; p.cash = 0;
  ['damage', 'attack_speed'].forEach(k => { if (p[k] != null) p[k] *= 1; });
  const T = window.__bench = { t: {}, n: {}, frames: [] };
  const wrap = (obj, key, label) => {
    const f = obj[key];
    obj[key] = function () { const a = performance.now(); try { return f.apply(this, arguments); } finally { T.t[label] = (T.t[label] || 0) + performance.now() - a; T.n[label] = (T.n[label] || 0) + 1; } };
  };
  wrap(MB.sim, 'step', 'sim.step');
  wrap(MB.render, 'world', 'render.world');
  wrap(MB.render, 'snapshot', 'render.snapshot');
  wrap(MB.render.fx, 'consume', 'fx.consume');
  wrap(MB.render.fx, 'update', 'fx.update');
  wrap(MB.screens, 'hud', 'screens.hud');
  wrap(MB.radio, 'update', 'radio.update');
  setInterval(() => { s.waveTime = 30; p.hp = p.max_hp; }, 100);
  const R = MB.render, noop = () => {};
  if (off.includes('floor')) R.drawFloor = g => { g.fillStyle = '#333'; g.fillRect(0, 0, 1920, 1080); };
  if (off.includes('ground')) R.fx.drawGround = noop;
  if (off.includes('top')) R.fx.drawTop = noop;
  if (off.includes('weather')) R.fx.drawWeather = noop;
  if (off.includes('hud')) MB.screens.hud = noop;
  if (off.includes('world')) R.world = noop;
  let last = 0;
  (function tick(ts) { if (last) T.frames.push(ts - last); last = ts; requestAnimationFrame(tick); })(0);
}, [WAVE, OFF, RES]);

await page.waitForTimeout(4000); // let enemies pile up
await page.evaluate(() => { const T = window.__bench; T.t = {}; T.n = {}; T.frames = []; T.t0 = performance.now(); window.__busy = []; });
let cdp;
if (PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
await page.waitForTimeout(SECS * 1000);
let prof;
if (PROFILE) prof = (await cdp.send('Profiler.stop')).profile;
const r = await page.evaluate(() => {
  const T = window.__bench, s = MB.app.sim, el = performance.now() - T.t0;
  const f = T.frames.slice().sort((a, b) => a - b), q = k => f[Math.min(f.length - 1, Math.floor(f.length * k))];
  const bz = window.__busy.slice().sort((a, b) => a - b), bq = k => bz[Math.min(bz.length - 1, Math.floor(bz.length * k))];
  return { frames: f.length, el, p50: q(0.5), p95: q(0.95), p99: q(0.99), t: T.t, n: T.n, busy: bz.reduce((a, b) => a + b, 0) / bz.length, b95: bq(0.95),
    scale: MB.app.renderScale(), kills: s.kills, enemies: s.enemies.length, bullets: s.bullets.length, ebullets: s.ebullets.length, pickups: s.pickups.length };
});
await browser.close();

console.log(`frames ${r.frames} in ${(r.el / 1000).toFixed(1)}s = ${(r.frames / r.el * 1000).toFixed(1)} fps   frame ms p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  p99 ${r.p99.toFixed(1)}`);
console.log(`busy ms/frame: mean ${r.busy.toFixed(2)}  p95 ${r.b95.toFixed(2)}${OFF.length ? '   (off: ' + OFF.join(',') + ')' : ''}`);
console.log(`render scale ${r.scale.toFixed(2)}   kills ${r.kills}   entities: ${r.enemies} enemies, ${r.bullets} bullets, ${r.ebullets} enemy bullets, ${r.pickups} pickups`);
const per = Object.keys(r.t).map(k => [k, r.t[k] / r.frames, r.n[k] / r.frames]).sort((a, b) => b[1] - a[1]);
per.forEach(([k, ms, n]) => console.log(`  ${k.padEnd(16)} ${ms.toFixed(2).padStart(6)} ms/frame   (${n.toFixed(2)} calls/frame)`));

if (prof) {
  const self = new Map(), byId = new Map(prof.nodes.map(n => [n.id, n]));
  const dt = []; for (let i = 0; i < prof.timeDeltas.length; i++) dt.push(prof.timeDeltas[i]);
  prof.samples.forEach((id, i) => {
    const n = byId.get(id), cf = n.callFrame;
    const key = (cf.functionName || '(anon)') + ' ' + (cf.url ? cf.url.split('/').slice(-2).join('/') + ':' + (cf.lineNumber + 1) : '');
    self.set(key, (self.get(key) || 0) + (dt[i] || 0));
  });
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('\nself time, top 25:');
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`  ${(v / tot * 100).toFixed(1).padStart(5)}%  ${k}`));
}
if (errors.length) { console.log('page errors:', errors.join(' | ')); process.exit(1); }

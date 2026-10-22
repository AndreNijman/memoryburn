// Headless checks for MemoryBurn: loads every manifest entry with env "any" into a node vm (no DOM),
// then plays runs with the bot. Usage: node tools/headless.mjs [scenario ...]   (default: all)
// Scenarios: load determinism run chars coop shop snapshot
// Exit code is non-zero if anything fails.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wanted = process.argv.slice(2);
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}

function load() {
  // deliberately no Math.random/Date in the sandbox's view of the sim: poison them to catch leaks
  const poisonMath = Object.create(Math);
  poisonMath.random = () => { throw new Error('Math.random used in sim'); };
  const sandbox = { console, Math: poisonMath, JSON, Date: undefined, performance: undefined };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts.manifest.json'), 'utf8'));
  for (const m of manifest) {
    if (m.env !== 'any') continue;
    vm.runInContext(fs.readFileSync(path.join(ROOT, m.path), 'utf8'), ctx, { filename: m.path });
  }
  return ctx.MB;
}

// Play a run with the bot until game over or `maxWave` is cleared. Returns {state, hashes}.
function play(MB, opts) {
  const s = MB.sim.create(opts);
  const hashes = [];
  let guard = 0;
  while (guard++ < 60 * 60 * 40) {
    if (s.phase === 'play') {
      MB.sim.step(s, s.players.map((_, i) => MB.bot.input(s, i)));
      if (s.tick % 600 === 0) hashes.push(MB.sim.hash(s));
    } else if (s.phase === 'shop') {
      if (s.wave >= (opts.maxWave || 6)) break;
      s.players.forEach((_, i) => MB.bot.shop(s, i).forEach(c => MB.sim.command(s, i, c)));
    } else if (s.phase === 'preview') {
      s.players.forEach((_, i) => MB.sim.command(s, i, { t: 'deploy' }));
    } else break;
  }
  hashes.push(MB.sim.hash(s));
  return { s, hashes };
}

const MB = load();
const run = name => wanted.length === 0 || wanted.includes(name);

if (run('load')) {
  check('load: namespaces', MB.sim && MB.data && MB.bot && MB.rng);
  check('load: 8 archetypes, 42 items, 7 biomes', MB.data.ARCHETYPES.length === 8 && MB.data.ITEM_POOL.length === 42 && MB.data.BIOME_NAMES.length === 7);
}

if (run('determinism')) {
  const a = play(MB, { seed: 1234, maxWave: 4 }), b = play(MB, { seed: 1234, maxWave: 4 }), c = play(MB, { seed: 99, maxWave: 4 });
  check('determinism: same seed, same hashes', JSON.stringify(a.hashes) === JSON.stringify(b.hashes), a.hashes.length + ' checkpoints');
  check('determinism: different seed diverges', JSON.stringify(a.hashes) !== JSON.stringify(c.hashes));
}

if (run('run')) {
  const { s } = play(MB, { seed: 7, maxWave: 6 });
  const p = s.players[0];
  check('run: bot reaches the wave-6 shop or dies trying', s.phase === 'shop' || s.phase === 'gameover', 'phase ' + s.phase + ' wave ' + s.wave + ' kills ' + s.kills);
  check('run: kills happen', s.kills > 50, s.kills + ' kills');
  check('run: items bought', p.items.length > 0, p.items.length + ' items, cash ' + p.cash);
  check('run: finite numbers', [p.x, p.y, p.hp, p.cash].every(Number.isFinite));
}

if (run('chars')) {
  for (let a = 0; a < 8; a++) {
    const s = MB.sim.create({ seed: 50 + a, players: [{ arch: a }] });
    let shots = 0;
    for (let t = 0; t < 60 * 10 && s.phase === 'play'; t++) { MB.sim.step(s, [MB.bot.input(s, 0)]); shots += s.events.filter(e => e.t === 'shoot').length; }
    check('chars: ' + MB.data.ARCHETYPES[a].name + ' fires', shots > 3, shots + ' volleys');
  }
  const js = MB.sim.create({ seed: 1, players: [{ arch: 7 }] });
  check('chars: Junk Saint pickup_add applied', js.players[0].pickup_range === 330);
}

if (run('coop')) {
  const { s } = play(MB, { seed: 77, maxWave: 3, players: [{ arch: 0 }, { arch: 1 }, { arch: 2 }, { arch: 3 }] });
  check('coop: 4-player run advances', s.wave >= 2 || s.phase === 'gameover', 'wave ' + s.wave + ' phase ' + s.phase);
  check('coop: every slot has its own shop', s.players.every(p => p.shop.items.length === 3 || s.phase === 'gameover'));
}

if (run('shop')) {
  const s = MB.sim.create({ seed: 5 });
  s.waveTime = 0; MB.sim.step(s, [{}]);
  check('shop: wave end opens the shop', s.phase === 'shop');
  const p = s.players[0]; p.cash = 1000;
  const before = p.shop.items.slice();
  MB.sim.command(s, 0, { t: 'lock', i: 1 });
  MB.sim.command(s, 0, { t: 'reroll' });
  check('shop: locked slot survives a reroll', p.shop.items[1] === before[1] && p.cash === 995);
  const dmg0 = p.damage, n0 = p.items.length;
  MB.sim.command(s, 0, { t: 'buy', i: 0 });
  check('shop: buying applies the item', p.items.length === n0 + 1);
  MB.sim.command(s, 0, { t: 'ready' });
  check('shop: ready -> preview', s.phase === 'preview');
  MB.sim.command(s, 0, { t: 'deploy' });
  check('shop: deploy -> wave 2', s.phase === 'play' && s.wave === 2 && Math.abs(s.waveTime - (32 + 1.2)) < 1e-9);
  void dmg0;
}

if (run('snapshot')) {
  const s = MB.sim.create({ seed: 31 });
  for (let t = 0; t < 900; t++) MB.sim.step(s, [MB.bot.input(s, 0)]);
  const copy = JSON.parse(JSON.stringify(s));
  for (let t = 0; t < 900; t++) { MB.sim.step(s, [MB.bot.input(s, 0)]); MB.sim.step(copy, [MB.bot.input(copy, 0)]); }
  check('snapshot: JSON round trip continues identically', MB.sim.hash(s) === MB.sim.hash(copy));
}

console.log(failures ? failures + ' failure(s)' : 'all passed');
process.exit(failures ? 1 : 0);

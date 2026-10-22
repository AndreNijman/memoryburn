// Headless checks for MemoryBurn: loads every manifest entry with env "any" into a node vm (no DOM),
// then plays runs with the bot. Usage: node tools/headless.mjs [scenario ...]   (default: all)
// Scenarios: load determinism run chars coop shop story snapshot
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
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts.manifest.json'), 'utf8')).map(m => m.path);
  const tags = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  check('load: index.html script order matches the manifest', JSON.stringify(tags) === JSON.stringify(manifest), tags.length + ' tags');
  check('load: every manifest file exists', manifest.every(p => fs.existsSync(path.join(ROOT, p))));
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

if (run('story')) {
  const D = MB.data, ST = D.STORY;
  const beats = [['intro', ST.intro], ['ending', ST.ending.lead], ...ST.ending.choices.map(c => ['ending:' + c.id, c.beats])];
  const radio = [];
  for (let n = 1; n <= ST.last; n++) {
    const c = ST.contracts[n];
    if (!c) { check('story: contract ' + n + ' exists', false); continue; }
    if (c.scene) beats.push(['scene ' + n, c.scene]);
    radio.push(...c.radio.map(b => ['radio ' + n, b]));
    if (c.boss) radio.push(['boss ' + n, [c.boss.speaker, c.boss.enter]], ['boss ' + n, [c.boss.speaker, c.boss.down]]);
  }
  for (const k in ST.pools) radio.push(...ST.pools[k].map(b => ['pool ' + k, b]));
  ST.gameover.forEach((pool, i) => radio.push(...pool.map(b => ['gameover ' + i, b])));
  const bad = [];
  const speaker = (where, who) => { if (!ST.speakers[who] || !ST.speakers[who].color || !ST.speakers[who].portrait) bad.push(where + ': unknown speaker ' + who); };
  for (const [where, list] of beats) for (const [who, line] of list) {
    speaker(where, who);
    if (line[0] !== '@' && line.length > 240) bad.push(where + ': beat over 240 chars');
  }
  for (const [where, [who, line]] of radio) { speaker(where, who); if (line.length > 120) bad.push(where + ': radio line over 120 chars (' + line.length + ')'); }
  for (let n = 1; n <= ST.last; n++) {
    const c = ST.contracts[n] || {};
    if (!D.BIOMES[c.district]) bad.push('contract ' + n + ': unknown district ' + c.district);
    if (c.note && c.note.length > 200) bad.push('contract ' + n + ': note over 200 chars');
    if (n > 1 && !c.note) bad.push('contract ' + n + ': no briefing note');
    if (!!c.boss !== (n % 5 === 0)) bad.push('contract ' + n + ': boss does not match the overlord waves');
  }
  const archLines = [...ST.arch.intro, ...ST.arch.ending];
  if (ST.arch.intro.length !== 8 || ST.arch.ending.length !== 8) bad.push('arch: need 8 intro and 8 ending lines');
  if (archLines.some(l => l.length > 240)) bad.push('arch: line over 240 chars');
  if (ST.gameover.length !== ST.acts.length) bad.push('gameover: need one pool per act');
  check('story: script data is complete and fits the panels', bad.length === 0, bad.join('; '));
  check('story: arch placeholders resolve', ST.resolve(ST.intro, 3).every(b => b[1][0] !== '@') && ST.resolve(ST.ending.choices[0].beats, 7).every(b => b[1][0] !== '@'));
  check('story: act lookup', ST.actIndex(1) === 0 && ST.actIndex(5) === 0 && ST.actIndex(6) === 1 && ST.actIndex(11) === 2 && ST.actIndex(16) === 3 && ST.actIndex(40) === 3);

  // the sim follows the district schedule through the campaign, then rolls freely
  const s = MB.sim.create({ seed: 77 });
  const seen = [s.biome];
  while (s.wave < ST.last + 3) {
    s.players[0].hp = s.players[0].max_hp; s.waveTime = 0; MB.sim.step(s, [{}]);
    MB.sim.command(s, 0, { t: 'ready' }); MB.sim.command(s, 0, { t: 'deploy' });
    seen.push(s.biome);
  }
  const want = Array.from({ length: ST.last }, (_, i) => ST.contracts[i + 1].district);
  check('story: sim uses the scheduled districts', JSON.stringify(seen.slice(0, ST.last)) === JSON.stringify(want), seen.join(','));
  check('story: afterburn districts are valid', seen.slice(ST.last).every(b => D.BIOMES[b]));
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

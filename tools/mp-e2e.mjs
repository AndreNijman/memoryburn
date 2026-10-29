// End-to-end co-op test against a real relay. By default it starts `wrangler dev --local` itself (127.0.0.1 only).
//   node tools/mp-e2e.mjs                                   local relay from wrangler.jsonc
//   MB_RELAY=wss://relay.example node tools/mp-e2e.mjs      an already running relay (e.g. the deployed one)
// Part 1 drives the relay protocol with raw sockets (create, password, listing, cfg -> listing, full lobby, routing,
// start, late join + snapshot relay, reset, host promotion). Part 2 loads the REAL sim, bot, snapshot codec and
// js/net/net.js into one vm per client and plays a 3-player run through the relay: lobby, ready gate, story gate,
// input forwarding, mirrors, shop commands + acks, dropped runner on autopilot, same-name rejoin, a spectator,
// host migration from the full-state backup, back to lobby, and the version check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { startRelay, stopRelay } from './relay-dev.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function load(name, fallbacks) {
  try { return require(name); } catch (e) { /* try fallbacks */ }
  for (const f of fallbacks) { try { return require(path.resolve(ROOT, f)); } catch (e) { /* next */ } }
  throw new Error('cannot resolve ' + name + ' (npm install, or keep ../tree/node_modules)');
}
const WebSocket = load('ws', ['../tree/node_modules/ws']);
const ORIGIN = 'http://localhost:8765';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(test, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = test(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(15);
  }
}

// ---------------------------------------------------------------- part 1: raw relay protocol
function rawConnect(base, origin, query, first) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(base + '/' + query, { origin });
    const messages = [], waiters = [];
    socket.on('open', () => socket.send(JSON.stringify({ ...first, v: 1 })));
    socket.on('message', raw => {
      const m = JSON.parse(String(raw));
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].test(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }
    });
    socket.on('error', reject);
    socket.on('unexpected-response', (req, res) => reject(new Error('http ' + res.statusCode)));
    const client = {
      socket, messages,
      send(m) { socket.send(JSON.stringify({ ...m, v: 1 })); },
      wait(test, timeout = 5000) {
        const hit = messages.find(test);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
          const w = { test, resolve: res, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error('message timeout; saw ' + messages.map(m => m.t).join(','))); }, timeout) };
          waiters.push(w);
        });
      },
      close() { socket.close(1000, 'test complete'); },
    };
    client.wait(m => m.t === 'welcome' || m.t === 'error').then(m => (m.t === 'welcome' ? resolve(client) : reject(new Error(m.code + ': ' + m.message))), reject);
  });
}
const lobbiesOf = async http => (await (await fetch(http + '/lobbies', { headers: { Origin: ORIGIN } })).json()).lobbies;

async function relayProtocol(base) {
  const http = base.replace(/^ws/, 'http');
  const health = await (await fetch(http + '/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'memoryburn-relay');

  await assert.rejects(rawConnect(base, 'https://evil.example', '?create=1', { t: 'create', player: 'X' }), 'foreign origins are refused');

  const host = await rawConnect(base, ORIGIN, '?create=1', { t: 'create', player: 'Host', lobbyName: 'Burn Night', password: 'acorn', difficulty: 'Hard' });
  const welcome = host.messages.find(m => m.t === 'welcome');
  assert.match(welcome.code, /^[A-Z0-9]{5}$/);
  const code = welcome.code;

  let mine = (await lobbiesOf(http)).find(l => l.code === code);
  assert.ok(mine && mine.locked && mine.max === 4 && mine.difficulty === 'Hard' && mine.phase === 'lobby' && mine.name === 'Burn Night', JSON.stringify(mine));
  host.send({ t: 'cfg', difficulty: 'Insane' });
  await until(async () => true, 'noop'); await sleep(200);
  mine = (await lobbiesOf(http)).find(l => l.code === code);
  assert.equal(mine.difficulty, 'Insane', 'host cfg updates the listing');
  host.send({ t: 'cfg', difficulty: 'Nightmare' });
  await sleep(200);
  assert.equal((await lobbiesOf(http)).find(l => l.code === code).difficulty, 'Normal', 'unknown difficulty is cleaned');

  await assert.rejects(rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'Bad', password: 'wrong' }), /password/i);
  const g1 = await rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'G1', password: 'acorn' });
  const g2 = await rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'G2', password: 'acorn' });
  const g3 = await rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'G3', password: 'acorn' });
  await host.wait(m => m.t === 'lobby' && m.players.length === 4);
  await assert.rejects(rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'G4', password: 'acorn' }), /full/i);
  const g1id = g1.messages.find(m => m.t === 'welcome').you, g2id = g2.messages.find(m => m.t === 'welcome').you;

  // routing: guest frames reach the host only; the host broadcasts or targets
  g1.send({ t: 'hello', name: 'G1' });
  assert.equal((await host.wait(m => m.t === 'hello' && m.from === g1id)).name, 'G1');
  g1.send({ t: 'go' });
  await host.wait(m => m.t === 'go' && m.from === g1id);
  g1.send({ t: 'snap', k: 1 }); // a guest can't forge host frames
  host.send({ t: 'slots', map: { [g1id]: { slot: 1 } } });
  for (const g of [g1, g2, g3]) await g.wait(m => m.t === 'slots');
  host.send({ t: 'pst', to: g2id, p: [] });
  await g2.wait(m => m.t === 'pst');
  await sleep(150);
  assert.equal(g1.messages.some(m => m.t === 'pst'), false, 'a targeted frame must not leak');
  assert.equal(g3.messages.some(m => m.t === 'hello' || m.t === 'go'), false, 'guest frames go to the host only');
  assert.equal(host.messages.some(m => m.t === 'snap'), false, 'guests cannot send snapshots');

  // start: host only
  g1.send({ t: 'start', metadata: { cfg: { seed: 1 } } });
  await sleep(150);
  assert.equal(g2.messages.some(m => m.t === 'start'), false);
  host.send({ t: 'start', metadata: { cfg: { seed: 5, difficulty: 'Hard', players: [] }, slots: {} } });
  assert.equal((await g2.wait(m => m.t === 'start')).metadata.cfg.seed, 5);
  await host.wait(m => m.t === 'start');
  host.send({ t: 'cfg', difficulty: 'Normal', wave: 7 });
  await sleep(250);
  mine = (await lobbiesOf(http)).find(l => l.code === code);
  assert.deepEqual([mine.phase, mine.difficulty, mine.wave], ['running', 'Hard', 7], 'a running lobby lists its contract, difficulty is locked');

  // late join + snapshot relay to one target
  g3.close();
  await host.wait(m => m.t === 'lobby' && m.players.length === 3);
  const late = await rawConnect(base, ORIGIN, '?code=' + code, { t: 'join', player: 'Late', password: 'acorn' });
  const lateId = late.messages.find(m => m.t === 'welcome').you;
  assert.equal(late.messages.find(m => m.t === 'welcome').metadata.cfg.seed, 5, 'late joiners get the start metadata');
  late.send({ t: 'snapshot-request' });
  await host.wait(m => m.t === 'snapshot-request' && m.from === lateId);
  host.send({ t: 'snapshot-begin', id: 's1', total: 2, to: lateId });
  host.send({ t: 'snapshot-chunk', id: 's1', index: 0, data: '{"a":', to: lateId });
  host.send({ t: 'snapshot-chunk', id: 's1', index: 1, data: '1}', to: lateId });
  host.send({ t: 'snapshot-end', id: 's1', to: lateId });
  await late.wait(m => m.t === 'snapshot-end');
  assert.equal(late.messages.filter(m => m.t === 'snapshot-chunk').map(m => m.data).join(''), '{"a":1}');
  assert.equal(g1.messages.some(m => m.t === 'snapshot-begin'), false);

  // reset: host only, back to the lobby phase, start allowed again
  g1.send({ t: 'reset' });
  await sleep(150);
  assert.equal(g2.messages.some(m => m.t === 'reset'), false, 'guests cannot reset');
  host.send({ t: 'reset' });
  await g2.wait(m => m.t === 'reset');
  await sleep(250);
  assert.equal((await lobbiesOf(http)).find(l => l.code === code).phase, 'lobby');
  host.send({ t: 'start', metadata: { cfg: { seed: 6 } } });
  assert.equal((await g2.wait(m => m.t === 'start' && m.metadata.cfg.seed === 6)).metadata.cfg.seed, 6, 'start works again after reset');

  // host promotion goes to the oldest remaining player
  host.close();
  assert.equal((await g1.wait(m => m.t === 'host')).host, g1id);
  g1.close(); g2.close(); late.close();
  await sleep(200);
  console.log('part 1: relay protocol OK');
}

// ---------------------------------------------------------------- part 2: the real game code, one vm per client
const ANY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts.manifest.json'), 'utf8')).filter(m => m.env === 'any').map(m => m.path);
const STEP = 1 / 60;

function makeClient(label, relayBase, version = '0.2.0') {
  const sandbox = {
    WebSocket: class extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } },
    fetch: (u, o) => fetch(u, Object.assign({ headers: { Origin: ORIGIN } }, o)),
    console, setTimeout, clearTimeout, URLSearchParams, Uint32Array, Promise, JSON, Math, Object, Array, Error, String, Number,
    location: { search: '?relay=' + relayBase }, crypto: webcrypto,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of [...ANY, 'js/net/net.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    if (f === 'js/core/mb.js') {
      // the browser-only pieces net.js touches
      ctx.MB.app = { version, settings: { gameSpeed: 100, dmgTaken: 100 } };
      ctx.MB.render = { snapshot: s => ({ tick: s.tick }) };
    }
  }
  const MB = ctx.MB, net = MB.net;
  const c = { label, MB, net, sim: null, starts: [], closed: [], resets: 0, frames: 0, events: [], toasts: [], acked: [], input: { mx: 0, my: 0, aimX: 960, aimY: 540 }, story: true, timer: null };
  net.bind({
    getSim: () => c.sim,
    setSim: s => { c.sim = s; },
    command: (slot, cmd) => {
      const ok = MB.sim.command(c.sim, slot, cmd);
      net.hostEvents(c.sim.events); net.hostChanged();
      return ok;
    },
  });
  net.on('start', info => {
    c.starts.push(info);
    if (!info.migrated) c.sim = info.role === 'host' ? MB.sim.create(info.meta) : MB.snap.newMirror(info.meta);
    if (!c.story) net.storyDone();
  });
  net.on('frame', f => { c.frames++; for (const e of f.events) c.events.push(e); });
  net.on('closed', r => c.closed.push(r));
  net.on('reset', () => { c.resets++; c.sim = null; });
  net.on('toast', m => c.toasts.push(m));
  let last = Date.now(), acc = 0;
  c.timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = c.sim;
    if (s && !s.remote && net.inRun()) {
      acc += dt;
      while (acc >= STEP && s.phase === 'play' && net.holding() === 0) {
        const inputs = s.players.map((p, i) => (i === net.localSlot() ? c.input : net.inputFor(s, i)));
        MB.sim.step(s, inputs);
        net.hostEvents(s.events);
        acc -= STEP;
      }
      if (acc > STEP * 8) acc = 0;
      net.autopilot(s);
    }
    if (s && s.remote && !net.isSpectator()) net.sendInput(c.input);
    net.tick(dt);
  }, 16);
  c.stop = () => clearInterval(c.timer);
  return c;
}

const lobbyPlayer = (c, name) => c.net.lobby && c.net.lobby.players.find(p => p.name === name);

async function coop(base) {
  const H = makeClient('host', base), G1 = makeClient('g1', base), G2 = makeClient('g2', base);
  const all = [H, G1, G2];
  try {
    assert.equal(H.net.role(), 'offline');
    const { code } = await H.net.host({ name: 'Hosty', lobbyName: 'Test burn', difficulty: 'Hard', arch: 3 });
    assert.match(code, /^[A-Z0-9]{5}$/);
    assert.equal(H.net.role(), 'host');
    assert.equal(H.net.state, 'lobby');
    assert.ok((await H.net.listLobbies()).some(l => l.code === code && l.difficulty === 'Hard' && l.max === 4), 'listed');

    await G1.net.join({ code, name: 'Gee One' });
    await G2.net.join({ code, name: 'Gee Two' });
    await assert.rejects(G2.net.join({ code: 'AB', name: 'x' }), /five/);
    assert.equal(G1.net.role(), 'guest');
    await until(() => H.net.lobby.players.length === 3 && H.net.lobby.players.every(p => p.slot >= 0) && G2.net.lobby.players.every(p => p.slot >= 0), 'full lobby');
    assert.equal(JSON.stringify(H.net.lobby.players.map(p => p.slot)), '[0,1,2]');
    assert.equal(H.net.lobby.players[0].arch, 3, 'host pick from the host() call');
    await until(() => G1.net.lobby.cfg.difficulty === 'Hard', 'guest got cfg');

    // pick + ready gate + cfg un-readies
    assert.equal(G1.net.setPick(5), true);
    await until(() => lobbyPlayer(H, 'Gee One').arch === 5, 'pick synced');
    assert.equal(H.net.canStart().ok, false);
    assert.equal(H.net.start(), false, 'cannot start before everyone is ready');
    G1.net.setReady(true); G2.net.setReady(true);
    await until(() => H.net.canStart().ok, 'all ready');
    assert.equal(H.net.setCfg({ difficulty: 'Insane' }), true);
    assert.equal(G1.net.setCfg({ difficulty: 'Normal' }), false, 'guests cannot change cfg');
    await until(() => G1.net.lobby.cfg.difficulty === 'Insane' && !H.net.canStart().ok, 'cfg change reaches guests and un-readies them');
    G1.net.setReady(true); G2.net.setReady(true);
    await until(() => H.net.canStart().ok, 'ready again');
    assert.equal(G1.net.start(), false, 'guests cannot start');
    assert.equal(H.net.start(), true);
    await until(() => all.every(c => c.starts.length === 1), 'start everywhere');
    const meta = H.starts[0].meta;
    assert.equal(meta.players.length, 3);
    assert.equal(meta.difficulty, 'Insane');
    assert.equal(meta.players[1].arch, 5);
    assert.deepEqual([H.starts[0].localSlot, G1.starts[0].localSlot, G2.starts[0].localSlot], [0, 1, 2]);
    assert.equal(G1.sim.remote, true);
    assert.equal(H.sim.remote, undefined);
    assert.equal(G1.sim.players[1].arch, 5, 'mirror built from the start metadata');

    // story gate: the host holds the sim until every runner has finished the opening story
    await sleep(400);
    assert.equal(H.sim.tick, 0, 'held while the crew reads the intro');
    assert.equal(H.net.holding(), 3);
    H.net.storyDone(); G1.net.storyDone();
    await until(() => H.net.holding() === 1, 'two of three done');
    await until(() => G2.net.holding() === 1, 'guests see the hold count');
    G2.net.storyDone();
    await until(() => H.sim.tick > 30, 'host steps once everyone is in');

    // input forwarding, mirrors and events
    const x0 = H.sim.players[1].x;
    G1.input = { mx: 1, my: 0, aimX: 1900, aimY: 540, dash: false };
    await sleep(900);
    assert.ok(H.sim.players[1].x > x0 + 60, 'the host moves the guest runner from forwarded input: ' + x0 + ' -> ' + H.sim.players[1].x);
    G1.input = { mx: 0, my: 0, aimX: 1900, aimY: 540 };
    await sleep(300);
    assert.ok(Math.abs(G2.sim.players[1].x - H.sim.players[1].x) < 40, 'the other guest sees it: ' + G2.sim.players[1].x + ' vs ' + H.sim.players[1].x);
    assert.ok(Math.abs(G2.sim.tick - H.sim.tick) < 30, 'mirror tick is close behind the host: ' + G2.sim.tick + ' vs ' + H.sim.tick);
    assert.equal(G2.sim.wave, 1);
    assert.ok(G2.frames > 10, 'snapshots arrive (' + G2.frames + ')');
    await until(() => G2.events.some(e => e.t === 'shoot'), 'sim events reach guests');

    // a dash tap shorter than a host step still dashes once
    const dashes = () => H.sim.players[2].dash_cd > 0;
    G2.input = { mx: 1, my: 0, aimX: 960, aimY: 540, dash: true };
    await sleep(40);
    G2.input = { mx: 0, my: 0, aimX: 960, aimY: 540, dash: false };
    await until(dashes, 'guest dash reaches the host');

    // commands: only shop commands from guests, acked
    const sent = G1.net._state.cmdSeq;
    assert.equal(G1.net.sendCmd({ t: 'debugCash' }), true);
    await sleep(300);
    assert.equal(G1.net._state.cmdSeq, sent + 1);
    assert.ok(H.sim.players[1].cash < 100, 'debugCash from a guest is refused');

    // end the contract on the host -> shop everywhere
    H.sim.waveTime = 0;
    await until(() => H.sim.phase === 'shop' && G1.sim.phase === 'shop' && G2.sim.phase === 'shop', 'shop phase mirrored');
    H.sim.players[1].cash += 500; H.net.hostChanged();
    await until(() => G1.sim.players[1].cash >= 500 && G1.sim.players[1].shop && G1.sim.players[1].shop.items.length === 3, 'player sheet mirrored');
    const items0 = G1.sim.players[1].items.length, cash0 = G1.sim.players[1].cash;
    const buyIdx = G1.sim.players[1].shop.items.findIndex(i => i != null);
    G1.net.sendCmd({ t: 'buy', i: buyIdx });
    await until(() => G1.sim.players[1].items.length === items0 + 1 && G1.sim.players[1].cash < cash0, 'buy applied on the host and mirrored');
    assert.equal(G1.sim.players[1].shop.items[buyIdx], null, 'bought card leaves its slot empty');
    G1.net.sendCmd({ t: 'lock', i: 7 });
    G1.net.sendCmd({ t: 'reroll' });
    await until(() => H.sim.players[1].cash === G1.sim.players[1].cash && G1.sim.players[1].cash < cash0 - 4, 'reroll mirrored');
    await until(() => G1.events.some(e => e.t === 'buy' && e.slot === 1), 'buy event reaches the guest');
    // everyone readies -> preview -> deploy -> contract 2
    MB_ready(H, 0); G1.net.sendCmd({ t: 'ready' }); G2.net.sendCmd({ t: 'ready' });
    await until(() => H.sim.phase === 'preview' && G2.sim.phase === 'preview', 'preview mirrored');
    MB_cmd(H, 0, { t: 'deploy' }); G1.net.sendCmd({ t: 'deploy' }); G2.net.sendCmd({ t: 'deploy' });
    await until(() => H.sim.phase === 'play' && H.sim.wave === 2 && G1.sim.wave === 2 && G1.sim.phase === 'play', 'contract 2 on every client');

    // a guest's socket dies mid-run: it reconnects by itself and gets its runner back
    const g1tick = G1.sim.tick;
    G1.net._state.ws.terminate(); // the connection just dies (no close handshake)
    await until(() => H.net.botSlot(1), 'host notices the dead socket');
    await until(() => G1.net.role() === 'guest' && G1.net.localSlot() === 1 && !G1.net.isSpectator() && !H.net.botSlot(1), 'auto-reconnect rebinds slot 1', 15000)
      .catch(e => { throw new Error(e.message + ' ' + JSON.stringify({ role: G1.net.role(), state: G1.net.state, slot: G1.net.localSlot(), spec: G1.net.isSpectator(), bot: H.net.botSlot(1), orphans: H.net._state.orphans, toasts: G1.toasts })); });
    await until(() => G1.sim.tick > g1tick + 60, 'reconnected guest keeps receiving snapshots');
    assert.equal(G1.starts.length, 1, 'a reconnect is not a new run');
    assert.equal(G1.closed.length, 0);

    // the guest stops hearing anything but the relay still holds its old socket (sleeping laptop, switched network):
    // the silence watchdog rejoins, and the host hands the runner from the stale entry to the new connection
    const stale = G1.net._state.ws, staleId = G1.net._state.id;
    stale.onmessage = null; stale.close = () => {}; // keep the old socket open on the relay
    G1.net._state.heardAt = -1e9;
    await until(() => G1.net._state.ws && G1.net._state.ws !== stale && G1.net._state.id && G1.net._state.id !== staleId && G1.net.state === 'running', 'watchdog rejoins', 15000);
    await until(() => H.net._state.slots[G1.net._state.id] && H.net._state.slots[G1.net._state.id].slot === 1, 'stale entry handed over', 8000)
      .catch(e => { throw new Error(e.message + ' ' + JSON.stringify({ slots: H.net._state.slots, orphans: H.net._state.orphans })); });
    assert.ok(!H.net._state.slots[staleId] && !H.net.botSlot(1), 'stale entry gone and no autopilot');
    const g1tick2 = G1.sim.tick;
    stale.terminate();
    await until(() => G1.sim.tick > g1tick2 + 40, 'guest keeps receiving snapshots after the stale socket closes');
    assert.ok(!H.net.botSlot(1) && !Object.keys(H.net._state.orphans).length, 'the stale socket closing orphans nothing');
    assert.equal(G1.starts.length, 1);

    // a guest drops: the autopilot plays their runner, and shops + readies for them
    G2.net.leave();
    await until(() => H.net.botSlot(2), 'slot 2 on autopilot');
    await until(() => H.toasts.some(t => /dropped/.test(t)), 'drop toast');
    const bx = H.sim.players[2].x;
    await sleep(800);
    assert.notEqual(H.sim.players[2].x, bx, 'the autopilot moves the dropped runner');
    H.sim.waveTime = 0;
    await until(() => H.sim.phase === 'shop', 'shop');
    await until(() => H.sim.players[2].ready, 'autopilot readies the dropped runner');

    // same name, same browser: the runner comes back
    await G2.net.join({ code, name: 'Gee Two' });
    await until(() => G2.net.localSlot() === 2 && !G2.net.isSpectator() && G2.starts.length === 2 && G2.starts[1].late, 'rejoin takes the slot back');
    await until(() => !H.net.botSlot(2), 'host stops the autopilot');
    await until(() => G2.sim && G2.sim.phase === 'shop' && G2.sim.players[2].shop, 'rejoined guest gets the world and the sheet');

    // a stranger joining mid-run watches
    const G3 = makeClient('g3', base); all.push(G3);
    await G3.net.join({ code, name: 'Stranger' });
    await until(() => G3.net.isSpectator() && G3.sim && G3.sim.wave === 2, 'spectator sees the run');
    assert.equal(G3.sim.players.length, 3);

    // host migration: the oldest guest restores the latest full backup and carries on
    MB_cmd(H, 0, { t: 'ready' }); G1.net.sendCmd({ t: 'ready' });
    await until(() => H.sim.phase === 'preview', 'preview');
    MB_cmd(H, 0, { t: 'deploy' }); G1.net.sendCmd({ t: 'deploy' }); G2.net.sendCmd({ t: 'deploy' });
    await until(() => H.sim.phase === 'play' && H.sim.wave === 3, 'contract 3');
    const asked = G1.net._state.clock;
    H.net._state.fullT = 99; // send the backup now instead of in 5 s
    await until(() => G1.net._state.backup && G1.net._state.backup.at > asked, 'G1 holds a fresh backup');
    const hostTick = H.sim.tick;
    H.net.leave();
    await until(() => G1.net.role() === 'host', 'G1 promoted');
    assert.equal(G1.sim.remote, undefined, 'the promoted host runs a real sim');
    assert.ok(G1.sim.tick >= hostTick - 60 && G1.sim.wave === 3, 'restored from a fresh backup: tick ' + G1.sim.tick + ' vs ' + hostTick + ', wave ' + G1.sim.wave);
    assert.equal(G1.net.localSlot(), 1);
    assert.ok(G1.starts.some(s => s.migrated), 'start(migrated) fired');
    assert.ok(G1.net.botSlot(0), 'the old host\'s runner is on autopilot');
    const t1 = G1.sim.tick;
    await until(() => G1.sim.tick > t1 + 30, 'new host steps');
    await until(() => G2.sim.tick > t1 + 10 && G2.net.role() === 'guest', 'G2 follows the new host');
    const x2 = G1.sim.players[2].x;
    G2.input = { mx: -1, my: 0, aimX: 0, aimY: 540 };
    await sleep(600);
    assert.ok(G1.sim.players[2].x < x2 - 30, 'new host gets forwarded input: ' + x2 + ' -> ' + G1.sim.players[2].x);
    G2.input = { mx: 0, my: 0, aimX: 0, aimY: 540 };
    assert.equal(G2.closed.length, 0);

    // back to the lobby
    G1.net.reset();
    await until(() => G1.net.state === 'lobby' && G2.net.state === 'lobby' && G2.resets === 1 && G1.resets === 1, 'reset everywhere');
    await until(() => G1.net.lobby.players.every(p => p.slot >= 0), 'the spectator gets a seat back');
    assert.equal(G1.net.canStart().ok, false, 'guests must ready again');

    // a different build is turned away
    const OLD = makeClient('old', base, '0.1.0'); all.push(OLD);
    await OLD.net.join({ code, name: 'Oldie' });
    await until(() => OLD.closed.includes('version'), 'version mismatch kicked');
    console.log('part 2: co-op session OK (real sim + net.js + snapshot.js)');
  } finally {
    all.forEach(c => { c.stop(); try { c.net.leave(); } catch (e) { /* ignore */ } });
  }
}
// host-side commands in the harness go through the same hook main.js uses
function MB_cmd(c, slot, cmd) { const ok = c.MB.sim.command(c.sim, slot, cmd); c.net.hostEvents(c.sim.events); c.net.hostChanged(); return ok; }
function MB_ready(c, slot) { return MB_cmd(c, slot, { t: 'ready' }); }

// ---------------------------------------------------------------- main
try {
  const base = await startRelay();
  console.log('relay at', base);
  await relayProtocol(base);
  await coop(base);
  console.log('mp e2e passed');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  stopRelay();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}

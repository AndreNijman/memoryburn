/*
 * MemoryBurn - js/net/net.js   (env: browser)
 *
 * Online co-op for 1-4 players, the broIsAPotato model: a Cloudflare relay (worker/relay.js) forwards frames between
 * a host, who runs the only sim, and guests, who send input and shop commands and draw a mirror of the host's state
 * (codec in js/net/snapshot.js). The protocol is broIsAPotato's (create/join handshake, hello/pick/ready/in/cmd from
 * guests, slots/cfg/snap/pst/ack/kick from the host, chunked full-state backups for host migration).
 *
 *   MB.net.state  'idle' | 'connecting' | 'lobby' | 'running' | 'closed'      MB.net.lobby (rebuilt on every change)
 *   role() 'offline'|'host'|'guest'   localSlot()   isSpectator()   relayUrl()   rtt (ms)
 *   listLobbies() -> Promise<[summary]>   host({name, password, lobbyName, difficulty, arch}) -> Promise<{code}>
 *   join({code, password, name}) -> Promise<{code}>   leave()   kick(id)
 *   setPick(arch)  setReady(bool)  setCfg({difficulty})  canStart() -> {ok, reason}  start()  reset() (host: back to lobby)
 *   storyDone()                        this client finished the opening story (the host holds the run until everyone has)
 *   tick(dt)                           every frame
 *   host: inputFor(state, slot)  hostEvents(events)  holding() -> players the host still waits for
 *   guest: sendInput(input)  sendCmd(cmd)  view() -> {prev, alpha}
 *   bind({getSim, setSim, command(slot, cmd) -> ok})   main.js wires the app in
 *   on(name, fn) -> unsubscribe        names: lobby start closed error reset frame toast
 *
 * Rules worth knowing:
 *   - start payload {meta, localSlot, role, spectator, migrated}; meta = {seed, difficulty, players:[{arch, name}], settings}.
 *   - A guest who drops mid-run leaves their character to MB.bot (moves, shops, readies) until they rejoin with the
 *     same name from the same browser. Someone joining a running game who has no slot to take back spectates.
 *   - Host leaves mid-run: the oldest guest restores the newest full backup (sent every 5 s) and carries on as host.
 *   - The host's socket drops: the host keeps playing offline, with the bot taking the other slots.
 */
(function () {
  'use strict';
  var D = MB.data;
  var DEFAULT_RELAY = 'wss://relay.memoryburn.andrenijman.com'; // same worker as memoryburn-relay.tung-tung-tung-sahur.workers.dev
  var PROTO = 1, MAX_PLAYERS = 4, SNAP_HZ = 20, IDLE_SNAP_HZ = 5, INPUT_HZ = 30, FULL_EVERY = 5, INTERP_DELAY = 0.1;
  var GUEST_CMDS = { buy: 1, lock: 1, reroll: 1, ready: 1, deploy: 1 };
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H;

  var S = {
    ws: null, id: 0, hostId: 0, code: '', role: 'offline', state: 'idle', clock: 0, leaving: false,
    name: 'Runner', password: '', opts: null, pending: null, roster: [], slots: {}, peers: {}, orphans: {}, orphanTok: {},
    cfg: { difficulty: 'Normal' }, lobbyName: '', hostArch: 0,
    localSlot: 0, spectator: false, meta: null, backup: null, snapParts: null, cmdSeq: 0, rtt: 0, pingT: 0,
    // host
    evOut: [], snapT: 0, forceSnap: false, sheetT: 0, sheetKey: {}, sheetAt: {}, forceSheet: false, fullT: 0, go: {}, gateOpen: false,
    gateT: 0, waveSent: -1, epoch: 0,
    // guest
    frames: [], cur: null, curStart: 0, off: null, lastSnapAt: 0, reqAt: -99, prevPos: null, alpha: 1, sendIn: { key: '', at: -9, seq: 0 },
    hostEpoch: 0, hold: 0,
    reconnect: { timer: null, tries: 0 },
    on: { lobby: [], start: [], closed: [], error: [], reset: [], frame: [], toast: [] }
  };
  var hooks = { getSim: function () { return null; }, setSim: function () { }, command: function () { return false; } };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function setState(s) { S.state = s; net.state = s; }
  function fire(list, a) {
    var arr = S.on[list].slice();
    for (var i = 0; i < arr.length; i++) { try { arr[i](a); } catch (e) { if (window.console) console.error('net listener', e); } }
  }
  function cleanName(v, fb) {
    var n = String(v == null ? '' : v).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16);
    return n || fb || 'Runner';
  }
  function toast(msg) { fire('toast', msg); }
  function randSeed() {
    try { var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] >>> 0; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
  }
  function ver() { return (MB.app ? MB.app.version : '') + '/' + MB.dataHash(); }

  /* ------------------------------------------------------------------ transport */
  function relayUrl() {
    var u = null;
    try {
      var q = new URLSearchParams(location.search).get('relay');
      if (q && /^wss?:\/\//.test(q)) u = q;
    } catch (e) { u = null; }
    return String(u || DEFAULT_RELAY).replace(/\/+$/, '');
  }
  function httpRelay() { return relayUrl().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'); }

  function send(msg) {
    if (!S.ws || S.ws.readyState !== 1) return false;
    msg.v = PROTO;
    try { S.ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }
  function sendTo(id, msg) { msg.to = id; return send(msg); }

  function fail(msg, fatal) {
    if (S.pending) { var p = S.pending; S.pending = null; p.reject(new Error(msg)); }
    fire('error', { message: msg, fatal: !!fatal });
  }
  function clearReconnect() { if (S.reconnect.timer) { clearTimeout(S.reconnect.timer); S.reconnect.timer = null; } }

  function resetSession() {
    clearReconnect();
    var ws = S.ws;
    S.ws = null;
    if (ws) { try { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(1000, 'bye'); } catch (e) { /* closed */ } }
    S.id = 0; S.hostId = 0; S.code = ''; S.role = 'offline'; S.roster = []; S.slots = {}; S.peers = {}; S.orphans = {}; S.orphanTok = {};
    S.localSlot = 0; S.spectator = false; S.meta = null; S.backup = null; S.snapParts = null; S.pending = null;
    resetRunNet();
    S.opts = null; S.reconnect.tries = 0;
    net.lobby = null;
  }
  function resetRunNet() {
    S.evOut = []; S.snapT = 0; S.forceSnap = true; S.sheetT = 0; S.sheetKey = {}; S.sheetAt = {}; S.forceSheet = true; S.fullT = 0;
    S.go = {}; S.gateOpen = false; S.gateT = 0; S.waveSent = -1; S.fullPhase = '';
    S.frames = []; S.cur = null; S.off = null; S.prevPos = null; S.alpha = 1; S.hold = 0; S.lastSnapAt = S.clock;
  }

  function connect(create, o, reconnecting) {
    return new Promise(function (resolve, reject) {
      if (!reconnecting) {
        resetSession();
        S.name = cleanName(o.name); S.password = String(o.password || '').slice(0, 64);
        S.opts = { create: create, code: String(o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '') };
        if (create) {
          S.cfg = { difficulty: D.DIFFICULTIES.indexOf(o.difficulty) >= 0 ? o.difficulty : 'Normal' };
          S.lobbyName = cleanName(o.lobbyName, S.name + "'s crew").slice(0, 28);
          S.hostArch = clamp(o.arch | 0, 0, D.ARCHETYPES.length - 1);
        }
      }
      S.rejoining = !!reconnecting; // a reconnect keeps the run: state stays 'running'
      if (!reconnecting) setState('connecting');
      var base = relayUrl(), ws;
      var url = create ? base + '/?create=1' : base + '/?code=' + encodeURIComponent(S.opts.code);
      try { ws = new WebSocket(url); } catch (e) { setState('idle'); reject(e); return; }
      S.ws = ws; S.pending = { resolve: resolve, reject: reject };
      S.heardAt = S.clock;
      ws.onopen = function () {
        send({ t: create ? 'create' : 'join', player: S.name, password: S.password, lobbyName: S.lobbyName, difficulty: S.cfg.difficulty, world: S.cfg.difficulty });
      };
      ws.onmessage = function (ev) {
        if (ws !== S.ws) return;
        S.heardAt = S.clock;
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && typeof m === 'object') { try { onMessage(m); } catch (err) { if (window.console) console.error('net handler ' + m.t, err); } }
      };
      ws.onerror = function () { /* onclose follows */ };
      ws.onclose = function (ev) { if (ws === S.ws) onClose(ev); };
    });
  }

  function onClose(ev) {
    S.ws = null;
    var reason = (ev && ev.reason) || 'Connection lost';
    if (S.leaving) return;
    if (S.pending) {
      var p = S.pending; S.pending = null;
      if (!S.rejoining) { setState('idle'); S.role = 'offline'; }
      p.reject(new Error(reason));
      return;
    }
    if (S.state === 'running' && S.role === 'guest' && S.opts) { scheduleReconnect(); return; }
    if (S.state === 'running' && S.role === 'host') {
      S.role = 'offline'; S.id = 0;
      setState('closed');
      toast('Lost the relay. Carrying on offline; the autopilot takes the other runners.');
      fire('closed', 'connection-lost-host');
      return;
    }
    finishClosed(reason);
  }

  function scheduleReconnect() {
    if (S.reconnect.timer) return;
    if (S.reconnect.tries >= 5) { toast('Could not reconnect.'); finishClosed('connection-lost'); return; }
    var delay = Math.min(5000, 1000 * Math.pow(2, S.reconnect.tries++));
    toast('Connection lost. Rejoining…');
    S.reconnect.timer = setTimeout(function () {
      S.reconnect.timer = null;
      connect(false, { code: S.code || (S.opts && S.opts.code), name: S.name, password: S.password }, true).then(function () {
        S.reconnect.tries = 0; toast('Reconnected.');
      }, function () { scheduleReconnect(); });
    }, delay);
  }

  function finishClosed(reason) {
    resetSession();
    setState('closed');
    fire('closed', reason);
  }

  /* ------------------------------------------------------------------ lobby model */
  function isHost() { return S.id !== 0 && S.id === S.hostId; }

  function rebuildLobby() {
    var list = [];
    S.roster.forEach(function (r) {
      var sl = S.slots[r.id] || {};
      list.push({ id: r.id, name: sl.name || r.name, host: r.id === S.hostId, slot: sl.slot != null ? sl.slot : -1,
        arch: sl.arch | 0, ready: r.id === S.hostId ? true : !!sl.ready, you: r.id === S.id });
    });
    list.sort(function (a, b) { return (a.slot < 0 ? 99 : a.slot) - (b.slot < 0 ? 99 : b.slot); });
    net.lobby = { code: S.code, you: S.id, host: S.hostId, name: S.lobbyName || '', max: MAX_PLAYERS, players: list,
      phase: S.state === 'running' ? 'running' : 'lobby', cfg: { difficulty: S.cfg.difficulty } };
    fire('lobby', net.lobby);
  }

  function slotsMsg() {
    var map = {}, id, s;
    for (id in S.slots) { s = S.slots[id]; map[id] = { slot: s.slot, arch: s.arch, name: s.name, ready: s.ready ? 1 : 0 }; }
    return { t: 'slots', map: map };
  }
  function broadcastSlots() { send(slotsMsg()); rebuildLobby(); }
  function cfgMsg() { return { t: 'cfg', difficulty: S.cfg.difficulty }; }

  function firstFreeSlot() {
    var used = {}, id;
    for (id in S.slots) if (S.slots[id].slot >= 0) used[S.slots[id].slot] = 1;
    for (var i = 0; i < MAX_PLAYERS; i++) if (!used[i]) return i;
    return -1;
  }

  /* ------------------------------------------------------------------ dispatch */
  var RELAY_ONLY = { error: 1, welcome: 1, lobby: 1, host: 1, pong: 1, 'snapshot-needed': 1, 'snapshot-begin': 1, 'snapshot-chunk': 1, 'snapshot-end': 1 };
  function onMessage(m) {
    // control frames come from the relay and never carry `from`; anything from a peer does. Drop forgeries.
    if (RELAY_ONLY[m.t] && m.from !== undefined) return;
    if ((m.t === 'start' || m.t === 'reset') && m.from !== S.hostId) return;
    switch (m.t) {
      case 'error': fail(String(m.message || m.code || 'relay error'), !!m.fatal); return;
      case 'welcome': onWelcome(m); return;
      case 'lobby': onRoster(m); return;
      case 'host': onHostChange(+m.host); return;
      case 'start': beginRun(m.metadata || {}, false); return;
      case 'reset': backToLobby(); return;
      case 'pong': if (typeof m.c === 'number') { S.rtt = Math.round((S.clock - m.c) * 1000); net.rtt = S.rtt; } return;
      case 'snapshot-request': if (isHost()) onSnapRequest(+m.from); return;
      case 'snapshot-needed': return;
      case 'snapshot-begin': S.snapParts = { id: m.id, total: m.total | 0, parts: [] }; return;
      case 'snapshot-chunk': if (S.snapParts && S.snapParts.id === m.id) S.snapParts.parts[m.index | 0] = String(m.data || ''); return;
      case 'snapshot-end': onFullDone(m); return;
    }
    if (isHost()) { hostGame(m); return; }
    if (m.from !== S.hostId) return;
    guestGame(m);
  }

  var clientTok = '';
  function clientToken() {
    if (!clientTok) {
      try { clientTok = window.sessionStorage.getItem('memoryburn.coop.tok') || ''; } catch (e) { clientTok = ''; }
      if (!clientTok) {
        for (var i = 0; i < 16; i++) clientTok += Math.floor(Math.random() * 36).toString(36);
        try { window.sessionStorage.setItem('memoryburn.coop.tok', clientTok); } catch (e) { /* private mode */ }
      }
    }
    return clientTok;
  }

  function onWelcome(m) {
    S.id = +m.you; S.hostId = +m.host || S.id; S.code = m.code || S.code;
    if (S.opts) S.opts.code = S.code;
    S.role = isHost() ? 'host' : 'guest';
    var reconnecting = S.rejoining && S.state === 'running';
    S.rejoining = false;
    if (isHost() && S.opts && S.opts.create) {
      S.slots = {}; S.peers = {};
      S.slots[S.id] = { slot: 0, arch: S.hostArch, name: S.name, ready: true, ver: ver() };
      S.localSlot = 0;
    }
    if (!reconnecting) setState('lobby');
    if (!isHost()) send({ t: 'hello', tok: clientToken(), name: S.name, ver: ver() });
    if (m.phase === 'running' && !isHost() && !reconnecting && m.metadata && m.metadata.cfg) beginRun(m.metadata, true);
    if (S.pending) { var p = S.pending; S.pending = null; p.resolve({ code: S.code }); }
    rebuildLobby();
  }

  function onRoster(m) {
    S.roster = (m.players || []).map(function (p) { return { id: +p.id, name: String(p.name || ''), host: !!p.host }; });
    S.hostId = +m.host || S.hostId;
    if (m.name) S.lobbyName = String(m.name);
    if (isHost()) {
      var present = {}, id;
      S.roster.forEach(function (r) { present[r.id] = true; });
      for (id in S.slots) if (!present[id] && +id !== S.id) removePeer(+id);
    }
    rebuildLobby();
  }

  /* ------------------------------------------------------------------ host: messages from guests */
  function hostGame(m) {
    var from = +m.from;
    if (!from) return;
    switch (m.t) {
      case 'hello': onHello(from, m); return;
      case 'pick': onPick(from, m); return;
      case 'ready': onReady(from, m); return;
      case 'in': onInput(from, m); return;
      case 'cmd': onCmd(from, m); return;
      case 'go': { var s = S.slots[from]; if (s && s.slot >= 0) S.go[s.slot] = true; return; }
    }
  }

  function newPeer(id) { return { id: id, lastIn: S.clock, tokens: 30, inp: null, dashPend: false, zeroed: false }; }

  function onHello(from, m) {
    if (String(m.ver) !== ver()) { sendTo(from, { t: 'kick', reason: 'version' }); return; }
    var name = cleanName(m.name, 'Guest'), key = name.toLowerCase(), slot = -1, sim = hooks.getSim();
    if (S.state === 'running') {
      var otok = S.orphanTok[key] || '';
      // rebind a dropped runner's slot only for the same browser; after a host migration nobody knows tokens, so name wins
      if (S.orphans[key] !== undefined && (!otok || otok === String(m.tok || ''))) { slot = S.orphans[key]; delete S.orphans[key]; delete S.orphanTok[key]; }
      // the same tab back before the relay noticed its old socket died: take the runner over from the stale entry
      for (var old in S.slots) {
        var os = S.slots[old];
        if (slot < 0 && +old !== from && os.slot >= 0 && os.tok && os.tok === String(m.tok || '') && String(os.name).toLowerCase() === key) {
          slot = os.slot; delete S.slots[old]; delete S.peers[old];
        }
      }
    } else slot = firstFreeSlot();
    if (S.state !== 'running' && slot < 0) { sendTo(from, { t: 'kick', reason: 'full' }); return; }
    var arch = 0;
    if (S.state === 'running' && slot >= 0 && sim) { var p = MB.snap.playerBySlot(sim, slot); arch = p ? p.arch : 0; S.go[slot] = true; }
    S.slots[from] = { slot: slot, arch: arch, name: name, ready: S.state === 'running', ver: m.ver, tok: String(m.tok || '').slice(0, 32) };
    S.peers[from] = newPeer(from);
    sendTo(from, cfgMsg());
    broadcastSlots();
    if (S.state === 'running') {
      if (slot >= 0) toast(name + ' is back in the run.'); else toast(name + ' is watching.');
      S.forceSheet = true; S.sheetKey = {}; S.forceSnap = true;
    } else toast(name + ' joined the crew.');
  }

  function onPick(from, m) {
    var s = S.slots[from];
    if (!s || S.state !== 'lobby') return;
    var a = m.arch | 0;
    if (a >= 0 && a < D.ARCHETYPES.length) { s.arch = a; s.ready = false; }
    broadcastSlots();
  }
  function onReady(from, m) {
    var s = S.slots[from];
    if (!s || S.state !== 'lobby') return;
    s.ready = !!m.r;
    broadcastSlots();
  }

  function onInput(from, m) {
    var s = S.slots[from], peer = S.peers[from];
    if (!s || !peer || S.state !== 'running' || s.slot < 0) return;
    var b = m.b | 0;
    peer.inp = {
      mx: clamp((m.mx | 0) / 100, -1, 1), my: clamp((m.my | 0) / 100, -1, 1),
      aimX: clamp(+m.ax || 0, -400, W + 400), aimY: clamp(+m.ay || 0, -400, H + 400),
      dash: !!(b & 1), fire: !!(b & 2), manual: !!(b & 4)
    };
    if (b & 1) peer.dashPend = true;
    peer.lastIn = S.clock; peer.zeroed = false;
  }

  function onCmd(from, m) {
    var s = S.slots[from], peer = S.peers[from], id = m.id | 0, c = m.cmd;
    var ack = function (ok, err) { sendTo(from, { t: 'ack', id: id, ok: ok, err: err }); };
    if (!s || !peer || S.state !== 'running' || s.slot < 0) { ack(false, 'not in the run'); return; }
    if (peer.tokens < 1) { ack(false, 'slow down'); return; }
    peer.tokens -= 1;
    if (!c || typeof c !== 'object' || !GUEST_CMDS[c.t]) { ack(false, 'bad command'); return; }
    var cmd = { t: c.t };
    if (c.i !== undefined) { var i = +c.i; if (!(i === 0 || i === 1 || i === 2)) { ack(false, 'bad slot'); return; } cmd.i = i; }
    var ok = false;
    try { ok = !!hooks.command(s.slot, cmd); } catch (e) { ok = false; }
    ack(ok, ok ? undefined : 'rejected');
  }

  function onSnapRequest(from) {
    var peer = S.peers[from];
    if (!from || !S.slots[from] || !peer) return;
    if (peer.reqAt && S.clock - peer.reqAt < 3) return;
    peer.reqAt = S.clock;
    S.forceSheet = true; S.sheetKey = {}; S.forceSnap = true;
  }

  function removePeer(id) {
    var s = S.slots[id];
    delete S.slots[id]; delete S.peers[id];
    if (!s) return;
    if (S.state === 'running') {
      if (s.slot >= 0) {
        var key = String(s.name).toLowerCase();
        S.orphans[key] = s.slot; S.orphanTok[key] = s.tok || '';
        toast(s.name + ' dropped. The autopilot has their runner until they rejoin.');
      }
      broadcastSlots();
    } else broadcastSlots();
  }

  /* ------------------------------------------------------------------ run start / reset */
  function startMeta() {
    var order = [], id;
    for (id in S.slots) if (S.slots[id].slot >= 0) order.push(+id);
    order.sort(function (a, b) { return S.slots[a].slot - S.slots[b].slot; });
    // compact the slots to 0..n-1 so the sim's players array has no holes
    var players = [], slots = {};
    order.forEach(function (rid, i) { var s = S.slots[rid]; s.slot = i; players.push({ arch: s.arch | 0, name: s.name }); slots[rid] = i; });
    var app = MB.app, st = app ? app.settings : { gameSpeed: 100, dmgTaken: 100 };
    return {
      cfg: { seed: randSeed(), difficulty: S.cfg.difficulty, players: players, settings: { gameSpeed: st.gameSpeed / 100, dmgTaken: st.dmgTaken / 100 } },
      slots: slots, ver: ver()
    };
  }

  function guestsReady() {
    var id, n = 0;
    for (id in S.slots) {
      if (+id === S.hostId) continue;
      if (S.slots[id].slot >= 0) { n++; if (!S.slots[id].ready) return { ok: false, reason: S.slots[id].name + ' is not ready' }; }
    }
    return { ok: true, n: n };
  }

  function beginRun(meta, late) {
    if (!meta || !meta.cfg || !meta.cfg.players) return;
    var slot = meta.slots ? meta.slots[S.id] : undefined;
    S.meta = meta;
    if (meta.slots) for (var rid in meta.slots) if (S.slots[rid]) S.slots[rid].slot = meta.slots[rid];
    S.localSlot = slot !== undefined && slot >= 0 ? slot : 0;
    S.spectator = slot === undefined || slot < 0;
    if (late && S.slots[S.id] && S.slots[S.id].slot >= 0) { S.localSlot = S.slots[S.id].slot; S.spectator = false; }
    resetRunNet();
    setState('running');
    S.epoch = S.hostId;
    if (isHost()) for (var k in S.peers) S.peers[k].lastIn = S.clock;
    rebuildLobby();
    fire('start', { meta: meta.cfg, localSlot: S.localSlot, role: S.role, spectator: S.spectator, late: !!late });
  }

  function backToLobby() {
    if (S.state !== 'running' && S.state !== 'closed') return;
    resetRunNet();
    S.meta = null; S.backup = null; S.orphans = {}; S.orphanTok = {}; S.spectator = false;
    var id;
    for (id in S.slots) { if (+id !== S.hostId) S.slots[id].ready = false; }
    if (isHost()) { // spectators get the free seats back
      for (id in S.slots) if (S.slots[id].slot < 0) S.slots[id].slot = firstFreeSlot();
      for (id in S.slots) if (S.slots[id].slot < 0) { sendTo(+id, { t: 'kick', reason: 'full' }); }
    }
    setState('lobby');
    if (isHost()) broadcastSlots(); else rebuildLobby();
    fire('reset', null);
  }

  /* ------------------------------------------------------------------ guest: messages from the host */
  function guestGame(m) {
    switch (m.t) {
      case 'slots': onSlots(m); return;
      case 'cfg': if (D.DIFFICULTIES.indexOf(m.difficulty) >= 0) S.cfg.difficulty = m.difficulty; rebuildLobby(); return;
      case 'kick': S.leaving = true; finishClosed(m.reason === 'version' ? 'version' : (m.reason || 'kicked')); S.leaving = false; return;
      case 'ack': if (!m.ok && m.err && m.err !== 'rejected') toast(String(m.err)); return;
      case 'snap': onSnap(m); return;
      case 'pst': onSheet(m); return;
    }
  }

  function onSlots(m) {
    var map = m.map || {}, id, o, ns = {};
    for (id in map) {
      o = map[id];
      ns[id] = { slot: o.slot == null ? -1 : o.slot | 0, arch: o.arch | 0, name: cleanName(o.name, 'Guest'), ready: !!o.ready };
    }
    S.slots = ns;
    var me = ns[S.id];
    if (me && S.state === 'running') {
      if (me.slot >= 0) { S.localSlot = me.slot; S.spectator = false; } else { S.spectator = true; S.localSlot = 0; }
    }
    rebuildLobby();
  }

  function onSheet(m) {
    var sim = hooks.getSim();
    if (!sim || !sim.remote || !Array.isArray(m.p)) return;
    for (var i = 0; i < m.p.length; i++) if (m.p[i]) MB.snap.applySheet(sim, m.p[i].slot, m.p[i]);
  }

  function onSnap(m) {
    var sim = hooks.getSim();
    if (!sim || !sim.remote || S.state !== 'running') return;
    if (m.ep !== S.hostEpoch) { S.hostEpoch = m.ep; S.frames = []; S.cur = null; S.off = null; } // a new host: its ticks start over
    var f = MB.snap.decode(m);
    f.time = f.k / 60; f.hold = m.hd | 0;
    var sample = f.time - S.clock;
    if (S.off === null || Math.abs(sample - S.off) > 0.6) S.off = sample; else S.off += (sample - S.off) * 0.08;
    if (S.frames.length && f.k <= S.frames[S.frames.length - 1].k) return; // late or duplicate
    S.frames.push(f);
    S.lastSnapAt = S.clock;
  }

  // Move the mirror along the buffered frames, INTERP_DELAY behind the host. The mirror always holds the frame we
  // are moving towards and prevPos the one we came from, which is what MB.render.world's (prev, alpha) expects.
  function advanceFrames() {
    var sim = hooks.getSim();
    if (!sim || !sim.remote) return;
    var latest = S.frames.length ? S.frames[S.frames.length - 1] : S.cur;
    if (!latest) return;
    var calm = latest.run.ph !== 0; // shop, briefing, game over: nothing moves, so show the newest frame at once
    var rt = calm ? Infinity : S.clock + S.off - INTERP_DELAY;
    var applied = 0;
    while (S.frames.length && (!S.cur || rt >= S.cur.time)) {
      var f = S.frames.shift();
      S.curStart = S.cur ? S.cur.time : f.time;
      S.prevPos = MB.render.snapshot(sim);
      MB.snap.applyFrame(sim, f);
      S.cur = f; S.hold = f.hold;
      fire('frame', f);
      if (++applied > 30) break;
    }
    if (!S.cur) return;
    var span = S.cur.time - S.curStart;
    S.alpha = calm || span <= 0 ? 1 : clamp((rt - S.curStart) / span, 0, 1);
  }

  /* ------------------------------------------------------------------ host -> guests */
  function sendFull(to) {
    var sim = hooks.getSim();
    if (!isHost() || !sim || S.state !== 'running') return;
    var raw;
    try { raw = JSON.stringify(sim); } catch (e) { return; }
    var parts = MB.snap.chunk(raw, 48000), id = 'f' + sim.tick + '-' + Math.floor(S.clock * 1000);
    var begin = { t: 'snapshot-begin', id: id, total: parts.length };
    if (to) begin.to = to;
    send(begin);
    for (var i = 0; i < parts.length; i++) { var c = { t: 'snapshot-chunk', id: id, index: i, data: parts[i] }; if (to) c.to = to; send(c); }
    var end = { t: 'snapshot-end', id: id };
    if (to) end.to = to;
    send(end);
  }

  function onFullDone(m) {
    var sp = S.snapParts;
    S.snapParts = null;
    if (!sp || sp.id !== m.id || isHost()) return;
    for (var i = 0; i < sp.total; i++) if (typeof sp.parts[i] !== 'string') return;
    S.backup = { raw: MB.snap.join(sp.parts), at: S.clock };
  }

  function guestIds() {
    var out = [], id;
    for (id in S.slots) if (+id !== S.id) out.push(+id);
    return out;
  }
  function nextHostId() {
    for (var i = 0; i < S.roster.length; i++) if (S.roster[i].id !== S.id && S.slots[S.roster[i].id]) return S.roster[i].id;
    return 0;
  }
  function slotOwner(slot) {
    for (var id in S.slots) if (S.slots[id].slot === slot) return +id;
    return 0;
  }

  // Slots the host's own local player doesn't drive and no connected guest drives: the autopilot plays them.
  function botSlot(slot) {
    if (slot === S.localSlot && (isHost() || S.role === 'offline')) return false;
    if (S.role !== 'host') return true;
    var owner = slotOwner(slot);
    return !owner || !S.peers[owner];
  }

  function hostTick(dt) {
    var sim = hooks.getSim();
    if (!sim || sim.remote || S.state !== 'running') return;
    var ids = guestIds(), i, peer;
    for (i = 0; i < ids.length; i++) {
      peer = S.peers[ids[i]];
      if (!peer) continue;
      peer.tokens = Math.min(30, peer.tokens + dt * 12);
      if (!peer.zeroed && S.clock - peer.lastIn > 1.0 && peer.inp) { peer.zeroed = true; peer.inp = { mx: 0, my: 0, aimX: peer.inp.aimX, aimY: peer.inp.aimY, dash: false, fire: false, manual: peer.inp.manual }; }
    }
    // the story gate at the start of a run
    if (!S.gateOpen) { S.gateT += dt; if (holding() === 0 || S.gateT > 120) S.gateOpen = true; }
    if (sim.wave !== S.waveSent) { S.waveSent = sim.wave; send({ t: 'cfg', difficulty: S.cfg.difficulty, wave: sim.wave }); }
    if (!ids.length) { S.evOut.length = 0; return; }
    S.snapT += dt;
    var step = 1 / (sim.phase === 'play' ? SNAP_HZ : IDLE_SNAP_HZ);
    if (S.snapT >= step || S.forceSnap) {
      S.snapT = Math.min(Math.max(0, S.snapT - step), step); S.forceSnap = false;
      var m = MB.snap.encode(sim, S.evOut);
      S.evOut = [];
      m.ep = S.epoch; m.hd = S.gateOpen ? 0 : holding();
      send(m);
    }
    S.sheetT += dt;
    if (S.sheetT >= 0.25 || S.forceSheet) {
      var gap = S.sheetT; S.sheetT = 0;
      var out = [];
      sim.players.forEach(function (pl) {
        var sh = MB.snap.sheet(pl), key = JSON.stringify(sh);
        S.sheetAt[pl.slot] = (S.sheetAt[pl.slot] || 0) + gap;
        if (S.forceSheet || key !== S.sheetKey[pl.slot] || S.sheetAt[pl.slot] >= 3) { S.sheetKey[pl.slot] = key; S.sheetAt[pl.slot] = 0; out.push(sh); }
      });
      S.forceSheet = false;
      if (out.length) send({ t: 'pst', p: out });
    }
    S.fullT += dt;
    if (sim.phase !== S.fullPhase) { S.fullPhase = sim.phase; S.fullT = FULL_EVERY; } // so a migration never rolls back across a phase
    if (S.fullT >= FULL_EVERY) { S.fullT = 0; var nh = nextHostId(); if (nh) sendFull(nh); }
  }

  function guestTick(dt) {
    advanceFrames();
    // the host sends at least 5 snapshots a second during a run; silence this long means the socket is dead even
    // if the browser hasn't noticed (sleeping laptop, switched network), so drop it and rejoin
    if (S.state === 'running' && S.ws && S.ws.readyState === 1 && S.clock - S.heardAt > 8) {
      var dead = S.ws;
      try { dead.onclose = null; dead.onmessage = null; dead.close(4000, 'silent'); } catch (e) { /* gone */ }
      if (S.ws === dead) onClose({ reason: 'silent' });
      return;
    }
    if (S.state === 'running' && S.clock - S.lastSnapAt > 4 && S.clock - S.reqAt > 4) { S.reqAt = S.clock; send({ t: 'snapshot-request' }); }
    void dt;
  }

  /* ------------------------------------------------------------------ host migration */
  function onHostChange(newHost) {
    var oldHost = S.hostId;
    S.hostId = newHost;
    S.role = isHost() ? 'host' : 'guest';
    if (!isHost()) { S.snapParts = null; rebuildLobby(); return; }
    var id;
    if (S.state === 'running') {
      var backup = S.backup;
      if (!backup || S.clock - backup.at > 20) { S.role = 'guest'; finishClosed('host-left'); return; }
      var sim;
      try { sim = JSON.parse(backup.raw); } catch (e) { S.role = 'guest'; finishClosed('host-left'); return; }
      var gone = S.slots[oldHost];
      delete S.slots[oldHost];
      if (gone && gone.slot >= 0) { var key = String(gone.name).toLowerCase(); S.orphans[key] = gone.slot; S.orphanTok[key] = ''; }
      S.peers = {};
      for (id in S.slots) if (+id !== S.id) S.peers[id] = newPeer(+id);
      S.localSlot = S.slots[S.id] && S.slots[S.id].slot >= 0 ? S.slots[S.id].slot : 0;
      S.spectator = !(S.slots[S.id] && S.slots[S.id].slot >= 0);
      resetRunNet();
      S.gateOpen = true; S.epoch = S.id;
      hooks.setSim(sim);
      broadcastSlots();
      send(cfgMsg());
      toast('The host left. You are hosting now.');
      fire('start', { meta: S.meta ? S.meta.cfg : null, localSlot: S.localSlot, role: 'host', spectator: S.spectator, migrated: true });
      return;
    }
    delete S.slots[oldHost];
    S.peers = {};
    for (id in S.slots) if (+id !== S.id) S.peers[id] = newPeer(+id);
    if (S.slots[S.id]) { S.slots[S.id].ready = true; S.localSlot = S.slots[S.id].slot; }
    broadcastSlots();
    send(cfgMsg());
  }

  /* ------------------------------------------------------------------ public API */
  function holding() {
    if (S.role !== 'host') return S.hold;
    if (S.gateOpen || S.state !== 'running') return 0;
    var sim = hooks.getSim(), n = 0;
    if (!sim) return 0;
    for (var slot = 0; slot < sim.players.length; slot++) if (!S.go[slot] && !botSlot(slot)) n++;
    return n;
  }

  var net = {
    state: 'idle', lobby: null, rtt: 0, MAX_PLAYERS: MAX_PLAYERS,
    role: function () { return S.role; },
    relayUrl: relayUrl,
    isSpectator: function () { return S.spectator; },
    localSlot: function () { return S.localSlot | 0; },
    inRun: function () { return S.state === 'running' && (S.role === 'host' || S.role === 'guest'); },
    holding: holding,
    nameOf: function (slot) {
      for (var id in S.slots) if (S.slots[id].slot === slot) return S.slots[id].name;
      var m = S.meta && S.meta.cfg && S.meta.cfg.players[slot];
      return m ? m.name : 'P' + (slot + 1);
    },
    bind: function (h) { for (var k in h) hooks[k] = h[k]; },
    on: function (name, fn) {
      S.on[name].push(fn);
      return function () { var i = S.on[name].indexOf(fn); if (i >= 0) S.on[name].splice(i, 1); };
    },

    listLobbies: function () {
      return fetch(httpRelay() + '/lobbies', { cache: 'no-store', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('The lobby list is unavailable.');
        return r.json();
      }).then(function (b) { return Array.isArray(b.lobbies) ? b.lobbies : []; });
    },
    host: function (o) { return connect(true, o || {}, false); },
    join: function (o) {
      o = o || {};
      var code = String(o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 5) return Promise.reject(new Error('Lobby codes have five characters.'));
      return connect(false, { code: code, name: o.name, password: o.password }, false);
    },
    leave: function () {
      S.leaving = true;
      if (S.ws && S.ws.readyState === 1) send({ t: 'leave' });
      resetSession();
      setState('idle');
      S.leaving = false;
    },
    kick: function (id) { if (isHost() && S.slots[id] && +id !== S.id) send({ t: 'kick', to: +id, reason: 'kicked' }); },

    setPick: function (arch) {
      arch = clamp(arch | 0, 0, D.ARCHETYPES.length - 1);
      var s = S.slots[S.id];
      if (!s || S.state !== 'lobby') { S.hostArch = arch; return false; }
      s.arch = arch;
      if (isHost()) broadcastSlots(); else { s.ready = false; send({ t: 'pick', arch: arch }); rebuildLobby(); }
      return true;
    },
    setReady: function (r) {
      var s = S.slots[S.id];
      if (!s || S.state !== 'lobby' || isHost()) return;
      s.ready = !!r; send({ t: 'ready', r: !!r }); rebuildLobby();
    },
    setCfg: function (c) {
      if (!isHost() || S.state !== 'lobby' || !c || D.DIFFICULTIES.indexOf(c.difficulty) < 0) return false;
      S.cfg.difficulty = c.difficulty;
      for (var id in S.slots) if (+id !== S.id) S.slots[id].ready = false;
      send(cfgMsg());
      broadcastSlots();
      return true;
    },
    canStart: function () {
      if (!isHost() || S.state !== 'lobby') return { ok: false, reason: 'Only the host starts the run.' };
      return guestsReady();
    },
    start: function () {
      var can = net.canStart();
      if (!can.ok) { fire('error', { message: can.reason, fatal: false }); return false; }
      var meta = startMeta();
      broadcastSlots();
      return send({ t: 'start', metadata: meta });
    },
    reset: function () { if (isHost() && S.state === 'running') send({ t: 'reset' }); },
    storyDone: function () {
      if (S.state !== 'running' || S.spectator) return;
      if (isHost()) S.go[S.localSlot] = true; else send({ t: 'go' });
    },

    // host
    inputFor: function (sim, slot) {
      if (botSlot(slot)) return MB.bot.input(sim, slot);
      var peer = S.peers[slotOwner(slot)];
      if (!peer || !peer.inp) return {};
      var inp = peer.inp, out = { mx: inp.mx, my: inp.my, aimX: inp.aimX, aimY: inp.aimY, fire: inp.fire, manual: inp.manual, dash: inp.dash || peer.dashPend };
      peer.dashPend = false; // a tap shorter than one host step still dashes exactly once
      return out;
    },
    hostEvents: function (evs) {
      if (S.role !== 'host' || S.state !== 'running') return;
      for (var i = 0; i < evs.length; i++) S.evOut.push(MB.snap.trimEvent(evs[i]));
      if (S.evOut.length > 400) S.evOut.splice(0, S.evOut.length - 400);
    },
    hostChanged: function () { S.forceSheet = true; S.forceSnap = true; },
    botSlot: botSlot,
    // The autopilot shops and readies for runners nobody drives (dropped guests, or everyone else once a host
    // lost the relay). main.js calls this every frame on the machine that owns the sim.
    autopilot: function (sim) {
      if (!sim || sim.remote || (sim.phase !== 'shop' && sim.phase !== 'preview')) return;
      for (var slot = 0; slot < sim.players.length; slot++) {
        if (!botSlot(slot) || sim.players[slot].ready) continue;
        if (sim.phase === 'shop') MB.bot.shop(sim, slot).forEach(function (c) { hooks.command(slot, c); });
        else hooks.command(slot, { t: 'deploy' });
      }
    },

    // guest
    sendInput: function (f) {
      if (S.role !== 'guest' || S.state !== 'running' || S.spectator || !f) return;
      var mx = Math.round(clamp(+f.mx || 0, -1, 1) * 100), my = Math.round(clamp(+f.my || 0, -1, 1) * 100);
      var ax = Math.round(+f.aimX || 0), ay = Math.round(+f.aimY || 0);
      var b = (f.dash ? 1 : 0) | (f.fire ? 2 : 0) | (f.manual ? 4 : 0);
      var key = mx + ',' + my + ',' + ax + ',' + ay + ',' + b, si = S.sendIn, age = S.clock - si.at;
      var dashEdge = (b & 1) && !(si.b & 1);
      if (!dashEdge && (key === si.key ? age < 0.25 : age < 1 / INPUT_HZ)) return;
      si.key = key; si.at = S.clock; si.b = b; si.seq++;
      send({ t: 'in', s: si.seq, mx: mx, my: my, ax: ax, ay: ay, b: b });
    },
    sendCmd: function (cmd) {
      if (S.role !== 'guest' || !S.ws || S.ws.readyState !== 1) return false;
      send({ t: 'cmd', id: ++S.cmdSeq, cmd: cmd });
      return true;
    },
    view: function () { return { prev: S.prevPos, alpha: S.alpha }; },

    tick: function (dt) {
      dt = clamp(+dt || 0, 0, 0.25);
      S.clock += dt;
      if (S.ws && S.ws.readyState === 1) {
        S.pingT -= dt;
        if (S.pingT <= 0) { S.pingT = 2.5; send({ t: 'ping', c: S.clock }); }
      }
      if (S.role === 'host') hostTick(dt);
      else if (S.role === 'guest') guestTick(dt);
    },
    // test hooks
    _state: S
  };

  MB.net = net;
})();

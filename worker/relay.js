// Memory Burn relay. Cloudflare Worker + Durable Objects `Room` (one per lobby code) and `Registry` (public lobby
// list). Copied from the broIsAPotato relay, which is derived from the tree relay (relay.tree.andrenijman.com).
// Host-authoritative: the first player is the host, guest messages are forwarded to the host only, host messages are
// broadcast or targeted with `to:<id>`.
// HTTP: GET /health, GET /lobbies, DELETE /admin/lobbies/:code (Bearer MB_ADMIN_TOKEN; room DO checks X-Mb-Admin).
// WebSocket: /?create=1 or /?code=ABCDE; first frame {t:'create'|'join', v:1, player, password, lobbyName, difficulty}.
// Differences vs broIsAPotato: the lobby summary carries `difficulty` and `wave` instead of biome/exp/heat/endless,
// Memory Burn origins, and a host `reset` frame that puts a running room back in the lobby (after a game over).
const PROTOCOL_VERSION = 1;
const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_CHUNKS = 256;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 900;
const PASSWORD_ATTEMPT_WINDOW_MS = 60_000;
const PASSWORD_ATTEMPT_MAX = 6;
const REGISTRY_STALE_MS = 60 * 60 * 1000;
const RESERVATION_MS = 20_000;
const HANDSHAKE_MS = 10_000;
const MAX_JUNK_FRAMES = 5;
const SNAPSHOT_REQUEST_GAP_MS = 3000;
// Frames only the relay may originate (host may additionally send start/kick/snapshot-*); guests are allow-listed.
const HOST_BLOCKED = new Set(['welcome', 'lobby', 'host', 'error', 'pong', 'snapshot-needed']);
const GUEST_ALLOWED = new Set(['hello', 'pick', 'ready', 'in', 'cmd', 'chat', 'snapshot-request', 'go', 'ping']);
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const DIFFICULTIES = ['Normal', 'Hard', 'Insane'];
// Allowed browser origins for websocket upgrades + CORS (plus localhost and file:// pages, whose origin is 'null').
const PRODUCTION_ORIGINS = [
  'https://memoryburn.andrenijman.com',
  'https://games.andrenijman.com',
];

const encoder = new TextEncoder();
const lobbyKey = code => `lobby:${code}`;
const reservationKey = code => `reservation:${code}`;

export function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sanitizeText(value, max = 32, fallback = '') {
  const clean = String(value || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, max);
  return clean || fallback;
}

export function originAllowed(origin) {
  if (PRODUCTION_ORIGINS.includes(origin) || origin === 'null') return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function randomInt(max) {
  const limit = 0x100000000 - (0x100000000 % max);
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % max;
}

export function makeCode() {
  let code = '';
  for (let index = 0; index < 5; index++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function normalizePassword(value) {
  return String(value || '').slice(0, 128);
}

export async function hashPassword(value) {
  const password = normalizePassword(value);
  if (!password) return null;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  return [...new Uint8Array(digest)];
}

export function constantTimeEqual(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= expected[index] ^ actual[index];
  return mismatch === 0;
}

async function passwordMatches(expected, supplied) {
  if (!expected) return true;
  const actual = await hashPassword(normalizePassword(supplied));
  return constantTimeEqual(expected, actual);
}

export function cleanDifficulty(value) {
  return DIFFICULTIES.includes(value) ? value : 'Normal';
}

export function cleanWave(value) {
  const wave = Math.floor(Number(value));
  return Number.isFinite(wave) ? Math.min(9999, Math.max(0, wave)) : 0;
}

export function cleanSummary(raw) {
  const code = normalizeCode(raw?.code);
  const players = Number(raw?.players);
  if (code.length !== 5 || !Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) return null;
  return {
    code,
    name: sanitizeText(raw.name, 40, 'Memory Burn crew'),
    world: sanitizeText(raw.world, 40, 'Unknown world'),
    players,
    max: MAX_PLAYERS,
    locked: Boolean(raw.locked),
    phase: raw.phase === 'running' ? 'running' : 'lobby',
    difficulty: cleanDifficulty(raw.difficulty),
    wave: cleanWave(raw.wave),
  };
}

function corsHeaders(request) {
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  if (originAllowed(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export class Registry {
  constructor(state) {
    this.state = state;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const operation = this.queue.then(() => this.handleRequest(request));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/lobbies') return this.list();
    if (request.method === 'POST' && url.pathname === '/allocate') return this.allocate();
    if (request.method === 'POST' && url.pathname === '/lobby') return this.upsert(request);
    if (request.method === 'DELETE' && url.pathname === '/lobby') return this.remove(request);
    return new Response('not found', { status: 404 });
  }

  async list() {
    const now = Date.now();
    const entries = await this.state.storage.list({ prefix: 'lobby:' });
    const lobbies = [];
    const expired = [];
    for (const [key, entry] of entries) {
      const summary = cleanSummary(entry?.summary);
      if (!summary || !Number.isFinite(entry.updatedAt) || now - entry.updatedAt > REGISTRY_STALE_MS) {
        expired.push(key);
      } else {
        lobbies.push({ summary, updatedAt: entry.updatedAt });
      }
    }
    await Promise.all(expired.map(key => this.state.storage.delete(key)));
    lobbies.sort((left, right) => right.updatedAt - left.updatedAt);
    return Response.json({ lobbies: lobbies.map(entry => entry.summary) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  async allocate() {
    const now = Date.now();
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = makeCode();
      const [lobby, reservation] = await Promise.all([
        this.state.storage.get(lobbyKey(code)),
        this.state.storage.get(reservationKey(code)),
      ]);
      const lobbyActive = lobby && now - lobby.updatedAt <= REGISTRY_STALE_MS;
      const reserved = reservation && reservation.expiresAt > now;
      if (lobbyActive || reserved) continue;
      await this.state.storage.put(reservationKey(code), { expiresAt: now + RESERVATION_MS });
      return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: 'could not allocate a lobby code' }, { status: 503 });
  }

  async upsert(request) {
    let body;
    try { body = await request.json(); } catch { return new Response('invalid update', { status: 400 }); }
    const summary = cleanSummary(body?.summary);
    if (!summary) return new Response('invalid lobby summary', { status: 400 });
    if (body.confirm) {
      const reservation = await this.state.storage.get(reservationKey(summary.code));
      if (!reservation || reservation.expiresAt <= Date.now()) {
        return new Response('lobby reservation expired', { status: 409 });
      }
      await this.state.storage.delete(reservationKey(summary.code));
    }
    await this.state.storage.put(lobbyKey(summary.code), { summary, updatedAt: Date.now() });
    return new Response(null, { status: 204 });
  }

  async remove(request) {
    let body;
    try { body = await request.json(); } catch { return new Response('invalid removal', { status: 400 }); }
    const code = normalizeCode(body?.code);
    if (code.length !== 5) return new Response('invalid room code', { status: 400 });
    await Promise.all([
      this.state.storage.delete(lobbyKey(code)),
      this.state.storage.delete(reservationKey(code)),
    ]);
    return new Response(null, { status: 204 });
  }
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.players = new Map();
    this.passwordAttempts = new Map();
    this.snapshot = null;
    this.initializationQueue = Promise.resolve();
    this.messageRates = new Map();
    this.junk = new Map();
    this.snapGate = new Map();
    this.banned = new Set();
    this.ready = state.blockConcurrencyWhile(async () => {
      const [room, storedAttempts] = await Promise.all([
        state.storage.get('room'),
        state.storage.get('passwordAttempts'),
      ]);
      this.room = room || null;
      this.passwordAttempts = new Map(Object.entries(storedAttempts || {}));
      for (const socket of state.getWebSockets()) {
        const session = socket.deserializeAttachment();
        if (session?.initialized && Number.isInteger(session.id)) {
          this.players.set(session.id, { ...session, socket });
        }
      }
      if (this.room && this.players.size) await this.repairHost();
    });
  }

  async fetch(request) {
    await this.ready;
    if (request.method === 'DELETE' && request.headers.get('X-Mb-Admin') === this.env.MB_ADMIN_TOKEN) {
      await this.destroy();
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('websocket upgrade required', { status: 426 });
    }
    const action = request.headers.get('X-Mb-Room-Action');
    const code = normalizeCode(request.headers.get('X-Mb-Room-Code'));
    if (!['create', 'join'].includes(action) || code.length !== 5) {
      return new Response('invalid room route', { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const session = {
      initialized: false,
      action,
      code,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      connectedAt: Date.now(),
    };
    server.serializeAttachment(session);
    this.state.acceptWebSocket(server);
    try { if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + HANDSHAKE_MS + 500); } catch { /* alarms optional */ }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, data) {
    await this.ready;
    const session = socket.deserializeAttachment() || {};
    if (typeof data !== 'string' || encoder.encode(data).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(typeof data === 'string' ? 1009 : 1003, 'invalid message');
      return;
    }
    let message;
    try { message = JSON.parse(data); } catch { message = null; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      if (!session.initialized) {
        const key = socket;
        const n = (this.junk.get(key) || 0) + 1;
        this.junk.set(key, n);
        if (n >= MAX_JUNK_FRAMES) socket.close(1008, 'invalid frames');
      }
      return;
    }
    if (!session.initialized) {
      const initialization = this.initializationQueue.then(() => this.initialize(socket, session, message));
      this.initializationQueue = initialization.catch(() => {});
      await initialization;
      return;
    }
    if (!this.allowMessage(socket, session)) return;
    if (message.v !== undefined && message.v !== PROTOCOL_VERSION) {
      this.send(socket, { t: 'error', code: 'version', message: 'protocol version mismatch' });
      return;
    }
    if (message.t === 'ping') {
      this.send(socket, { t: 'pong', c: message.c });
      return;
    }
    await this.handleMessage(session.id, message);
  }

  async alarm() {
    await this.ready;
    const now = Date.now();
    let pending = false;
    for (const socket of this.state.getWebSockets()) {
      const session = socket.deserializeAttachment();
      if (session?.initialized) continue;
      if (now - (session?.connectedAt || 0) >= HANDSHAKE_MS) { try { socket.close(1008, 'handshake timeout'); } catch { /* gone */ } }
      else pending = true;
    }
    if (pending) { try { await this.state.storage.setAlarm(now + HANDSHAKE_MS); } catch { /* ignore */ } }
  }

  async webSocketClose(socket) {
    await this.disconnect(socket);
  }

  async webSocketError(socket) {
    await this.disconnect(socket);
  }

  allowMessage(socket, session) {
    const now = Date.now();
    const rateTimes = (this.messageRates.get(session.id) || []).filter(time => now - time < RATE_WINDOW_MS);
    if (rateTimes.length >= RATE_MAX) {
      socket.close(1008, 'message rate exceeded');
      return false;
    }
    rateTimes.push(now);
    this.messageRates.set(session.id, rateTimes);
    return true;
  }

  async initialize(socket, session, message) {
    if (message.v !== PROTOCOL_VERSION || message.t !== session.action) {
      this.fatal(socket, 'handshake', `expected ${session.action} with protocol version ${PROTOCOL_VERSION}`);
      return;
    }
    if (session.action === 'create') {
      if (this.room || this.players.size) {
        this.fatal(socket, 'collision', 'lobby already exists');
        return;
      }
      this.room = {
        code: session.code,
        name: sanitizeText(message.lobbyName || message.lobby?.name || message.lobby, 40, 'Memory Burn crew'),
        world: sanitizeText(message.world || message.lobby?.world, 40, 'Unknown world'),
        passwordHash: await hashPassword(message.password),
        difficulty: cleanDifficulty(message.difficulty),
        wave: 0,
        phase: 'lobby',
        hostId: 1,
        nextPlayerId: 2,
        metadata: null,
      };
    } else {
      if (!this.room || this.room.code !== session.code || !this.players.size) {
        this.fatal(socket, 'missing', 'no lobby with that code');
        return;
      }
      if (this.banned.has(session.ip) && session.ip !== 'unknown') {
        this.fatal(socket, 'banned', 'you were removed from this lobby');
        return;
      }
      if (this.players.size >= MAX_PLAYERS) {
        this.fatal(socket, 'full', `lobby is full (${MAX_PLAYERS})`);
        return;
      }
      const now = Date.now();
      const attempts = (this.passwordAttempts.get(session.ip) || [])
        .filter(time => now - time < PASSWORD_ATTEMPT_WINDOW_MS);
      if (this.room.passwordHash && attempts.length >= PASSWORD_ATTEMPT_MAX) {
        this.passwordAttempts.set(session.ip, attempts);
        this.fatal(socket, 'rate', 'too many password attempts; wait a minute');
        return;
      }
      if (!await passwordMatches(this.room.passwordHash, message.password)) {
        attempts.push(now);
        this.passwordAttempts.set(session.ip, attempts);
        await this.persistPasswordAttempts();
        this.fatal(socket, 'password', 'wrong lobby password');
        return;
      }
      this.passwordAttempts.delete(session.ip);
      await this.persistPasswordAttempts();
    }

    const id = session.action === 'create' ? 1 : this.room.nextPlayerId++;
    Object.assign(session, {
      initialized: true,
      id,
      name: sanitizeText(message.player || message.playerName || message.name, 24, `Player ${id}`),
      connectedAt: Date.now(),
    });
    socket.serializeAttachment(session);
    this.players.set(id, { ...session, socket });
    await this.state.storage.put('room', this.room);
    try {
      await this.syncRegistry(session.action === 'create');
    } catch {
      this.players.delete(id);
      if (session.action === 'create') {
        this.room = null;
        await this.state.storage.delete('room');
      }
      this.fatal(socket, 'reservation', 'lobby code expired; create another lobby');
      return;
    }
    this.send(socket, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: id,
      code: this.room.code,
      host: this.room.hostId,
      phase: this.room.phase,
      metadata: this.room.metadata,
    });
    this.broadcastLobby();
    if (this.room.phase === 'running' && id !== this.room.hostId) {
      this.send(socket, { t: 'snapshot-needed' });
      this.toHost({ t: 'snapshot-request', from: id });
    }
  }

  async handleMessage(id, message) {
    const player = this.players.get(id);
    if (!player || typeof message.t !== 'string' || message.t.length < 1 || message.t.length > 64) return;
    const isHost = id === this.room.hostId;
    if (message.t === 'leave') {
      player.socket.close(1000, 'left lobby');
      return;
    }
    if (message.t === 'kick') {
      const target = Number(message.to);
      const victim = Number.isInteger(target) && target !== id ? this.players.get(target) : null;
      if (!isHost || !victim) return;
      if (message.reason === 'kicked' && victim.ip && victim.ip !== 'unknown') this.banned.add(victim.ip);
      this.send(victim.socket, { t: 'kick', v: PROTOCOL_VERSION, from: id, reason: sanitizeText(message.reason, 24, 'kicked') });
      try { victim.socket.close(1008, 'kicked'); } catch { /* gone */ }
      return;
    }
    if (!isHost && !GUEST_ALLOWED.has(message.t)) return;
    if (isHost && HOST_BLOCKED.has(message.t)) return;
    if (message.t === 'start') {
      if (!isHost || this.room.phase !== 'lobby') return;
      this.room.phase = 'running';
      this.room.metadata = cleanMetadata(message.metadata);
      this.applyCfg(this.room.metadata.cfg);
      await this.state.storage.put('room', this.room);
      this.broadcast({ t: 'start', v: PROTOCOL_VERSION, from: id, metadata: this.room.metadata });
      await this.syncRegistry();
      return;
    }
    if (message.t === 'reset') {
      // Back to the lobby after a run: the host's start metadata is dropped and `start` is allowed again.
      if (!isHost || this.room.phase !== 'running') return;
      this.room.phase = 'lobby';
      this.room.metadata = null;
      this.room.wave = 0;
      this.snapshot = null;
      await this.state.storage.put('room', this.room);
      this.broadcast({ t: 'reset', v: PROTOCOL_VERSION, from: id });
      this.broadcastLobby();
      await this.syncRegistry().catch(() => {});
      return;
    }
    if (message.t === 'cfg' && isHost) {
      // Keep the public lobby listing truthful: difficulty while in the lobby, the current contract while running.
      const patch = this.room.phase === 'lobby' ? message : { wave: message.wave };
      if (this.applyCfg(patch)) await this.state.storage.put('room', this.room);
      await this.syncRegistry().catch(() => {});
    }
    if (message.t === 'snapshot-request') {
      if (isHost) return;
      const nowMs = Date.now();
      if (nowMs - (this.snapGate.get(id) || 0) < SNAPSHOT_REQUEST_GAP_MS) return;
      this.snapGate.set(id, nowMs);
      this.toHost({ t: 'snapshot-request', from: id });
      return;
    }
    if (message.t === 'snapshot-begin' || message.t === 'snapshot-chunk' || message.t === 'snapshot-end') {
      if (!isHost || this.room.phase !== 'running') return;
      this.relaySnapshot(message);
      return;
    }
    const relayed = { ...message, v: PROTOCOL_VERSION, from: id };
    delete relayed.you;
    if (isHost) {
      const target = Number(message.to);
      if (Number.isInteger(target)) this.toPlayer(target, relayed);
      else this.broadcast(relayed, id);
    } else {
      delete relayed.to;
      this.toHost(relayed);
    }
  }

  relaySnapshot(message) {
    const target = Number(message.to);
    if (message.t === 'snapshot-begin') {
      const total = Number(message.total);
      if (!Number.isInteger(total) || total < 1 || total > MAX_SNAPSHOT_CHUNKS) return;
      this.snapshot = { id: sanitizeText(message.id, 64, String(Date.now())), total, sent: 0, target };
      this.routeFromHost({ t: 'snapshot-begin', v: PROTOCOL_VERSION, id: this.snapshot.id, total }, target);
      return;
    }
    if (!this.snapshot) return;
    if (message.t === 'snapshot-chunk') {
      if (sanitizeText(message.id, 64) !== this.snapshot.id || message.index !== this.snapshot.sent ||
          typeof message.data !== 'string') return;
      this.routeFromHost({
        t: 'snapshot-chunk', v: PROTOCOL_VERSION, id: this.snapshot.id,
        index: this.snapshot.sent, data: message.data,
      }, this.snapshot.target);
      this.snapshot.sent++;
      return;
    }
    if (sanitizeText(message.id, 64) !== this.snapshot.id || this.snapshot.sent !== this.snapshot.total) return;
    this.routeFromHost({ t: 'snapshot-end', v: PROTOCOL_VERSION, id: this.snapshot.id }, this.snapshot.target);
    this.snapshot = null;
  }

  routeFromHost(message, target) {
    if (Number.isInteger(target)) this.toPlayer(target, message);
    else this.broadcast(message, this.room.hostId);
  }

  send(socket, message) {
    try { socket.send(JSON.stringify(message)); } catch { /* close handling cleans up the session */ }
  }

  fatal(socket, code, message) {
    this.send(socket, { t: 'error', code, message, fatal: true });
    socket.close(1008, message.slice(0, 120));
  }

  toPlayer(id, message) {
    const player = this.players.get(id);
    if (player) this.send(player.socket, message);
  }

  toHost(message) {
    this.toPlayer(this.room?.hostId, message);
  }

  broadcast(message, exceptId = null) {
    for (const player of this.players.values()) {
      if (player.id !== exceptId) this.send(player.socket, message);
    }
  }

  roster() {
    return [...this.players.values()]
      .sort((left, right) => left.connectedAt - right.connectedAt)
      .map(player => ({ id: player.id, name: player.name, host: player.id === this.room.hostId }));
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby', v: PROTOCOL_VERSION, code: this.room.code, name: this.room.name,
      world: this.room.world, phase: this.room.phase, host: this.room.hostId,
      max: MAX_PLAYERS, players: this.roster(),
    });
  }

  applyCfg(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    if (cfg.difficulty !== undefined) this.room.difficulty = cleanDifficulty(cfg.difficulty);
    if (cfg.wave !== undefined) this.room.wave = cleanWave(cfg.wave);
    return true;
  }

  summary() {
    return {
      code: this.room.code,
      name: this.room.name,
      world: this.room.world,
      players: this.players.size,
      max: MAX_PLAYERS,
      locked: Boolean(this.room.passwordHash),
      phase: this.room.phase,
      difficulty: cleanDifficulty(this.room.difficulty),
      wave: cleanWave(this.room.wave),
    };
  }

  async syncRegistry(confirm = false) {
    const registry = this.env.REGISTRY.getByName('global');
    const response = await registry.fetch(new Request('https://registry.internal/lobby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: this.summary(), confirm }),
    }));
    if (!response.ok) throw new Error(`registry update failed: ${response.status}`);
  }

  async removeRegistry(code) {
    const registry = this.env.REGISTRY.getByName('global');
    await registry.fetch(new Request('https://registry.internal/lobby', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }));
  }

  async persistPasswordAttempts() {
    const now = Date.now();
    const active = [...this.passwordAttempts.entries()]
      .map(([ip, times]) => [ip, times.filter(time => now - time < PASSWORD_ATTEMPT_WINDOW_MS)])
      .filter(([, times]) => times.length)
      .slice(-128);
    this.passwordAttempts = new Map(active);
    if (active.length) await this.state.storage.put('passwordAttempts', Object.fromEntries(active));
    else await this.state.storage.delete('passwordAttempts');
  }

  async repairHost() {
    if (this.players.has(this.room.hostId)) return;
    const oldest = [...this.players.values()].sort((left, right) => left.connectedAt - right.connectedAt)[0];
    this.room.hostId = oldest?.id || null;
    await this.state.storage.put('room', this.room);
  }

  async disconnect(socket) {
    await this.ready;
    const session = socket.deserializeAttachment();
    if (!session?.initialized || !this.players.delete(session.id) || !this.room) return;
    this.messageRates.delete(session.id);
    const oldHost = this.room.hostId;
    if (!this.players.size) {
      const code = this.room.code;
      this.room = null;
      this.snapshot = null;
      this.passwordAttempts.clear();
      await Promise.all([
        this.state.storage.delete('room'),
        this.state.storage.delete('passwordAttempts'),
      ]);
      await this.removeRegistry(code);
      return;
    }
    if (session.id === oldHost) {
      await this.repairHost();
      this.broadcast({ t: 'host', v: PROTOCOL_VERSION, host: this.room.hostId });
    }
    this.broadcastLobby();
    await this.syncRegistry();
  }

  async destroy() {
    if (!this.room) return;
    const code = this.room.code;
    const sockets = [...this.players.values()].map(player => player.socket);
    this.room = null;
    this.players.clear();
    this.snapshot = null;
    this.passwordAttempts.clear();
    this.messageRates.clear();
    await this.state.storage.deleteAll();
    await this.removeRegistry(code);
    for (const socket of sockets) {
      try { socket.close(1001, 'lobby removed'); } catch { /* room state is already gone */ }
    }
  }
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoder.encode(encoded).byteLength > 64 * 1024) return {};
  return JSON.parse(encoded);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request);
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      return new Response(null, { status: 204, headers });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'memoryburn-relay', protocol: PROTOCOL_VERSION }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (request.method === 'GET' && url.pathname === '/lobbies') {
      const registry = env.REGISTRY.getByName('global');
      const response = await registry.fetch(new Request('https://registry.internal/lobbies'));
      return new Response(response.body, { status: response.status, headers: corsHeaders(request) });
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/admin/lobbies/')) {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!env.MB_ADMIN_TOKEN || token !== env.MB_ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
      const code = normalizeCode(url.pathname.slice('/admin/lobbies/'.length));
      if (code.length !== 5) return new Response('invalid lobby code', { status: 400 });
      const headers = new Headers({ 'X-Mb-Admin': env.MB_ADMIN_TOKEN });
      const roomResponse = await env.ROOMS.getByName(code).fetch(new Request('https://room.internal', { method:'DELETE', headers }));
      const registry = env.REGISTRY.getByName('global');
      await registry.fetch(new Request('https://registry.internal/lobby', {
        method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ code })
      }));
      return roomResponse;
    }
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Memory Burn relay. Connect over websocket.\n', {
        status: 426,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' },
      });
    }
    if (!originAllowed(request.headers.get('Origin'))) return new Response('origin not allowed', { status: 403 });

    const creating = url.searchParams.get('create') === '1';
    const suppliedCode = normalizeCode(url.searchParams.get('code'));
    if (creating === Boolean(suppliedCode)) {
      return new Response('use exactly one of ?create=1 or ?code=ABCDE', { status: 400 });
    }
    let code = suppliedCode;
    if (creating) {
      const registry = env.REGISTRY.getByName('global');
      const response = await registry.fetch(new Request('https://registry.internal/allocate', { method: 'POST' }));
      if (!response.ok) return new Response('could not allocate a lobby code', { status: 503 });
      code = normalizeCode((await response.json()).code);
    }
    if (code.length !== 5) return new Response('room codes must be five characters', { status: 400 });

    const headers = new Headers(request.headers);
    headers.set('X-Mb-Room-Action', creating ? 'create' : 'join');
    headers.set('X-Mb-Room-Code', code);
    return env.ROOMS.getByName(code).fetch(new Request(request, { headers }));
  },
};

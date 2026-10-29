# Co-op

Online co-op for one to four players. It follows broIsAPotato's design: one host runs the game and a Cloudflare relay forwards messages. The protocol is that game's, with Memory Burn's own data in it.

## Pieces

| File | Runs in | Job |
| --- | --- | --- |
| `worker/relay.js` | Cloudflare Worker | Lobbies and message routing. One `Room` Durable Object per lobby code and one `Registry` object for the public lobby list. It never runs game code. |
| `js/net/snapshot.js` | browser and Node | The wire format: snapshots, player sheets and trimmed events. It is pure data in and out, so `tools/headless.mjs` tests it. |
| `js/net/net.js` | browser | The client: connecting, the lobby model, the host and guest roles, the autopilot for dropped players, and host migration. |
| `js/ui/coop.js` | browser | The Co-op screen (host, join by code, browse) and the lobby. |
| `js/main.js` | browser | Wires `MB.net` into the loop: who steps the sim, where commands go, and screen changes. |

## Model

- **The host is authoritative.** The host's browser runs `MB.sim` exactly as in single-player. The other slots get their input from `MB.net.inputFor`: the guest's latest input, or `MB.bot.input` when nobody drives that slot. The sim rules are unchanged, and the pinned seed-1234 hash in `tools/headless.mjs` still passes.
- **Guests keep a mirror.** A guest never steps. `app.sim` holds an object shaped like sim state (`MB.snap.newMirror`), and snapshots overwrite it. The renderer, HUD and shop read it like a local run. Guests draw about 100 ms behind the host and interpolate between the two newest snapshots. A snapshot's events (shots, hits, kills, pickups, radio triggers) play when that snapshot is shown.
- **Guests send commands.** On a guest, `app.cmd` sends `{t:'cmd', cmd}` to the host. The host accepts only `buy`, `lock`, `reroll`, `ready` and `deploy` (with `i` from 0 to 2), limits each guest to a rate, runs the command for that guest's slot and acks it. After a command it pushes a fresh snapshot and player sheet at once, so the shop on the guest updates in about one round trip.
- **The run doesn't stop for menus.** On the host the sim steps on every in-run screen, including pause, the shop of a player who has already readied, and the ending story. Losing window focus doesn't pause a co-op run. While the host's tab is hidden, browsers stop `requestAnimationFrame`, so a worker timer drives `update()` instead.
- **Own-runner prediction:** none. A guest sees their own runner at the host's position about 100 ms late, plus their round trip to the relay. That is fine on a normal connection and noticeable on a bad one. Adding prediction means replaying unacknowledged inputs on the mirror (`in.s` already numbers them).

### The story gate

After the host presses Start, everyone gets the opening story unless they turned on Skip Story. The host holds the sim at tick 0 until every connected runner has sent `go`, or 120 seconds pass. Meanwhile the HUD reads "Waiting for N runners to finish the briefing…". Briefing scenes between contracts don't need a gate, because a contract only starts once every runner presses Deploy.

### Dropping out and coming back

| Event | What happens |
| --- | --- |
| A guest's connection drops | The guest retries five times with backoff (1, 2, 4, 5, 5 seconds) and gets its runner back. |
| A guest's connection goes quiet without closing | During a run the host sends at least 5 frames a second. If a guest hears nothing for 8 s (a sleeping laptop, a network switch), it drops the socket itself and rejoins. If the relay still lists the old socket, the host hands the runner from that stale entry to the new connection when the name and tab token match. |
| A guest leaves or doesn't come back | Their slot becomes an orphan. The autopilot moves, shoots, shops and readies for it. |
| The same name rejoins from the same tab | It gets the slot back. The tab token lives in `sessionStorage`. After a host migration nobody knows the tokens, so the name alone counts. |
| Anyone else joins a running game | They spectate: they see the run and their inputs are ignored. Back in the lobby they get a free seat. |
| The host leaves | The relay promotes the player who joined next. That player restores the newest full backup and becomes the host. The host sends a full `JSON.stringify(sim)` every 5 s, in chunks, to the next-in-line guest. The old host's runner goes to the autopilot. Snapshots carry an epoch (the host's relay id), so guests clear their frame buffer when the host changes. If the backup is more than 20 s old, the run ends. |
| The host's own connection drops | The host keeps playing offline, and the autopilot takes over the other runners. |
| The game versions differ | Every `hello` carries `app.version + '/' + MB.dataHash()`. The host kicks a guest whose value doesn't match theirs, and the guest is told to refresh. |
| Game over | The host can take everyone back to the lobby with a `reset` frame. The relay reopens the room for a new start, keeping the same code and crew. |

## Wire format

All frames are JSON with `v: 1`. The relay adds `from` (the sender's relay id) to anything it forwards.

**Relay to client:** `welcome {you, host, code, phase, metadata}`, `lobby {players:[{id,name,host}], host, name, phase}`, `host {host}`, `error {code, message, fatal}`, `pong`, `snapshot-begin/chunk/end`.

**Guest to host:**

| Frame | Fields |
| --- | --- |
| `hello` | `{tok, name, ver}` |
| `pick` | `{arch}` |
| `ready` | `{r}` |
| `go` | (none) |
| `in` | `{s, mx, my, ax, ay, b}`: `mx` and `my` are the move axes ×100, `ax` and `ay` are the aim point in arena pixels, and `b` holds dash (1), fire (2) and manual (4) as bits |
| `cmd` | `{id, cmd}` |
| `snapshot-request` | (none) |

Guests send input at up to 30 Hz, plus at once on a dash press. Unchanged input is re-sent every 250 ms. The host latches a dash press until one sim step has used it, and it zeroes a guest's input after 1 s of silence.

**Host to guests:**

| Frame | Contents |
| --- | --- |
| `slots` | `{map: {relayId: {slot, arch, name, ready}}}` |
| `cfg` | `{difficulty, wave?}` |
| `start` | `{metadata: {cfg:{seed, difficulty, players:[{arch,name}], settings}, slots, ver}}` |
| `reset` | (none) |
| `kick` | `{reason}` |
| `ack` | `{id, ok, err}` |
| `snap` | `MB.snap.encode` output, plus `ep` (the epoch) and `hd` (how many runners the story gate is waiting for) |
| `pst` | `{p:[sheet]}`, the whole player except live positions: stats, items, shop, cash, ready |

Snapshots go out at 20 Hz during a contract and 5 Hz otherwise. Players, pets, enemies, bullets, enemy bullets and pickups travel as rows of integers. The row layouts are documented at the top of `js/net/snapshot.js`. A crowded wave 12 with three players comes to about 10 KB. Player sheets go out when they change (checked 4 times a second), and every 3 s anyway.

## Relay

`worker/relay.js` started as broIsAPotato's relay and was adapted for this game:

- **Lobby listing:** it carries `difficulty` and `wave` (`Normal`/`Hard`/`Insane`, and the current contract while running).
- **Allowed origins:** `https://memoryburn.andrenijman.com`, `https://games.andrenijman.com`, localhost, and `null` (pages opened as `file://`).
- **Guest frames:** `go` is allowed.
- **Host frames:** a `reset` frame takes a running room back to the lobby phase. While running, the host's `cfg` updates only the `wave` in the listing.
- **Unchanged from broIsAPotato:**
  - Lobby codes are 5 characters, drawn from an alphabet without vowels.
  - Passwords are hashed, with 6 tries a minute per IP.
  - Each socket may send at most 900 messages per 10 s.
  - Frames are limited to 1 MB, and a snapshot to 256 chunks.
  - A kick for misbehaviour bans the IP from that room.
  - The listing drops rooms that have been quiet for an hour.
- **Admin:** `DELETE /admin/lobbies/:code` takes a Bearer token. The token is `MB_ADMIN_TOKEN`, which is unset by default; set it with `wrangler secret put MB_ADMIN_TOKEN`.

The relay is deployed as `memoryburn-relay` with a custom domain. Configuration is in `wrangler.jsonc`.

```sh
wrangler dev                 # local relay on http://127.0.0.1:8787; open index.html?relay=ws://127.0.0.1:8787
wrangler deploy              # publish (workers.dev + relay.memoryburn.andrenijman.com)
curl https://relay.memoryburn.andrenijman.com/health
```

The client connects to `wss://relay.memoryburn.andrenijman.com` (`DEFAULT_RELAY` in `js/net/net.js`), and `?relay=` overrides it. `wss://memoryburn-relay.tung-tung-tung-sahur.workers.dev` serves the same worker.

## Tests

```sh
node tools/headless.mjs      # 'net' group: snapshot round trip into a mirror, events, size budget, data hash
node tools/mp-e2e.mjs        # relay protocol with raw sockets, then three vm clients running the real sim + net.js
node tools/mp-playtest.mjs   # two Chromium contexts: host, join by typed code, story gate, move, shop, deploy, drop out
MB_RELAY=wss://relay.memoryburn.andrenijman.com node tools/mp-e2e.mjs   # the same against production
```

`mp-e2e` covers:

- create, password, listing and cfg
- a full lobby and routing rules
- start, a late join with a targeted snapshot relay, reset, and host promotion
- the lobby ready gate and the story gate
- input forwarding and dash latching
- guest commands and the command whitelist
- shop, ready and deploy into contract 2
- a guest whose socket dies reconnecting on its own, and the silence watchdog rejoining while the relay still holds the old socket
- the autopilot taking a dropped runner, and a same-name rejoin
- a spectator
- host migration from the backup
- back to the lobby
- the version kick

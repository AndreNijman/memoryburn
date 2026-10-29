/*
 * MemoryBurn - js/ui/coop.js
 *
 * The online co-op screens: SC.coop (name, host a crew, join by code, browse open lobbies) and SC.lobby (roster,
 * character pick, difficulty, ready / start). They drive MB.net; main.js reacts to its start/reset/closed events.
 * Also the one text field the game needs, built on MB.input.typed().
 */
(function () {
  'use strict';
  var SC = MB.screens, UI = MB.ui, S = MB.sprites, P = S.palette, D = MB.data, IN = MB.input;
  var W = D.VIRTUAL_W, H = D.VIRTUAL_H, C = UI.C;
  var NAME_KEY = 'memoryburn.coop.name';

  /* ------------------------------------------------------------------ text field */
  var active = null, caretT = 0, gref = null;
  // o: {max, filter: RegExp of allowed characters, upper, secret, placeholder}
  function field(id, label, val, x, y, w, o) {
    o = o || {};
    var h = 64, hov = UI.hover(x, y, w, h);
    if (IN.mouse.clicked) { if (hov) { active = id; caretT = 0; } else if (active === id) active = null; }
    var on = active === id;
    if (on) {
      var add = IN.typed();
      if (o.upper) add = add.toUpperCase();
      if (o.filter) add = add.split('').filter(function (ch) { return o.filter.test(ch); }).join('');
      if (add) { val = (val + add).slice(0, o.max || 24); caretT = 0; }
      if (IN.pressed('Backspace') && val.length) { val = val.slice(0, -1); caretT = 0; }
      caretT += 1 / 60;
    }
    UI.text(label, x + 4, y - 20, { size: 22, color: P.yellow, outlineW: 5 });
    var g = gref;
    UI.rr(x - 4, y - 4, w + 8, h + 8, 14); g.fillStyle = C.edge; g.fill();
    UI.rr(x, y, w, h, 11); g.fillStyle = on ? '#3d3350' : (hov ? '#332a43' : '#241d2f'); g.fill();
    if (on) { g.lineWidth = 3; g.strokeStyle = P.cyan; UI.rr(x + 1.5, y + 1.5, w - 3, h - 3, 10); g.stroke(); }
    var shown = o.secret ? val.replace(/./g, '•') : val;
    if (shown) UI.text(shown, x + 20, y + h / 2, { size: 32, font: 'body', color: C.text, outline: false, maxW: w - 40 });
    else if (!on && o.placeholder) UI.text(o.placeholder, x + 20, y + h / 2, { size: 28, font: 'body', color: '#7d7290', outline: false });
    if (on && Math.floor(caretT * 2) % 2 === 0) {
      var cx = x + 20 + (shown ? Math.min(w - 40, UI.measure(shown, 32, 'body')) : 0) + 3;
      g.fillStyle = C.text; g.fillRect(cx, y + 14, 3, h - 28);
    }
    return val;
  }

  /* ------------------------------------------------------------------ state */
  var st = null;
  function loadName() { try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function saveName(n) { try { window.localStorage.setItem(NAME_KEY, n); } catch (e) { /* storage blocked */ } }
  function ui() {
    if (!st) st = { name: loadName(), code: '', lobbyName: '', hostPass: '', joinPass: '', diff: 'Normal', busy: false, list: null, listAt: -99, listErr: '', copiedT: 0 };
    return st;
  }
  function cleanName(n) { return String(n || '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16); }

  function begin(app, p) {
    var s = ui();
    s.busy = true; app.coopMsg = '';
    saveName(cleanName(s.name));
    p.then(function () {
      s.busy = false; active = null;
      if (!app.coop) app.go('lobby'); // a late joiner is already in the run
    }, function (err) {
      s.busy = false;
      app.coopMsg = (err && err.message) || 'Could not reach the relay.';
    });
  }

  function refreshList(app) {
    var s = ui();
    s.listAt = app.t; s.listErr = '';
    MB.net.listLobbies().then(function (l) { s.list = l; }, function (e) { s.listErr = (e && e.message) || 'The lobby list is unavailable.'; });
  }

  /* ------------------------------------------------------------------ SC.coop */
  SC.coop = function (app, g) {
    gref = g;
    var s = ui(), net = MB.net;
    UI.dim(0.72);
    UI.text('Co-op', W / 2, 96, { size: 76, align: 'center' });
    UI.text('Up to four runners. One hosts and runs the game; the others join with a five-letter code.', W / 2, 152, { size: 26, font: 'body', align: 'center', color: C.dim, outline: false });
    s.name = field('f:name', 'Your name', s.name, W / 2 - 300, 222, 600, { max: 16, filter: /[\x20-\x7e]/, placeholder: 'Runner' });
    var named = cleanName(s.name).length > 0, busy = s.busy || net.state === 'connecting';

    // host
    var hx = 110, hy = 340, hw = 620, hh = 590;
    UI.panel(hx, hy, hw, hh);
    UI.text('Host a crew', hx + 40, hy + 56, { size: 44 });
    s.lobbyName = field('f:lobby', 'Lobby name', s.lobbyName, hx + 40, hy + 140, hw - 80, { max: 28, filter: /[\x20-\x7e]/, placeholder: (cleanName(s.name) || 'Runner') + '\'s crew' });
    s.hostPass = field('f:hpass', 'Password (optional)', s.hostPass, hx + 40, hy + 260, hw - 80, { max: 32, filter: /[\x21-\x7e]/, secret: true, placeholder: 'Open to anyone' });
    UI.text('Difficulty', hx + 44, hy + 368, { size: 22, color: P.yellow, outlineW: 5 });
    D.DIFFICULTIES.forEach(function (d, i) {
      if (UI.button('cd:' + d, d, hx + 40 + i * 185, hy + 388, 170, 64, { size: 28, selected: s.diff === d })) s.diff = d;
    });
    if (UI.button('c:host', busy ? 'Connecting…' : 'Host', hx + 40, hy + hh - 110, hw - 80, 84, { tone: 'primary', size: 42, disabled: busy || !named })) {
      begin(app, net.host({ name: cleanName(s.name), lobbyName: s.lobbyName, password: s.hostPass, difficulty: s.diff, arch: app.arch }));
    }

    // join
    var jx = 770, jy = 340, jw = 1040, jh = 590;
    UI.panel(jx, jy, jw, jh);
    UI.text('Join a crew', jx + 40, jy + 56, { size: 44 });
    s.code = field('f:code', 'Lobby code', s.code, jx + 40, jy + 140, 380, { max: 5, filter: /[A-Z0-9]/, upper: true, placeholder: 'ABCDE' });
    s.joinPass = field('f:jpass', 'Password (if it has one)', s.joinPass, jx + 40, jy + 260, 380, { max: 32, filter: /[\x21-\x7e]/, secret: true });
    var codeOk = s.code.length === 5;
    if (UI.button('c:join', busy ? 'Connecting…' : 'Join', jx + 40, jy + jh - 110, 380, 84, { tone: 'primary', size: 42, disabled: busy || !named || !codeOk }) || (active === 'f:code' && codeOk && named && !busy && IN.confirm())) {
      begin(app, net.join({ code: s.code, password: s.joinPass, name: cleanName(s.name) }));
    }

    // open lobbies
    var lx = jx + 470, ly = jy + 100, lw = jw - 510;
    UI.text('Open lobbies', lx, ly - 20, { size: 22, color: P.yellow, outlineW: 5 });
    if (app.t - s.listAt > 6 && !busy) refreshList(app);
    if (UI.button('c:refresh', 'Refresh', lx + lw - 150, ly - 46, 150, 48, { size: 22, tone: 'ghost' })) refreshList(app);
    var rows = (s.list || []).slice(0, 5);
    if (s.listErr) UI.text(s.listErr, lx, ly + 50, { size: 24, font: 'body', color: '#ff6a7a', outline: false, maxW: lw });
    else if (!s.list) UI.text('Looking…', lx, ly + 50, { size: 24, font: 'body', color: C.dim, outline: false });
    else if (!rows.length) UI.text('Nobody is hosting right now. Host one and share the code.', lx, ly + 50, { size: 24, font: 'body', color: C.dim, outline: false, maxW: lw });
    rows.forEach(function (l, i) {
      var y = ly + 10 + i * 88, hov = UI.hover(lx, y, lw, 78), full = l.players >= l.max;
      UI.rr(lx, y, lw, 78, 12); g.fillStyle = hov && !full ? '#3d3350' : 'rgba(0,0,0,0.28)'; g.fill();
      if (l.locked) S.draw(g, 'hud:lock', lx + 30, y + 27, { scale: 0.7 });
      UI.text(l.name, lx + (l.locked ? 52 : 18), y + 26, { size: 26, maxW: lw - 200 });
      var sub = l.difficulty + '  ·  ' + (l.phase === 'running' ? 'in contract ' + (l.wave || 1) : 'in the lobby') + '  ·  ' + l.code;
      UI.text(sub, lx + 18, y + 58, { size: 20, font: 'body', color: C.dim, outline: false });
      UI.text(l.players + '/' + l.max, lx + lw - 20, y + 40, { size: 30, align: 'right', color: full ? '#ff6a7a' : C.text });
      if (hov && IN.mouse.clicked && !full && !busy) {
        s.code = l.code;
        if (l.locked && !s.joinPass) { active = 'f:jpass'; app.coopMsg = 'That crew has a password. Type it, then press Join.'; }
        else if (named) begin(app, net.join({ code: l.code, password: s.joinPass, name: cleanName(s.name) }));
        else app.coopMsg = 'Pick a name first.';
      }
    });

    if (app.coopMsg) UI.text(app.coopMsg, W / 2, 976, { size: 28, font: 'body', align: 'center', color: '#ff9a3c', outline: false, maxW: 1400 });
    UI.text('Relay: ' + net.relayUrl().replace(/^wss?:\/\//, ''), W - 30, H - 26, { size: 18, font: 'body', align: 'right', color: '#6f6480', outline: false });
    if (UI.button('c:back', 'Back', 60, H - 100, 220, 70, { size: 30, tone: 'ghost' }) || (IN.back() && !active)) {
      if (net.state !== 'idle') net.leave();
      active = null; app.go('menu');
    }
    if (IN.pressed('Escape')) active = null;
  };

  /* ------------------------------------------------------------------ SC.lobby */
  function copy(text) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text); } catch (e) { /* no clipboard */ }
  }

  SC.lobby = function (app, g) {
    gref = g;
    var s = ui(), net = MB.net, L = net.lobby;
    UI.dim(0.72);
    if (!L || net.state !== 'lobby') {
      UI.text(net.state === 'connecting' ? 'Connecting…' : 'Not connected', W / 2, H / 2, { size: 48, align: 'center' });
      if (UI.button('l:back', 'Back', 60, H - 100, 220, 70, { size: 30, tone: 'ghost' }) || IN.back()) { net.leave(); app.go('coop'); }
      return;
    }
    s.copiedT = Math.max(0, s.copiedT - 1 / 60);
    var host = net.role() === 'host';
    UI.text(L.name || 'Crew', W / 2, 92, { size: 64, align: 'center', maxW: 1300 });
    // the code, click to copy
    var cw = 520, cx = W / 2 - cw / 2, cy = 130, chov = UI.hover(cx, cy, cw, 78);
    UI.rr(cx, cy, cw, 78, 16); g.fillStyle = chov ? '#3d3350' : 'rgba(0,0,0,0.35)'; g.fill();
    UI.text('CODE', cx + 24, cy + 40, { size: 24, color: C.dim, outlineW: 5 });
    UI.text(L.code, cx + cw / 2 + 30, cy + 40, { size: 54, align: 'center', color: P.yellow });
    UI.text(s.copiedT > 0 ? 'Copied' : 'Copy', cx + cw - 24, cy + 40, { size: 20, align: 'right', color: C.dim, outlineW: 4 });
    if (chov && IN.mouse.clicked) { copy(L.code); s.copiedT = 1.5; }

    // roster
    var rx = 110, ry = 250, rw = 820, rh = 130;
    UI.text('Crew  ' + L.players.length + '/' + L.max, rx + 4, ry - 18, { size: 26, color: P.yellow, outlineW: 5 });
    for (var i = 0; i < L.max; i++) {
      var y = ry + i * (rh + 16), pl = L.players[i];
      UI.panel(rx, y, rw, rh, { r: 16, edge: 6, alpha: pl ? 1 : 0.5 });
      if (!pl) { UI.text('Open seat', rx + rw / 2, y + rh / 2, { size: 30, align: 'center', color: '#7d7290', outline: false }); continue; }
      S.draw(g, 'shadow', rx + 80, y + 104, { scale: 0.7 });
      S.draw(g, 'char:' + pl.arch, rx + 80, y + 66, { scale: 0.85 });
      UI.text(pl.name + (pl.you ? '  (you)' : ''), rx + 160, y + 46, { size: 36, maxW: 380 });
      UI.text(SC.shortName(D.ARCHETYPES[pl.arch]), rx + 160, y + 92, { size: 24, font: 'body', color: C.dim, outline: false });
      var tag = pl.host ? 'HOST' : pl.ready ? 'READY' : 'NOT READY';
      UI.text(tag, rx + rw - 30, y + 46, { size: 26, align: 'right', color: pl.host ? P.cyan : pl.ready ? P.green : '#ff9a3c', outlineW: 5 });
      if (host && !pl.you && UI.button('l:kick' + pl.id, 'Kick', rx + rw - 150, y + 70, 120, 46, { size: 22, tone: 'danger' })) net.kick(pl.id);
    }

    // character pick
    var me = null;
    L.players.forEach(function (p) { if (p.you) me = p; });
    var px = 990, py = 250, tw = 190, th = 190;
    UI.text('Your runner', px + 4, py - 18, { size: 26, color: P.yellow, outlineW: 5 });
    D.ARCHETYPES.forEach(function (a, k) {
      var x = px + (k % 4) * (tw + 14), yy = py + Math.floor(k / 4) * (th + 14), sel = me && me.arch === k, hov = UI.hover(x, yy, tw, th);
      UI.panel(x, yy, tw, th, { r: 16, edge: 6, fill: sel ? '#4a3c62' : hov ? '#352b45' : C.panel, glow: sel ? P.yellow : null });
      S.draw(g, 'shadow', x + tw / 2, yy + 128, { scale: 0.8 });
      S.draw(g, 'char:' + k, x + tw / 2, yy + 86 - (sel ? Math.abs(Math.sin(app.t * 4)) * 6 : 0), { scale: 1.0 });
      UI.text(SC.shortName(a), x + tw / 2, yy + th - 26, { size: 22, align: 'center', maxW: tw - 16 });
      if (hov && IN.mouse.clicked && !sel) { app.arch = k; net.setPick(k); }
    });
    var cur = D.ARCHETYPES[me ? me.arch : app.arch];
    UI.text(cur.name, px + 4, py + 2 * (th + 14) + 26, { size: 30, maxW: 800 });

    // difficulty
    var dy = py + 2 * (th + 14) + 80;
    UI.text('Difficulty', px + 4, dy, { size: 22, color: P.yellow, outlineW: 5 });
    if (host) {
      D.DIFFICULTIES.forEach(function (d, k) {
        if (UI.button('ld:' + d, d, px + k * 250, dy + 20, 230, 66, { size: 30, selected: L.cfg.difficulty === d })) net.setCfg({ difficulty: d });
      });
    } else UI.text(L.cfg.difficulty + '  ·  the host picks', px + 4, dy + 50, { size: 32 });

    // start / ready
    var by = H - 130;
    if (host) {
      var can = net.canStart();
      if (!can.ok) UI.text(can.reason, 1430, by - 30, { size: 24, font: 'body', align: 'center', color: '#ff9a3c', outline: false });
      else if (L.players.length < 2) UI.text('Share the code. You can also start alone.', 1430, by - 30, { size: 24, font: 'body', align: 'center', color: C.dim, outline: false });
      if (UI.button('l:start', 'Start Run', 1190, by, 480, 90, { tone: 'good', size: 44, disabled: !can.ok })) net.start();
    } else if (me) {
      if (UI.button('l:ready', me.ready ? 'Not Ready' : 'Ready', 1190, by, 480, 90, { tone: me.ready ? 'normal' : 'good', size: 44 })) net.setReady(!me.ready);
      if (me.ready) UI.text('Waiting for the host to start…', 1430, by - 30, { size: 24, font: 'body', align: 'center', color: C.dim, outline: false });
    }
    if (app.coopMsg) UI.text(app.coopMsg, W / 2, by - 76, { size: 26, font: 'body', align: 'center', color: '#ff9a3c', outline: false, maxW: 1400 });
    UI.text(net.rtt ? net.rtt + ' ms' : '', W - 30, H - 26, { size: 18, font: 'body', align: 'right', color: '#6f6480', outline: false });
    if (UI.button('l:back', 'Leave', 110, by, 260, 90, { size: 36, tone: 'danger' }) || IN.back()) { net.leave(); app.go('coop'); }
  };
})();

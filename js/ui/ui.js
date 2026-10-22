/*
 * MemoryBurn - js/ui/ui.js
 *
 * Immediate-mode canvas widgets in virtual coordinates. Brotato-flavoured: dark rounded panels with a
 * thick outline and a drop edge, white buttons on hover, chunky outlined display text.
 *
 *   UI.begin(g, dt)  ... widgets ...  UI.end()
 *   UI.text(str, x, y, o)                       o: {size, color, align, base, font:'title'|'body', outline, maxW, alpha}
 *   UI.panel(x, y, w, h, o)                     o: {fill, edge, r, glow}
 *   UI.button(id, label, x, y, w, h, o) -> bool o: {tone:'normal'|'primary'|'danger'|'ghost', disabled, size, icon, sub, selected}
 *   UI.toggle(id, label, val, x, y, w) -> val
 *   UI.slider(id, label, val, min, max, step, x, y, w, fmt) -> val
 *   UI.tabs(id, labels, idx, x, y, w, h) -> idx
 *   UI.hover(x, y, w, h)   UI.wrap(str, maxW, size, font) -> lines
 *
 * Keyboard/d-pad focus: every focusable widget registers in draw order; arrows move, Enter activates.
 */
(function () {
  'use strict';
  var UI = MB.ui = {}, S = MB.sprites, P = S.palette, IN = MB.input, TAU = Math.PI * 2;
  var g = null, t = 0;
  UI.FONT_T = '"Lilita One", "Arial Black", system-ui, sans-serif';
  UI.FONT_B = '"Nunito", system-ui, sans-serif';
  UI.C = {
    panel: '#2a2236', panelLo: '#1e1828', edge: '#120e18', text: '#fbf6ec', dim: '#b9aec8', gold: P.yellow,
    good: P.green, bad: P.red, cyan: P.cyan, hover: '#fbf6ec'
  };
  UI.textScale = 1;

  var anim = Object.create(null); // per-id hover easing
  var focusables = [], focusId = null, focusOn = false, activate = false, sliders = Object.create(null);

  UI.begin = function (ctx, dt) {
    g = ctx; t += dt;
    // focus navigation from the previous frame's widget list
    var prev = focusables; focusables = [];
    var dir = 0, onSlider = focusOn && sliders[focusId]; // left/right adjust a focused slider instead of moving focus
    if (IN.pressed('ArrowDown') || IN.pressed('Tab') || IN.padPressed('down') || (!onSlider && (IN.pressed('ArrowRight') || IN.padPressed('right')))) dir = 1;
    if (IN.pressed('ArrowUp') || IN.padPressed('up') || (!onSlider && (IN.pressed('ArrowLeft') || IN.padPressed('left')))) dir = -1;
    sliders = Object.create(null);
    if (IN.mouse.moved) focusOn = false;
    if (dir && prev.length) {
      var idx = -1;
      for (var i = 0; i < prev.length; i++) if (prev[i] === focusId) idx = i;
      if (!focusOn || idx < 0) idx = dir > 0 ? 0 : prev.length - 1; else idx = (idx + dir + prev.length) % prev.length;
      focusId = prev[idx]; focusOn = true;
    }
    activate = focusOn && IN.confirm();
  };
  UI.end = function () { };
  UI.time = function () { return t; };
  UI.clearFocus = function () { focusOn = false; focusId = null; };

  function ease(id, target, k) {
    var v = anim[id] || 0;
    v += (target - v) * Math.min(1, k || 0.3);
    anim[id] = v; return v;
  }

  UI.font = function (size, kind) {
    var s = Math.round(size * (kind === 'title' ? 1 : UI.textScale));
    return (kind === 'title' ? '' : '800 ') + s + 'px ' + (kind === 'title' ? UI.FONT_T : UI.FONT_B);
  };

  UI.text = function (str, x, y, o) {
    o = o || {};
    var size = o.size || 28, kind = o.font || 'title';
    g.save();
    if (o.alpha != null) g.globalAlpha *= o.alpha;
    g.font = UI.font(size, kind);
    g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'middle';
    if (o.maxW) {
      var w = g.measureText(str).width;
      if (w > o.maxW) { g.font = UI.font(size * o.maxW / w, kind); }
    }
    if (o.outline !== false) {
      g.lineJoin = 'round'; g.miterLimit = 2;
      g.lineWidth = o.outlineW || Math.max(4, size * 0.22); g.strokeStyle = o.outlineCol || UI.C.edge;
      if (o.drop !== false && kind === 'title') { g.fillStyle = UI.C.edge; g.strokeText(str, x, y + size * 0.09); }
      g.strokeText(str, x, y);
    }
    g.fillStyle = o.color || UI.C.text;
    g.fillText(str, x, y);
    g.restore();
  };
  UI.measure = function (str, size, kind) { g.font = UI.font(size, kind || 'title'); return g.measureText(str).width; };

  UI.wrap = function (str, maxW, size, kind) {
    g.font = UI.font(size, kind || 'body');
    var out = [];
    String(str).split('\n').forEach(function (para) {
      var words = para.split(' '), line = '';
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (g.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      });
      out.push(line);
    });
    return out;
  };

  function rr(x, y, w, h, r) { MB.render.roundRect(g, x, y, w, h, r); }
  UI.rr = rr;

  UI.panel = function (x, y, w, h, o) {
    o = o || {};
    var r = o.r != null ? o.r : 18, edge = o.edge != null ? o.edge : 8;
    g.save();
    if (o.alpha != null) g.globalAlpha *= o.alpha;
    g.fillStyle = 'rgba(8,5,12,0.45)'; rr(x + 4, y + edge + 6, w, h, r); g.fill();
    g.fillStyle = UI.C.edge; rr(x - 4, y - 4, w + 8, h + edge + 8, r + 4); g.fill();
    g.fillStyle = o.lo || UI.C.panelLo; rr(x, y, w, h + edge, r); g.fill();
    g.fillStyle = o.fill || UI.C.panel; rr(x, y, w, h, r); g.fill();
    if (o.glow) { g.lineWidth = 4; g.strokeStyle = o.glow; rr(x + 3, y + 3, w - 6, h - 6, r - 3); g.stroke(); }
    g.restore();
  };

  UI.hover = function (x, y, w, h) {
    var m = IN.mouse;
    return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
  };

  var TONES = {
    normal: { fill: '#3d3350', lo: '#272033', text: UI.C.text },
    primary: { fill: '#e8a93a', lo: '#a5661e', text: UI.C.edge },
    danger: { fill: '#c43b4f', lo: '#7d2232', text: UI.C.text },
    ghost: { fill: '#2a2236', lo: '#1e1828', text: UI.C.dim },
    good: { fill: '#4fb85c', lo: '#2c7a3a', text: UI.C.edge }
  };

  UI.button = function (id, label, x, y, w, h, o) {
    o = o || {};
    focusables.push(id);
    var tone = TONES[o.tone || 'normal'];
    var dis = !!o.disabled;
    var hov = !dis && (UI.hover(x, y, w, h) || (focusOn && focusId === id));
    var press = hov && IN.mouse.down && UI.hover(x, y, w, h);
    var k = ease(id, hov ? 1 : 0, 0.35);
    var edge = 7, dy = press ? edge - 2 : 0;
    var grow = k * 4;
    g.save();
    if (dis) g.globalAlpha *= 0.45;
    var X = x - grow, Y = y - grow * 0.6 + dy, W = w + grow * 2, H = h;
    g.fillStyle = UI.C.edge; rr(X - 4, Y - 4, W + 8, H + edge + 8 - dy, 16); g.fill();
    var fill = hov ? UI.C.hover : (o.selected ? '#5a4a78' : tone.fill);
    var lo = hov ? '#b8aec6' : tone.lo;
    g.fillStyle = lo; rr(X, Y, W, H + edge - dy, 13); g.fill();
    g.fillStyle = fill; rr(X, Y, W, H, 13); g.fill();
    g.fillStyle = 'rgba(255,255,255,' + (hov ? 0 : 0.10) + ')'; rr(X + 6, Y + 5, W - 12, H * 0.32, 8); g.fill();
    if (o.selected && !hov) { g.lineWidth = 4; g.strokeStyle = UI.C.gold; rr(X + 2, Y + 2, W - 4, H - 4, 11); g.stroke(); }
    var size = o.size || Math.min(34, h * 0.48);
    var tx = X + W / 2, ty = Y + H / 2 + (o.sub ? -size * 0.32 : 0);
    if (o.icon) {
      var iw = UI.measure(label, size, 'title') + size * 1.3;
      S.draw(g, o.icon, tx - iw / 2 + size * 0.45, ty, { scale: size / 40 });
      tx += size * 0.65;
    }
    var col = hov ? UI.C.edge : tone.text;
    UI.text(label, tx, ty, { size: size, align: 'center', color: col, outline: !hov && tone.text !== UI.C.edge, drop: false, maxW: W - 24 });
    var subCol = hov || tone.text === UI.C.edge ? 'rgba(28,22,34,0.78)' : 'rgba(255,250,240,0.85)';
    if (o.sub) UI.text(o.sub, X + W / 2, Y + H / 2 + size * 0.55, { size: size * 0.55, font: 'body', align: 'center', color: subCol, outline: false });
    g.restore();
    if (dis) return false;
    var clicked = (hov && IN.mouse.clicked && UI.hover(x, y, w, h)) || (focusOn && focusId === id && activate);
    if (clicked) { activate = false; if (MB.audio && MB.audio.click) MB.audio.click(); }
    return clicked;
  };

  UI.toggle = function (id, label, val, x, y, w) {
    var h = 58;
    focusables.push(id);
    var hov = UI.hover(x, y, w, h) || (focusOn && focusId === id);
    if (hov) { g.fillStyle = 'rgba(255,255,255,0.07)'; rr(x - 10, y, w + 20, h, 12); g.fill(); }
    UI.text(label, x + 6, y + h / 2, { size: 26, font: 'body', color: hov ? UI.C.text : UI.C.dim, outline: false });
    var sw = 92, sh = 40, sx = x + w - sw, sy = y + (h - sh) / 2;
    var k = ease(id, val ? 1 : 0, 0.3);
    g.fillStyle = UI.C.edge; rr(sx - 4, sy - 4, sw + 8, sh + 8, (sh + 8) / 2); g.fill();
    g.fillStyle = val ? '#4fb85c' : '#4a4058'; rr(sx, sy, sw, sh, sh / 2); g.fill();
    var kx = sx + sh / 2 + k * (sw - sh);
    g.fillStyle = UI.C.edge; g.beginPath(); g.arc(kx, sy + sh / 2, sh / 2 + 1, 0, TAU); g.fill();
    g.fillStyle = UI.C.text; g.beginPath(); g.arc(kx, sy + sh / 2, sh / 2 - 4, 0, TAU); g.fill();
    if ((hov && IN.mouse.clicked && UI.hover(x, y, w, h)) || (focusOn && focusId === id && activate)) { activate = false; return !val; }
    return val;
  };

  UI.slider = function (id, label, val, min, max, step, x, y, w, fmt) {
    var h = 58;
    focusables.push(id); sliders[id] = 1;
    var focused = focusOn && focusId === id;
    var hov = UI.hover(x, y, w, h) || focused;
    if (hov) { g.fillStyle = 'rgba(255,255,255,0.07)'; rr(x - 10, y, w + 20, h, 12); g.fill(); }
    UI.text(label, x + 6, y + h / 2, { size: 26, font: 'body', color: hov ? UI.C.text : UI.C.dim, outline: false });
    var tw = w * 0.42, tx = x + w - tw - 90, ty = y + h / 2;
    var f = (val - min) / (max - min);
    g.fillStyle = UI.C.edge; rr(tx - 4, ty - 10, tw + 8, 20, 10); g.fill();
    g.fillStyle = '#4a4058'; rr(tx, ty - 6, tw, 12, 6); g.fill();
    g.fillStyle = P.cyan; rr(tx, ty - 6, Math.max(12, tw * f), 12, 6); g.fill();
    g.fillStyle = UI.C.edge; g.beginPath(); g.arc(tx + tw * f, ty, 17, 0, TAU); g.fill();
    g.fillStyle = UI.C.text; g.beginPath(); g.arc(tx + tw * f, ty, 12, 0, TAU); g.fill();
    UI.text(fmt ? fmt(val) : String(val), x + w, ty, { size: 26, align: 'right', color: UI.C.text });
    var m = IN.mouse, nv = val;
    if (m.down && (anim[id + ':drag'] || (m.clicked && UI.hover(tx - 20, y, tw + 40, h)))) {
      anim[id + ':drag'] = 1;
      nv = min + Math.max(0, Math.min(1, (m.x - tx) / tw)) * (max - min);
    } else anim[id + ':drag'] = 0;
    if (focused) {
      if (IN.pressed('ArrowRight') || IN.padPressed('right')) nv = val + step;
      if (IN.pressed('ArrowLeft') || IN.padPressed('left')) nv = val - step;
    }
    nv = Math.round(nv / step) * step;
    return Math.max(min, Math.min(max, +nv.toFixed(4)));
  };

  UI.tabs = function (id, labels, idx, x, y, w, h) {
    var n = labels.length, gap = 12, bw = (w - gap * (n - 1)) / n;
    for (var i = 0; i < n; i++) {
      if (UI.button(id + ':' + i, labels[i], x + i * (bw + gap), y, bw, h, { selected: i === idx, size: 28 })) idx = i;
    }
    return idx;
  };

  // HUD-style bar with outline + label inside
  UI.bar = function (x, y, w, h, f, col, label) {
    g.fillStyle = UI.C.edge; rr(x - 4, y - 4, w + 8, h + 8, (h + 8) / 2.6); g.fill();
    g.fillStyle = '#3a3048'; rr(x, y, w, h, h / 2.6); g.fill();
    if (f > 0) {
      g.fillStyle = col; rr(x, y, Math.max(h * 0.8, w * Math.min(1, f)), h, h / 2.6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.22)'; rr(x + 4, y + 3, Math.max(0, w * Math.min(1, f) - 8), h * 0.28, h * 0.14); g.fill();
    }
    if (label) UI.text(label, x + w / 2, y + h / 2 + 1, { size: h * 0.7, align: 'center', outlineW: 5, drop: false });
  };

  UI.dim = function (a) { g.fillStyle = 'rgba(10,6,16,' + (a == null ? 0.6 : a) + ')'; g.fillRect(0, 0, MB.data.VIRTUAL_W, MB.data.VIRTUAL_H); };
})();

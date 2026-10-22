/*
 * MemoryBurn - js/input/input.js
 *
 * Keyboard, mouse and gamepad, turned into the sim's input shape. Mouse coordinates are in virtual
 * space (1920x1080); main.js keeps MB.input.view in sync with the letterbox.
 *
 *   MB.input.attach(canvas)
 *   MB.input.poll()                    once per rendered frame, before UI/sim reads
 *   MB.input.endFrame()                clears edge flags (pressed / clicked)
 *   MB.input.down(code) / pressed(code)
 *   MB.input.mouse  {x, y, down, clicked, released, rdown, wheel}
 *   MB.input.sample(player, settings) -> {mx, my, dash, aimX, aimY, fire, manual}
 */
(function () {
  'use strict';
  var I = MB.input = {};
  var keys = Object.create(null), edges = Object.create(null);
  var mouse = I.mouse = { x: 960, y: 540, down: false, clicked: false, released: false, rdown: false, wheel: 0, moved: false };
  I.view = { scale: 1, ox: 0, oy: 0 };
  I.pad = null;       // last seen gamepad snapshot {mx, my, ax, ay, dash, start, a, b, back}
  I.usingPad = false; // flips to the last device that produced input
  var padPrev = {};

  // keys the browser should not act on while the game has focus
  var DASH_KEYS = { Space: 1, ShiftLeft: 1, ShiftRight: 1 };
  var dashLatch = false;
  var GRAB = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };

  function toVirtual(e, canvas) {
    var r = canvas.getBoundingClientRect(), v = I.view;
    var dpr = canvas.width / r.width;
    mouse.x = ((e.clientX - r.left) * dpr - v.ox) / v.scale;
    mouse.y = ((e.clientY - r.top) * dpr - v.oy) / v.scale;
  }

  I.attach = function (canvas) {
    window.addEventListener('keydown', function (e) {
      if (!keys[e.code]) { edges[e.code] = true; if (DASH_KEYS[e.code]) dashLatch = true; }
      keys[e.code] = true; I.usingPad = false;
      if (GRAB[e.code]) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { keys = Object.create(null); mouse.down = false; mouse.rdown = false; });
    canvas.addEventListener('pointermove', function (e) { toVirtual(e, canvas); mouse.moved = true; I.usingPad = false; });
    canvas.addEventListener('pointerdown', function (e) {
      toVirtual(e, canvas); canvas.focus();
      if (e.button === 2) { mouse.rdown = true; dashLatch = true; } else { mouse.down = true; mouse.clicked = true; }
      I.usingPad = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    });
    window.addEventListener('pointerup', function (e) {
      if (e.button === 2) mouse.rdown = false; else { if (mouse.down) mouse.released = true; mouse.down = false; }
    });
    canvas.addEventListener('wheel', function (e) { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  I.down = function (code) { return !!keys[code]; };
  I.pressed = function (code) { return !!edges[code]; };
  I.anyPressed = function (codes) { for (var i = 0; i < codes.length; i++) if (edges[codes[i]]) return true; return false; };
  // UI-level actions so screens don't care about the device
  I.back = function () { return I.pressed('Escape') || I.padPressed('b') || I.padPressed('start'); };
  I.confirm = function () { return I.pressed('Enter') || I.pressed('NumpadEnter') || I.padPressed('a'); };

  function dz(v) { return Math.abs(v) < 0.2 ? 0 : v; }
  I.poll = function () {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    if (!gp) { I.pad = null; return; }
    var b = function (n) { return !!(gp.buttons[n] && gp.buttons[n].pressed); };
    var pad = {
      mx: dz(gp.axes[0] || 0), my: dz(gp.axes[1] || 0), ax: dz(gp.axes[2] || 0), ay: dz(gp.axes[3] || 0),
      a: b(0), b: b(1), dash: b(0) || b(4) || b(6), start: b(9), back: b(8), fire: b(7) || b(5),
      up: b(12), down: b(13), left: b(14), right: b(15)
    };
    pad.edge = {};
    var EDGE = ['a', 'b', 'start', 'back', 'up', 'down', 'left', 'right'];
    EDGE.forEach(function (k) { pad.edge[k] = pad[k] && !padPrev[k]; });
    padPrev = {}; EDGE.forEach(function (k) { padPrev[k] = pad[k]; });
    if (pad.mx || pad.my || pad.ax || pad.ay || pad.a || pad.b || pad.start) I.usingPad = true;
    I.pad = pad;
  };
  I.padPressed = function (k) { return !!(I.pad && I.pad.edge[k]); };

  // Drop this frame's edges so an input that changed screens is not seen again by the new screen.
  I.flush = function () {
    edges = Object.create(null); mouse.clicked = false; dashLatch = false;
    if (I.pad) I.pad.edge = {};
  };

  I.endFrame = function () {
    edges = Object.create(null);
    mouse.clicked = false; mouse.released = false; mouse.wheel = 0; mouse.moved = false;
  };

  // Build one sim input for the local player. `player` is the sim player (for aim relative to it).
  I.sample = function (player, settings) {
    var mx = 0, my = 0;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS || keys.ArrowDown) my += 1;
    var dash = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || mouse.rdown || dashLatch);
    dashLatch = false; // a tap is held until one sim step has seen it, even if it was shorter than a frame
    var aimX = mouse.x, aimY = mouse.y, fire = mouse.down;
    var pad = I.pad;
    if (pad) {
      if (pad.mx || pad.my) { mx = pad.mx; my = pad.my; }
      dash = dash || pad.dash;
      if (pad.ax || pad.ay) { aimX = player.x + pad.ax * 300; aimY = player.y + pad.ay * 300; fire = true; }
      else if (I.usingPad) { aimX = player.aimX; aimY = player.aimY; }
      fire = fire || pad.fire;
    }
    return { mx: mx, my: my, dash: dash, aimX: aimX, aimY: aimY, fire: !!fire, manual: !!settings.manualFire };
  };
})();

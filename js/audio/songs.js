/*
 * MemoryBurn - js/audio/songs.js
 *
 * The soundtrack as data: synth patches, scales and one song per screen, district and boss. Every song
 * quotes the same four-bar "memory" motif (MOTIF below) in its own key, scale and tempo, so the plug
 * ending can play it in major and the smash ending can leave half of it out. js/audio/music.js plays
 * these with live Web Audio voices; tools/headless.mjs audio checks that every bar adds up.
 *
 * Song fields:
 *   bpm root scale kit swing     root is the bass-register MIDI note; kit is a MB.sounds.KITS name
 *   form 'AABA'                  one letter per 4-bar phrase; prog[letter] lists chord roots (scale degrees) per bar
 *   fixed | ramp [start, perBar, max]   intensity for screen songs; play songs follow the fight instead
 *   drums [[drum, pattern, minIntensity, gain]]   pattern: X accent, x hit, o ghost, . rest. A 16-step
 *                                pattern follows the bar; any other length cycles freely (polyrhythm)
 *   fill [drum, pattern, min]    replaces nothing, adds a roll on the last bar of a phrase
 *   bass / arp {patch, o, p, min}   p digits pick chord tones (0 root 1 third 2 fifth 3 octave 4 tenth
 *                                5 twelfth 6 two octaves 7 seventh), - holds, . rests; o = octaves above root
 *   pad {patch, o, p, min, sev}  p: x strikes the chord, - holds; sev adds the seventh
 *   mel [{patch, o, min, A: [bar, bar, bar, bar], B: [...]}]   bars are 'degree:steps' tokens, '.' rests,
 *                                degrees count from the song root (0 = tonic, 7 = octave, -1 = below)
 *   pump  sidechain depth on kick hits      echo  delay in beats      fb  delay feedback   gain  song level
 */
(function () {
  'use strict';
  var SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10],
    phrdom: [0, 1, 4, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11], major: [0, 2, 4, 5, 7, 9, 11]
  };

  // t: 'sub' subtractive, 'fm' two-operator FM, 'pad' a whole chord through one filter.
  // cut/env filter base and envelope depth (Hz), dec/sus/a/rel amp and filter shape, gate = note length used,
  // n/det unison voices and spread (cents), vib [rate, cents, delay], echo/verb sends, pump follows the kick.
  var PATCH = {
    saw: { t: 'sub', w: 'sawtooth', cut: 380, env: 1500, q: 4, dec: 0.16, sus: 0.5, a: 0.004, rel: 0.06, g: 0.26, gate: 0.85, pump: 1 },
    acid: { t: 'sub', w: 'sawtooth', cut: 240, env: 2700, q: 13, dec: 0.13, sus: 0.6, a: 0.003, rel: 0.04, g: 0.22, gate: 0.8, pump: 1, accent: 1 },
    reese: { t: 'sub', w: 'sawtooth', n: 2, det: 24, cut: 360, env: 300, q: 3, dec: 0.6, sus: 0.85, a: 0.02, rel: 0.14, g: 0.24, gate: 1, sub: 0.6 },
    sub: { t: 'sub', w: 'triangle', cut: 900, env: 200, q: 0.7, dec: 0.3, sus: 0.8, a: 0.008, rel: 0.14, g: 0.42, gate: 0.95, sub: 0.5 },
    fmbass: { t: 'fm', ratio: 1, idx: 2.6, idxEnd: 0.4, idxDec: 0.18, dec: 0.25, sus: 0.5, a: 0.003, rel: 0.08, g: 0.32, gate: 0.85 },
    pulse: { t: 'sub', w: 'square', cut: 1100, env: 1900, q: 3, dec: 0.09, sus: 0.15, a: 0.002, rel: 0.05, g: 0.09, gate: 0.6, echo: 0.3, pump: 1 },
    pluck: { t: 'sub', w: 'sawtooth', cut: 480, env: 3800, q: 5, dec: 0.12, sus: 0, a: 0.002, rel: 0.1, g: 0.11, gate: 0.5, echo: 0.35, verb: 0.2 },
    glass: { t: 'fm', ratio: 3.5, idx: 2.4, idxEnd: 0.1, idxDec: 0.35, dec: 0.6, sus: 0, a: 0.002, rel: 0.4, g: 0.11, gate: 1, echo: 0.4, verb: 0.35 },
    bell: { t: 'fm', ratio: 2.76, idx: 4, idxEnd: 0.2, idxDec: 1.1, dec: 1.8, sus: 0, a: 0.002, rel: 1.2, g: 0.09, gate: 1, echo: 0.3, verb: 0.5 },
    epiano: { t: 'fm', ratio: 1, idx: 1.8, idxEnd: 0.3, idxDec: 0.6, dec: 1.4, sus: 0.25, a: 0.004, rel: 0.4, g: 0.09, gate: 1, verb: 0.25 },
    padSaw: { t: 'pad', w: 'sawtooth', n: 2, det: 14, cut: 1300, q: 1, a: 0.35, rel: 0.9, g: 0.045, pump: 1, verb: 0.35, lfo: [0.15, 500] },
    padWarm: { t: 'pad', w: 'triangle', n: 2, det: 8, cut: 2400, q: 0.7, a: 0.8, rel: 1.4, g: 0.08, verb: 0.5 },
    padDark: { t: 'pad', w: 'sawtooth', n: 2, det: 20, cut: 520, q: 3, a: 1.2, rel: 1.6, g: 0.055, verb: 0.5, lfo: [0.08, 260] },
    choir: { t: 'pad', w: 'sawtooth', n: 3, det: 12, cut: 950, q: 6, ft: 'bandpass', a: 0.5, rel: 1, g: 0.11, verb: 0.6 },
    stab: { t: 'pad', w: 'sawtooth', n: 2, det: 16, cut: 900, env: 3200, dec: 0.12, q: 2, a: 0.004, rel: 0.12, g: 0.06, pump: 1, verb: 0.3, echo: 0.25 },
    leadSaw: { t: 'sub', w: 'sawtooth', n: 2, det: 9, cut: 2200, env: 1600, q: 2.5, dec: 0.3, sus: 0.65, a: 0.01, rel: 0.18, g: 0.09, gate: 0.92, vib: [5.5, 16, 0.25], echo: 0.35, verb: 0.3, glide: 0.03 },
    leadSq: { t: 'sub', w: 'square', cut: 1800, env: 1400, q: 2, dec: 0.22, sus: 0.55, a: 0.006, rel: 0.12, g: 0.075, gate: 0.9, vib: [6, 14, 0.2], echo: 0.3, verb: 0.2 },
    leadSine: { t: 'sub', w: 'sine', cut: 6000, env: 0, q: 0.5, dec: 0.4, sus: 0.8, a: 0.03, rel: 0.3, g: 0.15, gate: 0.95, vib: [5, 22, 0.3], echo: 0.45, verb: 0.45 }
  };
  var DRUM_GAIN = { kick: 0.55, snare: 0.32, clap: 0.3, hat: 0.11, ohat: 0.09, rim: 0.16, tom: 0.3, shaker: 0.09, crash: 0.13, perc: 0.15, wood: 0.17, zap: 0.08 };

  /* ------------------------------------------------------------------ the memory motif and its variations */
  // In A minor: E C B A G | A C E A G E | E F E C B | A.  Played in every song, transposed by its scale.
  var M1 = '4:4 2:2 1:2 0:6 -1:2', M2 = '0:2 2:2 4:2 7:4 6:2 4:4', M3 = '4:4 5:2 4:2 2:6 1:2', M4 = '0:12 .:4';
  var MOTIF = [M1, M2, M3, M4], REST = '.:16';
  function halve(bar) { // same notes at double speed: 8 steps
    return bar.split(' ').map(function (tk) { var p = tk.split(':'); return p[0] + ':' + (+p[1] / 2); }).join(' ');
  }
  function fast(a, b) { return halve(a) + ' ' + halve(b); }
  function shift(bar, n) { // move every degree by n scale steps
    return bar.split(' ').map(function (tk) { var p = tk.split(':'); return (p[0] === '.' ? '.' : String(+p[0] + n)) + ':' + p[1]; }).join(' ');
  }
  function stretch(bar) { // twice as slow: returns two bars
    var out = [], cur = [], n = 0;
    bar.split(' ').forEach(function (tk) {
      var p = tk.split(':'), len = +p[1] * 2, first = true;
      while (len > 0) { // a note that crosses the bar line rests for its remainder
        var take = Math.min(len, 16 - n);
        cur.push((first ? p[0] : '.') + ':' + take);
        n += take; len -= take; first = false;
        if (n === 16) { out.push(cur.join(' ')); cur = []; n = 0; }
      }
    });
    if (cur.length) out.push(cur.join(' '));
    return out;
  }
  var SLOW = stretch(M1).concat(stretch(M2)); // the first half of the motif over four bars

  var list = {
    /* ---------------------------------------------------------------- screens */
    menu: {
      title: 'Forty Eddies a Hit', gain: 1.2, bpm: 100, root: 45, scale: 'minor', kit: 'neon', pump: 0.45, echo: 0.75, fb: 0.38,
      form: 'AABA', prog: { A: [0, 5, 2, 6], B: [3, 5, 0, 4] }, ramp: [0.3, 0.04, 0.9],
      drums: [['kick', 'X...x...X...x...', 0.45], ['clap', '....x.......x...', 0.5], ['hat', '..x...x...x...x.', 0.4],
        ['hat', 'o.o.o.o.o.o.o.o.', 0.7], ['ohat', '......x.......x.', 0.8]],
      fill: ['snare', '........x.x.xxXX', 0.6], crash: 0.55,
      bass: { patch: 'saw', o: 0, p: '0.3.0.3.0.3.0.3.', min: 0.35 },
      pad: { patch: 'padSaw', o: 1, p: 'x---------------', min: 0 },
      arp: { patch: 'pulse', o: 2, p: '0123210301232103', min: 0.25 },
      mel: [{ patch: 'leadSaw', o: 2, min: 0.6, A: MOTIF, B: ['7:6 6:2 5:4 4:4', '5:6 4:2 2:4 4:4', '3:6 2:2 1:4 2:4', '4:8 .:8'] }]
    },
    story: {
      title: 'Doc\'s Table', gain: 0.45, bpm: 72, root: 38, scale: 'dorian', kit: 'soft', echo: 0.75, fb: 0.45, fixed: 0.45,
      form: 'AB', prog: { A: [0, 0, 3, 3], B: [5, 6, 0, 4] },
      drums: [['shaker', '..x...x...x...x.', 0.6], ['rim', '........x.......', 0.7]],
      bass: { patch: 'sub', o: 0, p: '0-------2-------', min: 0 },
      pad: { patch: 'padWarm', o: 1, p: 'x---------------', min: 0, sev: true },
      arp: { patch: 'glass', o: 2, p: '0...2...1...3...', min: 0.3 },
      mel: [{ patch: 'bell', o: 3, min: 0.4, A: [M1, REST, M3, REST], B: [REST, M2, REST, M4] }]
    },
    shop: {
      title: 'Back-Alley Market', gain: 0.65, bpm: 86, root: 41, scale: 'dorian', kit: 'lofi', swing: 0.2, echo: 0.5, fb: 0.3, fixed: 0.62,
      form: 'AABA', prog: { A: [0, 3, 6, 2], B: [5, 4, 3, 3] },
      drums: [['kick', 'X.....x...x..o..', 0], ['snare', '....X.......X...', 0], ['hat', 'xoxoxoxoxoxoxoxo', 0], ['rim', '.......o.....o..', 0.5]],
      bass: { patch: 'sub', o: 0, p: '0.....0.2...3.2.', min: 0 },
      pad: { patch: 'epiano', o: 1, p: 'x.....x...x-----', min: 0, sev: true },
      mel: [{ patch: 'leadSine', o: 2, min: 0.55, A: ['4:3 2:1 1:2 0:6 .:4', REST, M3, REST], B: [REST, '7:3 6:1 5:2 4:6 .:4', REST, '2:3 1:1 0:12'] }]
    },
    brief: {
      title: 'Contract', gain: 1.0, bpm: 120, root: 40, scale: 'phryg', kit: 'neon', echo: 0.75, fb: 0.4, fixed: 0.5,
      form: 'AB', prog: { A: [0, 0, 1, 0], B: [5, 5, 6, 1] },
      drums: [['hat', '..x...x...x...x.', 0], ['rim', 'x..x..x.', 0.3], ['kick', 'x.......x.......', 0.4]],
      bass: { patch: 'saw', o: 0, p: '0.00.00.0.00.00.', min: 0 },
      pad: { patch: 'padDark', o: 1, p: 'x---------------', min: 0 },
      mel: [{ patch: 'bell', o: 3, min: 0.4, A: [M1, REST, REST, REST], B: [M3, REST, REST, REST] }]
    },

    /* ---------------------------------------------------------------- districts */
    neon: {
      title: 'Neon Grid', gain: 0.87, bpm: 128, root: 45, scale: 'minor', kit: 'neon', pump: 0.55, echo: 0.75, fb: 0.35,
      form: 'AABA', prog: { A: [0, 5, 2, 6], B: [3, 4, 5, 6] },
      drums: [['kick', 'X...x...X...x...', 0], ['clap', '....x.......x...', 0.3], ['hat', '..x...x...x...x.', 0.15],
        ['hat', 'o.ox' + 'o.ox' + 'o.ox' + 'o.ox', 0.65], ['ohat', '..x...x...x...x.', 0.82]],
      fill: ['tom', '..........x.x.xx', 0.55], crash: 0.6,
      bass: { patch: 'saw', o: 0, p: '0.3.0.3.0.3.0.3.', min: 0 },
      pad: { patch: 'padSaw', o: 1, p: 'x---------------', min: 0.2 },
      arp: { patch: 'pulse', o: 2, p: '0123012301230123', min: 0.42 },
      mel: [{ patch: 'leadSaw', o: 2, min: 0.7, A: MOTIF, B: ['7:4 6:4 4:4 2:4', '3:4 4:4 5:8', '4:4 2:4 1:4 -1:4', '0:16'] }]
    },
    rain: {
      title: 'Rain Alley', gain: 0.6, bpm: 172, root: 43, scale: 'minor', kit: 'rain', echo: 1.5, fb: 0.4,
      form: 'AABB', prog: { A: [0, 5, 3, 4], B: [5, 6, 0, 0] },
      drums: [['kick', ['x.........x.....', 'x.........x..x..'], 0.3], ['snare', '....X.......X...', 0.3], ['hat', '..x...x...x...x.', 0.15],
        ['hat', 'o.o.o.o.o.o.o.o.', 0.55], ['snare', '.......o.o....o.', 0.65, 0.5], ['shaker', 'xoxoxoxoxoxoxoxo', 0.75]],
      fill: ['snare', '........xxxxXXXX', 0.6], crash: 0.7,
      bass: { patch: 'reese', o: 0, p: '0-----------3---', min: 0 },
      pad: { patch: 'padDark', o: 1, p: 'x---------------', min: 0 },
      arp: { patch: 'glass', o: 2, p: '0..2..1..3..2...', min: 0.5 },
      mel: [{ patch: 'leadSine', o: 2, min: 0.65, A: SLOW, B: ['7:8 6:4 4:4', '5:12 .:4', '4:8 2:4 1:4', '0:16'] }]
    },
    dust: {
      title: 'Dust Slums', gain: 0.76, bpm: 96, root: 40, scale: 'phrdom', kit: 'dust', echo: 0.75, fb: 0.3,
      form: 'AABA', prog: { A: [0, 0, 1, 0], B: [6, 5, 1, 0] },
      drums: [['kick', 'X..x....x.x.....', 0], ['snare', '....X.......X...', 0.2], ['perc', '..x...x..x...x..', 0.45],
        ['hat', 'x.x.x.x.x.x.x.x.', 0.35], ['shaker', '.x.x.x.x.x.x.x.x', 0.8]],
      fill: ['tom', '............xxXX', 0.55], crash: 0.75,
      bass: { patch: 'fmbass', o: 0, p: '0..0..0.0..1.0..', min: 0 },
      pad: { patch: 'choir', o: 1, p: 'x---------------', min: 0.5 },
      mel: [{ patch: 'leadSq', o: 2, min: 0.6,
        A: ['0:2 1:2 2:2 1:2 0:4 -1:2 0:2', '4:4 3:2 2:2 1:4 0:4', '0:2 1:2 2:2 3:2 4:4 5:2 4:2', '2:2 1:2 0:12'], B: MOTIF }]
    },
    vine: {
      title: 'Vine Mesh', gain: 0.72, bpm: 112, root: 38, scale: 'dorian', kit: 'vine', echo: 0.5, fb: 0.35,
      form: 'AABA', prog: { A: [0, 3, 0, 4], B: [5, 6, 3, 0] },
      drums: [['kick', 'x.....x...x.....', 0], ['rim', 'x..x..x..x..', 0.3], ['wood', '..x.....', 0.5], ['shaker', 'oxoxoxox', 0.4],
        ['snare', '....x.......x...', 0.55], ['tom', '..............x.', 0.75]],
      fill: ['wood', '........x.x.xxxx', 0.6],
      bass: { patch: 'sub', o: 0, p: '0.....0...2.....', min: 0 },
      arp: { patch: 'pluck', o: 2, p: '012301230123', min: 0.2 },
      pad: { patch: 'padWarm', o: 1, p: 'x---------------', min: 0.35, sev: true },
      mel: [{ patch: 'glass', o: 3, min: 0.65, A: MOTIF, B: ['2:2 4:2 7:4 6:4 4:4', '5:4 4:4 2:8', '3:2 4:2 5:4 4:4 2:4', '0:16'] }]
    },
    jet: {
      title: 'Jetstream', gain: 0.78, bpm: 138, root: 36, scale: 'minor', kit: 'jet', pump: 0.7, echo: 0.75, fb: 0.4,
      form: 'AABA', prog: { A: [0, 5, 6, 4], B: [5, 6, 0, 0] },
      drums: [['kick', 'X...X...X...X...', 0], ['ohat', '..x...x...x...x.', 0.25], ['clap', '....x.......x...', 0.4],
        ['hat', 'oxoxoxoxoxoxoxox', 0.6]],
      fill: ['snare', 'x.x.x.x.xxxxXXXX', 0.55], crash: 0.6,
      bass: { patch: 'saw', o: 0, p: '.000.000.000.000', min: 0 },
      pad: { patch: 'stab', o: 1, p: 'x..x..x...x..x..', min: 0.45 },
      arp: { patch: 'pulse', o: 2, p: '0123432101234321', min: 0.3 },
      mel: [{ patch: 'leadSaw', o: 2, min: 0.7, A: [fast(M1, M2), fast(M3, M4), M1, M2], B: [shift(M1, 2), shift(M2, 2), M3, M4] }]
    },
    core: {
      title: 'Reactor Core', gain: 0.85, bpm: 146, root: 35, scale: 'phryg', kit: 'core', echo: 0.75, fb: 0.45,
      form: 'AABA', prog: { A: [0, 0, 0, 1], B: [5, 1, 6, 0] },
      drums: [['kick', 'X...X...X...X...', 0], ['perc', '..x..x..x..x.x..', 0.3], ['ohat', '..x...x...x...x.', 0.2],
        ['clap', '....x.......x...', 0.55], ['zap', '.......x.......x', 0.75], ['hat', 'xxxxxxxxxxxxxxxx', 0.85]],
      fill: ['perc', '........x.x.xxxx', 0.6], crash: 0.65,
      bass: { patch: 'acid', o: 0, p: '0030030000300307', min: 0 },
      pad: { patch: 'choir', o: 1, p: 'x---------------', min: 0.6 },
      mel: [
        { patch: 'bell', o: 3, min: 0.5, A: ['0:2 .:2 1:2 .:10', REST, '0:2 .:2 1:2 .:2 0:2 .:6', REST], B: [REST, REST, REST, REST] },
        { patch: 'leadSq', o: 2, min: 0.8, A: [REST, REST, REST, REST], B: MOTIF }
      ]
    },
    midnight: {
      title: 'Midnight District', gain: 0.92, bpm: 116, root: 37, scale: 'minor', kit: 'mid', echo: 0.75, fb: 0.42,
      form: 'AABA', prog: { A: [0, 5, 6, 4], B: [3, 5, 6, 6] },
      drums: [['kick', 'x.......x.x.....', 0], ['snare', '....X.......X...', 0.2], ['hat', '..x...x...x...x.', 0.3],
        ['shaker', 'oxoxoxoxoxoxoxox', 0.6]],
      fill: ['tom', '........x..x.xxx', 0.55], crash: 0.7,
      bass: { patch: 'saw', o: 0, p: '0.0.0.0.0.0.0.0.', min: 0 },
      pad: { patch: 'padSaw', o: 1, p: 'x---------------', min: 0 },
      arp: { patch: 'glass', o: 2, p: '0.1.2.3.2.1.0.1.', min: 0.5 },
      mel: [{ patch: 'leadSaw', o: 2, min: 0.55, A: MOTIF, B: ['7:6 6:2 4:8', '5:6 4:2 3:8', '4:6 2:2 1:4 -1:4', '0:16'] }]
    },

    /* ---------------------------------------------------------------- Lethe's bosses (transposed per act) */
    boss: {
      title: 'Lethe & Sons', gain: 0.63, bpm: 160, root: 38, scale: 'harm', kit: 'boss', pump: 0.35, echo: 0.5, fb: 0.3,
      form: 'AABA', prog: { A: [0, 0, 5, 4], B: [3, 5, 1, 4] },
      drums: [['kick', 'X..xX..xX..xX.xx', 0], ['snare', '....X.......X...', 0], ['hat', 'xxxxxxxxxxxxxxxx', 0.5],
        ['perc', '...x...x...x...x', 0.85]],
      fill: ['tom', '........xxxxXXXX', 0.5], crash: 0.5,
      bass: { patch: 'acid', o: 0, p: '0.00.00.0.00.0.3', min: 0 },
      pad: { patch: 'choir', o: 1, p: 'x---------------', min: 0 },
      mel: [
        { patch: 'leadSq', o: 2, min: 0.75, A: MOTIF, B: ['7:2 6:2 7:2 4:2 5:4 4:4', '3:2 2:2 3:2 1:2 2:4 -1:4', '0:2 1:2 2:2 4:2 6:4 7:4', '4:16'] },
        { patch: 'bell', o: 3, min: 0.9, A: [REST, REST, M1, REST], B: [M1, REST, M3, REST] }
      ]
    },

    /* ---------------------------------------------------------------- the end */
    vault: {
      title: 'Clause 14', gain: 0.42, bpm: 76, root: 45, scale: 'minor', kit: 'soft', echo: 0.75, fb: 0.45,
      form: 'AB', prog: { A: [5, 6, 0, 0], B: [3, 5, 6, 4] },
      drums: [['kick', 'x.......x.......', 0.55], ['rim', '....x.......x...', 0.6], ['shaker', '..x...x...x...x.', 0.7]],
      bass: { patch: 'sub', o: 0, p: '0-------0---2---', min: 0 },
      pad: { patch: 'padWarm', o: 1, p: 'x---------------', min: 0, sev: true },
      arp: { patch: 'glass', o: 2, p: '0.2.1.3.', min: 0.3 },
      mel: [{ patch: 'leadSine', o: 2, min: 0.35, A: MOTIF, B: ['7:8 6:4 4:4', '5:8 4:4 2:4', '3:8 2:4 1:4', '0:16'] }]
    },
    plug: {
      title: 'Everything Back', gain: 0.59, bpm: 80, root: 45, scale: 'major', kit: 'soft', echo: 0.75, fb: 0.45, fixed: 0.75,
      form: 'AABA', prog: { A: [0, 4, 5, 3], B: [3, 4, 0, 0] },
      drums: [['kick', 'x.......x.x.....', 0.5], ['rim', '....x.......x...', 0.5], ['shaker', 'oxoxoxoxoxoxoxox', 0.6]],
      bass: { patch: 'sub', o: 0, p: '0.......0...2...', min: 0 },
      pad: { patch: 'padWarm', o: 1, p: 'x---------------', min: 0, sev: true },
      arp: { patch: 'glass', o: 2, p: '0123', min: 0.5 },
      mel: [{ patch: 'leadSine', o: 2, min: 0.3, A: MOTIF, B: ['7:4 9:4 7:4 4:4', '5:4 4:4 2:8', '4:4 5:2 4:2 2:4 1:4', '0:16'] },
        { patch: 'bell', o: 3, min: 0.6, A: [REST, M2, REST, M4], B: [M1, REST, M3, REST] }]
    },
    smash: {
      title: 'Nine', gain: 0.44, bpm: 64, root: 45, scale: 'dorian', kit: 'soft', echo: 1, fb: 0.5, fixed: 0.4,
      form: 'AB', prog: { A: [0, 3, 0, 3], B: [5, 6, 0, 0] },
      drums: [],
      bass: { patch: 'sub', o: 0, p: '0---------------', min: 0 },
      pad: { patch: 'padWarm', o: 1, p: 'x---------------', min: 0 },
      mel: [{ patch: 'glass', o: 3, min: 0, A: [M1, REST, REST, REST], B: [REST, REST, M4, REST] }]
    },
    flatline: {
      title: 'Flatline', gain: 1.2, bpm: 60, root: 33, scale: 'minor', kit: 'soft', echo: 1, fb: 0.5, fixed: 0.5,
      form: 'A', prog: { A: [0, 0, 5, 4] },
      drums: [['kick', 'x..x............', 0, 0.7]],
      pad: { patch: 'padDark', o: 1, p: 'x---------------', min: 0 },
      mel: [{ patch: 'bell', o: 3, min: 0, A: [M1, REST, REST, REST] }]
    }
  };

  var DISTRICT = { 'Neon Grid': 'neon', 'Rain Alley': 'rain', 'Dust Slums': 'dust', 'Vine Mesh': 'vine', 'Jetstream': 'jet', 'Reactor Core': 'core', 'Midnight District': 'midnight' };
  var BOSS_KEY = [0, 3, 5, 7]; // semitones up for the Appraiser, the Auctioneer, the Archivist, then Afterburn

  MB.songs = { list: list, SCALES: SCALES, PATCH: PATCH, DRUM_GAIN: DRUM_GAIN, MOTIF: MOTIF, DISTRICT: DISTRICT, BOSS_KEY: BOSS_KEY };
})();

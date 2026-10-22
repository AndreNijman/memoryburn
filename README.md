# Memory Burn

A cyberpunk wave-survival shooter. Somebody burned out your memory and Lethe & Sons is selling it as shards at forty eddies a hit. You fight through 15 timed contracts across seven districts to get it back, spending eddies in the Back-Alley Market between waves. After the campaign ends, Afterburn keeps the run going.

This is a browser port of the original pygame game, which shipped as `MemoryBurn.exe`. It uses plain JavaScript and `<canvas>`, with no build step and no dependencies. Every sprite is drawn in code, in a chunky outlined style with flat colours, round bodies and blob enemies with eyes.

## Running it

Open `index.html` in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

URL flags:

| Flag | Effect |
| --- | --- |
| `?debug` | Turns on the debug keys: `8` ends the current contract, `9` adds 100 eddies |
| `?seed=N` | Uses a fixed run seed |
| `?screen=shop&arch=3` | Opens a screen directly (`menu chars difficulty play shop preview pause gameover`); used for screenshots |

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | WASD or arrow keys | Left stick |
| Dash | Space, Shift or right mouse | A, LB, LT |
| Aim | Mouse | Right stick |
| Fire | Automatic. With Manual Fire on, hold the left mouse button | RT or RB |
| Pause | Esc | Start |
| Menus | Mouse, arrow keys and Enter | D-pad and A |

## Layout

```
index.html               page shell; loads the scripts in manifest order and waits for the fonts
scripts.manifest.json    script order; env "any" scripts must run without a DOM
js/core/mb.js            MB namespace, seeded RNG (mulberry32), cosmetic RNG, math utils
js/data/data.js          content and tuning, copied value for value from the original
js/data/story.js         the campaign script: contracts, scenes, radio lines, ending (new; see docs/story.md)
js/sim/sim.js            the game rules (deterministic)
js/sim/bot.js            autopilot, used by the menu background and the tests
js/render/sprites.js     procedural sprites baked to offscreen canvases, plus district floors
js/render/icons.js       shop and stat icons
js/render/fx.js          particles, splats, damage numbers, shake, weather (cosmetic only)
js/render/render.js      draws the arena from sim state with interpolation
js/input/input.js        keyboard, mouse and gamepad turned into sim inputs
js/ui/ui.js              immediate-mode canvas widgets
js/ui/screens.js         every screen plus the HUD
js/ui/radio.js           in-wave radio chatter driven by the script and sim events
js/main.js               fixed-step loop, screen state machine, settings
docs/story.md            story bible: premise, cast, reveal order, rules for new lines
reference/               recovered original source and the bytecode checker used to verify it
tools/                   headless tests, browser playtest, benchmark, screenshot helper, sprite sheet
```

### Ready for multiplayer

The sim is written so that a host-authoritative online mode (the model broIsAPotato uses) can be added without touching the game rules:

- Each step is fixed and every random roll comes from a seeded RNG, so the same seed and inputs always produce the same game. The sim never reads `Math.random`, `Date` or the DOM.
- State is plain JSON: it can be snapshotted, sent over the network and restored.
- Each player is a slot in `state.players` with their own stats, cash, shop and ready flag. Enemies chase the nearest living player. Waves and shops move on only when every player is ready.
- The UI changes the game only through `app.cmd({t: 'buy' | 'lock' | 'reroll' | 'ready' | 'deploy', ...})`, and each frame's input reaches the sim as one input object per slot. A network layer would replace those two calls.

## Tests

```sh
node tools/headless.mjs      # sim: determinism, bot runs, all 8 characters, 4-player co-op, shop, story data, snapshots
node tools/playtest.mjs      # browser: real clicks and keys through menu > story > run > pause > shop > briefing > ending > game over
node tools/shot.mjs 'index.html?screen=shop' out.png 1920 1080   # screenshot
node tools/bench.mjs         # frame rate and per-system JS cost in a crowded wave 12 (flags in the file header)
```

Headless Chromium draws the canvas on the CPU, so the bench's fps is a worst case. Add `BENCH_ARGS='--disable-gpu-vsync --disable-frame-rate-limit'` to measure uncapped, or `BENCH_ARGS='--headless=new --enable-gpu --ignore-gpu-blocklist'` to use the GPU.

The browser tools use Playwright. If it isn't installed here, they borrow it from `../tree/node_modules`.

## Differences from the original

### Bugs fixed

- **Suicide enemies:** they now die after bursting. The original set their HP to 0 but kept them alive, so they burst again every frame.
- **Aegis enemies:** they now walk toward the player at 70% speed. The original had no movement code for Aegis, so they stayed on the arena edge forever.
- **Junk Saint:** the pickup-radius bonus is now applied. The original never read it.
- **Shop locks:** clicking a card's padlock no longer also buys the card.
- **Pets and lifesteal:** pets orbit on game time instead of the wall clock. Lifesteal, enemy wobble phase and pickup scatter use the game's seeded RNG.
- **Aim Assist:** with Manual Fire on, it snaps your aim to the nearest enemy within about 16° of the cursor. In the original the option did nothing.

### Kept on purpose

These are original behaviours. They change the balance but aren't crashes, so they stay:

- Reactor Core's heat drain can't take you below 1 HP.
- The magnet drone's pickup range keeps growing.
- Piercing bullets can hit the same enemy again on later frames.
- The Overlord has normal enemy HP.
- Rerolling with locked cards rolls the unlocked slots without your wave or luck bonus.
- Blue XP pickups give nothing.
- Small +damage% items can round to no change at low damage (for example 16 × 1.06 truncates to 16).

### New in this port

- **The story.** The original had 15 one-line beats and no ending. The port has a written campaign in three acts:
  - Named contracts, each with a scheduled district.
  - Three named bosses.
  - Story scenes with speaker portraits.
  - Radio chatter during waves, with its own toggle in Options.
  - Doc's opening and closing lines depend on your archetype.
  - The game-over line depends on how far you got.
  - The ending is a choice, followed by Afterburn for endless play.

  See `docs/story.md`. The sim reads only the district schedule. It still makes the same random roll it made before, so the RNG stream is unchanged.
- A fixed 60 Hz simulation with interpolated rendering.
- Procedural sprites and per-district floors, weather and lighting.
- A shop stats panel and per-card stat previews, computed by applying the item to a copy of the player with the real game code.
- Gamepad and keyboard menu navigation.
- A Resolution option. On Auto, the game renders at native resolution and lowers it when frames run slow.

### Performance

On the CPU renderer, a crowded wave 12 went from 17 fps to about 53 fps uncapped at 1080p, with the same picture. The changes:

- The floor, rim vignette and border are drawn once per district into a canvas at screen resolution, then copied 1:1 each frame.
- Each sprite has a half-size copy, made once with high-quality filtering. Sprites then draw with cheap bilinear filtering, which removes the per-frame cost of 'high' smoothing.
- Particles and damage numbers draw from small cached images, not from paths and stroked text.
- District lighting and the hurt flash use gradients baked once at low resolution.
- The render loop reuses its sort records and interpolated positions instead of allocating them every frame. Effect lists are compacted in place.
- The sim removes dead enemies in one pass per step, not once per bullet hit. Run hashes are unchanged.
- Settings saved in the browser.
- A menu background where the autopilot plays the game.
- Co-op-ready game rules (see above).

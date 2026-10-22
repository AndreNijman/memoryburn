# Memory Burn: story bible

All the lines live in `js/data/story.js`, so edit them there. This file covers what the lines rely on: the premise, the cast, what the player learns and when, and where each kind of text appears.

## Premise

Lethe & Sons runs memory pawnshops. People sell memories they don't need, and Lethe presses them into shards that anyone can plug in and live. If you miss a payment on a memory loan, Lethe takes the collateral.

You wake up on Doc's table with your memory burned out and a barcode on your neck: LOT C-9. Lethe is selling your life as a premium shard line called CIPHER. Lethe's repo crews collect burned donors for parts, which is why the waves keep coming. Lucky, a bookie who also sells jobs, bets on you and sends you after Lethe.

## What you learn, and when

| Contract | Reveal |
| --- | --- |
| 1 | Doc says "none of these stitches are mine". It's a lie. |
| 3 | Lethe is selling you as shards, at forty eddies a hit. |
| 4–6 | One buyer has bought all 412 CIPHER shards. The fragments show a kitchen and a girl with pliers. Her name is Ren, and she's your sister. |
| 8 | Your own thumbprint is on the burn contract. Doc did the burn, and you paid her to lie about it. |
| 9 | You meet Ren. She doesn't know you. She plays your shards when she can't sleep. |
| 11 | Lucky confesses: the old you paid him to keep you away from Lethe. He took the money and sent you after Lethe anyway. |
| 12 | Ren lost all her memories to a Lethe loan. You sold yours to buy hers back. Under Lethe's rules, a shared memory belongs to whoever sold it first, so she got her life back with you cut out of it. Clause 14: if you take the core shard back, the sale is void and Ren loses everything again. |
| 15 | The vault. You choose: plug the core shard in (you remember everything, Ren forgets) or smash it (you stay Nine, Ren keeps her life). |

## Cast and voice

- **Doc** is a back-alley surgeon. She talks in short sentences, describes your body like a repair job, and always mentions the eight grand. Her intro line and her last line depend on your archetype. She reads what the burn left behind (calluses, old bullets, a chrome lattice).
- **Lucky** is the bookie. Everything he says is about odds. He calls you Nine and mentions a wife nobody has met.
- **Lethe** only appears as radio ads: cheerful copy that gets steadily more sinister.
- **Ren** is your sister. She speaks only in act 2 and later, and she never learns who you are.
- **Nine** is you. You say very little, mostly in the reveals and the epilogue.
- **Fragment** lines are recovered memories, written in second person and present tense. They get their own sepia panel.
- **The Appraiser, the Auctioneer and the Archivist** are the Lethe bosses at contracts 5, 10 and 15. In-game each is an Overlord wearing its own gear: a monocle, a top hat, or reading glasses with a file tag.

## Where the text appears

- **Story panels** (they pause the game) show the intro, a scene before contracts 2, 3, 4, 6, 8, 9, 11, 12 and 13, and the ending. The Skip Story option turns them off.
- **The Contract Briefing** shows the contract name, the act, Lucky's note and the named boss.
- **The radio** shows two lines per contract while you fight, plus the boss's entrance and death lines, Doc when your HP is low, and Lucky when a side-job finishes or fails. It never pauses the game, and the Radio Chatter option turns it off.
- **The wave banner** shows the contract or boss name.
- **The game-over screen** shows a reaction from the cast that depends on which act you reached.
- **Afterburn** starts once you clear contract 15 and choose Keep running. Waves go on with random districts, and Lucky and Doc chip in now and then.

## Rules for new lines

- Each speaker keeps their own habit: Doc bills you, Lucky quotes odds, Lethe sells.
- Every line needs one concrete thing, like a zip, pliers, 412 shards, or eight grand.
- Write lines the way a person would say them over a radio, not as aphorisms.
- Length limits are checked by `node tools/headless.mjs story`: panel beats 240 characters, radio lines 120, briefing notes 200.
- The sim only reads `district` from the script. Everything else is UI, so changing a line can't break a run's determinism.

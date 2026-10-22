/*
 * MemoryBurn - js/data/story.js
 *
 * The campaign: 15 contracts in three acts, then endless Afterburn. New in the web port; the original
 * had one-line beats with no ending. docs/story.md has the premise, cast and plot.
 *
 * Beats are [speaker, line]. '@arch' as a line means "the line for the player's archetype" from
 * STORY.arch. The sim reads only `district` (scheduled per contract); everything else is UI text.
 * Limits (checked by tools/headless.mjs): panel beats 240 chars, radio and notes 120 / 200.
 */
(function () {
  'use strict';
  var D = MB.data;

  D.STORY = {
    last: 15, // the contract whose end triggers the ending

    // portrait: sprite key drawn in the speaker badge ('char' = the player's archetype)
    speakers: {
      DOC: { color: '#79e36a', portrait: 'npc:doc' },
      LUCKY: { color: '#ffd35a', portrait: 'npc:lucky' },
      LETHE: { color: '#ff8cf0', portrait: 'npc:lethe', tag: 'RADIO AD' },
      REN: { color: '#ff9a5a', portrait: 'npc:ren' },
      NINE: { color: '#5fb3ff', portrait: 'char' },
      FRAGMENT: { color: '#e2cfa6', portrait: 'npc:shard', tag: 'RECOVERED MEMORY' },
      APPRAISER: { color: '#ef4d5f', portrait: 'boss:1' },
      AUCTIONEER: { color: '#ef4d5f', portrait: 'boss:2' },
      ARCHIVIST: { color: '#ef4d5f', portrait: 'boss:3' }
    },

    acts: [
      { from: 1, name: 'Act I', title: 'Stock' },
      { from: 6, name: 'Act II', title: 'Provenance' },
      { from: 11, name: 'Act III', title: 'Clause 14' },
      { from: 16, name: 'Afterburn', title: 'Overtime' }
    ],

    intro: [
      ['DOC', "Don't sit up. Forty stitches in your scalp and none of them are mine. Somebody burned you clean, top to bottom."],
      ['DOC', '@arch'],
      ['DOC', "There's a barcode on your neck. LOT C-9. That's Lethe & Sons stock. They sell what they take out of people."],
      ['DOC', "Their repo drones are in the street. Lethe doesn't like burned people walking around. Back door's on the left. Pay me when you can."]
    ],

    contracts: {
      1: {
        title: 'Back Door', district: 'Neon Grid',
        radio: [
          ['DOC', "Repo drones, three blocks out. Shoot the ones with the Lethe stripe. That's all of them."],
          ['LETHE', "Lethe & Sons. Sell the memories you don't use. Buy the ones you wish you had."]
        ]
      },
      2: {
        title: 'Repo Men', district: 'Rain Alley',
        scene: [
          ['LUCKY', "Doc says you owe her eight grand and can't remember your own name. I can work with one of those."],
          ['LUCKY', "I'm Lucky. I take bets and I sell jobs. Lethe's paying bounties on you, so I'm betting the other way."],
          ['LUCKY', "I'll call you Nine, like the barcode. Don't make that face. It's catchy."]
        ],
        note: 'Lethe runs a repo van down Rain Alley every night. Wreck the escort and see what\'s in the back.',
        radio: [
          ['LUCKY', 'Opening odds on you were nine to one. They\'re down to six.'],
          ['LETHE', 'Lethe Repo reminds you: unclaimed donors become spare parts. Thank you for your cooperation.']
        ]
      },
      3: {
        title: 'Shelf Life', district: 'Dust Slums',
        scene: [
          ['FRAGMENT', 'A rooftop in the rain. You slip on the gutter and someone laughs at you so hard she has to sit down. You laugh too.']
        ],
        note: 'The van was full of shards with your barcode on them. Lethe is selling you at forty a hit. A kiosk in the Slums still has stock.',
        radio: [
          ['LETHE', 'New at your local kiosk: CIPHER-9, Rooftop Summer. Customers say they cried twice.'],
          ['LUCKY', "Forty a hit. I'd have priced you at sixty."]
        ]
      },
      4: {
        title: 'Bulk Order', district: 'Vine Mesh',
        scene: [
          ['FRAGMENT', 'A kitchen with one working light. A girl, maybe twelve, fixes the zip on your jacket with pliers. "Hold still, idiot."']
        ],
        note: "Somebody buys CIPHER shards by the crate and collects them at a relay in the Mesh. Lethe guards the cables. Find out who's buying.",
        radio: [
          ['DOC', "If you tear those stitches I'm charging double."],
          ['LUCKY', 'I put fifty on you clearing the Mesh. My wife thinks I put it on a horse.']
        ]
      },
      5: {
        title: 'Valuation', district: 'Jetstream',
        note: 'Lethe sent an appraiser up to the vents to price you in person. Big unit, cheap suit. Drop him and his case is yours.',
        radio: [
          ['LUCKY', "Wind's strong up there. Your shots drift. So will he."]
        ],
        boss: {
          name: 'The Appraiser', speaker: 'APPRAISER', art: 1,
          enter: "Lot C-9, walking around. That's a write-off. Hold still while I itemize you.",
          down: 'Mark me down as damaged in transit.'
        }
      },
      6: {
        title: 'Return to Sender', district: 'Rain Alley',
        scene: [
          ['FRAGMENT', "The kitchen again, years later. The girl with the pliers has grown up. Her name's Ren. She's yelling at you for coming home bleeding."],
          ['NINE', 'Lucky. I have a sister.'],
          ['LUCKY', "The appraiser's case had a sales ledger. One customer bought every CIPHER shard Lethe ever pressed. Four hundred and twelve. The account says Ren."]
        ],
        note: 'Lethe is pulling CIPHER stock off the shelves. Somebody upstairs noticed you\'re awake. Hit the recall trucks.',
        radio: [
          ['LETHE', 'Product recall: CIPHER-9 shards may cause déjà vu. Please return them to any Lethe kiosk.'],
          ['LUCKY', 'Four hundred and twelve shards. Nobody buys a stranger four hundred times.']
        ]
      },
      7: {
        title: 'Fine Print', district: 'Dust Slums',
        note: 'Lethe keeps paper copies of donor contracts in a Slums records office. Paper, Nine. Yours is in a drawer down there.',
        radio: [
          ['LUCKY', "Bookies have you at even money. Nobody bets against you anymore. I can't make a living like this."],
          ['DOC', 'Stop calling me from fights. I can hear you getting hit.']
        ]
      },
      8: {
        title: 'Signature', district: 'Neon Grid',
        scene: [
          ['NINE', 'It\'s my thumbprint. My handwriting. "Burn all of it. Don\'t let me come looking."'],
          ['DOC', 'I said none of those stitches were mine. I lied. You paid me extra to lie, and you were very specific about it.'],
          ['DOC', 'Be angry at me later. Lethe knows you read the contract.']
        ],
        note: 'Lethe crews are sweeping the Grid for you. All of them. Make them regret the overtime.',
        radio: [
          ['DOC', 'You can hate me after you stop bleeding.'],
          ['LETHE', 'Lethe & Sons. Every sale is final.']
        ]
      },
      9: {
        title: 'Noodle Bar', district: 'Vine Mesh',
        scene: [
          ['REN', "You're the one Lucky sent? Sorry. You look like someone from a shard I play when I can't sleep."],
          ['REN', "There's a kitchen in it. Somebody's zip won't close and I fix it with pliers. I don't know why I keep buying it."]
        ],
        note: "Lethe repo crews are working the Mesh door to door. Ren's building is on the list. Keep them off her stairs.",
        radio: [
          ['REN', "There's shooting outside. Is that you? Is that about me?"],
          ['LUCKY', "She asked me if you're a good person. I said the odds were fair."]
        ]
      },
      10: {
        title: 'Lot C-9', district: 'Midnight District',
        note: 'Lethe is auctioning the rest of you at midnight. All but one shard: the core lot stays in the vault as collateral. Crash the sale.',
        radio: [
          ['LETHE', 'Tonight only, the complete CIPHER-9 collection. Viewing from eleven. Paddles at the door.']
        ],
        boss: {
          name: 'The Auctioneer', speaker: 'AUCTIONEER', art: 2,
          enter: 'The donor has wandered onto the floor. Do I hear a bid on the donor? Going once.',
          down: 'No sale! No sale!'
        }
      },
      11: {
        title: 'Collateral', district: 'Jetstream',
        scene: [
          ['LUCKY', "I have a confession and you're going to hate it. Six months ago you paid me twenty grand to keep you busy after the burn."],
          ['LUCKY', 'Small jobs. Stay away from Lethe. I took the money and sent you after Lethe bounties anyway. They paid better. Sorry, Nine.'],
          ['DOC', 'The core shard is in Lethe\'s vault under the reactor. It has the rest of you in it, and the reason you did this.']
        ],
        note: 'The vault keys ride a courier loop over the Jetstream vents. Lucky says he can\'t watch. Lucky is watching.',
        radio: [
          ['LUCKY', "I put everything you paid me on you. Every eddy. Don't you dare."],
          ['LETHE', 'Lethe & Sons. Forget responsibly.']
        ]
      },
      12: {
        title: 'Clause 14', district: 'Dust Slums',
        scene: [
          ['DOC', "You made me promise to never tell you this, so I'll say it fast. Ren took a Lethe loan and couldn't pay. They took her memories. All of them."],
          ['DOC', 'You sold yours to buy hers back. Lethe says a shared memory belongs to whoever sold first. Ren got her life back with you cut out of it.'],
          ['DOC', 'Clause 14. If you ever take back the core shard, the sale voids and Lethe takes Ren\'s memories again. You knew. You signed anyway.']
        ],
        note: "Lethe sent a crew to seize Doc's clinic records. Doc is in the clinic. Doc refuses to leave the clinic.",
        radio: [
          ['DOC', "I've been shot before. Mostly by clients."],
          ['REN', 'Lucky gave me this number. Is this the right number? Hello?']
        ]
      },
      13: {
        title: 'House Rules', district: 'Midnight District',
        scene: [
          ['FRAGMENT', 'Doc\'s chair. Your own voice: "Ren doesn\'t get to miss me. That\'s the deal. Make it clean." Doc doesn\'t answer for a long time.']
        ],
        note: 'Lethe locked down Midnight and put your face on every camera. Good news: most of the cameras down there are broken.',
        radio: [
          ['LETHE', 'Attention Midnight residents. A defective product is loose in your district. Do not engage. Do not reminisce.'],
          ['LUCKY', 'Odds on you reaching the vault: forty to one. I took every bet.']
        ]
      },
      14: {
        title: 'Deep Storage', district: 'Reactor Core',
        note: "The vault is under the reactor. It's hot and it gets hotter. Doc patched you up as well as she could, which is pretty well.",
        radio: [
          ['DOC', 'Heat bleed will nibble at you. Keep moving.'],
          ['REN', "I played the kitchen shard again tonight. The zip still won't close."]
        ]
      },
      15: {
        title: 'Final Sale', district: 'Reactor Core',
        note: 'The core shard is behind the Archivist. Whatever you do with it, you have to take it first.',
        radio: [
          ['LUCKY', "This is it, Nine. I can't even look at the odds."]
        ],
        boss: {
          name: 'The Archivist', speaker: 'ARCHIVIST', art: 3,
          enter: 'Take the shard. Please. Clause 14 is my favourite clause.',
          down: 'File me under closed.'
        }
      }
    },

    ending: {
      lead: [
        ['NINE', 'The shard is warm, about the size of a thumbnail. Everything I was is in there, including the reason I gave it away.'],
        ['DOC', 'Plug it in and you get yourself back, and Ren gets nothing. Smash it and you stay Nine. She keeps a life that doesn\'t have you in it.']
      ],
      choices: [
        {
          id: 'plug', label: 'Plug it in', sub: 'Remember. Ren forgets.',
          beats: [
            ['NINE', "I remember all of it. The rooftop, the kitchen, the chair. Ren woke up the next morning and didn't know her own street."],
            ['NINE', 'I walked her home. I told her her name, then mine. I fixed the zip on her jacket and told her to hold still, idiot. She laughed and didn\'t know why.'],
            ['DOC', '@archEnd']
          ]
        },
        {
          id: 'smash', label: 'Smash it', sub: 'Stay Nine. Ren keeps her life.',
          beats: [
            ['NINE', 'It broke like cheap glass. The vault alarms went off and then gave up.'],
            ['LUCKY', 'A woman from the Mesh keeps asking if I know anybody who looks like her favourite shard. I said I\'d ask around. Want me to keep asking?'],
            ['DOC', '@archEnd']
          ]
        }
      ]
    },

    // Doc reads the body the burn left behind (intro), and checks on it at the end. Indexed by archetype.
    arch: {
      intro: [
        "You've got a deck port behind your ear and calluses on your typing fingers. Somebody paid good money for those hands.",
        "Four old bullets in you, all healed ugly. You stand like you're waiting on a fifth.",
        'Titanium knees, and your boots are worn through at the toe. You ran for a living.',
        "None of the blood in you started out yours. I don't ask whose. I'm a doctor, not an auditor.",
        "Resting heart rate of 41 on a burn table. Mine's higher, and I'm not the one being cut.",
        "You've broken both collarbones twice. You landed on purpose both times, from the look of it.",
        "There's a chrome lattice under your skin. It hums when your pulse goes up. It's humming now.",
        'You tried to steal my scalpels while you were under. Twice. You were unconscious.'
      ],
      ending: [
        "Your fingers still twitch at night like you're typing. I don't think that goes away. You still owe me eight grand.",
        'Five bullets now. I left the new one in. Call it a souvenir. You still owe me eight grand.',
        "You still run everywhere. Nobody's chasing you. I checked. You still owe me eight grand.",
        'Your blood is forty percent yours now. Up from zero. You still owe me eight grand.',
        "Heart rate's back to 41. You're very annoying to treat. You still owe me eight grand.",
        'Third collarbone. You jumped on a Lethe drone on purpose. I could tell. You still owe me eight grand.',
        'The lattice stopped humming. I thought you\'d want to know. You still owe me eight grand.',
        'You took two scalpels on your way out last time. Bring them back. And you still owe me eight grand.'
      ]
    },

    // Radio barks picked by the HUD (cosmetic RNG).
    pools: {
      lowHp: [
        ['DOC', "You're leaking. Find cover."],
        ['DOC', "I can hear you wheezing over comms. That's bad."],
        ['DOC', "Don't die. You still owe me eight grand."]
      ],
      questDone: [
        ['LUCKY', "Side-job's done. I'll wire the bonus, minus my cut."],
        ['LUCKY', 'Clean work. I made money on that.'],
        ['LUCKY', 'Side-job cleared. The bookies hate you.']
      ],
      questFail: [
        ['LUCKY', 'There goes the side bet.'],
        ['LUCKY', "Forget the side-job. I'll forget it too. Eventually."]
      ],
      afterburn: [
        ['LUCKY', "More Lethe crews. Nobody told them the story's over."],
        ['LUCKY', 'Lethe wants its inventory back. Tell them no.'],
        ['LUCKY', "I'm taking side bets on how long you last. Don't tell Doc."],
        ['DOC', 'You keep coming back with new holes. I keep closing them. It\'s a living.']
      ]
    },

    // Game over line by act (index into acts).
    gameover: [
      [['DOC', 'The repo crews got you. I\'ll tell Lucky. He had money on you.'], ['LUCKY', 'Nine goes down in the early rounds. Somebody get me a chair.']],
      [['DOC', 'You got further than a burned donor has any right to. Then you got shot.'], ['LUCKY', "Lethe will put your parts back on the shelf. I'll buy one. Sentimental reasons."]],
      [['DOC', "Two doors from the vault. I'll stitch what I can find."], ['REN', "The kitchen shard stopped working tonight. I don't know why I'm crying."]],
      [['LUCKY', 'Afterburn\'s over. You lasted longer than any odds I ever set.'], ['DOC', "Lethe's still sending crews. You're still in debt to me. Some things last."]]
    ]
  };

  var S = D.STORY;
  S.actIndex = function (wave) { var i = 0; while (i + 1 < S.acts.length && wave >= S.acts[i + 1].from) i++; return i; };
  S.contract = function (wave) { return S.contracts[wave] || null; };
  // resolve '@arch' / '@archEnd' placeholders for one archetype
  S.resolve = function (beats, arch) {
    return beats.map(function (b) {
      if (b[1] === '@arch') return [b[0], S.arch.intro[arch]];
      if (b[1] === '@archEnd') return [b[0], S.arch.ending[arch]];
      return b;
    });
  };
})();

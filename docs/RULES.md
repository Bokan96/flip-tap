# Flip Tap: Rules

A two-player **simultaneous-planning card duel** on a tiny grid. Each round, both players secretly
plan a sequence of cards. The cards are then revealed and resolved step by step, at the same time.
Winning is about reading where your opponent will be and what they will do.

The core mechanic was studied from a classic Flash-era tournament game. All names, numbers for
individual cards, art, sound and text in this project are original. Values marked **(design choice)**
are rules this project defines itself.

All tunable numbers live in [`src/content/balance.ts`](../src/content/balance.ts). Every card and fighter lives in
[`src/content/cards.ts`](../src/content/cards.ts).

## Board and fighters
- Matches are played in an **arena** ([`src/content/arenas.ts`](../src/content/arenas.ts)). The default,
  **Classic**, is a grid of **3 rows × 5 columns**; Player 1 starts at row 2, column 2 and Player 2 at
  row 2, column 4, one square in from each edge (Close Quarters and Thorn Garden start at the edges).
- Other arenas change the size (Close Quarters 3×4, the original board; Grand Court 4×5) or add
  special squares (Pillars, Hot Springs and Thorn Garden are 3×5):
  - **Pillars (blocked squares):** nobody can stand on them. A move onto one does nothing, a push or
    pull stops in front of one, and attacks don't cover them.
  - **Thorns:** a fighter who ends a step on one loses 10 life.
  - **Springs:** a fighter who ends a step on one gains 10 energy.
- Every arena is point-symmetric, so neither side has an advantage **(design choice)**.
- Both fighters may stand on the same square.
- Every fighter has **Life** (max 100) and **Energy** (max 100). Life starts full, Energy at 50.

## Cards
Every card has:
| Field | Meaning |
|---|---|
| `cost` | Energy change applied to the user when it resolves (negative = spends, positive = gains) |
| `step` | Movement `[rows, cols]` applied to the user (clamped to the board) |
| `heal` | Life restored to the user |
| `guard` | Damage absorbed this step if the user is hit |
| `pattern` | 3×3 attack area centred on the user (only for attack and trap cards); rows may be 5 wide for a reach of 2 |
| `damage` | Life removed from the opponent if they stand in the pattern |
| `push` | Attack effect: on a connecting hit, move the target *n* squares away (positive) or toward you (negative, a **pull**) |
| `stun` | Attack effect: if the hit deals damage, the target's **next card** is cancelled (after a round's last card: their first card next round) |
| `root` | Attack effect: if the hit deals damage, the target is **rooted** for the rest of the round: their move cards don't move them |
| `counter` | Guard effect: if an attack hits you this step, the attacker takes this much damage |
| `blockSap` | Guard effect: if an attack hits you this step (even one the guard doesn't fully stop), the attacker loses this much energy (basic Guard: 10) |
| `drain` | Attack effect: heal this percentage of the damage the attack dealt |
| `sap` | Attack effect: on a connecting hit (even a guarded one), the target loses this much energy |
| `hex` | Attack effect: if the hit deals damage, the target is **hexed** with this value (see below) |
| `vsMoved` | Attack effect: extra damage against a target that moved this step |
| `recoil` | Attack effect: the user loses this much life when the card resolves, hit or miss |
| `planted` | Attack rule: can't be planned after a move card in the same round |
| `healAtOrBelow` | Heal rule: only heals if the user's life is at or below this after the step's hits |
| `trap` | Trap card: sets a trap with this damage on each square of its pattern |
| `swap` | Move card: after movement, the two fighters trade places; only the one who played it turns |
| `forward` | Move card: the step's columns count toward the side the user faces |

Card kinds: **move**, **guard**, **focus** (gain energy), **attack**, **heal**, **trap**, **reload**.

### Effects in detail **(design choices)**
- **Push / pull** move the target along columns only, after damage is applied.
  - A push goes away from the attacker (in the attacker's facing direction if they share a column) and stops at the edge of the board.
  - A pull moves the target toward the attacker but never past the attacker's column.
  - Both players' pushes happen at the same time.
- **Stun** only works if the hit deals at least 1 damage after guard.
  - The stunned player's next card does nothing and costs nothing.
  - A stun on the last step of a round **carries over**: the stunned player's first card next round does
    nothing (and costs nothing, so it may even be a card they couldn't afford). They see the stun while
    planning, and the planner marks that slot. (`BALANCE.carryDaze`; in Two-tap it cancels the locked-in card.)
- **Root** only works if the hit deals at least 1 damage after guard.
  - For the rest of the round the rooted player's move cards don't move them (and their own swap
    doesn't happen); the card is still paid for and still turns them to face the opponent. Pushes,
    pulls and the opponent's swap still move them. It wears off at the end of the round.
  - It is on the bonus card **Entangle** and can be put on custom attack cards in the hero creator.
- **Counter** damage is fixed (not reduced by guard or passives). It triggers on any hit, even one fully guarded.
  Guard cards and move cards (Zephyr's dashes) can carry a counter.
- **Drain** rounds down.
- **Traps** are set at the very end of the step their card is played, on the open squares of the card's
  pattern (aimed like an attack). The first enemy to *end a later step* on a trap takes its damage and
  the trap is used up. A trap never hurts its owner. Unused traps disappear at the end of the round
  after the one they were set in. A new trap from the same owner on the same square replaces the old one.
- **Breaking traps:** an attack that strikes (an interrupted one doesn't) destroys every enemy trap on
  the squares it covers, right after the attacks and before any trap can spring that step. So a
  fighter standing on an enemy trap is safe if it attacks its own square.
- **Hex:** a damaging hit from a `hex` attack marks a fighter who isn't already hexed, with the card's
  `hex` value (Hex Bolt and Malediction 20, Evil Eye 10). The next enemy hit that *connects* on a
  hexed fighter deals that much more damage (guard still applies) and removes the hex. A hex lasts
  across rounds until it is used. A hexing attack that removes a hex doesn't put a new one on.
- **Sap** comes off the target's energy together with its own card's cost (clamped to 0). A later card
  it can no longer pay for this round does nothing.
- **Recoil** is applied with the attacker's own cost, after the strikes. Guard doesn't reduce it, and it
  can knock the attacker out (both fighters at 0 in the same step is a draw).
- **Planted** attacks can't be planned after any move card in the same round. Moves after them are fine.
- **Swap** happens right after movement: the fighters trade squares (once, even if both swap). A swap
  can't move an immovable opponent. Both fighters count as having moved.
- **Forward** moves step toward the side the fighter faces at the start of the step.
- Trap and recoil damage is fixed: guard, counters and drains don't apply to it.

## Fighter passives
Most fighters have one always-on passive ability, made of simple numeric modifiers. Briar and Vex
have none: their trap and hex damage is printed in full on their cards.

| Fighter | Passive | Effect | Signature mechanic |
|---|---|---|---|
| Cinder | Kindle | Attacks deal +10 damage while Cinder is at 50 life or less | His big attacks have **recoil**; **Rekindle** (25 energy, +20 life) works only at 50 life or less |
| Marin | Riptide | Pushes and pulls move the target 1 extra square | **Tidal Lure** pulls from 2 squares away; **Geyser** shoves foes in his own column |
| Zephyr | Slipstream | Takes 10 less damage on steps where Zephyr moved | **Gale Dash** / **Sky Lunge**: costly forward moves with a counter |
| Basalt | Bedrock | Can't be pushed or pulled | **Planted** attacks: cheap and strong, but not after a move |
| Volta | Capacitor | Regains 10 extra energy every round | **Sap** attacks: weak, wide hits that drain energy |
| Umbra | Ambush | Attacks deal +5 damage to a target that moved this step | **Pounce** / **Nightfall** deal much more to a target that moved |
| Ferro | Magazine | Each attack fires once, then is **spent** until Ferro plays his **Reload** card | Reload |
| Briar | — | — | Cheap traps (attacks can break them): Snare 35, Thorn Ring 25 |
| Vex | — | — | **Hex** attacks (a hex worth 20) and Mirror Step (swap) |

### Ammo and Reload (Ferro)
- An attack is spent as soon as it is played (hit or miss). A spent attack can't be planned again.
- **Reload** (a free card in Ferro's deck) makes every spent attack usable again. It can come earlier
  in the same plan, so *Reload, Snap Shot, Guard* is legal even if Snap Shot is spent.
- If Reload is cancelled by a stun, the attacks stay spent and a spent attack later in that plan does
  nothing.

The same modifier system powers match-wide rule changes (for example a daily challenge that adds
damage to every attack).

Each fighter has a deck made of:
- **Basic cards** every fighter shares: Step ↑ ↓ ← →, Guard, Focus.
- **4 or 5 signature cards** unique to that fighter (Basalt's include a counter guard; Ferro also has
  Reload; Cinder has Rekindle; Zephyr has two dashes).
- **Bonus cards** earned in Tournament mode (see below).

### Patterns and facing
Patterns are written facing **right**: the left column is behind the user and the right column is in
front, mirrored when the fighter faces left.

**Facing (design choice):** both fighters turn to face each other's column at the start of every round.
During a round a fighter turns only when they play a move card (swaps included): afterwards they face
the opponent's column. A fighter who doesn't play one keeps facing the same way, even if the opponent
leaps past them or swaps places with them, so their attacks can go the wrong way and miss until they
play a move card themselves. Pushes and pulls never turn anyone. When both fighters share a column, a
turning fighter keeps their previous facing.

## Round flow
1. **Plan:** each player fills **3 slots** with cards from their deck.
   - A card can be used at most **once per round** **(design choice)**.
   - The plan must be affordable. Walking the slots in order, the running energy total may never
     drop below 0. Focus cards placed earlier pay for attacks placed later.
2. **Reveal and resolve:** slots resolve in order (slot 1, 2, 3). Both players' cards in the same slot
   happen simultaneously, using the procedure below. On screen the two cards still play one after
   the other, in the order the procedure resolves them (moves, then guard / focus / reload, then
   attacks in strike order, then heals and traps), each for about the same time; the outcome is the same.
3. **Fatigue (design choice):** from round 8 on, both fighters lose **5 Life** at the end of every
   round. This can knock out one or both fighters (both at once is a draw).
4. **Recover:** at the end of the round both fighters gain **+15 Energy** plus any passive bonus (capped at max), and both fighters turn to face each other. A stun from the
   round's last card carries into the next round.
5. If the match isn't over, start a new round.

### Resolving one slot (both players at once)
Let *A* and *B* be the two players. A card is **active** if its owner was not stunned on the
previous step and can afford it at the start of this slot (`energy + cost >= 0`). An inactive card
does nothing.

1. **Movement:** every active card's `step` is applied. Positions are clamped to the board. A fighter
   whose active card is a move (a swap included) then turns to face the opponent; the other keeps their
   facing, even if they were swapped.
2. **Hits:** for each player *X*, if the opponent's active card is an attack whose pattern (from the
   opponent's **new** position and facing) covers *X*'s **new** square, *X* is hit.
   - **Attack priority (design choice):** if *both* players attack in the same step, they don't
     strike at the same time. The hit that would deal more damage right now strikes first, counting
     every bonus (a low-life passive, a hex on the target, the daily rule twist) and the target's
     reductions; on equal damage, the fighter with **less** life strikes first, so the one behind gets
     the chance to turn it around. The first strike is resolved completely
     (damage, drain, stun, push) before the second attacker acts, from wherever they stand after a
     push. A fighter knocked out by the first strike never makes their attack. Only if damage
     *and* life are equal do both attacks land at the same time.
   - Damage = attack `damage` + the attacker's passive bonuses + *X*'s hex (if any) − *X*'s `guard`
     (if *X*'s own card is active) − *X*'s passive reductions, never below 0. A hit with `guard > 0` counts as "guarded".
   - Then: *X*'s counter hurts the attacker, the attacker's drain heals them, a stun marks *X*'s
     next card, a root roots *X*, and a push or pull is queued.
3. **Self effects:** every active card applies its own `cost`, `heal` (if its condition holds) and
   `recoil`, any `sap` comes off the target's energy, and Life and Energy are clamped to `0..max`.
   A fighter the step's hits (and counters) bring to 0 is out: neither their heal card nor their
   drain brings them back that step.
4. **Push and pull:** queued displacements happen at the same time. Nobody turns.
   Then, in order: attacks **break** the enemy traps they covered, **square effects** (thorns,
   springs), **traps** springing, and finally new **traps** being set.
5. **KO check:** if exactly one fighter has 0 Life, the other wins. If both reach 0 on the same step,
   the match is a **draw**. A KO ends the round immediately, and the remaining slots don't resolve.

Movement resolves before attacks, so dodging is the core skill. A fighter that steps out of the
pattern in the same slot avoids the hit.

## Win conditions
- Reduce the opponent to 0 Life.
- Both KO'd in the same step: draw.
- There is no round limit.

## Modes
- **Tutorial:** a guided first match against a scripted training dummy, with tips about moving,
  attacking, dodging, energy and guarding. Offered once on the title screen and always available
  from How to play.
- **Play menu:** the title screen's **Play** button opens every way to play: Tournament, Daily
  challenge, Versus CPU, Hot-seat and the rule variants (Two-tap).
- **Versus CPU:** pick fighters, play one match against the AI.
- **Hot-seat:** two people share a device. Player 1 plans, then hands over the device ("pass" screen
  hides the plan), then Player 2 plans, then both are revealed.
- **Two-tap (rule variant, vs CPU or hot-seat):** only **2 cards play each round**.
  - Round 1 is planned as usual (3 cards). Slots 1 and 2 play; the card in slot 3 stays **face down
    and locked in**, and plays first next round. Every later round you plan just 2 new cards behind
    it, so there is always one hidden card committed from the round before.
  - The plan rules apply to the whole 3-card window: no card twice, Focus earlier pays for later
    cards, planted attacks can't follow a move. The round's energy refill counts before the held
    card in the plan's energy check.
  - A locked-in card that can no longer be played when its turn comes (not enough energy, a spent
    shot, or a stun) simply fizzles; it never makes the new plan illegal.
  - A stun on a round's last card is not wasted: it **carries over and cancels the locked-in card**.
  - Rounds are shorter, so fighters regain **+10 Energy** a round and **fatigue** starts after
    round 10 (`TWO_TAP` in `content/variants.ts`). The CPU can't see your face-down card either.
- **Tournament (single player):** pick a fighter and beat the other 8 fighters in a fixed order.
  - Each win lets you **choose 1 of 3 bonus cards** you don't own yet (with one left, you simply get
    it). The choice waits until you make it, so closing the game can't lose or re-roll it. Bonus cards
    form one collection shared by all fighters.
  - You can equip up to **3 bonus cards** (`BALANCE.bonusSlots`), which join your deck in
    Tournament and Versus CPU. Hot-seat always uses basic and signature cards only.
  - Each rival brings as many bonus cards as you have ladder wins (up to 3), always the same ones for
    that spot on that fighter's ladder, so retrying a loss can't fish for an easier draw.
  - Losing lets you retry. Beating all eight makes that fighter a **champion** (★), which stays
    even if you restart the ladder. The ★'s colour shows the hardest difficulty a whole ladder was
    won on, counting each run at the easiest difficulty used in it (bronze Easy, silver Normal,
    gold Hard, violet Expert).
- **Daily challenge:** one match per day against the Hard CPU, with the fighter, rival and a rule
  twist (for example +10 damage for everyone, or both fighters starting at 50 life) chosen from the
  date, so everyone gets the same challenge. Only even pairings are drawn: those scoring 40–60% in the
  balance simulations (`src/content/matchups.ts`, written by `DAILY=YYYY-MM-DD npm run balance`; each
  table applies from its date on, so earlier days keep their challenge). Winning on consecutive days
  builds a streak, and a shared result says whether the day was won on the first try. No bonus cards
  are used.
- **Resume:** every match except the tutorial is saved at the start of each round's planning
  (never the plans themselves). After a reload, or after closing the installed app, the title screen
  offers *Resume match*; the round restarts from its planning. Quitting from the menu discards it.
- **Profile:** stats (matches, wins, damage dealt, best win streak, favourite card), per-fighter
  records and ladder progress, 14 achievements and the bonus card collection. Everything is saved in
  the browser (localStorage) and can be reset from the Profile screen.
- **Online (planned):** the engine is deterministic and action-based, so two browsers can run in
  lockstep over WebRTC (PeerJS) and exchange only each round's plans.

## Balance
`npm run balance` plays every fighter pairing AI-vs-AI and writes [`BALANCE.md`](BALANCE.md): overall
scores, matchup table and per-card usage. Re-run it after changing numbers in `cards.ts`.
`VARIANT=twoTap npm run balance` does the same with the Two-tap rules (report in `sim/`), and
`TWOTAP="energyPerRound=12"` tries other Two-tap numbers. `DAILY=YYYY-MM-DD` on the default run also
adds its matchup scores to `src/content/matchups.ts` for the daily challenge from that date on.

## Rules versions
`RULES.revision` in `rules.ts` goes into every replay code's content stamp (with the numbers in the
content files), so a replay recorded under older rules says so instead of playing out differently.
Bump it whenever a code change alters how a match plays out; the golden match in `tests/rules.test.ts`
fails as a reminder. Revision 2: strike order by real damage (less life first on a tie), a swapped
fighter turns, and a last-card stun carries into the next round in Classic. Revision 3: a fighter
knocked out by a step's hits can't be healed back that step (heal cards, drain); the Root effect.
Revision 4: a swapped fighter no longer turns (revision 2's swap rule undone).

## CPU opponent (original design)
The AI enumerates every affordable 3-card plan it could make. It scores each plan against a sample of
plausible opponent plans by simulating the round with a fast copy of the rules engine (`fastsim.ts`).

**Scoring a simulated round** (`src/engine/ai.ts`, weights per difficulty in `PROFILES`):
- a KO is worth ±1000 and a draw −150;
- otherwise, life swing, with extra weight on life below 40 (one bad round from a KO);
- energy after next round's refill, where the first 50 points matter most;
- Ferro's loaded shots, the most dangerous lasting trap next to the enemy, and a hex on either side (by its value);
- a stun carried into next round (it costs its holder their first card there);
- **position:** the strongest hit each fighter could afford on the other at next round's start, from where
  the round leaves them (standing still, or half of it after one move), and how many squares each could
  step to that the other can't hit. Ending a round cornered, or right in front of the opponent's best
  attack, costs the CPU.

**Difficulties:**
- **Easy, Normal and Hard** guess the opponent's likely replies, then pick a strong plan against
  them. Lower difficulties add more randomness and score more short-sightedly.
- **Expert** narrows both sides down to their strongest plans and solves the round as a small
  simultaneous game (regret matching plus a few "best reply" refinements). It then plays that
  game's mixed strategy, so its plans are hard to predict. As the match goes on it builds a model
  of the opponent's habits (`playerModel.ts`: favourite cards per step, recent rounds weighted
  more, and what they do at low life) and leans toward the plans that punish them.

**Personalities:** each fighter can nudge the CPU with `ai: { aggression, caution }` in `cards.ts`.
For example, Cinder chases damage and Zephyr plays safe. Balance simulations ignore personalities.

**Where it runs:** in the browser, the search runs in a Web Worker (`aiWorker.ts`) that starts as soon
as the round begins, so the page never freezes. `npm run balance` and `sim/ai.sim.ts` (CPU vs CPU
duels: `npm run duel`, e.g. with `A=expert B=hard`) run it directly. In duels over every fighter pairing
on the 3×5 Classic board, Expert scores about 63% against Hard.

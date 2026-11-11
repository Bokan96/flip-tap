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
- The arena is a grid of **3 rows × 4 columns**.
- Player 1 starts at row 2, column 1 (middle-left). Player 2 starts at row 2, column 4 (middle-right).
- Both fighters may stand on the same square.
- Each fighter has **Life** (max 100) and **Energy** (max 100). Both start full.

## Cards
Every card has:
| Field | Meaning |
|---|---|
| `cost` | Energy change applied to the user when it resolves (negative = spends, positive = gains) |
| `step` | Movement `[rows, cols]` applied to the user (clamped to the board) |
| `heal` | Life restored to the user |
| `guard` | Damage absorbed this step if the user is hit |
| `pattern` | 3×3 attack area centred on the user (only for attack cards) |
| `damage` | Life removed from the opponent if they stand in the pattern |
| `push` | Attack effect: on a connecting hit, move the target *n* squares away (positive) or toward you (negative, a **pull**) |
| `stun` | Attack effect: if the hit deals damage, the target's **next card this round** is cancelled |
| `counter` | Guard effect: if an attack hits you this step, the attacker takes this much damage |
| `drain` | Attack effect: heal this percentage of the damage the attack dealt |

Card kinds: **move**, **guard**, **focus** (gain energy), **attack**, **heal**.

### Effects in detail **(design choices)**
- **Push / pull** move the target along columns only, after damage is applied.
  - A push goes away from the attacker (in the attacker's facing direction if they share a column) and stops at the edge of the board.
  - A pull moves the target toward the attacker but never past the attacker's column.
  - Both players' pushes happen at the same time.
- **Stun** only works if the hit deals at least 1 damage after guard.
  - The stunned player's next card does nothing and costs nothing.
  - A stun on the last step of a round has no effect, because stuns wear off at the end of every round.
- **Counter** damage is fixed (not reduced by guard or passives). It triggers on any hit, even one fully guarded.
- **Drain** rounds down.

## Fighter passives
Every fighter has one always-on passive ability, made of simple numeric modifiers:

| Fighter | Passive | Effect |
|---|---|---|
| Cinder | Kindle | Attacks deal +10 damage while Cinder is at 50 life or less |
| Marin | Riptide | Pushes and pulls move the target 1 extra square |
| Zephyr | Slipstream | Takes 10 less damage on steps where Zephyr moved |
| Basalt | Bedrock | 115 max life; can't be pushed or pulled |
| Volta | Capacitor | 120 max energy; regains 10 extra energy every round |
| Umbra | Ambush | Attacks deal +5 damage to a target that moved this step |

The same modifier system powers match-wide rule changes (for example a daily challenge that adds
damage to every attack).

Each fighter has a deck made of:
- **Basic cards** every fighter shares: Step ↑ ↓ ← →, Guard, Focus.
- **4 signature attacks** unique to that fighter.
- **Bonus cards** earned in Tournament mode (see below).

### Patterns and facing
Patterns are written facing **right**: the left column is behind the user and the right column is in
front. A fighter always faces the opponent's column. When both fighters share a column, each keeps
its previous facing and the pattern is mirrored to match **(design choice)**.

## Round flow
1. **Plan:** each player fills **3 slots** with cards from their deck.
   - A card can be used at most **once per round** **(design choice)**.
   - The plan must be affordable. Walking the slots in order, the running energy total may never
     drop below 0. Focus cards placed earlier pay for attacks placed later.
2. **Reveal and resolve:** slots resolve in order (slot 1, 2, 3). Both players' cards in the same slot
   happen simultaneously, using the procedure below.
3. **Recover:** at the end of the round both fighters gain **+15 Energy** plus any passive bonus (capped at max). Stuns wear off.
4. If the match isn't over, start a new round.

### Resolving one slot (both players at once)
Let *A* and *B* be the two players. A card is **active** if its owner was not stunned on the
previous step and can afford it at the start of this slot (`energy + cost >= 0`). An inactive card
does nothing.

1. **Movement:** every active card's `step` is applied. Positions are clamped to the board. Both
   fighters then face each other.
2. **Hits:** for each player *X*, if the opponent's active card is an attack whose pattern (from the
   opponent's **new** position and facing) covers *X*'s **new** square, *X* is hit.
   - Damage = attack `damage` + the attacker's passive bonuses − *X*'s `guard` (if *X*'s own card is
     active) − *X*'s passive reductions, never below 0. A hit with `guard > 0` counts as "guarded".
   - Then: *X*'s counter hurts the attacker, the attacker's drain heals them, a stun marks *X*'s
     next card, and a push or pull is queued.
3. **Self effects:** every active card applies its own `cost` and `heal`, and Life and Energy are
   clamped to `0..max`.
4. **Push and pull:** queued displacements happen at the same time. Both fighters face each other again.
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
- **Versus CPU:** pick fighters, play one match against the AI.
- **Hot-seat:** two people share a device. Player 1 plans, then hands over the device ("pass" screen
  hides the plan), then Player 2 plans, then both are revealed.
- **Tournament (single player):** pick a fighter and beat the other 5 fighters in a fixed order.
  - After each win you gain **1 random bonus card** from the bonus pool.
  - Each opponent enters with as many bonus cards as you have won matches.
  - Losing lets you retry the same opponent. Beating everyone crowns you champion.
  - Progress is saved in the browser (localStorage).
- **Online (planned):** the engine is deterministic and action-based, so two browsers can run in
  lockstep over WebRTC (PeerJS) and exchange only each round's plans.

## Balance
`npm run balance` plays every fighter pairing AI-vs-AI and writes [`BALANCE.md`](BALANCE.md): overall
scores, matchup table and per-card usage. Re-run it after changing numbers in `cards.ts`.

## CPU opponent (original design)
The AI enumerates every affordable 3-card plan it could make. It scores each plan against a sample of
plausible opponent plans by simulating the round with the real rules engine. The score covers the
life swing, energy, and a bonus for a KO / penalty for being KO'd. It then picks a high-scoring plan,
and lower difficulties add more randomness.

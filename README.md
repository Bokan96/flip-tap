# Flip Tap

A small two-player **simultaneous-planning card battle** for the browser. Each round, both players
secretly plan three cards (move, guard, focus, attack, …). The cards are then revealed and resolved
step by step on a 3×5 grid. Dodge, predict, and land your attacks.

Modes: **Tournament** (beat 5 rivals, earn bonus cards), **Versus CPU** (4 difficulties, up to an Expert that learns your habits),
**Hot-seat** (two players on one device) and a **Daily challenge**. Full rules: [docs/RULES.md](docs/RULES.md).

After every match there is a summary (life over the rounds, damage per card, biggest hit, best dodge)
and a replay. The last 10 matches stay in Profile → Recent matches, and any of them can be shared as a
`#replay=` link that plays the match back in the receiver's browser.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/flip-tap/
npm test           # engine + AI tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173/flip-tap/
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`.
One-time setup: **GitHub repo → Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/flip-tap/`. If you rename the repo, update `base`
in `vite.config.ts`.

## Reskinning

Content and presentation are separate from the rules:

| What | Where |
|---|---|
| Fighters, cards, damage, costs, attack patterns | `src/content/cards.ts` |
| Life/energy, slots per round, energy regen, fatigue | `src/content/balance.ts` |
| Arenas: board sizes, start squares, pillars, thorns, springs | `src/content/arenas.ts` |
| All UI text | `src/content/strings.ts` |
| Fighter images and sound files (optional) | `public/assets/…` + `src/content/assets.ts` |
| Colours, layout | `src/styles.css` |

Without overrides, fighters use built-in vector emblems (`src/ui/emblems.ts`) and sounds are
synthesized with WebAudio (`src/audio/sfx.ts`).

## Architecture

```
src/engine/   pure, deterministic rules (no DOM)
  rules.ts      plan validation + round resolution
  fastsim.ts    allocation-free copy of the rules for AI search (kept in sync by tests)
  ai.ts         CPU: searches every legal plan against likely opponent replies (Expert solves
                the round as a small game); runs in a Web Worker (aiWorker.ts)
  playerModel.ts  the Expert CPU's model of your habits
  setup.ts      match creation
src/net/      PlanSource abstraction (human / CPU / replay / future remote peer)
src/meta/     profile, stats, achievements, daily challenge, saved match
  replay.ts     match ⇄ short URL-safe code (fighters, bonus cards, arena, rule, plans as deck
                indices); replaying re-runs the plans through the engine
  matchStats.ts the post-match summary numbers
src/ui/       DOM rendering, planner, reveal animation
src/tournament.ts   single-player ladder + localStorage progress
```

### Online play (next step)
The engine is deterministic and only needs both players' plans each round. Online play can be
added by implementing a `remote` `PlanSource` over WebRTC (e.g. PeerJS room codes), with no game server.
See `src/net/transport.ts`.

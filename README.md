# Flip Tap

A small two-player **simultaneous-planning card battle** for the browser. Each round, both players
secretly plan three cards (move, guard, focus, attack, …). The cards are then revealed and resolved
step by step on a 3×4 grid. Dodge, predict, and land your attacks.

Modes: **Tournament** (beat 5 rivals, earn bonus cards), **Versus CPU** (3 difficulties) and
**Hot-seat** (two players on one device). Full rules: [docs/RULES.md](docs/RULES.md).

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
| Board size, life/energy, slots per round, energy regen | `src/content/balance.ts` |
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
  ai.ts         CPU: searches every legal plan against likely opponent replies
  setup.ts      match creation
src/net/      PlanSource abstraction (human / CPU / future remote peer)
src/ui/       DOM rendering, planner, reveal animation
src/tournament.ts   single-player ladder + localStorage progress
```

### Online play (next step)
The engine is deterministic and only needs both players' plans each round. Online play can be
added by implementing a `remote` `PlanSource` over WebRTC (e.g. PeerJS room codes), with no game server.
See `src/net/transport.ts`.

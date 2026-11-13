# Reskinning Flip Tap

Everything that makes Flip Tap *look and read* like Flip Tap lives in a few content files. The rules
engine (`src/engine/`) never needs to change for a reskin. Work through the sections below in any order.

| What | Where |
|---|---|
| All on-screen text | [`src/content/strings.ts`](../src/content/strings.ts) |
| Fighters, cards, passives | [`src/content/cards.ts`](../src/content/cards.ts) |
| Rule numbers (life, energy, fatigue, square effects…) | [`src/content/balance.ts`](../src/content/balance.ts) |
| Arenas (board sizes, pillars, thorns, springs) | [`src/content/arenas.ts`](../src/content/arenas.ts) |
| Achievements, daily rule twists | [`src/content/achievements.ts`](../src/content/achievements.ts), [`src/content/modifiers.ts`](../src/content/modifiers.ts) |
| Tutorial script | [`src/tutorial.ts`](../src/tutorial.ts) (texts are in `strings.ts → tutorial`) |
| Colours, fonts, shapes | [`src/theme.css`](../src/theme.css) |
| Images, sounds, music | files in `public/assets/`, listed in [`src/content/assets.ts`](../src/content/assets.ts) |
| Browser tab icon | `index.html` (`<link rel="icon">`) |
| Installed-app name and icons | [`public/manifest.webmanifest`](../public/manifest.webmanifest), `public/icons/` ([`scripts/icon.html`](../scripts/icon.html)) |

## 1. Name and text
- **`strings.ts`** holds every word the player sees: game title, tagline, menus, rules, tutorial tips,
  daily challenge, profile screen, card tooltips. Translate or rewrite freely; keep the function
  signatures (for example `wins: (who) => …`).
- **Other languages** live in `src/content/lang/` (Serbian: `sr.ts`). Each provides the whole
  `strings.ts` object (the type checker lists any missing key) plus the names and descriptions of
  cards, fighters, arenas, daily rules and achievements by id. Register a new one in
  `src/content/i18n.ts` and it appears under Settings → Language. Changing a rename in a reskin? Change
  it in every language file too.
- `gameTitle` and `pageDescription` also become the browser tab title and page description at startup.
  `index.html` has the same title as a fallback for the first instant; update it too.
- Card and fighter names live in `cards.ts` (next section).

## 2. Fighters and cards
In **`cards.ts`**:
- `FIGHTERS`: `name`, `title`, `blurb`, `color` (the fighter's own colour, used for glows and emblems),
  `emblem` (built-in vector shape, used until you add art), `signature` (their cards), `passive`
  (name, text and the numbers it changes), optional `lifeMax` / `energyMax`.
- Card lists (`basics`, `bonus`, `signature`): `name`, `cost` (negative spends energy), `damage`,
  `pattern` (3×3, written facing right, centre = the user), and effects (`push`, `stun`, `counter`,
  `drain`), plus `fx` for the attack animation style (`slash`, `burst`, `wave`, `beam`, `quake`).
- Card descriptions are generated from the effects (wording in `strings.ts`), so changing numbers
  never leaves stale text. Use a card's `text` only for extra notes.

Changing numbers? Run `npm run balance`. It plays every pairing AI-vs-AI and rewrites
[`BALANCE.md`](BALANCE.md); aim for every fighter between 45% and 55%.

Keep card `id`s stable once players have saves: bonus cards and stats are stored by id.

## 3. Colours, fonts and shapes
**`src/theme.css`** is the only place with colours. Each token has a comment; the most visible ones:

| Token | Used for |
|---|---|
| `--bg`, `--bg2`, `--panel`, `--page-glow` | page, raised areas, menus, top-of-page glow |
| `--accent`, `--accent-hi`, `--on-accent` | buttons, highlights, timer; text on them |
| `--p0`, `--p1` | Player 1 / Player 2 (keep them clear of `--attack` red and `--move` blue) |
| `--attack`, `--move`, `--special` | attack squares, movement squares, special card group |
| `--life`, `--energy` (+ `-lo` ends) | the two HUD bars |
| `--board`, `--tile-a`, `--tile-b` | board frame and squares |
| `--rock-a`, `--rock-b`, `--hazard-spikes`, `--hazard-well` | pillars, thorn squares, spring squares |
| `--card-*` | card backgrounds per kind, bonus outline, card back |
| `--fx-*` | guard, stun, counter, drain, push, reload, recoil, sap, hex, planted, dust effects |
| `--trap`, `--card-trap-a/b` | trap squares on cards and previews, trap card background |
| `--font-body`, `--font-display` | text and headings/logo |
| `--radius`, `--cut` | corner rounding and the clipped button corner |

**Fonts:** add an `@import` (for example from Google Fonts) or an `@font-face` pointing at a file in
`public/assets/fonts/` at the top of `theme.css`, then name it in `--font-body` / `--font-display`.

Player colours, the attack red and the move blue appear both on cards and on the board, so pick four
colours that are easy to tell apart.

## 4. Images
Put files in **`public/assets/`** (create sub-folders as you like) and list them in **`ASSETS`** in
`assets.ts`, with paths relative to the site root. Every slot is optional; anything left out keeps the
built-in art.

```ts
export const ASSETS: AssetOverrides = {
  fighters: {
    cinder: { emblem: 'assets/fighters/cinder-icon.png', portrait: 'assets/fighters/cinder.png', token: 'assets/fighters/cinder-token.png' },
    marin: 'assets/fighters/marin.png', // a plain string fills all three slots
  },
  cards: { cinderJab: 'assets/cards/ember-jab.webp' },
  logo: 'assets/logo.png',
  background: 'assets/bg.webp',
  board: 'assets/board.webp',
  tile: 'assets/tile.png',
  cardBack: 'assets/card-back.webp',
  sounds: {},
  music: {},
};
```

| Slot | Shown | Suggested file |
|---|---|---|
| `fighters[id].emblem` | HUD, ladder, lists, deck viewer, title row | square, transparent PNG/WebP/SVG, 256×256 |
| `fighters[id].portrait` | fighter select, VS splash, result and daily screens | square, transparent, 512×512 |
| `fighters[id].token` | inside the board piece (without it the piece is a plain diamond in the player's colour) | square, transparent, 256×256, subject centred |
| `cards[id]` | behind the card's grid (bottom is darkened) | 3:4, 240×320 WebP |
| `logo` | title screen, replaces the text logo | wide transparent PNG/SVG, up to 920×360 |
| `background` | whole page, fixed | 1920×1080 JPG/WebP, dark enough for text |
| `board` | behind the squares | 5:3, 1500×900 |
| `tile` | every board square | square, 256×256, subtle |
| `cardBack` | face-down cards during the reveal | 3:4, 240×320 |

Without fighter art, the vector emblems in `src/ui/emblems.ts` are used (tinted with the fighter's
`color`). You can also add new vector shapes there and point a fighter's `emblem` at them.

## 5. Sounds and music
List files in `ASSETS.sounds` by id and `ASSETS.music.menu` / `.battle`. Short MP3 or OGG files work
everywhere; music files should loop cleanly. Anything left out uses the built-in synthesized sound.

| Sound id | Plays when |
|---|---|
| `click` | any button |
| `place`, `deny` | a card is planned / an illegal move is refused |
| `reveal`, `flip` | the reveal starts / a card turns face up |
| `step`, `thud` | fighters move / someone is pushed or pulled |
| `slash`, `burst`, `wave`, `beam`, `quake` | an attack lights up (by the card's `fx`) |
| `hit`, `guard`, `miss` | an attack lands / is guarded / misses |
| `clang`, `zap`, `shimmer`, `heal`, `reload` | counter, stun, drain, heal, Reload |
| `trap`, `burn`, `swap` | a trap springs, an attack burns its user (recoil), fighters swap places |
| `ko`, `win` | knockout / victory |
| `tick` | the last 10 seconds of the plan timer |

## 6. Browser icon, app name and home-screen icons
- **Tab icon:** an inline SVG in `index.html` (`<link rel="icon" …>`). Replace it with your own, for
  example `<link rel="icon" href="/favicon.png">` with the file in `public/`.
- **Installed app:** `public/manifest.webmanifest` holds the name shown under the home-screen icon
  (`name`, `short_name`), the splash colours (`background_color`, `theme_color`) and the icon list.
  Also update `apple-mobile-web-app-title` in `index.html` for iPhones.
- **Icons:** `public/icons/` has `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (art kept in
  the middle 80%, since phones may crop it to a circle) and `apple-touch-icon.png` (180×180).
  Either drop in your own PNGs with the same names, or edit the SVG in `scripts/icon.html` and run
  `node scripts/make-icons.mjs` (uses a local Chrome; pass its path if it isn't in the default place).
- **Offline files:** the build lists everything the app needs offline in `precache.json`
  automatically. If you add files to `public/` that the game loads at runtime (images, sounds,
  fonts), add them to `PUBLIC_FILES` in `vite.config.ts` so they work offline too.

## 7. Check your reskin
1. `npm run dev` and play: title, a tutorial round, a hot-seat round, fighter select, profile.
2. `npm test` (rules and content checks) and `npm run build`.
3. If you changed any numbers: `npm run balance`.
4. Look at the phone layout (about 390×844) as well as desktop.

# PROMPTCASTER — Handoff (Claude → Codex)

A two-boss browser RPG where the player's **prompt is the weapon**. A Prompt Mage first
duels the Regex Goblin, then the Null Oracle; an LLM "Arbiter" scores each prompt and
**damage scales with the score**. This document is the current source of truth — it
supersedes the original pre-redesign handoff.

Live demo: https://prompt-caster.vercel.app

---

## 1 · Stack & run

- **Frontend:** React 19 + TypeScript, single-page, hand-rolled CSS design system (no UI
  libs). JetBrains Mono everywhere (loaded in `index.html`).
- **Backend:** Express (`server.ts`) for local dev plus Vercel serverless routes (`api/`) —
  judge endpoints + LLM call + local fallback + cache.
- **Build/dev:** Vite.
- **Hosted demo:** `https://prompt-caster.vercel.app`

```bash
npm install
npm run dev       # tsx server.ts → http://localhost:5173
npm run build     # tsc && vite build
npm run preview   # tsx server.ts --prod  (serves dist/)
```

> ⚠️ `npm run dev` runs `tsx server.ts`, which **does not hot-reload `server.ts`**. After
> editing the backend (e.g. the judge prompt), **restart the dev server**. Restarting also
> clears the in-memory judge cache (stale verdicts persist until then). Client code
> (`src/`) hot-reloads normally via Vite.

---

## 2 · Files

| File | Role |
|------|------|
| `src/main.tsx` | Everything client-side: game state, combat loop, all components, sprites, the onboarding tour, the judge normalizer + local fallback. |
| `src/styles.css` | Full design system: tokens, layout, arena VFX, animations, the desktop fit-to-viewport rules, tour styles. |
| `server.ts` | Local Express server for `/api/judge-status`, `/api/judge-prompt`, the Arbiter system prompt, the LLM call, server-side normalize + local fallback, cache. |
| `api/judge-status.ts` / `api/judge-prompt.ts` | Vercel serverless versions of the same judge endpoints; required for the hosted demo. |
| `index.html` | Entry; loads JetBrains Mono. |
| `.env` (git-ignored) / `.env.example` | `AI_API_KEY`, optional compatibility `VITE_AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`. Key is **server-only**. |
| `docs/screenshots/` | README imagery. |

---

## 3 · Game logic (current, tuned — leave as-is unless asked)

Constants live at the top of `src/main.tsx`:

```
PLAYER_MAX_HP   = 90
PLAYER_MAX_TOKENS = 60      // regen +8 each surviving turn
TOKEN_REGEN     = 8
MAX_HIT         = 44
ENEMIES[0].maxHp = 170     // Regex Goblin
ENEMIES[1].maxHp = 190     // Null Oracle
PATTERN_MEMORY  = 3
BLANK_PATTERN   = /\[[^\]]+\]/
```

- **Damage from score (not from the model):** `damageFromScore(s) = max(3, round(s/100 * 44))`.
  The judge's own `damage` field is ignored client-side so balance stays predictable and
  tied directly to the score.
- **Token cost:** `clamp(ceil(prompt.trim().length / 16), 6, 26)` — concise prompts cost less.
- **Enemies** live in the `ENEMIES` array:
  - Regex Goblin: weakness `role · target · tactic · result`; attacks Unexpected Token (13),
    Escaped Slash (11), Parentheses Trap (15).
  - Null Oracle: weakness `context · assumptions · success criteria · verification`; attacks
    Missing Context (14), False Premise (16), Ambiguous Prophecy (18).
- **Enemy attacks** cycle by turn: `enemy.attacks[(turn-1) % enemy.attacks.length]`. The next
  one is shown as a dashed "NEXT … −N HP" telegraph in the enemy stat card.
- **Turn order:** player casts → damage applies → if enemy alive, it retaliates, then tokens
  regen +8 and `turn++`. A kill skips the retaliation.
- **Boss progression:** killing Regex Goblin sets `phase='revealing'`, logs the deeper signal,
  switches to Null Oracle after a short delay, clears prompt/repetition memory, and restores
  HP/tokens to `PLAYER_MAX_HP` / `PLAYER_MAX_TOKENS`. Killing Null Oracle sets `phase='won'`.
- **Test bypass:** `getRequestedEnemyIndex()` reads `?boss=2`, `?boss=null-oracle`,
  `?enemy=null-oracle`, or `?start=oracle` and initializes directly on Null Oracle with full
  HP/tokens plus a "TEST OVERRIDE" log. `reset()` preserves the requested starting boss.

### Anti-abuse (the core of the design — keep all of it)

The whole point is *writing* prompts, so shortcuts are neutralized:

1. **Skeleton templates.** The 3 template buttons load a *shape* full of `[blanks]`
   (`You are [your fighter or caster role]. Attack [name the enemy]…`). `canCast` is false while any
   `BLANK_PATTERN` match remains; there is also a hard guard in `cast()`.
2. **Borrowed = 0 damage.** Clipboard paste (≥8 chars) is recorded in `borrowedChunksRef`;
   while a recorded chunk still appears verbatim in the prompt, `borrowed` is true and the
   cast is **REJECTED** for 0 damage. Editing the text (so the chunk no longer matches)
   clears it. Loading a template does **not** mark borrowed (blanks gate it instead).
3. **Pattern resistance.** The enemy remembers the last `PATTERN_MEMORY` casts (word sets)
   for the current fight only. Memory is cleared when Null Oracle is revealed.
   `patternResistance()` takes the max Jaccard similarity vs that history; multiplier =
   `sim≥.85→.2, ≥.65→.45, ≥.5→.7, else 1`. Repeats/near-repeats are heavily reduced and a
   `RESISTED` warning is logged. Cycling distinct prompts avoids it.
4. **Token economy.** Length-scaled cost vs +8 regen makes rambling expensive.

### Relics (live prompt-quality indicators, computed via `useMemo`)

| Sigil | Charges when prompt… | test |
|------|----------------------|------|
| SYS | opens with "you are…" | `/^\s*you are\b/i` |
| CLR | uses clear/concrete/tactical/checkable spellcraft language | `/\b(clear|concrete|precise|concise|specific|structured|focused|tactical|disciplined|verify|verification|confirm|checkable)\b/i` |
| CTX | names the active enemy | Regex Goblin accepts `"regex goblin"`/`"goblin"`; Null Oracle accepts `"null oracle"`/`"oracle"` |

Shown both as live chips in the composer footer and as the bottom-row **Relics** panel.

### Cast-loop timeline (animations are tuned to these offsets)

```
t=0      phase='casting'; tokens-=cost; log 'player'
         (borrowed → fixed REJECTED judgment, no fetch; else cache→fetch→normalize→fallback)
         compute resistance; setLastJudge; setBeam(now)
t=720    enemyHp-=effectiveDamage; hit flash; floater (-dmg / RESISTED / REJECTED);
         screen shake on critical; push 'result' (+ 'warning' if resisted/borrowed)
t=1100   beam VFX unmounts
t=1200   if enemy dead → phase='won'
t=1280   else enemy attack: playerHp-=dmg; floater; log 'enemy'; turn++; regen; phase
```

---

## 4 · The Arbiter (AI judge)

`POST /api/judge-prompt` receives only:

```json
{ "enemy": "Regex Goblin",
  "weakness": "role · target · tactic · result",
  "relics": ["System Prompt Crown","Clarity Gem","Context Blade"],
  "playerPrompt": "..." }
```

The same contract is used for Null Oracle:

```json
{ "enemy": "Null Oracle",
  "weakness": "context · assumptions · success criteria · verification",
  "relics": ["System Prompt Crown","Clarity Gem","Context Blade"],
  "playerPrompt": "..." }
```

No combat history is ever sent. Returns JSON with these keys:

```json
{ "score": 0-100, "quality": "misfire|weak|solid|critical", "damage": 0-45,
  "reason": "one sharp critique naming the decisive technique/flaw",
  "terminalText": "one cinematic dark-fantasy line",
  "improvement": "one concrete fix to raise the score" }
```

- `server.ts` `SYSTEM_PROMPT` casts the judge as **"THE ARBITER"** — a constructive combat
  coach and master prompt-engineer. The rubric evaluates two layers: combat intent
  (role/persona, target, action, intended effect, specificity) and reliability upgrades
  (constraints, sequence, context/examples, confirmation, enemy adaptation). Regex Goblin
  tests ambiguity/malformed intent; Null Oracle tests missing context, assumptions, false
  premises, success criteria, and verification. Regex/code symbols are optional flavor only
  and should not be over-rewarded.
  `temperature: 0.3`, `max_tokens: 180`, `response_format: json_object`, score bands,
  recognition rules, and hard caps anchor the tone.
- Current scoring is deliberately **human-prompt adapted**. Fantasy/combat prompts such as
  warrior, mage, rogue, commander, analyst, or coach can score well when they contain a
  clear role, target, action, intended effect, and at least one tactical/reliability detail.
  Formal prompt-engineering language is helpful but not required.
- Both server and client **normalize/clamp** the result (reason ≤180, terminalText ≤140,
  improvement ≤140). Client recomputes `damage = damageFromScore(score)`.
- `applyPromptcraftBounds()` is the server-side safety layer after the LLM response. It caps
  missing target/action, missing intended effect, no specificity, no confirmation/constraint,
  no enemy adaptation, very short prompts, vague prompts, and code/regex-only prompts. It also
  boosts good human intent to solid/critical floors when the prompt earns them. It now
  recognizes both combat verbs and analytical verbs such as audit, verify, validate,
  challenge, test, and prove.
- `alignJudgeNarrative()` prevents confusing verdicts: if the final score is solid/critical,
  terminal text containing miss/fail/fizzle/dodge/evade/unbound-style wording is replaced
  with a clean hit line. It also removes some redundant "add a number" advice when the player
  already gave a number.
- **Cache** keyed by `enemy + prompt` (server `cache` Map + client `cacheRef`); repeats
  return `source:"cache"`.
- **Fallback:** if the provider fails or no key is set, a deterministic local scorer runs
  (role, target, action, intended effect, specificity, constraints, structure, context,
  examples, confirmation, enemy adaptation, length, and small optional technical-detail
  bonus), then uses the same broad caps/floors so offline scoring stays aligned with the LLM
  path. Human prompts can land solid/critical; regex-symbol-only prompts stay weak/misfire.
  Top-bar pill shows `LLM JUDGE` vs `LOCAL JUDGE`.
- The verdict (quality · score, `reason`, and `▸ TO IMPROVE: improvement`) renders in the
  bottom-row **ARBITER · VERDICT** panel; `RESISTED`/`REJECTED` states are reflected there.

---

## 5 · UI / design system

Ported from a Claude-Design handoff (now fully in `src/`). North star: a serious **CLI/IDE**
aesthetic — tight 1px borders, square corners, mono type, restrained accents
(`--mage` mint = player, `--enemy` coral = foe, `--judge` amber = judge/cost/charge), all in
`oklch`. Tokens are at the top of `styles.css`.

**Layout (top → bottom):** topbar → stats (two combatant cards bracketing a "vs" rail) →
main grid `1fr : 1.25fr` (**ArenaPanel** | **ComposerPanel**) → bottom grid 3-col
(**VerdictPanel** | **RelicsPanel** | combat **log**).

**Fits one screen, no scroll (desktop ≥1000px):** see the `@media (min-width:1000px)` block
in `styles.css`. `.app` is `height:100vh; display:flex; flex-direction:column; overflow:hidden`.
Topbar/stats/bottom are `flex-shrink:0`; `.main` is `flex:1`. The **arena floor** (`.arena
flex:1`) and the **textarea** both grow to fill, so there's no dead space and the arena is
the large centerpiece.

**Composer containment (do not regress):** `.spell-input` wraps gutter + textarea with
`overflow:hidden`; the textarea is `min-height:0` so it shrinks to its box and scrolls
internally instead of overlapping the `SYS/CLR/CTX` footer. Blank/paste warnings render as
inline `.spell-note` text inside `.spell-meta-left` beside the relic chips, not as a
separate row, so the textarea keeps its vertical space. `.spell-area` has a min-height floor
so the CAST button never spills past the panel border on shorter windows. The line-number
gutter is decorative (does not scroll with content).

**Key components in `src/main.tsx`:** `Stats`/`Bar`, `ArenaPanel` (perspective floor, drifting
motes, scanline, viewfinder brackets, scene HUD, figure tags w/ mini-HP, spinning **reticle**
when armed, **windup** telegraph, staggered **cast-fx** orb→beam→impact→sparks, floaters),
`ComposerPanel` (gutter, live relic chips, inline warning state, token cost, skeleton templates, cast-row),
`VerdictPanel`, `RelicsPanel`, `MageSprite`, `GoblinSprite`, `NullOracleSprite` (SVG,
`crispEdges`). `EnemySprite` chooses the active enemy sprite; Null Oracle has a separate
pixel body plus flickering eye/omen animation.

---

## 6 · Onboarding tour

Dependency-free guided walkthrough (`OnboardingTour` + `TOUR_STEPS` in `src/main.tsx`,
`.tour-*` styles in `styles.css`):

- Dark overlay via a spotlight `box-shadow`; glowing highlight that **smoothly glides**
  between steps; a full-screen **blocker** makes the rest of the UI inert; an **animated
  arrow** points at the target; a floating card has step counter, progress bar, and
  **Back / Next / Skip Tutorial**. Keyboard: ←/→, Enter, Esc.
- Steps target existing class selectors (`.composer-panel`, `.relics-panel`, `.cast-btn`,
  `.arena-panel`, `.stats`, `.verdict-panel`, `.log-panel`); step 0 is a centered welcome.
- Auto-starts once (remembered via `localStorage` key `pc_tour_done`); replay via the
  **`? tour`** pill in the top bar.

---

## 7 · Constraints to preserve

- Single-page; **two-enemy gauntlet only** (Regex Goblin → Null Oracle); no
  inventory/maps/accounts/multiplayer.
- API key **server-only**; never send combat history to the LLM; keep compact JSON-only
  output; keep the local fallback and the cache.
- Hosted Vercel deploys must keep `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` configured in
  the Vercel dashboard. If the top-bar judge pill falls back/offline on Vercel while local
  works, check those env vars and the serverless `api/` deployment first.
- Keep all four anti-abuse systems (skeletons, borrowed=0, resistance, tokens).
- Keep the serious CLI/IDE mood; 1px borders, square corners, the three accents.

---

## 8 · Notes for next steps

- **Balance:** Regex Goblin is the opener at 170 HP. Null Oracle is slightly heavier at 190
  HP, but the player enters it fully restored. If asked to lengthen the gauntlet, adjust
  `ENEMIES[*].maxHp`, attack damage, and/or `TOKEN_REGEN`; keep the full restore between
  bosses unless explicitly asked otherwise.
- **Verifying UI changes without a browser in the loop:** there's a headless-Chrome +
  Pillow workflow used heavily during the redesign — render the running app and crop
  regions to actually *see* layout instead of guessing:
  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=2 --window-size=1440,900 \
    --screenshot=/tmp/shot.png http://localhost:5173
  ```
  Then crop with PIL. Test at 1280×720 too — that's the tight case for the no-scroll layout.
- The original Claude-Design source folder (`prompt caster claudedesign/`) has been removed;
  its visual system is fully ported into `src/`.

---

## 9 · Useful commands

```bash
curl -s http://localhost:5173/api/judge-status
curl -s -X POST http://localhost:5173/api/judge-prompt \
  -H 'Content-Type: application/json' \
  -d '{"enemy":"Regex Goblin","weakness":"role · target · tactic · result","relics":["System Prompt Crown","Clarity Gem","Context Blade"],"playerPrompt":"You are an old war fighter. Throw three precise knives at the Regex Goblin casting hand, interrupt its spell, and confirm it loses health."}' | python3 -m json.tool

curl -s -X POST http://localhost:5173/api/judge-prompt \
  -H 'Content-Type: application/json' \
  -d '{"enemy":"Null Oracle","weakness":"context · assumptions · success criteria · verification","relics":["System Prompt Crown","Clarity Gem","Context Blade"],"playerPrompt":"You are a truth auditor. Give the Null Oracle clear context, state the assumptions, expose the false premise, verify the success criteria, and confirm its ward loses health."}' | python3 -m json.tool

# Browser shortcut for testing the second boss directly:
# http://localhost:5173?boss=null-oracle
```

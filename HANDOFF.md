# PROMPTCASTER — Handoff (Claude → Codex)

A single-encounter browser RPG where the player's **prompt is the weapon**. A Prompt Mage
duels the Regex Goblin; an LLM "Arbiter" scores each prompt and **damage scales with the
score**. This document is the current source of truth — it supersedes the original
pre-redesign handoff.

---

## 1 · Stack & run

- **Frontend:** React 19 + TypeScript, single-page, hand-rolled CSS design system (no UI
  libs). JetBrains Mono everywhere (loaded in `index.html`).
- **Backend:** Express (`server.ts`) — judge endpoints + LLM call + local fallback + cache.
- **Build/dev:** Vite.

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
| `server.ts` | `/api/judge-status`, `/api/judge-prompt`, the Arbiter system prompt, the LLM call, server-side normalize + local fallback, cache. |
| `index.html` | Entry; loads JetBrains Mono. |
| `.env` (git-ignored) / `.env.example` | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`. Key is **server-only**. |
| `docs/screenshots/` | README imagery. |

---

## 3 · Game logic (current, tuned — leave as-is unless asked)

Constants live at the top of `src/main.tsx`:

```
PLAYER_MAX_HP   = 90
PLAYER_MAX_TOKENS = 60      // regen +8 each surviving turn
TOKEN_REGEN     = 8
MAX_HIT         = 44
ENEMY.maxHp     = 170
PATTERN_MEMORY  = 3
BLANK_PATTERN   = /\[[^\]]+\]/
```

- **Damage from score (not from the model):** `damageFromScore(s) = max(3, round(s/100 * 44))`.
  The judge's own `damage` field is ignored client-side so balance stays predictable and
  tied directly to the score.
- **Token cost:** `clamp(ceil(prompt.trim().length / 16), 6, 26)` — concise prompts cost less.
- **Enemy attacks** cycle by turn: `attacks[(turn-1) % 3]` →
  Unexpected Token (13) · Escaped Slash (11) · Parentheses Trap (15). The next one is shown
  as a dashed "NEXT … −N HP" telegraph in the enemy stat card.
- **Turn order:** player casts → damage applies → if enemy alive, it retaliates, then tokens
  regen +8 and `turn++`. A kill skips the retaliation.

### Anti-abuse (the core of the design — keep all of it)

The whole point is *writing* prompts, so shortcuts are neutralized:

1. **Skeleton templates.** The 3 template buttons load a *shape* full of `[blanks]`
   (`You are [your caster role]. Target [name the enemy]…`). `canCast` is false while any
   `BLANK_PATTERN` match remains; there is also a hard guard in `cast()`.
2. **Borrowed = 0 damage.** Clipboard paste (≥8 chars) is recorded in `borrowedChunksRef`;
   while a recorded chunk still appears verbatim in the prompt, `borrowed` is true and the
   cast is **REJECTED** for 0 damage. Editing the text (so the chunk no longer matches)
   clears it. Loading a template does **not** mark borrowed (blanks gate it instead).
3. **Pattern resistance.** The goblin remembers the last `PATTERN_MEMORY` casts (word sets).
   `patternResistance()` takes the max Jaccard similarity vs that history; multiplier =
   `sim≥.85→.2, ≥.65→.45, ≥.5→.7, else 1`. Repeats/near-repeats are heavily reduced and a
   `RESISTED` warning is logged. Cycling distinct prompts avoids it.
4. **Token economy.** Length-scaled cost vs +8 regen makes rambling expensive.

### Relics (live prompt-quality indicators, computed via `useMemo`)

| Sigil | Charges when prompt… | test |
|------|----------------------|------|
| SYS | opens with "you are…" | `/^\s*you are\b/i` |
| CLR | uses precise/concise/specific/structured | `/\b(precise|concise|specific|structured)\b/i` |
| CTX | names the enemy | includes `"regex goblin"` |

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
  "weakness": "precise structured syntax-focused prompts",
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

- `server.ts` `SYSTEM_PROMPT` casts the judge as **"THE ARBITER"** — a ruthless master
  prompt-engineer. `temperature: 0.45`, `max_tokens: 260`, `response_format: json_object`,
  two worked examples (critical + misfire) anchor the tone.
- Both server and client **normalize/clamp** the result (reason ≤180, terminalText ≤140,
  improvement ≤140). Client recomputes `damage = damageFromScore(score)`.
- **Cache** keyed by `enemy + prompt` (server `cache` Map + client `cacheRef`); repeats
  return `source:"cache"`.
- **Fallback:** if the provider fails or no key is set, a deterministic local scorer runs
  (same heuristics as the relics + length + metacharacters), so the game always plays.
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
internally instead of overlapping the `SYS/CLR/CTX` footer. `.spell-area` has a min-height
floor so the CAST button never spills past the panel border on shorter windows. The line-
number gutter is decorative (does not scroll with content).

**Key components in `src/main.tsx`:** `Stats`/`Bar`, `ArenaPanel` (perspective floor, drifting
motes, scanline, viewfinder brackets, scene HUD, figure tags w/ mini-HP, spinning **reticle**
when armed, **windup** telegraph, staggered **cast-fx** orb→beam→impact→sparks, floaters),
`ComposerPanel` (gutter, live relic chips, token cost, skeleton templates, cast-row),
`VerdictPanel`, `RelicsPanel`, `MageSprite`/`GoblinSprite` (SVG, `crispEdges`).

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

- Single-page; **one enemy** (Regex Goblin); no inventory/maps/accounts/multiplayer.
- API key **server-only**; never send combat history to the LLM; keep compact JSON-only
  output; keep the local fallback and the cache.
- Keep all four anti-abuse systems (skeletons, borrowed=0, resistance, tokens).
- Keep the serious CLI/IDE mood; 1px borders, square corners, the three accents.

---

## 8 · Notes for next steps

- **Balance** (per the owner, currently frozen): a live playtest had a skilled player win in
  ~5 casts (target was 6–9). If asked to extend the fight: bump `ENEMY.maxHp` toward ~210
  and/or lower `TOKEN_REGEN` to make tokens bite. The damage curve and attack values felt
  good as-is.
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
  -d '{"enemy":"Regex Goblin","weakness":"precise structured syntax-focused prompts","relics":["System Prompt Crown","Clarity Gem","Context Blade"],"playerPrompt":"You are a precise regex exorcist. Bind the Regex Goblin with /^valid\\/(token|slash)$/ and escape every literal slash."}' | python3 -m json.tool
```

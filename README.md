<div align="center">

# PROMPT·CASTER

**A retro terminal RPG where your prompt is the weapon.**

You play a Prompt Mage dueling hostile prompt failures inside a dungeon parser. There are no attack buttons — you *write* spells. An LLM judge (the **Arbiter**) scores how good your prompt is, that score becomes your damage, and the run grades you with score, rank, and combo.

**Live demo:** [prompt-caster.vercel.app](https://prompt-caster.vercel.app)

![PromptCaster — full interface](docs/screenshots/overview.png)

</div>

---

## What is it?

PromptCaster turns prompt engineering into a combat system. Each turn you compose a prompt aimed at the enemy's weakness; the Arbiter grades your spellcraft in two layers: usable combat intent (role, target, action, effect) and reliability upgrades (specific tactic, constraints, sequence, confirmation, enemy adaptation). Better prompts hit harder, build combo, and push your run rank higher — sloppy ones fizzle and break momentum.

The current judge is intentionally human-prompt friendly: a warrior, mage, commander, rogue, analyst, or prompt coach prompt can all score well if they clearly say who is acting, what they target, what they do, and what result they want. Regex/code syntax is optional flavor, not a requirement.

It's a focused two-boss gauntlet built as a serious **CLI/IDE-flavored** interface: tight borders, mono type, a live combat "viewport," and restrained mint/coral/amber accents. The prompt is the weapon, the arena is the scope, the judge is the trigger.

![Mid-battle](docs/screenshots/gameplay.png)

---

## How to play

1. **Write a spell** in the composer. Aim at the active enemy's weakness. Add constraints, context, sequence, or confirmation for a harder hit.
2. **Watch the relics light up** as your prompt satisfies them (see below) — they're live feedback on prompt quality.
3. **Cast** (button or `⌘/Ctrl + Enter`). The Arbiter scores your prompt; **damage scales with the score**.
4. **Chase score and combo.** Solid and critical casts build combo; resisted, weak, misfired, or borrowed casts slow you down.
5. **Read the verdict.** The Arbiter tells you what landed, which relic checks triggered, and exactly what to improve next turn.
6. **Draft a reward.** Beat Regex Goblin and choose one upgrade before Null Oracle.
7. **Survive the gauntlet.** After your cast, the enemy strikes back. Your HP and tokens restore to full before the second boss.

### Enemies

| Boss | HP | Weakness | Attacks |
|------|----|----------|---------|
| Regex Goblin | 170 | role · target · tactic · result | Unexpected Token · Escaped Slash · Parentheses Trap |
| Null Oracle | 190 | context · assumptions · success criteria · verification | Missing Context · False Premise · Ambiguous Prophecy |

### Relics — live prompt-quality indicators

| Sigil | Relic | Charges when your prompt… |
|------|-------|----------------------------|
| `SYS` | System Prompt Crown | opens with **"You are…"** |
| `CLR` | Clarity Gem | uses **clear / concrete / tactical / checkable** spellcraft language |
| `CTX` | Context Blade | names the active enemy directly |

### Run scoring, rank, and combo

The top bar now tracks a persistent run score and combo meter. Every cast earns run score from the Arbiter score, effective damage, charged relics, quality tier, and active combo. Solid casts add `+1` combo, critical casts add `+2`, repeated resisted patterns cool the combo down, and misfires/borrowed casts break it.

Boss clears add bonus score, and the final gauntlet clear adds survival bonus from remaining HP/tokens. The end screen shows your rank (`D` → `S`), total score, best combo, best hit, casts, critical count, clear bonus, medals, and penalties — so the replay goal is not only "win," but win cleanly.

### Run medals

Medals are one-time score bonuses for strong play patterns:

| Medal | Unlock |
|-------|--------|
| Critical Thesis | land a clean critical cast |
| Full Sigil | charge `SYS`, `CLR`, and `CTX` on one cast |
| Chain Caster | reach combo `x3` |
| Heavy Impact | deal at least `36` damage in one cast |
| Clean Gauntlet | finish with no resisted or rejected casts |

### Reward draft

After Regex Goblin falls, the run pauses for a three-choice relic draft:

| Reward | Effect |
|--------|--------|
| Token Siphon | solid or critical casts refund `6` tokens |
| Combo Lens | all three relics charged adds `+1` combo and `+60` score |
| Ward Script | enemy attacks deal `4` less damage |

The draft makes the second boss feel different depending on how you want to play: economy, rank chase, or survival.

---

## The Arbiter (AI judge)

When you cast, the frontend sends a compact payload to the backend, which asks an OpenAI-compatible chat API for **JSON only**:

```json
{ "enemy": "Regex Goblin",
  "weakness": "role · target · tactic · result",
  "relics": ["System Prompt Crown", "Clarity Gem", "Context Blade"],
  "playerPrompt": "You are an old war fighter. Throw three precise knives at the Regex Goblin's casting hand, interrupt its spell, and confirm it loses health." }
```

The Arbiter returns a sharp, in-character critique:

```json
{ "score": 82, "quality": "critical", "damage": 37,
  "reason": "Strong craft: role, target, action, and effect are clear; refine with sharper enemy-specific detail.",
  "terminalText": "The knives strike the Regex Goblin's casting hand, severing its connection to dark magic.",
  "improvement": "Refine further: name the exact weakness or risk the strike exploits." }
```

- **No combat history is ever sent** — only the four fields above.
- The API key lives **server-side only**; the browser never sees it.
- The judge uses compact JSON-only chat completions (`temperature: 0.3`, `max_tokens: 180`) and the server validates/clamps the result.
- Code-only or regex-symbol-only prompts are capped low unless they include plain-language combat intent and an intended effect.
- Solid/critical verdicts are guarded so the terminal text cannot claim the spell missed or failed after awarding strong damage.
- Identical prompts are **cached**; if the provider is unavailable, a **local fallback judge** scores offline so the game always plays.
- The displayed verdict (quality · score, score gain/combo, relic trigger breakdown, critique, and a `▸ TO IMPROVE` line) lives in its own panel:

![Verdict · relics · log](docs/screenshots/verdict-log.png)

---

## Anti-cheese mechanics

The whole point is *writing* good prompts, so several systems make shortcuts worthless:

- **Skeleton templates, not answers.** The three template buttons load a *shape* full of `[blanks]` (`You are [your fighter or caster role]. Attack [name the enemy]…`). A prompt containing any unfilled `[blank]` **cannot be cast** — the inline warning sits beside the `SYS / CLR / CTX` chips until you write the substance yourself.
- **Borrowed words deal 0 damage.** Pasted text (or a template left verbatim) is flagged and lands for nothing until you rewrite it in your own words.
- **The enemy adapts.** It remembers your last few casts within the current fight; reusing the same pattern is **resisted** (damage falls off), so you must keep your prompts varied. Pattern memory clears between bosses.
- **Tokens are a resource.** Every cast costs tokens scaled to prompt length, with a small per-turn regen — rambling drains you, concision is rewarded.
- **Combo rewards clean play.** Strong varied casts raise the meter; repeated, rejected, or unclear casts lower the final rank.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/arena.png" alt="Arena viewport"/></td>
<td width="50%"><img src="docs/screenshots/composer.png" alt="Spell composer"/></td>
</tr>
<tr>
<td align="center"><em>The arena viewport — perspective floor, reticle, cast VFX.</em></td>
<td align="center"><em>The composer — line gutter, live relic chips, inline warnings, token cost.</em></td>
</tr>
</table>

---

## Onboarding tour

First-time players get a guided, cinematic walkthrough that spotlights each part of the UI in turn — a dark overlay dims the screen, the current element gets a glowing highlight, and a floating card (with an animated arrow pointing at it) explains the feature. Navigate with **Back / Next / Skip**, the arrow keys, or `Esc`; the rest of the UI is locked while it runs. It auto-starts once and can be replayed anytime via the **`? tour`** button in the top bar.

![Onboarding tour](docs/screenshots/tour.png)

---

## Tech stack

- **Frontend:** React 19 + TypeScript, single-page app, hand-rolled CSS design system (JetBrains Mono, `oklch` accents), SVG sprites.
- **Backend:** Express server for local dev plus Vercel serverless API routes (`api/judge-status.ts`, `api/judge-prompt.ts`), calling an OpenAI-compatible chat API with a strict JSON contract + local fallback.
- **Build/dev:** Vite.

---

## Getting started

Hosted build: [https://prompt-caster.vercel.app](https://prompt-caster.vercel.app)

```bash
# 1. install
npm install

# 2. configure the judge (optional — falls back to a local scorer if omitted)
cp .env.example .env
#   then set AI_API_KEY, and AI_BASE_URL / AI_MODEL for your provider
#   (OpenAI, OpenRouter, or any OpenAI-compatible endpoint)

# 3. run
npm run dev            # http://localhost:5173

# production build + serve
npm run build
npm run preview
```

Second-boss test shortcut:

```text
http://localhost:5173?boss=null-oracle
http://localhost:5173?boss=2
```

That starts directly on Null Oracle with full HP/tokens and logs a test override. `?enemy=null-oracle` and `?start=oracle` work too.

`.env` keys:

| Key | Purpose | Default |
|-----|---------|---------|
| `AI_API_KEY` | Server-side API key (never exposed to the client) | — |
| `VITE_AI_API_KEY` | Compatibility fallback read by the server; prefer `AI_API_KEY` for deployment | — |
| `AI_BASE_URL` | OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `AI_MODEL` | Model id | `gpt-4o-mini` |

> The judge pill in the top bar shows `LLM JUDGE` when a key is configured, or `LOCAL JUDGE` when running on the offline fallback. Restart `npm run dev` after editing `.env`.

---

## Project structure

```
src/
  main.tsx     # all game state, combat loop, UI components, sprites
  styles.css   # design tokens, layout, arena VFX, animations
api/
  judge-status.ts   # Vercel serverless status endpoint
  judge-prompt.ts   # Vercel serverless judge endpoint
server.ts      # local Express server: judge endpoints, LLM call, fallback, cache
index.html     # entry (loads JetBrains Mono)
docs/screenshots/   # README imagery
```

---

## Design notes

A two-boss prototype, deliberately scoped: Regex Goblin into Null Oracle, no inventory/maps/accounts. The intent is to make the **first ten seconds self-explanatory** and every cast feel consequential — a debugger attached to a dungeon, not a cartoon mage. The visual system (arena viewport, reticle, beam/impact VFX, relic LEDs) all exists to show *what your prompt did* to a hostile prompt failure.

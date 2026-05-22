# PROMPTBOUND.EXE Handoff

## Project Goal

PROMPTBOUND.EXE is a single-page React + TypeScript + Tailwind prototype for a serious retro pixel RPG mixed with an AI terminal. The player is a Prompt Mage fighting one enemy, Regex Goblin, by writing prompts as spell casts.

The current objective is not to expand content yet. Improve clarity, UI polish, battle feel, and player onboarding for this first encounter.

## Current Stack

- Frontend: React 19, TypeScript, Tailwind CSS, Vite
- Backend: Express server in `server.ts`
- Dev entry: `npm run dev`
- Production build: `npm run build`
- Local URL: `http://localhost:5173`

## Important Files

- `src/main.tsx`: all game state, combat logic, UI components, prompt presets
- `src/styles.css`: pixel/terminal/dungeon styling and sprite CSS
- `server.ts`: Express server, `/api/judge-status`, `/api/judge-prompt`, LLM call, fallback scoring, cache
- `.env`: local API config, do not print or commit secrets
- `.env.example`: safe template
- `README.md`: setup and play instructions

## Current Game Loop

1. Player edits prompt in the right terminal panel.
2. Player clicks `CAST`.
3. Frontend sends only this compact payload to `/api/judge-prompt`:

```json
{
  "enemy": "Regex Goblin",
  "weakness": "precise structured syntax-focused prompts",
  "relics": ["System Prompt Crown", "Clarity Gem", "Context Blade"],
  "playerPrompt": "..."
}
```

4. Backend asks an OpenAI/OpenRouter-compatible chat completions API for JSON only.
5. Backend validates/normalizes the JSON and returns:

```json
{
  "score": 85,
  "quality": "critical",
  "damage": 40,
  "reason": "Short reason.",
  "terminalText": "Short cinematic result.",
  "source": "ai"
}
```

6. Frontend applies damage to Regex Goblin.
7. Enemy attacks after the player turn.
8. Player wins when enemy HP reaches 0, loses when player HP reaches 0.

## AI/API Status

The API key is server-only. The frontend never receives it.

Current `.env` is configured for OpenRouter because the key looked like `sk-or-v1...`:

```env
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-4o-mini
```

The key itself is in `AI_API_KEY`.

Tested status:

- `/api/judge-status` returns LLM mode.
- `/api/judge-prompt` returned a valid LLM result with `"source":"ai"`.
- Repeating the same prompt returns `"source":"cache"`.
- If the provider fails, the backend uses local fallback scoring.

## Backend Details

`server.ts`:

- Loads `.env` using `dotenv/config`.
- Adds OpenRouter-friendly headers:
  - `HTTP-Referer`
  - `X-Title`
- Uses:
  - `temperature: 0.3`
  - `max_tokens: 160`
  - `response_format: { type: "json_object" }`
- Does not send full combat history.
- Caches by `enemy + prompt`.

Fallback scoring rewards:

- Prompt starts with `You are`
- Includes clarity words like `precise`, `concise`, `specific`, `structured`
- Mentions `Regex Goblin`
- Uses syntax/regex terms
- Has reasonable length
- Includes regex-like symbols

## Current UI State

The UI has:

- Left side battle scene with CSS pixel sprites
- Right side AI terminal
- Player HP, tokens, enemy HP
- Relics
- Terminal combat log
- Prompt textarea
- Prompt preset buttons: `Structured`, `Regex`, `Fast`
- Visible judge mode: `LLM JUDGE` or `LOCAL JUDGE`
- Clearer battle instructions: `1 write`, `2 cast`, `3 survive`
- Labeled bars for `HP`, `TOKENS`, `ENEMY HP`

Recent UI fix:

The HP/token bars used to appear as anonymous colored lines. They now have labels and current/max values in `CombatantPlate` / `HpBar` in `src/main.tsx`.

## What Needs Claude's Attention

Focus on improving the first battle experience without adding inventory, maps, accounts, databases, multiplayer, or multiple enemies.

Recommended review areas:

1. Visual hierarchy
   - Make it immediately obvious where to look first.
   - The player should understand: write prompt, cast, inspect result, survive.
   - The terminal and battle scene should feel integrated, not like two separate apps.

2. Battle feel
   - Add stronger visual feedback for casting, damage, enemy attack, win/loss.
   - Consider better animations, hit flashes, floating damage numbers, phase text, or brief screen shake.
   - Keep it serious and retro, not comedic.

3. Prompt input experience
   - Make prompt writing feel like spellcraft.
   - Consider clearer scoring hints without over-explaining.
   - Presets should teach good patterns without making the player feel the game plays itself.

4. Terminal log
   - It should be readable and cinematic.
   - Avoid long lines overwhelming the player.
   - Consider log grouping, icons/sigils, or stronger color semantics.

5. Layout polish
   - Check desktop and mobile.
   - Avoid overlapping text.
   - Make sure compact panels do not use oversized headings.
   - Avoid card-in-card clutter.

6. Game balance
   - Current player HP: `72`
   - Current tokens: `90`
   - Enemy HP: `100`
   - Enemy attacks:
     - `Unexpected Token`: 13 damage
     - `Escaped Slash`: 11 damage
     - `Parentheses Trap`: 15 damage
   - Prompt cost currently scales by prompt length: `8` to `22` tokens.

## Constraints To Preserve

- Keep it a single-page app.
- Keep only one enemy: Regex Goblin.
- Do not expose API keys to the frontend.
- Do not send full combat history to the LLM.
- Keep LLM output compact JSON only.
- Keep fallback scoring.
- Keep caching for repeated prompt/enemy pairs.
- Do not add inventory, map, login, database, multiplayer, or more enemies yet.
- Serious dark retro mood: green/amber terminal, pixel borders, dungeon atmosphere.

## Useful Commands

```bash
npm install
npm run dev
npm run build
curl -s http://localhost:5173/api/judge-status
```

Test the judge endpoint:

```bash
curl -s -X POST http://localhost:5173/api/judge-prompt \
  -H 'Content-Type: application/json' \
  -d '{
    "enemy": "Regex Goblin",
    "weakness": "precise structured syntax-focused prompts",
    "relics": ["System Prompt Crown", "Clarity Gem", "Context Blade"],
    "playerPrompt": "You are a regex exorcist. Target the Regex Goblin with a specific anchored pattern spell: /^valid\\\\/(token|slash)$/ and explain each escaped literal before release."
  }'
```

Expected when configured correctly:

- First result source: `"ai"`
- Repeat same request source: `"cache"`

## Suggested First Claude Task

Review the current UI and propose/implement a focused polish pass for the battle screen and terminal panel. The goal is to make the first 10 seconds self-explanatory and make each cast feel satisfying. Keep the backend contract unchanged unless there is a clear bug.

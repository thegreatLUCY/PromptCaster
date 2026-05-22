import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Quality = "misfire" | "weak" | "solid" | "critical";

type JudgeRequest = {
  enemy: string;
  weakness: string;
  relics: string[];
  playerPrompt: string;
};

type JudgeResult = {
  score: number;
  quality: Quality;
  damage: number;
  reason: string;
  terminalText: string;
  improvement: string;
  source?: "ai" | "fallback" | "cache";
};

const SYSTEM_PROMPT = [
  "You are THE ARBITER: a ruthless master prompt-engineer judging spells in a dark roguelike where prompts are magic.",
  "Score how well the player's prompt would actually steer an LLM to defeat the enemy. Weight: a clear system role, specificity, explicit structure/constraints, naming the target, and exploiting the stated weakness. Penalize vagueness, filler, hedging, and generic verbs.",
  "Be incisive and critical, never flattering. In `reason`, deliver one terse expert verdict that names the single most decisive technique the prompt used well OR the specific craft flaw that weakened it (e.g. 'anchored regex with escaped literals — surgical' or \"vague verb 'strike' with no pattern or constraint\"). Quote the player's own wording when it sharpens the critique.",
  "In `terminalText`, narrate the spell's impact cinematically and seriously — dark fantasy meets parser/compiler imagery. No emojis, no exclamation spam.",
  "Return JSON only."
].join(" ");

const cache = new Map<string, JudgeResult>();
const app = express();
const isProd = process.argv.includes("--prod");
const port = Number(process.env.PORT ?? 5173);

app.use(express.json({ limit: "8kb" }));

app.get("/api/judge-status", (_req, res) => {
  const hasApiKey = Boolean(process.env.AI_API_KEY ?? process.env.VITE_AI_API_KEY);
  res.json({
    mode: hasApiKey ? "llm" : "fallback",
    model: hasApiKey ? (process.env.AI_MODEL ?? "gpt-4o-mini") : "local-rules",
    baseUrl: hasApiKey ? (process.env.AI_BASE_URL ?? "https://api.openai.com/v1") : null
  });
});

app.post("/api/judge-prompt", async (req, res) => {
  const payload = sanitizePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid prompt judgment payload." });
    return;
  }

  const cacheKey = `${payload.enemy.toLowerCase()}::${payload.playerPrompt.trim().toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ ...cached, source: "cache" });
    return;
  }

  let result: JudgeResult;
  try {
    result = await judgeWithAi(payload);
  } catch {
    result = fallbackJudge(payload);
  }

  cache.set(cacheKey, result);
  res.json(result);
});

if (isProd) {
  app.use(express.static(resolve("dist")));
  app.get("*", async (_req, res) => {
    res.type("html").send(await readFile(resolve("dist/index.html"), "utf-8"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`PROMPTCASTER running on http://localhost:${port}`);
});

function sanitizePayload(input: unknown): JudgeRequest | null {
  const body = input as Partial<JudgeRequest>;
  if (
    !body ||
    typeof body.enemy !== "string" ||
    typeof body.weakness !== "string" ||
    typeof body.playerPrompt !== "string" ||
    !Array.isArray(body.relics)
  ) {
    return null;
  }

  const playerPrompt = body.playerPrompt.trim().slice(0, 700);
  if (!playerPrompt) return null;

  return {
    enemy: body.enemy.trim().slice(0, 80),
    weakness: body.weakness.trim().slice(0, 160),
    relics: body.relics.filter((item) => typeof item === "string").slice(0, 8),
    playerPrompt
  };
}

async function judgeWithAi(payload: JudgeRequest): Promise<JudgeResult> {
  const apiKey = process.env.AI_API_KEY ?? process.env.VITE_AI_API_KEY;
  if (!apiKey) throw new Error("Missing AI key.");

  const baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.AI_HTTP_REFERER ?? "http://localhost:5173",
      "X-Title": "PROMPTCASTER"
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            task: "Judge this prompt spell and return exactly these JSON keys: score, quality, damage, reason, terminalText, improvement.",
            allowedQuality: ["misfire", "weak", "solid", "critical"],
            limits: {
              score: "integer 0-100",
              damage: "integer 0-45",
              reason: "ONE sharp expert critique sentence naming the single most decisive technique or flaw, under 140 chars",
              terminalText: "ONE cinematic dark-fantasy sentence, under 120 chars",
              improvement: "ONE concrete, actionable fix the player could make to score higher; name the missing/weak element specifically (e.g. 'Add an explicit role: open with You are...' or 'Replace the vague verb with a concrete regex'), under 120 chars. Even for a critical spell, name the next refinement."
            },
            enemy: payload.enemy,
            weakness: payload.weakness,
            relics: payload.relics,
            playerPrompt: payload.playerPrompt,
            outputExamples: [
              {
                score: 88,
                quality: "critical",
                damage: 39,
                reason: "Opens with a system role, then anchors an escaped regex to the goblin's exact weakness — no wasted tokens.",
                terminalText: "The pattern locks shut like a closing bracket; the goblin's syntax unravels into validated ash.",
                improvement: "Tighten further: state the expected output format so the bind can't be reinterpreted."
              },
              {
                score: 22,
                quality: "misfire",
                damage: 6,
                reason: "Generic 'attack the goblin' with no role, no pattern, no constraint — nothing for the parser to bind.",
                terminalText: "The incantation dissolves into unparsed noise and dies before the goblin's ward.",
                improvement: "Open with an explicit role ('You are...'), name the Regex Goblin, and give one concrete escaped pattern."
              }
            ]
          })
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`AI provider failed: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content.");

  return normalizeJudgeResult(JSON.parse(content), "ai");
}

function normalizeJudgeResult(raw: Partial<JudgeResult>, source: "ai" | "fallback"): JudgeResult {
  const score = clampNumber(raw.score, 0, 100, 10);
  const quality = normalizeQuality(raw.quality, score);
  const defaultDamage = quality === "critical" ? 34 : quality === "solid" ? 24 : quality === "weak" ? 12 : 4;

  return {
    score,
    quality,
    damage: clampNumber(raw.damage, 0, 45, defaultDamage),
    reason: clampText(raw.reason, "The Arbiter finds nothing decisive in this casting.", 180),
    terminalText: clampText(raw.terminalText, "The spell resolves into flat terminal static.", 140),
    improvement: clampText(raw.improvement, "Add an explicit role, name the target, and give one concrete pattern.", 140),
    source
  };
}

function fallbackJudge(payload: JudgeRequest): JudgeResult {
  const prompt = payload.playerPrompt.toLowerCase();
  let score = 18;
  const hits: string[] = [];
  const misses: string[] = [];

  if (payload.playerPrompt.trim().startsWith("You are")) {
    score += 18;
    hits.push("a system role grounds the cast");
  } else {
    misses.push("no system role to anchor the spell");
  }
  if (/\b(precise|concise|specific|structured)\b/.test(prompt)) {
    score += 18;
    hits.push("clarity terms sharpen the intent");
  } else {
    misses.push("no clarity directive (precise/structured)");
  }
  if (prompt.includes(payload.enemy.toLowerCase())) {
    score += 16;
    hits.push("the target is named outright");
  } else {
    misses.push("the target is never named");
  }
  if (/\b(regex|syntax|pattern|escape|literal|token|constraint|step|json)\b/.test(prompt)) {
    score += 18;
    hits.push("syntax-focused wording exploits the weakness");
  } else {
    misses.push("nothing targets its syntax weakness");
  }
  if (payload.playerPrompt.length > 70 && payload.playerPrompt.length < 360) {
    score += 10;
    hits.push("tight, usable spell length");
  }
  if (/[{}[\]()/\\^$*+?.|]/.test(payload.playerPrompt)) {
    score += 10;
    hits.push("concrete regex sigils give it teeth");
  } else {
    misses.push("no concrete pattern for the parser to bind");
  }

  score = Math.min(100, score);
  const quality: Quality =
    score >= 82 ? "critical" : score >= 58 ? "solid" : score >= 30 ? "weak" : "misfire";
  const damage = quality === "critical" ? 36 : quality === "solid" ? 24 : quality === "weak" ? 12 : 5;
  const reason =
    quality === "critical" || quality === "solid"
      ? `Strong craft: ${hits.slice(0, 2).join(", ")}.`
      : misses.length
        ? `Weak craft: ${misses.slice(0, 2).join(", ")}.`
        : "The casting lacks any decisive prompt technique.";
  const improvement = misses.length
    ? `Fix this next: ${misses[0]}.`
    : "Refine further: specify the exact output format the bind should produce.";

  return {
    score,
    quality,
    damage,
    reason,
    terminalText:
      quality === "critical"
        ? "Green fire compiles into a flawless binding pattern."
        : quality === "solid"
          ? "The glyphs lock, then cut through the goblin's escape ward."
          : quality === "weak"
            ? "The spell sparks against a malformed token shield."
            : "The incantation collapses into inert terminal noise.",
    improvement,
    source: "fallback"
  };
}

function normalizeQuality(value: unknown, score: number): Quality {
  if (value === "misfire" || value === "weak" || value === "solid" || value === "critical") {
    return value;
  }
  return score >= 82 ? "critical" : score >= 58 ? "solid" : score >= 30 ? "weak" : "misfire";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.slice(0, maxLength);
}

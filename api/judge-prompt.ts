import "dotenv/config";

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

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

const serverDamageFromScore = (score: number) => Math.max(3, Math.round((score / 100) * 45));

const SYSTEM_PROMPT = [
  "You are THE ARBITER: a combat coach and master prompt-engineer judging spells in a dark roguelike where prompts are magic.",
  "Judge usable human intent first, advanced promptcraft second. A player may write as a warrior, mage, commander, rogue, analyst, or prompt coach. Do not require formal prompt-engineering language if the prompt clearly gives a role, target, action, and intended effect.",
  "Score in two layers. Layer 1 Combat Intent: role/persona, target, action, intended effect, and specific tactic. Layer 2 Promptcraft Reliability: constraints, sequence, enemy adaptation, examples/context, and confirmation/checking.",
  "Each enemy represents a prompt failure mode. Regex Goblin tests role, target, tactic, and result against ambiguity and malformed instructions. Null Oracle tests context, assumptions, success criteria, verification, and false-premise handling.",
  "Literal regex/code syntax can help only when it supports the action; never require it, never over-reward symbols, anchors, JSON, or compiler jargon by themselves.",
  "Recognition rules: combat actions like throw, strike, stab, cast, bind, interrupt, expose, disable, audit, verify, challenge, and weaken count as actions. Effects like lose health, damage, stop next attack, interrupt spell, break ward, expose a false premise, clarify context, verify truth, or disable count as intended effects. Body parts, weak points, number of strikes, named tactics, assumptions, evidence, and success criteria count as specificity. 'check', 'confirm', 'verify', 'ensure', and 'report whether it worked' count as confirmation.",
  "Be constructive, not just critical. In `reason`, always name what worked before naming the flaw when there is any usable intent. In `improvement`, give a concrete upgrade phrase the player could add next cast.",
  "Do not give a critical score if `terminalText` says the strike failed, fizzled, or remains unformed. Critical and solid results must narrate a real hit; weak and misfire results may fail.",
  "In `terminalText`, narrate the spell's impact cinematically and seriously — dark fantasy with terminal/parser atmosphere. No emojis, no exclamation spam.",
  "Return JSON only."
].join(" ");

const cache = new Map<string, JudgeResult>();

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const payload = sanitizePayload(parseBody(req.body));
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
}

function parseBody(body: unknown) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

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
      "HTTP-Referer": process.env.AI_HTTP_REFERER ?? "https://prompt-caster.vercel.app",
      "X-Title": "PROMPTCASTER"
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 180,
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
              reason: "ONE constructive combat-coach sentence naming what worked and the main missing upgrade, under 115 chars",
              terminalText: "ONE cinematic dark-fantasy sentence, under 105 chars",
              improvement: "ONE concrete, actionable upgrade phrase the player can add next cast, under 100 chars. For a critical spell, make it a refinement, not a flaw."
            },
            enemy: payload.enemy,
            weakness: payload.weakness,
            relics: payload.relics,
            playerPrompt: payload.playerPrompt,
            scoringRubric: {
              role: "Does the player give a persona or useful perspective?",
              target: "Is the enemy or problem clearly targeted?",
              action: "Is there a clear combat or analytical action?",
              effect: "Is the intended result clear, such as damage, interrupt, disable, clarify, or weaken?",
              specificity: "Is the tactic vivid or specific enough to guide the action?",
              constraints: "Does it include must/avoid/only/without/requirements or risk control?",
              sequence: "Does it give steps, priority, or order of operations?",
              confirmation: "Does it ask to confirm, check, verify, ensure, or report whether it worked?",
              enemyAdaptation: "Does it adapt to the named enemy's stated weakness, next attack, ward, weak point, false premise, missing context, or failure mode?"
            },
            hardCaps: {
              noTargetOrAction: "Maximum 35 if there is no clear target or no clear action.",
              noIntendedEffect: "Maximum 55 if the player does not say what should happen to the enemy/problem.",
              actionOnly: "Maximum 55 for target+action prompts with no tactic, effect, or specificity.",
              noSpecificity: "Maximum 72 if the action is broad and has no tactic, weak point, number, method, or concrete detail.",
              noConstraintAndNoConfirmation: "Maximum 76 if it has combat intent but no constraint and no confirmation.",
              noAdaptation: "Maximum 88 if it never adapts to the enemy's weakness, ward, next attack, ambiguity, or weak point.",
              codeOnly: "Maximum 68 for prompts that rely mainly on regex/code symbols without plain-language combat intent and confirmation."
            },
            scoreBands: {
              critical: "82-100: role/target/action/effect plus tactic, adaptation, constraint or confirmation.",
              solid: "55-84: usable human combat intent with a clear target, action, effect, and at least one tactical detail.",
              weak: "25-54: partial intent, usually target+action, but too vague or missing effect/tactic.",
              misfire: "0-24: no clear target, no clear action, incoherent, or pure vibes."
            },
            writingRule: "Do not copy these instructions. Write a fresh reason and improvement based only on the actual playerPrompt."
          })
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`AI provider failed: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content.");

  return applyPromptcraftBounds(normalizeJudgeResult(JSON.parse(content), "ai"), payload);
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
    improvement: clampText(raw.improvement, "Add a specific tactic, intended effect, and a way to confirm the hit worked.", 140),
    source
  };
}

function analyzePromptcraft(playerPrompt: string, enemy: string) {
  const prompt = playerPrompt.toLowerCase();
  const length = playerPrompt.length;
  const role = /^\s*(you are|act as|as a)\b/i.test(playerPrompt);
  const clarity = /\b(clear|concrete|precise|concise|specific|structured|focused|tactical|disciplined|verify|verification|confirm|checkable)\b/.test(prompt);
  const target = prompt.includes(enemy.toLowerCase()) || /\b(goblin|oracle|enemy|target|foe|boss|hostile)\b/.test(prompt);
  const action = /\b(attack|strike|throw|stab|slash|cast|hit|pin|interrupt|break|bind|expose|rewrite|clarify|identify|explain|turn|disable|stop|drain|weaken|pierce|cut|aim|target|defeat|fight|counter|block|parry|define|verify|validate|audit|question|challenge|test|prove)\b/.test(prompt);
  const effect = /\b(lose health|loses health|loss of health|health|hp|damage|wound|weaken|weakened|disable|disabled|interrupt|interrupted|stop|stopped|prevent|break|broken|expose|exposed|defeat|defeated|drop|drain|counter|cannot retaliate|cannot counter|next attack|next spell|clarify|clarified|verify|verified|validate|validated|false premise|success criteria|truth|context)\b/.test(prompt);
  const specificity = /\b(precise|specific|concrete|focused|exact|three|two|one|head|hand|casting hand|weak point|ward|spell|knife|knives|blade|slash|strike|next attack|next spell|where|how|method|tactic|context|assumption|assumptions|premise|criteria|success criteria|evidence|verification)\b/.test(prompt) || /\d/.test(prompt);
  const goal = /\b(goal|goals|outcome|objective|solve|defeat|clarify|diagnose|rewrite|explain|identify|make|force|turn)\b/.test(prompt) || effect;
  const constraints = /\b(must|avoid|only|never|do not|require|requires|required|requirement|requirements|constraint|constraints|criteria|criterion|include|exclude|limit|without)\b/.test(prompt);
  const structure = /\b(step|steps|first|then|finally|list|lists|listing|outline|sequence|plan|section|name|naming|give|giving|show|showing|finish|finishing)\b/.test(prompt);
  const context = /\b(context|assumption|assumptions|edge case|edge cases|ambiguity|ambiguous|missing|audience|purpose)\b/.test(prompt);
  const example = /\b(example|for example|sample|illustrate)\b/.test(prompt);
  const confirmation = /\b(confirm|confirms|confirmation|check|checks|checking|verify|verifies|verification|validate|validation|review|ensure|report|success criteria|worked|lands|landed|final)\b/.test(prompt);
  const adaptation = prompt.includes(enemy.toLowerCase()) || /\b(regex goblin|goblin|null oracle|oracle|ambiguity|ambiguous|pattern|parser|malformed|loophole|ward|casting hand|next spell|next attack|weak point|escape|unexpected token|parentheses|slash|context|assumption|assumptions|premise|false premise|success criteria|criteria|verification|verify|validate|missing context|prophecy|truth|evidence|uncertainty)\b/.test(prompt);
  const technical = /\b(regex|syntax|pattern|escape|literal|json|schema)\b/.test(prompt) || /[{}[\]()/\\^$*+?.|]/.test(playerPrompt);
  const vagueCount = (prompt.match(/\b(maybe|stuff|things|somehow|good|better|destroy)\b/g) ?? []).length;
  const combatIntent = [role, target, action, effect, specificity].filter(Boolean).length;
  const reliability = [constraints, structure, context, example, confirmation, adaptation].filter(Boolean).length;
  return {
    role,
    clarity,
    target,
    action,
    effect,
    specificity,
    goal,
    constraints,
    structure,
    context,
    example,
    confirmation,
    adaptation,
    technical,
    vagueCount,
    combatIntent,
    reliability,
    veryShort: length < 45,
    goodLength: length >= 60 && length <= 360
  };
}

function applyPromptcraftBounds(result: JudgeResult, payload: JudgeRequest): JudgeResult {
  const features = analyzePromptcraft(payload.playerPrompt, payload.enemy);
  const caps: number[] = [];

  if (!features.target || !features.action) caps.push(35);
  if (!features.effect) caps.push(55);
  if (features.target && features.action && !features.effect && !features.specificity) caps.push(55);
  if (!features.specificity) caps.push(72);
  if (!features.constraints && !features.confirmation) caps.push(76);
  if (!features.adaptation) caps.push(88);
  if (!features.role && features.combatIntent < 4) caps.push(78);
  if (features.veryShort) caps.push(35);
  if (features.vagueCount >= 2 && features.combatIntent < 4) caps.push(35);
  if (features.technical && !features.effect) caps.push(35);
  if (features.technical && (features.combatIntent < 4 || !features.confirmation)) caps.push(68);

  const capMax = caps.length ? Math.min(...caps) : 100;
  const cappedScore = Math.min(result.score, capMax);
  const score =
    features.combatIntent >= 4 && features.reliability >= 2 && features.goodLength && features.vagueCount === 0
      ? Math.max(cappedScore, Math.min(82, capMax))
      : features.combatIntent >= 5 && features.reliability >= 1 && features.goodLength && features.vagueCount === 0
        ? Math.max(cappedScore, Math.min(58, capMax))
        : cappedScore;
  const quality = normalizeQuality(undefined, score);
  const aligned = alignJudgeNarrative({ ...result, score, quality }, payload);
  const improvement =
    result.source === "fallback" && quality !== "critical"
      ? chooseMissingFeatureImprovement(features)
      : aligned.improvement;

  return {
    ...aligned,
    score,
    quality,
    damage: serverDamageFromScore(score),
    improvement
  };
}

function chooseMissingFeatureImprovement(features: ReturnType<typeof analyzePromptcraft>) {
  if (!features.role) return "Fix this next: add a role or combat perspective.";
  if (!features.target) return "Fix this next: name the enemy or target.";
  if (!features.action) return "Fix this next: add a clear action.";
  if (!features.effect) return "Fix this next: say what should happen to the enemy.";
  if (!features.specificity) return "Fix this next: add a tactic, weak point, or concrete detail.";
  if (!features.constraints && !features.confirmation) return "Fix this next: add a confirmation check or must/avoid constraint.";
  if (!features.confirmation) return "Fix this next: add a confirmation or success check.";
  if (!features.constraints) return "Fix this next: add a must/avoid/only constraint.";
  if (!features.adaptation) return "Fix this next: connect the move to the enemy's weakness or next attack.";
  return "Refine further: name the exact weakness or risk the strike exploits.";
}

function alignJudgeNarrative(result: JudgeResult, payload: JudgeRequest): JudgeResult {
  const terminal = result.terminalText.toLowerCase();
  const contradictoryHit =
    (result.quality === "solid" || result.quality === "critical") &&
    /\b(fail\w*|fizzl\w*|dodg\w*|evad\w*|slip\w*|weakly|dissipat\w*|sputter\w*|untouched|unharmed|unscathed|unbound|miss\w*|unformed|no spell)\b/.test(terminal);
  const reasonLooksLikeCriticalFlaw =
    result.quality === "critical" &&
    /\b(lacks|lacking|lacked|fails|failed|missing)\b/i.test(result.reason);
  const hasExplicitCount = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(payload.playerPrompt);
  const redundantNumberTip = hasExplicitCount && /\b(number|exact number)\b/i.test(result.improvement);
  const redundantNumberReason = hasExplicitCount && /\b(number|exact number|number of)\b/i.test(result.reason);

  return {
    ...result,
    reason: reasonLooksLikeCriticalFlaw || redundantNumberReason
      ? "Strong craft: role, target, action, and effect are clear; refine with sharper enemy-specific detail."
      : result.reason,
    terminalText: contradictoryHit
      ? result.quality === "critical"
        ? `The spell lands cleanly; green sigils bite into ${payload.enemy}'s ward and fracture it.`
        : `The spell lands with force, cutting through ${payload.enemy}'s ward and drawing a clean wound.`
      : result.terminalText,
    improvement: redundantNumberTip
      ? "Refine further: name the exact weakness or risk the strike exploits."
      : result.improvement
  };
}

function fallbackJudge(payload: JudgeRequest): JudgeResult {
  const features = analyzePromptcraft(payload.playerPrompt, payload.enemy);
  let score = 8;
  const hits: string[] = [];
  const misses: string[] = [];

  if (features.role) {
    score += 12;
    hits.push("the role gives the spell a voice");
  } else {
    misses.push("add a role or combat perspective");
  }
  if (features.clarity) {
    score += 5;
    hits.push("clear wording sharpens the task");
  } else {
    misses.push("make the wording more specific");
  }
  if (features.target) {
    score += 12;
    hits.push("the target is clear");
  } else {
    misses.push("name the enemy or target");
  }
  if (features.action) {
    score += 12;
    hits.push("the action is usable");
  } else {
    misses.push("add a clear action");
  }
  if (features.goal) {
    score += 5;
    hits.push("the goal points the cast");
  } else {
    misses.push("state the intended outcome");
  }
  if (features.effect) {
    score += 10;
    hits.push("the desired effect is clear");
  } else {
    misses.push("say what should happen to the enemy");
  }
  if (features.specificity) {
    score += 8;
    hits.push("specific detail guides the strike");
  } else {
    misses.push("add a tactic, weak point, or concrete detail");
  }
  if (features.constraints) {
    score += 10;
    hits.push("constraints control the risk");
  } else {
    misses.push("add a must/avoid/only constraint");
  }
  if (features.structure) {
    score += 8;
    hits.push("structure gives the action order");
  } else {
    misses.push("add sequence or priority");
  }
  if (features.context) {
    score += 6;
    hits.push("context addresses the confusion");
  } else {
    misses.push("add context or edge-case handling");
  }
  if (features.example) {
    score += 8;
    hits.push("an example makes the instruction testable");
  }
  if (features.confirmation) {
    score += 10;
    hits.push("the result can be confirmed");
  } else {
    misses.push("add a confirmation or success check");
  }
  if (features.adaptation) {
    score += 10;
    hits.push("the attack adapts to the enemy");
  } else {
    misses.push("connect the move to the enemy's weakness or next attack");
  }
  const length = payload.playerPrompt.length;
  if (length >= 60 && length <= 360) {
    score += 8;
    hits.push("focused, usable length");
  } else if (length >= 30 && length <= 520) {
    score += 4;
  } else if (length < 25) {
    score -= 8;
    misses.push("too short to steer an AI");
  } else {
    score -= 8;
    misses.push("too rambling to stay sharp");
  }
  if (features.technical) {
    score += 3;
    hits.push("technical detail supports the cast");
  }
  if (features.vagueCount) {
    score -= Math.min(18, features.vagueCount * 6);
    misses.push("vague or generic wording weakens control");
  }

  score = Math.max(0, Math.min(100, score));
  const quality: Quality =
    score >= 82 ? "critical" : score >= 58 ? "solid" : score >= 30 ? "weak" : "misfire";
  const damage = serverDamageFromScore(score);
  const reason =
    quality === "critical" || quality === "solid"
      ? `Strong craft: ${hits.slice(0, 2).join(", ")}.`
      : misses.length
        ? `Weak craft: ${misses.slice(0, 2).join(", ")}.`
        : "The casting lacks any decisive prompt technique.";
  const improvement =
    quality === "critical"
      ? "Refine further: name the exact weakness or risk the strike exploits."
      : misses.length
        ? `Fix this next: ${misses[0]}.`
        : "Refine further: name the exact weakness or risk the strike exploits.";

  return applyPromptcraftBounds({
    score,
    quality,
    damage,
    reason,
    terminalText:
      quality === "critical"
        ? `Green fire exploits ${payload.enemy}'s flaw and fractures the ward.`
        : quality === "solid"
          ? `The spell forms a clear path through ${payload.enemy}'s fog.`
          : quality === "weak"
            ? "The spell sparks, but vague edges leave the ward intact."
            : "The incantation collapses into inert terminal noise.",
    improvement,
    source: "fallback"
  }, payload);
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
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  const clipped = lastSpace > Math.floor(maxLength * 0.55) ? truncated.slice(0, lastSpace) : truncated;
  return `${clipped.replace(/[.,;:!?-]+$/, "")}…`;
}

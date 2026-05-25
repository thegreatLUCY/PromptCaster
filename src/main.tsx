import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Quality = "misfire" | "weak" | "solid" | "critical";
type Phase = "playing" | "casting" | "rewarding" | "revealing" | "won" | "lost";
type Tone = "system" | "player" | "result" | "enemy" | "warning";

type JudgeResult = {
  score: number;
  quality: Quality;
  damage: number;
  reason: string;
  terminalText: string;
  improvement: string;
  source?: "ai" | "fallback" | "cache";
  baseDamage?: number;
  resisted?: boolean;
  rejected?: boolean;
};

type LogEntry = { id: number; ts: number; tone: Tone; text: string };
type Floater = { id: number; target: "enemy" | "player"; text: string; quality: Quality | "enemy" };
type JudgeStatus = { mode: "llm" | "fallback"; model: string; baseUrl: string | null };
type Vars = React.CSSProperties & Record<`--${string}`, string | number>;
type RunStats = {
  score: number;
  combo: number;
  bestCombo: number;
  casts: number;
  criticals: number;
  solids: number;
  resisted: number;
  rejected: number;
  bestHit: number;
  bossesDefeated: number;
  clearBonus: number;
};
type RankInfo = { label: string; title: string; nextAt: number | null; nextLabel: string | null };
type ScoreEvent = { gain: number; combo: number; detail: string };
type RewardId = "token-siphon" | "combo-lens" | "ward-script";
type Reward = { id: RewardId; sigil: string; name: string; summary: string; detail: string };
type MedalId = "first-critical" | "full-sigil" | "combo-chain" | "heavy-hit" | "clean-gauntlet";
type Medal = { id: MedalId; sigil: string; name: string; detail: string; score: number };
type Enemy = {
  id: "regex-goblin" | "null-oracle";
  name: string;
  terminalName: string;
  role: string;
  maxHp: number;
  weakness: string;
  attacks: { label: string; dmg: number }[];
  aliases: string[];
  adaptationTerms: string[];
  placeholder: string;
  openingLog: string;
  revealLog: string;
  defeatLog: string;
  finalVictoryLog: string;
};

// ---------- balance (preserved from the tuned game logic) ----------
const PLAYER_MAX_HP = 90;
const PLAYER_MAX_TOKENS = 60;
const TOKEN_REGEN = 8;
const MAX_HIT = 44;
const PATTERN_MEMORY = 3;
const BLANK_PATTERN = /\[[^\]]+\]/;
const INITIAL_RUN_STATS: RunStats = {
  score: 0,
  combo: 0,
  bestCombo: 0,
  casts: 0,
  criticals: 0,
  solids: 0,
  resisted: 0,
  rejected: 0,
  bestHit: 0,
  bossesDefeated: 0,
  clearBonus: 0
};
const RANKS = [
  { label: "S", title: "Archmage", min: 6500 },
  { label: "A", title: "Spellblade", min: 4700 },
  { label: "B", title: "Invoker", min: 3200 },
  { label: "C", title: "Apprentice", min: 1800 },
  { label: "D", title: "Unbound", min: 0 }
];
const REWARDS: Reward[] = [
  {
    id: "token-siphon",
    sigil: "SIP",
    name: "Token Siphon",
    summary: "solid or critical casts refund 6 tokens",
    detail: "Rewards clean prompt economy. Strong casts keep the terminal charged for longer duels."
  },
  {
    id: "combo-lens",
    sigil: "LNS",
    name: "Combo Lens",
    summary: "all 3 relics add +1 combo and +60 score",
    detail: "Turns complete prompt structure into momentum. Best for rank chasing."
  },
  {
    id: "ward-script",
    sigil: "WRD",
    name: "Ward Script",
    summary: "enemy attacks deal 4 less damage",
    detail: "A defensive patch for riskier second-boss attempts."
  }
];
const MEDALS: Medal[] = [
  { id: "first-critical", sigil: "CRT", name: "Critical Thesis", detail: "land a clean critical cast", score: 140 },
  { id: "full-sigil", sigil: "ALL", name: "Full Sigil", detail: "charge SYS, CLR, and CTX on one cast", score: 120 },
  { id: "combo-chain", sigil: "CHN", name: "Chain Caster", detail: "reach combo x3", score: 160 },
  { id: "heavy-hit", sigil: "HIT", name: "Heavy Impact", detail: "deal at least 36 damage in one cast", score: 130 },
  { id: "clean-gauntlet", sigil: "CLN", name: "Clean Gauntlet", detail: "finish with no resisted or rejected casts", score: 300 }
];
const MEDAL_MAP = new Map(MEDALS.map((medal) => [medal.id, medal]));

const ENEMIES: Enemy[] = [
  {
    id: "regex-goblin",
    name: "Regex Goblin",
    terminalName: "regex_goblin",
    role: "parser ambusher",
    maxHp: 170,
    weakness: "role · target · tactic · result",
    attacks: [
      { label: "Unexpected Token", dmg: 13 },
      { label: "Escaped Slash", dmg: 11 },
      { label: "Parentheses Trap", dmg: 15 }
    ],
    aliases: ["regex goblin", "goblin"],
    adaptationTerms: ["regex goblin", "goblin", "ambiguity", "ambiguous", "pattern", "parser", "malformed", "loophole", "ward", "casting hand", "next spell", "next attack", "weak point", "escape", "unexpected token", "parentheses", "slash"],
    placeholder: "Type your own spell — e.g. You are an old war fighter. Throw three precise knives at the Regex Goblin's casting hand, interrupt its spell, and confirm it loses health…",
    openingLog: "HOSTILE — Regex Goblin detected in the dungeon parser.",
    revealLog: "BOSS 01 — Regex Goblin blocks the parser gate.",
    defeatLog: "VICTORY — Regex Goblin dissolved into clarified intent.",
    finalVictoryLog: "VICTORY — Regex Goblin dissolved into clarified intent."
  },
  {
    id: "null-oracle",
    name: "Null Oracle",
    terminalName: "null_oracle",
    role: "context devourer",
    maxHp: 190,
    weakness: "context · assumptions · success criteria · verification",
    attacks: [
      { label: "Missing Context", dmg: 14 },
      { label: "False Premise", dmg: 16 },
      { label: "Ambiguous Prophecy", dmg: 18 }
    ],
    aliases: ["null oracle", "oracle"],
    adaptationTerms: ["null oracle", "oracle", "context", "assumption", "assumptions", "premise", "false premise", "success criteria", "criteria", "verification", "verify", "validate", "missing context", "prophecy", "truth", "evidence", "uncertainty"],
    placeholder: "Type your own spell — e.g. You are a truth auditor. Give the Null Oracle clear context, state your assumptions, expose the false premise, and verify the success criteria…",
    openingLog: "HOSTILE — Null Oracle detected behind the cleared parser gate.",
    revealLog: "BOSS 02 — Null Oracle rises from missing context.",
    defeatLog: "VICTORY — Null Oracle collapsed under verified truth.",
    finalVictoryLog: "GAUNTLET CLEARED — every hostile prompt pattern is bound."
  }
];

// Skeletons only — every scoring part is a [blank] the player must write themselves.
const PRESETS = [
  { glyph: "{ }", label: "Tactical", teaches: "role + action", text: "You are [your fighter or caster role]. Attack [name the enemy] with [specific tactic] so it [desired effect], then [confirm the result]." },
  { glyph: "✦", label: "Cinematic", teaches: "vivid + precise", text: "You are [combat persona]. Strike [name the enemy] at [specific weak point] using [vivid action], while avoiding [risk or wasted move]." },
  { glyph: "✓", label: "Check", teaches: "effect + verify", text: "[role or perspective]: [clear action] [name the enemy], make it [result], avoid [failure], and confirm [success sign]." }
];

type TourStep = { selector: string; title: string; body: string; placement?: "top" | "bottom" | "left" | "right" | "center" };

const TOUR_STEPS: TourStep[] = [
  { selector: "", placement: "center", title: "Welcome, Prompt Mage", body: "In PromptCaster your prompts are your spells. There are no attack buttons — you write your way to victory. Here's the battlefield." },
  { selector: ".composer-panel", placement: "left", title: "Compose your spell", body: "Write a prompt with a role, target, action, and result. Add tactics or confirmation to make it hit harder." },
  { selector: ".relics-panel", placement: "top", title: "Relics — live feedback", body: "These charge as your prompt gains a clear role, clarity terms, and names the enemy. Light all three for a stronger cast." },
  { selector: ".cast-btn", placement: "top", title: "Cast the spell", body: "Fire your prompt with the button or ⌘/Ctrl + Enter. The Arbiter scores it, and damage scales directly with that score." },
  { selector: ".arena-panel", placement: "right", title: "The arena", body: "Watch your spell strike here. After every cast the enemy retaliates — so a sharper prompt that ends the fight faster keeps you alive." },
  { selector: ".stats", placement: "bottom", title: "Know the duel", body: "Your HP and tokens versus the enemy's HP. Tokens fuel each cast and scale with prompt length — concise spells cost less." },
  { selector: ".verdict-panel", placement: "top", title: "The Arbiter's verdict", body: "After each cast the Arbiter critiques your craft and tells you exactly what to improve. Read it — it's how you get better." },
  { selector: ".log-panel", placement: "top", title: "Combat log", body: "Every cast, hit, and verdict is recorded here. That's the loop: write, cast, read, refine. Good luck, mage." }
];

// ---------- helpers ----------
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const damageFromScore = (score: number) => Math.max(3, Math.round((score / 100) * MAX_HIT));
const formatTurn = (n: number) => String(n).padStart(2, "0");

function rankForScore(score: number): RankInfo {
  const current = RANKS.find((rank) => score >= rank.min) ?? RANKS[RANKS.length - 1];
  const next = [...RANKS].reverse().find((rank) => rank.min > score) ?? null;
  return { label: current.label, title: current.title, nextAt: next?.min ?? null, nextLabel: next?.label ?? null };
}

function comboAfterCast(combo: number, quality: Quality, resisted: boolean, rejected: boolean) {
  if (rejected) return 0;
  if (resisted) return Math.max(0, combo - 1);
  if (quality === "critical") return combo + 2;
  if (quality === "solid") return combo + 1;
  if (quality === "weak") return Math.max(0, combo - 1);
  return 0;
}

function hasReward(rewardIds: RewardId[], id: RewardId) {
  return rewardIds.includes(id);
}

function isCleanStrongCast(judgment: JudgeResult, resisted: boolean, rejected: boolean) {
  return !resisted && !rejected && (judgment.quality === "solid" || judgment.quality === "critical");
}

function comboLensBonus(rewardIds: RewardId[], judgment: JudgeResult, relicsOn: number, resisted: boolean, rejected: boolean) {
  return hasReward(rewardIds, "combo-lens") && relicsOn === 3 && isCleanStrongCast(judgment, resisted, rejected) ? 1 : 0;
}

function tokenRefundForCast(rewardIds: RewardId[], judgment: JudgeResult, resisted: boolean, rejected: boolean) {
  return hasReward(rewardIds, "token-siphon") && isCleanStrongCast(judgment, resisted, rejected) ? 6 : 0;
}

function medalsForCast(args: {
  judgment: JudgeResult;
  relicsOn: number;
  combo: number;
  effectiveDamage: number;
  resisted: boolean;
  rejected: boolean;
  finalKill: boolean;
  cleanSoFar: boolean;
}): MedalId[] {
  const medals: MedalId[] = [];
  if (args.judgment.quality === "critical" && isCleanStrongCast(args.judgment, args.resisted, args.rejected)) medals.push("first-critical");
  if (args.relicsOn === 3 && !args.rejected) medals.push("full-sigil");
  if (args.combo >= 3) medals.push("combo-chain");
  if (args.effectiveDamage >= 36 && !args.resisted && !args.rejected) medals.push("heavy-hit");
  if (args.finalKill && args.cleanSoFar) medals.push("clean-gauntlet");
  return medals;
}

function castScoreGain(judgment: JudgeResult, effectiveDamage: number, relicsOn: number, combo: number, resisted: boolean, rejected: boolean) {
  if (rejected) return { gain: 0, detail: "borrowed spell rejected" };
  const qualityBonus = judgment.quality === "critical" ? 120 : judgment.quality === "solid" ? 55 : judgment.quality === "weak" ? 10 : 0;
  const relicBonus = relicsOn * 35;
  const comboBonus = combo > 1 ? combo * 30 : 0;
  const rawGain = judgment.score * 3 + effectiveDamage * 8 + relicBonus + qualityBonus + comboBonus;
  const gain = resisted ? Math.max(effectiveDamage * 8, Math.round(rawGain * 0.45)) : Math.round(rawGain);
  const detail = resisted ? "pattern resisted" : `${relicsOn}/3 relics · ${judgment.quality}`;
  return { gain, detail };
}

function bossClearBonus(enemyIndex: number, combo: number) {
  return 420 + enemyIndex * 180 + combo * 45;
}

function finalClearBonus(playerHp: number, tokens: number, combo: number) {
  return playerHp * 8 + tokens * 5 + combo * 75;
}

function getRequestedEnemyIndex() {
  if (typeof window === "undefined") return 0;
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get("boss") ?? params.get("enemy") ?? params.get("start") ?? "").trim().toLowerCase();
  if (["2", "02", "null-oracle", "null oracle", "oracle"].includes(requested)) return 1;
  return 0;
}

function openingLogsFor(enemy: Enemy, bypassed = false): Omit<LogEntry, "id">[] {
  return [
    { ts: 0, tone: "system", text: "BOOT — combat kernel online." },
    ...(bypassed ? [{ ts: 1, tone: "warning" as const, text: "TEST OVERRIDE — Regex Goblin bypassed via URL." }] : []),
    { ts: bypassed ? 2 : 1, tone: "warning", text: enemy.openingLog },
    { ts: bypassed ? 3 : 2, tone: "system", text: "DIRECTIVE — write a spell prompt, then cast." },
    { ts: bypassed ? 4 : 3, tone: "system", text: `WEAKNESS — ${enemy.weakness}.` }
  ];
}

function logSigil(tone: Tone) {
  return ({ system: "⚙", player: "▸", result: "✦", enemy: "☠", warning: "!" } as const)[tone] || "·";
}

function wordSet(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i);
}
function patternResistance(spell: string, history: Set<string>[]): { multiplier: number; similarity: number } {
  if (!history.length) return { multiplier: 1, similarity: 0 };
  const cur = wordSet(spell);
  const similarity = Math.max(...history.map((h) => jaccard(cur, h)));
  const multiplier = similarity >= 0.85 ? 0.2 : similarity >= 0.65 ? 0.45 : similarity >= 0.5 ? 0.7 : 1;
  return { multiplier, similarity };
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function buildRelics(enemy: Enemy) {
  return [
    { sigil: "SYS", name: "System Prompt Crown", rule: 'opens with "you are…"', test: (p: string) => /^\s*you are\b/i.test(p) },
    { sigil: "CLR", name: "Clarity Gem", rule: "clear · concrete · tactical · checkable", test: (p: string) => /\b(clear|concrete|precise|concise|specific|structured|focused|tactical|disciplined|verify|verification|confirm|checkable)\b/i.test(p) },
    { sigil: "CTX", name: "Context Blade", rule: "names the enemy directly", test: (p: string) => hasAnyTerm(p.toLowerCase(), enemy.aliases) }
  ];
}

function clampText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  const clipped = lastSpace > Math.floor(maxLength * 0.55) ? truncated.slice(0, lastSpace) : truncated;
  return `${clipped.replace(/[.,;:!?-]+$/, "")}…`;
}
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeClientJudge(raw: Partial<JudgeResult>): JudgeResult {
  const score = clampNumber(raw.score, 0, 100, 10);
  const quality: Quality =
    raw.quality === "misfire" || raw.quality === "weak" || raw.quality === "solid" || raw.quality === "critical"
      ? raw.quality
      : score >= 82 ? "critical" : score >= 58 ? "solid" : score >= 30 ? "weak" : "misfire";
  return {
    score,
    quality,
    damage: damageFromScore(score),
    reason: clampText(raw.reason, "The Arbiter finds nothing decisive in this casting.", 180),
    terminalText: clampText(raw.terminalText, "The spell resolves into flat terminal static.", 140),
    improvement: clampText(raw.improvement, "Add a specific tactic, intended effect, and a way to confirm the hit worked.", 140),
    source: raw.source
  };
}

function localFallbackJudge(spell: string, enemy: Enemy): JudgeResult {
  const text = spell.toLowerCase();
  const role = /^\s*(you are|act as|as a)\b/i.test(spell);
  const clarity = /\b(clear|concrete|precise|concise|specific|structured|focused|tactical|disciplined|verify|verification|confirm|checkable)\b/.test(text);
  const target = hasAnyTerm(text, enemy.aliases) || /\b(enemy|target|foe|boss|hostile)\b/.test(text);
  const action = /\b(attack|strike|throw|stab|slash|cast|hit|pin|interrupt|break|bind|expose|rewrite|clarify|identify|explain|turn|disable|stop|drain|weaken|pierce|cut|aim|target|defeat|fight|counter|block|parry|define|verify|validate|audit|question|challenge|test|prove)\b/.test(text);
  const effect = /\b(lose health|loses health|loss of health|health|hp|damage|wound|weaken|weakened|disable|disabled|interrupt|interrupted|stop|stopped|prevent|break|broken|expose|exposed|defeat|defeated|drop|drain|counter|cannot retaliate|cannot counter|next attack|next spell|clarify|clarified|verify|verified|validate|validated|false premise|success criteria|truth|context)\b/.test(text);
  const specificity = /\b(precise|specific|concrete|focused|exact|three|two|one|head|hand|casting hand|weak point|ward|spell|knife|knives|blade|slash|strike|next attack|next spell|where|how|method|tactic|context|assumption|assumptions|premise|criteria|success criteria|evidence|verification)\b/.test(text) || /\d/.test(spell);
  const constraints = /\b(must|avoid|only|never|do not|require|requires|required|requirement|requirements|constraint|constraints|criteria|criterion|include|exclude|limit|without)\b/.test(text);
  const structure = /\b(step|steps|first|then|finally|list|lists|listing|outline|sequence|plan|section|name|naming|give|giving|show|showing|finish|finishing)\b/.test(text);
  const context = /\b(context|assumption|assumptions|edge case|edge cases|ambiguity|ambiguous|missing|audience|purpose)\b/.test(text);
  const example = /\b(example|for example|sample|illustrate)\b/.test(text);
  const confirmation = /\b(confirm|confirms|confirmation|check|checks|checking|verify|verifies|verification|validate|validation|review|ensure|report|success criteria|worked|lands|landed|final)\b/.test(text);
  const adaptation = hasAnyTerm(text, enemy.adaptationTerms);
  const technical = /\b(regex|syntax|pattern|escape|literal|json|schema)\b/.test(text) || /[{}[\]()/\\^$*+?.|]/.test(spell);
  const vagueMatches = text.match(/\b(maybe|stuff|things|somehow|good|better|destroy)\b/g) ?? [];
  let score = 8;
  const hits: string[] = [];
  const misses: string[] = [];
  if (role) {
    score += 12;
    hits.push("role");
  } else {
    misses.push("add a role or perspective");
  }
  if (clarity) {
    score += 5;
    hits.push("clarity");
  } else {
    misses.push("make the wording more specific");
  }
  if (target) {
    score += 12;
    hits.push("target");
  } else {
    misses.push("name the enemy or target");
  }
  if (action) {
    score += 12;
    hits.push("action");
  } else {
    misses.push("add a clear action");
  }
  if (effect) {
    score += 10;
    hits.push("effect");
  } else {
    misses.push("say what should happen to the enemy");
  }
  if (specificity) {
    score += 8;
    hits.push("specificity");
  } else {
    misses.push("add a tactic, weak point, or concrete detail");
  }
  if (constraints) {
    score += 10;
    hits.push("constraints");
  } else {
    misses.push("add a must/avoid/only constraint");
  }
  if (structure) {
    score += 8;
    hits.push("structure");
  } else {
    misses.push("add sequence or priority");
  }
  if (context) {
    score += 6;
    hits.push("context");
  } else {
    misses.push("handle context or edge cases");
  }
  if (example) {
    score += 8;
    hits.push("example");
  }
  if (confirmation) {
    score += 10;
    hits.push("confirmation");
  } else {
    misses.push("add a confirmation or success check");
  }
  if (adaptation) {
    score += 10;
    hits.push("adaptation");
  } else {
    misses.push("connect the move to the enemy's weakness or next attack");
  }
  if (spell.length >= 60 && spell.length <= 360) score += 8;
  else if (spell.length >= 30 && spell.length <= 520) score += 4;
  else score -= 8;
  if (technical) score += 3;
  if (vagueMatches.length) score -= Math.min(18, vagueMatches.length * 6);
  score = clamp(score, 0, 100);
  const combatIntent = [role, target, action, effect, specificity].filter(Boolean).length;
  const reliability = [constraints, structure, context, example, confirmation, adaptation].filter(Boolean).length;
  const caps: number[] = [];
  if (!target || !action) caps.push(35);
  if (!effect) caps.push(55);
  if (target && action && !effect && !specificity) caps.push(55);
  if (!specificity) caps.push(72);
  if (!constraints && !confirmation) caps.push(76);
  if (!adaptation) caps.push(88);
  if (!role && combatIntent < 4) caps.push(78);
  if (spell.length < 45) caps.push(35);
  if (vagueMatches.length >= 2 && combatIntent < 4) caps.push(35);
  if (technical && !effect) caps.push(35);
  if (technical && (combatIntent < 4 || !confirmation)) caps.push(68);
  const capMax = caps.length ? Math.min(...caps) : 100;
  const cappedScore = Math.min(score, capMax);
  score =
    combatIntent >= 4 && reliability >= 2 && spell.length >= 60 && spell.length <= 360 && !vagueMatches.length
      ? Math.max(cappedScore, Math.min(82, capMax))
      : combatIntent >= 5 && reliability >= 1 && spell.length >= 60 && spell.length <= 360 && !vagueMatches.length
        ? Math.max(cappedScore, Math.min(58, capMax))
        : cappedScore;
  const quality: Quality = score >= 82 ? "critical" : score >= 58 ? "solid" : score >= 30 ? "weak" : "misfire";
  const nextFix =
    !role ? "add a role or perspective"
      : !target ? "name the enemy or target"
        : !action ? "add a clear action"
          : !effect ? "say what should happen to the enemy"
            : !specificity ? "add a tactic, weak point, or concrete detail"
              : !constraints && !confirmation ? "add a confirmation check or must/avoid constraint"
                : !confirmation ? "add a confirmation or success check"
                  : !constraints ? "add a must/avoid/only constraint"
                    : !adaptation ? "connect the move to the enemy's weakness or next attack"
                      : misses[0];
  return {
    score,
    quality,
    damage: damageFromScore(score),
    reason: score >= 58 ? `Offline Arbiter: strong spellcraft — ${hits.slice(0, 3).join(", ")}.` : "Offline Arbiter: usable intent needs clearer target, action, effect, or tactic.",
    terminalText: score >= 58 ? `The spell exploits ${enemy.name}'s flaw and cuts through its ward.` : "The half-formed spell scatters into terminal static.",
    improvement: quality === "critical" ? "Refine further: name the exact weakness or risk the strike exploits." : nextFix ? `Fix this next: ${nextFix}.` : "Refine further: name the exact weakness or risk the strike exploits.",
    source: "fallback"
  };
}

// ---------- root ----------
function App() {
  const initialEnemyIndex = useMemo(() => getRequestedEnemyIndex(), []);
  const initialLogs = useMemo(() => openingLogsFor(ENEMIES[initialEnemyIndex], initialEnemyIndex > 0), [initialEnemyIndex]);
  const [enemyIndex, setEnemyIndex] = useState(initialEnemyIndex);
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [tokens, setTokens] = useState(PLAYER_MAX_TOKENS);
  const [enemyHp, setEnemyHp] = useState(ENEMIES[initialEnemyIndex].maxHp);
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("playing");
  const [turn, setTurn] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>(() => initialLogs.map((l, i) => ({ ...l, id: i + 1 })));
  const [lastJudge, setLastJudge] = useState<JudgeResult | null>(null);
  const [runStats, setRunStats] = useState<RunStats>(INITIAL_RUN_STATS);
  const [lastScoreEvent, setLastScoreEvent] = useState<ScoreEvent | null>(null);
  const [rewardIds, setRewardIds] = useState<RewardId[]>([]);
  const [unlockedMedals, setUnlockedMedals] = useState<MedalId[]>([]);
  const [pendingEnemyIndex, setPendingEnemyIndex] = useState<number | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [beam, setBeam] = useState<number | false>(false);
  const [hit, setHit] = useState(false);
  const [shake, setShake] = useState(false);
  const [borrowed, setBorrowed] = useState(false);
  const [judgeStatus, setJudgeStatus] = useState<JudgeStatus | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const enemy = ENEMIES[enemyIndex];
  const finalEnemy = enemyIndex === ENEMIES.length - 1;
  const rank = useMemo(() => rankForScore(runStats.score), [runStats.score]);
  const activeRewards = useMemo(() => REWARDS.filter((reward) => rewardIds.includes(reward.id)), [rewardIds]);
  const activeMedals = useMemo(() => MEDALS.filter((medal) => unlockedMedals.includes(medal.id)), [unlockedMedals]);

  // Auto-start the tour on first visit; remember dismissal.
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem("pc_tour_done") === "1"; } catch { /* ignore */ }
    if (!done) {
      const t = window.setTimeout(() => setTourOpen(true), 450);
      return () => window.clearTimeout(t);
    }
  }, []);

  function closeTour() {
    setTourOpen(false);
    try { localStorage.setItem("pc_tour_done", "1"); } catch { /* ignore */ }
  }

  const cacheRef = useRef(new Map<string, JudgeResult>());
  const patternHistoryRef = useRef<Set<string>[]>([]);
  const borrowedChunksRef = useRef<string[]>([]);
  const logEnd = useRef<HTMLDivElement>(null);
  const floaterId = useRef(1);
  const logId = useRef(10);
  const tsRef = useRef(initialLogs.length);

  useEffect(() => {
    if (logEnd.current) logEnd.current.scrollTop = logEnd.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/judge-status");
        if (!res.ok) throw new Error("status");
        const status = (await res.json()) as JudgeStatus;
        if (ignore) return;
        setJudgeStatus(status);
        pushLog("system", status.mode === "llm" ? `JUDGE — Arbiter online via ${status.model}.` : "JUDGE — local fallback. Add AI_API_KEY for LLM scoring.");
      } catch {
        if (!ignore) pushLog("warning", "JUDGE — local fallback only.");
      }
    })();
    return () => { ignore = true; };
  }, []);

  function pushLog(tone: Tone, text: string) {
    setLogs((cur) => [...cur, { id: logId.current++, ts: tsRef.current++, tone, text }].slice(-40));
  }
  function addFloater(target: Floater["target"], text: string, quality: Floater["quality"]) {
    const id = floaterId.current++;
    setFloaters((cur) => [...cur, { id, target, text, quality }]);
    window.setTimeout(() => setFloaters((cur) => cur.filter((f) => f.id !== id)), 1050);
  }
  function chooseReward(reward: Reward) {
    if (pendingEnemyIndex === null) return;
    const nextBoss = ENEMIES[pendingEnemyIndex];
    setRewardIds((cur) => (cur.includes(reward.id) ? cur : [...cur, reward.id]));
    pushLog("system", `REWARD LOCKED — ${reward.name}: ${reward.summary}.`);
    pushLog("warning", "DEEPER SIGNAL DETECTED.");
    pushLog("warning", nextBoss.revealLog);
    pushLog("system", "RESTORE — HP and tokens returned to full capacity.");
    pushLog("system", `WEAKNESS — ${nextBoss.weakness}.`);
    setPhase("revealing");
    setPlayerHp(PLAYER_MAX_HP);
    setTokens(PLAYER_MAX_TOKENS);
    setTurn(1);
    setPrompt("");
    setLastJudge(null);
    setLastScoreEvent(null);
    setBorrowed(false);
    borrowedChunksRef.current = [];
    patternHistoryRef.current = [];
    window.setTimeout(() => {
      setEnemyIndex(pendingEnemyIndex);
      setEnemyHp(nextBoss.maxHp);
      setPendingEnemyIndex(null);
      setHit(false);
      setShake(false);
      setFloaters([]);
      setPhase("playing");
    }, 650);
  }

  // ---- prompt authorship tracking (anti-abuse) ----
  function recomputeBorrowed(value: string) {
    const surviving = borrowedChunksRef.current.filter((chunk) => value.includes(chunk));
    borrowedChunksRef.current = surviving;
    setBorrowed(surviving.length > 0);
  }
  function handlePromptPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (pasted.length >= 8) borrowedChunksRef.current = [...borrowedChunksRef.current, pasted].slice(-6);
  }
  function updatePrompt(value: string) {
    setPrompt(value);
    recomputeBorrowed(value);
  }
  function loadPreset(text: string) {
    setPrompt(text);
    borrowedChunksRef.current = [];
    setBorrowed(false);
  }

  const relics = useMemo(() => buildRelics(enemy), [enemy]);
  const relicState = useMemo(() => relics.map((r) => ({ ...r, on: r.test(prompt) })), [prompt, relics]);
  const relicsOn = relicState.filter((r) => r.on).length;
  const promptCost = clamp(Math.ceil(prompt.trim().length / 16), 6, 26);
  const intent = enemy.attacks[(turn - 1) % enemy.attacks.length];
  const battleOver = phase === "won" || phase === "lost";
  const hasBlanks = BLANK_PATTERN.test(prompt);
  const canCast = phase === "playing" && prompt.trim().length > 0 && tokens >= promptCost && !hasBlanks;
  const firstTurn = !lastJudge && phase === "playing";

  async function cast() {
    if (!canCast) return;
    if (BLANK_PATTERN.test(prompt)) {
      pushLog("warning", "INCOMPLETE SPELL — fill every [blank] in your own words before casting.");
      return;
    }
    const spell = prompt.trim();
    const cacheKey = `${enemy.name.toLowerCase()}::${spell.toLowerCase()}`;
    const borrowedCast = borrowed;
    const tokensAfterCast = Math.max(0, tokens - promptCost);

    setPhase("casting");
    setTokens(tokensAfterCast);
    pushLog("player", `CAST [${promptCost}T] · ${spell.length > 64 ? spell.slice(0, 64) + "…" : spell}`);

    let judgment: JudgeResult;
    if (borrowedCast) {
      judgment = {
        score: 0, quality: "misfire", damage: 0,
        reason: "The Arbiter rejects borrowed words: this spell was pasted or lifted verbatim from a template, not woven by you.",
        terminalText: "The stolen sigils refuse your voice and crumble into dead syntax.",
        improvement: "Write the spell yourself — type your own role, target, action, effect, and confirmation.",
        source: "fallback"
      };
    } else {
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        judgment = { ...cached, source: "cache" };
      } else {
        try {
          const res = await fetch("/api/judge-prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enemy: enemy.name, weakness: enemy.weakness, relics: relicState.filter((r) => r.on).map((r) => r.name), playerPrompt: spell })
          });
          if (!res.ok) throw new Error("judge rejected");
          judgment = normalizeClientJudge(await res.json());
        } catch {
          judgment = localFallbackJudge(spell, enemy);
        }
        cacheRef.current.set(cacheKey, judgment);
      }
    }

    const { multiplier, similarity } = borrowedCast ? { multiplier: 1, similarity: 0 } : patternResistance(spell, patternHistoryRef.current);
    const baseDamage = judgment.damage;
    const effectiveDamage = borrowedCast ? 0 : multiplier < 1 ? Math.max(1, Math.round(baseDamage * multiplier)) : baseDamage;
    const resisted = !borrowedCast && multiplier < 1;
    const nextEnemy = Math.max(0, enemyHp - effectiveDamage);
    const finalKill = finalEnemy && nextEnemy <= 0;
    const cleanSoFar = runStats.resisted + runStats.rejected === 0 && !resisted && !borrowedCast;
    patternHistoryRef.current = [wordSet(spell), ...patternHistoryRef.current].slice(0, PATTERN_MEMORY);
    const lensBonus = comboLensBonus(rewardIds, judgment, relicsOn, resisted, borrowedCast);
    const tokenRefund = tokenRefundForCast(rewardIds, judgment, resisted, borrowedCast);
    const rewardScoreBonus = lensBonus ? 60 : 0;
    const nextCombo = comboAfterCast(runStats.combo, judgment.quality, resisted, borrowedCast) + lensBonus;
    const baseScoreEvent = castScoreGain(judgment, effectiveDamage, relicsOn, nextCombo, resisted, borrowedCast);
    const newMedals = medalsForCast({
      judgment,
      relicsOn,
      combo: nextCombo,
      effectiveDamage,
      resisted,
      rejected: borrowedCast,
      finalKill,
      cleanSoFar
    }).filter((id) => !unlockedMedals.includes(id));
    const medalScoreBonus = newMedals.reduce((sum, id) => sum + (MEDAL_MAP.get(id)?.score ?? 0), 0);
    const rewardDetail =
      lensBonus && tokenRefund ? " · lens +1 · siphon +6T"
        : lensBonus ? " · lens +1"
          : tokenRefund ? " · siphon +6T"
            : "";
    const medalDetail = medalScoreBonus ? ` · medal +${medalScoreBonus}` : "";
    const scoreEvent = { gain: baseScoreEvent.gain + rewardScoreBonus + medalScoreBonus, combo: nextCombo, detail: `${baseScoreEvent.detail}${rewardDetail}${medalDetail}` };
    setLastScoreEvent({ ...scoreEvent, combo: nextCombo });
    if (newMedals.length) {
      setUnlockedMedals((cur) => [...cur, ...newMedals.filter((id) => !cur.includes(id))]);
      for (const id of newMedals) {
        const medal = MEDAL_MAP.get(id);
        if (medal) pushLog("system", `MEDAL UNLOCKED — ${medal.name} +${medal.score}: ${medal.detail}.`);
      }
    }
    setRunStats((cur) => {
      const combo = comboAfterCast(cur.combo, judgment.quality, resisted, borrowedCast) + lensBonus;
      const { gain } = castScoreGain(judgment, effectiveDamage, relicsOn, combo, resisted, borrowedCast);
      return {
        score: cur.score + gain + rewardScoreBonus + medalScoreBonus,
        combo,
        bestCombo: Math.max(cur.bestCombo, combo),
        casts: cur.casts + 1,
        criticals: cur.criticals + (judgment.quality === "critical" && !resisted && !borrowedCast ? 1 : 0),
        solids: cur.solids + (judgment.quality === "solid" && !resisted && !borrowedCast ? 1 : 0),
        resisted: cur.resisted + (resisted ? 1 : 0),
        rejected: cur.rejected + (borrowedCast ? 1 : 0),
        bestHit: Math.max(cur.bestHit, effectiveDamage),
        bossesDefeated: cur.bossesDefeated,
        clearBonus: cur.clearBonus
      };
    });
    if (tokenRefund) setTokens((cur) => Math.min(PLAYER_MAX_TOKENS, cur + tokenRefund));

    setLastJudge({ ...judgment, damage: effectiveDamage, baseDamage, resisted, rejected: borrowedCast });
    setBeam(Date.now());
    window.setTimeout(() => setBeam(false), 1100);

    window.setTimeout(() => {
      setEnemyHp(nextEnemy);
      setHit(true);
      window.setTimeout(() => setHit(false), 320);
      if (borrowedCast) {
        addFloater("enemy", "REJECTED", "enemy");
      } else {
        addFloater("enemy", `-${effectiveDamage}`, resisted ? "misfire" : judgment.quality);
        if (resisted) addFloater("enemy", "RESISTED", "enemy");
        if (judgment.quality === "critical" && !resisted) {
          setShake(true);
          window.setTimeout(() => setShake(false), 280);
        }
      }
    }, 720);

    if (borrowedCast) {
      pushLog("result", `REJECTED · 0/100 — ${judgment.terminalText} (0 HP)`);
      pushLog("warning", "BORROWED INCANTATION — pasted or unedited template text deals no damage. Rewrite it in your own words.");
      pushLog("system", `SCORE +${scoreEvent.gain} · combo x${nextCombo} · ${scoreEvent.detail}.`);
    } else {
      pushLog("result", `${judgment.quality.toUpperCase()} · ${judgment.score}/100 — ${judgment.terminalText} (–${effectiveDamage} HP)`);
      pushLog("system", `SCORE +${scoreEvent.gain} · combo x${nextCombo} · ${scoreEvent.detail}.`);
      if (resisted) pushLog("warning", `RESISTED (${Math.round(similarity * 100)}% familiar) — base ${baseDamage} cut to ${effectiveDamage}. Vary your approach.`);
    }

    if (nextEnemy <= 0) {
      window.setTimeout(() => {
        const clear = bossClearBonus(enemyIndex, nextCombo);
        const survival = finalEnemy ? finalClearBonus(playerHp, tokensAfterCast, nextCombo) : 0;
        setRunStats((cur) => ({
          ...cur,
          score: cur.score + clear + survival,
          bossesDefeated: cur.bossesDefeated + 1,
          clearBonus: cur.clearBonus + clear + survival
        }));
        pushLog("system", enemy.defeatLog);
        pushLog("system", `CLEAR BONUS +${clear + survival}${survival ? ` · survival ${survival}` : ""}.`);
        if (finalEnemy) {
          setPhase("won");
          pushLog("system", enemy.finalVictoryLog);
          return;
        }

        const nextIndex = enemyIndex + 1;
        setPendingEnemyIndex(nextIndex);
        setPhase("rewarding");
        pushLog("system", "REWARD DRAFT — choose one upgrade before the next boss.");
        setPlayerHp(PLAYER_MAX_HP);
        setTokens(PLAYER_MAX_TOKENS);
      }, 1200);
      return;
    }

    window.setTimeout(() => {
      const wardReduction = hasReward(rewardIds, "ward-script") ? 4 : 0;
      const dmg = Math.max(1, intent.dmg - wardReduction);
      const nextP = Math.max(0, playerHp - dmg);
      setPlayerHp(nextP);
      addFloater("player", `-${dmg}`, "enemy");
      pushLog("enemy", `${enemy.name} casts ${intent.label}. –${dmg} HP${wardReduction ? " (ward -4)" : ""}.`);
      setTurn((n) => n + 1);
      if (nextP <= 0) {
        setPhase("lost");
        pushLog("warning", "DEFEAT — prompt stream went dark under hostile logic.");
      } else {
        setTokens((cur) => Math.min(PLAYER_MAX_TOKENS, cur + TOKEN_REGEN));
        setPhase("playing");
      }
    }, 1280);
  }

  function reset() {
    setEnemyIndex(initialEnemyIndex);
    setPlayerHp(PLAYER_MAX_HP);
    setTokens(PLAYER_MAX_TOKENS);
    setEnemyHp(ENEMIES[initialEnemyIndex].maxHp);
    setPrompt("");
    setPhase("playing");
    setTurn(1);
    setLastJudge(null);
    setLastScoreEvent(null);
    setRunStats(INITIAL_RUN_STATS);
    setRewardIds([]);
    setUnlockedMedals([]);
    setPendingEnemyIndex(null);
    setFloaters([]);
    setBeam(false);
    setHit(false);
    setShake(false);
    setBorrowed(false);
    borrowedChunksRef.current = [];
    patternHistoryRef.current = [];
    setLogs(initialLogs.map((l, i) => ({ ...l, id: i + 1 })));
    logId.current = 10;
    tsRef.current = initialLogs.length;
  }

  // keyboard: ⌘/Ctrl + Enter casts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (tourOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (canCast) void cast();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">PROMPT<span className="dot">·</span>CASTER</div>
          <div className="brand-sub">ai terminal · battle prototype</div>
        </div>
        <div className="topbar-meta">
          <span className="pill muted"><span className="pill-k">model</span><span className="pill-v">{judgeStatus?.model ?? "…"}</span></span>
          <span className={`pill ${judgeStatus?.mode === "fallback" ? "judge-local" : "judge-llm"}`}>
            <span className="led" />{judgeStatus?.mode === "fallback" ? "local judge" : "llm judge"}
          </span>
          <span className="pill score-pill"><span className="pill-k">score</span><span className="pill-v">{runStats.score}</span><span className="rank-chip">{rank.label}</span></span>
          <span className={`pill combo-pill ${runStats.combo > 1 ? "hot" : ""}`}><span className="pill-k">combo</span><span className="pill-v">x{runStats.combo}</span></span>
          <span className="pill muted"><span className="pill-k">turn</span><span className="pill-v">{formatTurn(turn)}</span></span>
          <button className="pill pill-btn" onClick={() => setTourOpen(true)} title="Replay the tutorial">? tour</button>
        </div>
      </header>

      <Stats enemy={enemy} playerHp={playerHp} tokens={tokens} enemyHp={enemyHp} intent={intent} hit={hit} casting={phase === "casting"} rewards={activeRewards} />

      <section className="main">
        <ArenaPanel
          enemy={enemy} encounter={enemyIndex + 1} phase={phase} playerHp={playerHp} enemyHp={enemyHp} beam={beam} hit={hit} shake={shake}
          floaters={floaters} canCast={canCast}
        />
        <ComposerPanel
          prompt={prompt} updatePrompt={updatePrompt} onPaste={handlePromptPaste} loadPreset={loadPreset}
          promptCost={promptCost} relicState={relicState} phase={phase} canCast={canCast} cast={cast}
          firstTurn={firstTurn} borrowed={borrowed} hasBlanks={hasBlanks} placeholder={enemy.placeholder}
        />
      </section>

      <section className="bottom">
        <VerdictPanel judge={lastJudge} scoreEvent={lastScoreEvent} relicState={relicState} />
        <RelicsPanel relicState={relicState} relicsOn={relicsOn} />
        <section className="panel log-panel">
          <div className="panel-header">
            <span className="h-title">combat.log</span>
            <span className="h-meta">turn {formatTurn(turn)} · {logs.length} lines</span>
          </div>
          <div className="log" ref={logEnd}>
            {logs.map((l) => (
              <div key={l.id} className={`log-line tone-${l.tone}`}>
                <span className="ts">{String(l.ts).padStart(3, "0")}</span>
                <span className="sig">{logSigil(l.tone)}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </section>
      </section>

      {battleOver && (
        <div className="outcome">
          <div className={`outcome-card ${phase === "won" ? "win" : "lose"}`}>
            <div className="verdict">{phase === "won" ? "COMBAT · WON" : "PROCESS · KILLED"}</div>
            <div className="blurb">
              {phase === "won"
                ? "The gauntlet is silent. Every hostile prompt pattern is bound."
                : "Your prompt stream went dark under hostile logic."}
            </div>
            <div className="outcome-rank">
              <span className="rank-letter">{rank.label}</span>
              <span className="rank-title">{rank.title}</span>
              <span className="rank-score">{runStats.score} score</span>
            </div>
            <div className="outcome-summary">
              <span><b>{runStats.bestCombo}</b><small>best combo</small></span>
              <span><b>{runStats.bestHit}</b><small>best hit</small></span>
              <span><b>{runStats.casts}</b><small>casts</small></span>
              <span><b>{runStats.criticals}</b><small>critical</small></span>
              <span><b>{runStats.clearBonus}</b><small>clear bonus</small></span>
              <span><b>{activeMedals.length}</b><small>medals</small></span>
            </div>
            <div className="outcome-medals">
              {activeMedals.length ? activeMedals.map((medal) => (
                <span key={medal.id}><b>{medal.sigil}</b>{medal.name}</span>
              )) : <span><b>---</b>no medals unlocked</span>}
            </div>
            <div className="outcome-penalty">{runStats.resisted + runStats.rejected} resisted/rejected casts</div>
            <div className="rank-next">
              {rank.nextAt ? `${rank.nextAt - runStats.score} score to rank ${rank.nextLabel}` : "top rank reached"}
            </div>
            <button className="restart" onClick={reset}>restart battle</button>
          </div>
        </div>
      )}

      {phase === "rewarding" && (
        <RewardDraft rewards={REWARDS.filter((reward) => !rewardIds.includes(reward.id))} onChoose={chooseReward} />
      )}

      <OnboardingTour steps={TOUR_STEPS} open={tourOpen} onClose={closeTour} />
    </main>
  );
}

// ---------- reward draft ----------
function RewardDraft({ rewards, onChoose }: { rewards: Reward[]; onChoose: (reward: Reward) => void }) {
  return (
    <div className="reward-overlay">
      <section className="reward-card">
        <div className="reward-kicker">parser gate cleared</div>
        <h2>Choose a relic upgrade</h2>
        <p>One boon carries into the next boss. Pick the line that matches how you want to play the Null Oracle fight.</p>
        <div className="reward-options">
          {rewards.map((reward) => (
            <button key={reward.id} type="button" className="reward-option" onClick={() => onChoose(reward)}>
              <span className="reward-sigil">{reward.sigil}</span>
              <span className="reward-copy">
                <span className="reward-name">{reward.name}</span>
                <span className="reward-summary">{reward.summary}</span>
                <span className="reward-detail">{reward.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- stats ----------
function Stats({ enemy, playerHp, tokens, enemyHp, intent, hit, casting, rewards }: {
  enemy: Enemy; playerHp: number; tokens: number; enemyHp: number; intent: { label: string; dmg: number }; hit: boolean; casting: boolean; rewards: Reward[];
}) {
  return (
    <section className="stats">
      <article className="combatant is-player">
        <div className="avatar player"><MageSprite casting={casting} /></div>
        <div className="combatant-meta">
          <h2 className="combatant-name">Prompt Mage<span className="tag">ally</span></h2>
          <div className="combatant-role">relic-bound caster</div>
          {rewards.length > 0 && (
            <div className="reward-badges">
              {rewards.map((reward) => <span key={reward.id} className="reward-badge">{reward.sigil}</span>)}
            </div>
          )}
          <div className="bars">
            <Bar label="hp" value={playerHp} max={PLAYER_MAX_HP} kind="hp" />
            <Bar label="tok" value={tokens} max={PLAYER_MAX_TOKENS} kind="tokens" />
          </div>
        </div>
      </article>

      <div className="vs-rail"><span className="line" /><span className="vs">vs</span><span className="line" /></div>

      <article className="combatant is-enemy">
        <div className="avatar enemy"><EnemySprite enemy={enemy} hit={hit} dead={enemyHp <= 0} /></div>
        <div className="combatant-meta">
          <h2 className="combatant-name">{enemy.name}<span className="tag">hostile</span></h2>
          <div className="combatant-role">{enemy.role}</div>
          <div className="combatant-weak"><span className="k">weak to</span> {enemy.weakness}</div>
          <div className="bars"><Bar label="hp" value={enemyHp} max={enemy.maxHp} kind="enemy" /></div>
          <div className="intent">
            <span className="k">next</span><span className="v">{intent.label}</span><span className="dmg">–{intent.dmg} hp</span>
          </div>
        </div>
      </article>
    </section>
  );
}

function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: "hp" | "tokens" | "enemy" }) {
  const pct = clamp((value / max) * 100, 0, 100);
  const low = kind !== "tokens" && pct <= 30;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className={`bar-track ${low ? "low" : ""}`}>
        <div className={`bar-fill ${kind}`} style={{ "--w": `${pct}%` } as Vars} />
      </div>
      <span className="bar-num">{value}<span className="of">/{max}</span></span>
    </div>
  );
}

// ---------- arena ----------
type RelicView = { sigil: string; name: string; rule: string; on: boolean };

function ArenaPanel({ enemy, encounter, phase, playerHp, enemyHp, beam, hit, shake, floaters, canCast }: {
  enemy: Enemy; encounter: number; phase: Phase; playerHp: number; enemyHp: number; beam: number | false; hit: boolean; shake: boolean;
  floaters: Floater[]; canCast: boolean;
}) {
  const motes = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * -8, dur: 6 + Math.random() * 5,
    drift: (Math.random() - 0.5) * 40, size: Math.random() > 0.7 ? 3 : 2
  })), []);
  const armed = canCast && phase === "playing";
  const enemyHpPct = clamp((enemyHp / enemy.maxHp) * 100, 0, 100);
  const playerHpPct = clamp((playerHp / PLAYER_MAX_HP) * 100, 0, 100);
  const status = phase === "playing" ? "ready" : phase === "casting" ? "casting…" : phase === "rewarding" ? "reward draft" : phase === "revealing" ? "revealing…" : phase;

  return (
    <section className="panel arena-panel">
      <div className="panel-header">
        <span className="h-title">arena · viewport</span>
        <span className="h-meta">floor 01 · encounter {String(encounter).padStart(3, "0")}</span>
      </div>
      <div className={`arena ${shake ? "shake" : ""}`}>
        <div className="arena-floor" />
        <div className="arena-horizon" />
        <div className="motes">
          {motes.map((m) => (
            <span key={m.id} style={{ left: `${m.left}%`, width: m.size, height: m.size, animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`, "--drift": `${m.drift}px` } as Vars} />
          ))}
        </div>
        <div className="scanline" />
        <span className="arena-bracket tl" /><span className="arena-bracket tr" /><span className="arena-bracket bl" /><span className="arena-bracket br" />

        <div className="scene-hud">
          <span className="row"><span className="led" /><span>live</span></span>
          <span className="row"><span className="k">enc</span><span className="v">{String(encounter).padStart(3, "0")}</span></span>
          {armed && <span className="row"><span className="led lock" /><span>lock</span></span>}
        </div>
        <div className="scene-hud-r"><span className={`v ${phase}`}>{status}</span></div>

        <div className="arena-figures">
          <div className={`fig player ${phase === "casting" ? "casting" : ""}`}>
            <div className="fig-tag"><span>prompt_mage</span><span className="hp-mini"><i style={{ "--w": `${playerHpPct}%` } as Vars} /></span></div>
            <div className="fig-stage">
              <div className="fig-shadow" />
              <MageSprite casting={phase === "casting"} orbActive={phase === "casting"} />
              <div className="fig-pedestal" />
              {floaters.filter((f) => f.target === "player").map((f) => (
                <div key={f.id} className={`floater ${f.quality}`} style={{ left: "50%", top: "10%" }}>{f.text}</div>
              ))}
            </div>
          </div>

          <div className={`fig enemy ${hit ? "hit" : ""} ${enemyHp <= 0 ? "dead" : ""}`}>
            <div className="fig-tag"><span>{enemy.terminalName}</span><span className="hp-mini"><i style={{ "--w": `${enemyHpPct}%` } as Vars} /></span></div>
            <div className="fig-stage">
              <div className={`reticle ${armed ? "armed" : ""} ${phase === "casting" ? "locked" : ""}`}>
                <span className="r-bracket tl" /><span className="r-bracket tr" /><span className="r-bracket bl" /><span className="r-bracket br" /><span className="r-cross" />
              </div>
              <div className="fig-shadow" />
              <EnemySprite enemy={enemy} hit={hit} dead={enemyHp <= 0} />
              <div className="fig-pedestal" />
              {enemyHp > 0 && phase === "playing" && <div className="windup"><span className="dot" />winds up</div>}
              {floaters.filter((f) => f.target === "enemy").map((f) => (
                <div key={f.id} className={`floater ${f.quality}`} style={{ left: "50%", top: "10%" }}>{f.text}</div>
              ))}
            </div>
          </div>
        </div>

        {beam && (
          <div className="cast-fx" key={`fx-${beam}`}>
            <div className="orb-charge" />
            <div className="beam" />
            <div className="impact" />
            <div className="spark" style={{ "--dx": "24px", "--dy": "-22px" } as Vars} />
            <div className="spark" style={{ "--dx": "-18px", "--dy": "-28px", animationDelay: "760ms" } as Vars} />
            <div className="spark" style={{ "--dx": "30px", "--dy": "12px", animationDelay: "780ms" } as Vars} />
            <div className="spark" style={{ "--dx": "-26px", "--dy": "6px", animationDelay: "740ms" } as Vars} />
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- relics ----------
function RelicsPanel({ relicState, relicsOn }: { relicState: RelicView[]; relicsOn: number }) {
  return (
    <section className="panel relics-panel">
      <div className="panel-header">
        <span className="h-title">relics</span>
        <span className="h-meta">{relicsOn}/3 charged</span>
      </div>
      <div className="relic-list">
        {relicState.map((r) => (
          <div key={r.sigil} className={`relic-row ${r.on ? "on" : ""}`}>
            <span className="relic-sigil">{r.sigil}</span>
            <div className="relic-text">
              <span className="relic-name">{r.name}</span>
              <span className="relic-rule">{r.rule}</span>
            </div>
            <span className="relic-dot" />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- composer ----------
function ComposerPanel({ prompt, updatePrompt, onPaste, loadPreset, promptCost, relicState, phase, canCast, cast, firstTurn, borrowed, hasBlanks, placeholder }: {
  prompt: string; updatePrompt: (v: string) => void; onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void; loadPreset: (t: string) => void;
  promptCost: number; relicState: RelicView[]; phase: Phase; canCast: boolean; cast: () => void; firstTurn: boolean; borrowed: boolean; hasBlanks: boolean;
  placeholder: string;
}) {
  const lineCount = Math.max(8, prompt.split("\n").length + 1);
  const disabled = phase === "casting" || phase === "rewarding" || phase === "revealing" || phase === "won" || phase === "lost";

  return (
    <section className="panel composer-panel">
      <div className="panel-header">
        <span className="h-title">compose spell</span>
        <span className="h-meta"><span className="kbd">⌘</span> <span className="kbd">↵</span> to cast · {prompt.length}/700</span>
      </div>
      <div className="composer-body">
        <div className={`spell-area ${borrowed ? "borrowed" : hasBlanks ? "blanks" : ""}`}>
          <div className="spell-input">
            <div className="gutter">
              {Array.from({ length: lineCount }, (_, i) => <span key={i}>{String(i + 1).padStart(2, "0")}</span>)}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => updatePrompt(e.target.value)}
              onPaste={onPaste}
              disabled={disabled}
              maxLength={700}
              placeholder={placeholder}
              spellCheck={false}
            />
          </div>
          <div className="spell-meta">
            <div className="spell-meta-left">
              <div className="relic-chips">
                {relicState.map((r) => (
                  <span key={r.sigil} className={`relic-chip ${r.on ? "on" : ""}`}><span className="d" />{r.sigil}</span>
                ))}
              </div>
              {(borrowed || hasBlanks) && (
                <span className={`spell-note ${borrowed ? "borrowed" : "blanks"}`}>
                  {borrowed
                    ? "⚠ pasted text deals 0 damage — rewrite in your own words."
                    : "✎ fill every [blank] with your own words before you can cast."}
                </span>
              )}
            </div>
            <span className="right">
              {borrowed || hasBlanks ? `${prompt.length} · ~${promptCost} tok` : `${prompt.length} chars · ~${promptCost} tokens`}
            </span>
          </div>
        </div>

        <div>
          <div className="templates-head">skeletons — load the shape, then fill every [blank] yourself</div>
          <div className="templates">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="template" disabled={disabled} onClick={() => loadPreset(p.text)}>
                <span className="glyph">{p.glyph}</span>
                <span><span className="label">{p.label}</span><span className="teaches">{p.teaches}</span></span>
              </button>
            ))}
          </div>
        </div>

        <div className="cast-row">
          <p className="cast-explain">
            <b>contract:</b> the judge receives only enemy, weakness, active relic names and your prompt — no history. damage scales with score; the enemy resists repeated patterns.
          </p>
          <button className={`cast-btn ${firstTurn && canCast ? "pulse" : ""}`} disabled={!canCast} onClick={cast}>
            <span className="label">{phase === "casting" ? "casting…" : "cast"}</span>
            <span className="cost"><b>{promptCost}</b>&nbsp;tok</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- arbiter verdict ----------
function VerdictPanel({ judge, scoreEvent, relicState }: { judge: JudgeResult | null; scoreEvent: ScoreEvent | null; relicState: RelicView[] }) {
  const label = judge ? (judge.rejected ? "rejected" : judge.resisted ? "resisted" : judge.quality) : null;
  const tone = judge ? (judge.rejected || judge.resisted ? "enemy" : judge.quality) : "misfire";
  const sourceLabel = judge?.source === "ai" ? "llm" : judge?.source === "cache" ? "cache" : judge?.source === "fallback" ? "local" : "";
  return (
    <section className={`panel verdict-panel ${judge ? `accent-${tone}` : ""}`}>
      <div className="panel-header">
        <span className="h-title">arbiter · verdict</span>
        {judge && <span className="h-meta">{sourceLabel} judge</span>}
      </div>
      <div className="verdict-body">
        {judge ? (
          <>
            <div className="verdict-head">
              <span className={`verdict-quality ${tone}`}>{label}</span>
              <span className="verdict-score">{judge.score}/100</span>
              {judge.resisted && <span className="verdict-flag">base {judge.baseDamage} → {judge.damage}</span>}
            </div>
            {scoreEvent && (
              <div className="score-event">
                <span className="gain">+{scoreEvent.gain}</span>
                <span className="combo">combo x{scoreEvent.combo}</span>
                <span className="detail">{scoreEvent.detail}</span>
              </div>
            )}
            <div className="relic-breakdown">
              {relicState.map((relic) => (
                <span key={relic.sigil} className={relic.on ? "on" : ""}>
                  <b>{relic.sigil}</b>{relic.on ? "charged" : "missing"}
                </span>
              ))}
            </div>
            <p className="verdict-reason">{judge.reason}</p>
            <p className="verdict-improve"><span className="k">▸ to improve</span><span>{judge.improvement}</span></p>
          </>
        ) : (
          <p className="verdict-empty">awaiting first cast — write a spell and the Arbiter will score your craft and tell you what to sharpen.</p>
        )}
      </div>
    </section>
  );
}

// ---------- onboarding tour ----------
function OnboardingTour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => { if (open) setIndex(0); }, [open]);

  // Track the target element's position; recompute on step change / resize.
  useLayoutEffect(() => {
    if (!open) return;
    const step = steps[index];
    let raf = 0;
    const update = () => {
      const el = step.selector ? (document.querySelector(step.selector) as HTMLElement | null) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", update); };
  }, [open, index, steps]);

  const last = index === steps.length - 1;
  const next = () => (last ? onClose() : setIndex((i) => Math.min(steps.length - 1, i + 1)));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, index, last]);

  if (!open) return null;
  const step = steps[index];

  const vw = window.innerWidth, vh = window.innerHeight;
  const PAD = 8, GAP = 16, CARD_W = 320;

  // spotlight box (expanded around the target)
  const sb = rect ? { top: rect.top - PAD, left: rect.left - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 } : null;

  // resolve placement (auto-pick the side with the most room)
  let placement = step.placement ?? "bottom";
  if (sb && placement !== "center") {
    const ok = { bottom: vh - (sb.top + sb.h), top: sb.top, right: vw - (sb.left + sb.w), left: sb.left };
    if (ok[placement] < 200) placement = (Object.entries(ok).sort((a, b) => b[1] - a[1])[0][0] as typeof placement);
  }

  // card + arrow geometry
  const cardStyle: React.CSSProperties = {};
  let arrowDir: "up" | "down" | "left" | "right" = "up";
  const arrowStyle: React.CSSProperties = {};

  if (!sb || placement === "center") {
    cardStyle.top = "50%"; cardStyle.left = "50%"; cardStyle.transform = "translate(-50%, -50%)";
  } else {
    const cx = sb.left + sb.w / 2, cy = sb.top + sb.h / 2;
    const clampX = (x: number) => Math.max(16, Math.min(vw - CARD_W - 16, x));
    if (placement === "bottom") {
      cardStyle.top = sb.top + sb.h + GAP; cardStyle.left = clampX(cx - CARD_W / 2);
      arrowDir = "up"; arrowStyle.top = -9; arrowStyle.left = Math.min(CARD_W - 28, Math.max(16, cx - clampX(cx - CARD_W / 2) - 6));
    } else if (placement === "top") {
      cardStyle.top = sb.top - GAP; cardStyle.left = clampX(cx - CARD_W / 2); cardStyle.transform = "translateY(-100%)";
      arrowDir = "down"; arrowStyle.bottom = -9; arrowStyle.left = Math.min(CARD_W - 28, Math.max(16, cx - clampX(cx - CARD_W / 2) - 6));
    } else if (placement === "right") {
      cardStyle.left = sb.left + sb.w + GAP; cardStyle.top = Math.max(16, Math.min(vh - 160, cy - 70));
      arrowDir = "left"; arrowStyle.left = -9; arrowStyle.top = Math.max(14, cy - (cardStyle.top as number) - 6);
    } else { // left
      cardStyle.left = sb.left - GAP; cardStyle.top = Math.max(16, Math.min(vh - 160, cy - 70)); cardStyle.transform = "translateX(-100%)";
      arrowDir = "right"; arrowStyle.right = -9; arrowStyle.top = Math.max(14, cy - (cardStyle.top as number) - 6);
    }
  }

  return (
    <div className="tour-root">
      <div className={`tour-blocker ${sb ? "" : "dim"}`} />
      {sb && (
        <div
          className="tour-spotlight"
          style={{ top: sb.top, left: sb.left, width: sb.w, height: sb.h }}
        />
      )}
      <div className="tour-card" style={cardStyle} key={index}>
        {sb && placement !== "center" && <span className={`tour-arrow ${arrowDir}`} style={arrowStyle} />}
        <div className="tour-card-head">
          <span className="tour-step-no">{String(index + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
          <button className="tour-skip" onClick={onClose}>skip tutorial ✕</button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-progress"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
        <div className="tour-actions">
          <button className="tour-btn ghost" onClick={back} disabled={index === 0}>back</button>
          <button className="tour-btn primary" onClick={next}>{last ? "finish ▸" : "next ▸"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- sprites ----------
function EnemySprite({ enemy, hit, dead }: { enemy: Enemy; hit: boolean; dead: boolean }) {
  return enemy.id === "null-oracle"
    ? <NullOracleSprite hit={hit} dead={dead} />
    : <GoblinSprite hit={hit} dead={dead} />;
}

function MageSprite({ casting = false, orbActive = false }: { casting?: boolean; orbActive?: boolean }) {
  const accent = "var(--mage)";
  return (
    <svg className="sprite" viewBox="0 0 32 40" shapeRendering="crispEdges" aria-label="Prompt Mage">
      <ellipse cx="14" cy="39" rx="9" ry="1" fill="rgba(0,0,0,0.5)" />
      <rect x="25" y="8" width="2" height="30" fill="#5d4a30" />
      <rect x="25" y="8" width="1" height="30" fill="#3a2f1f" />
      {casting && <circle cx="26" cy="7" r="8" fill={accent} opacity="0.18" />}
      <circle cx="26" cy="7" r="5" fill={accent} opacity="0.25" />
      <rect x="24" y="5" width="4" height="4" fill={accent} />
      <rect x="25" y="6" width="2" height="2" fill="#ffffff" opacity="0.7" />
      <path d="M9 6 L9 18 L21 18 L21 6 L18 3 L12 3 Z" fill="#1d2942" />
      <path d="M9 6 L12 3 L18 3 L21 6 L21 7 L19 5 L11 5 L9 7 Z" fill="#101728" />
      <rect x="10" y="6" width="11" height="2" fill="#101728" opacity="0.6" />
      <rect x="11" y="9" width="9" height="6" fill="#d8d2bd" />
      <rect x="11" y="14" width="9" height="1" fill="#9b9479" />
      <rect x="13" y="11" width="2" height="2" fill={orbActive ? accent : "#101728"} />
      <rect x="17" y="11" width="2" height="2" fill={orbActive ? accent : "#101728"} />
      <rect x="8" y="17" width="14" height="3" fill="#121a2b" />
      <path d="M7 20 L23 20 L25 38 L5 38 Z" fill="#1f2942" />
      <path d="M10 20 L20 20 L21 36 L9 36 Z" fill="#2a3656" />
      <rect x="5" y="37" width="20" height="1" fill="#121a2b" />
      <rect x="11" y="25" width="8" height="1" fill={accent} opacity="0.7" />
    </svg>
  );
}

function GoblinSprite({ hit = false, dead = false }: { hit?: boolean; dead?: boolean }) {
  return (
    <svg className="sprite" viewBox="0 0 32 40" shapeRendering="crispEdges" aria-label="Regex Goblin" data-dead={dead}>
      <ellipse cx="16" cy="39" rx="10" ry="1" fill="rgba(0,0,0,0.5)" />
      <path d="M3 14 L7 12 L7 22 L3 20 Z" fill="#5b7548" />
      <rect x="3" y="14" width="1" height="6" fill="#1f2d1c" />
      <path d="M29 14 L25 12 L25 22 L29 20 Z" fill="#5b7548" />
      <rect x="28" y="14" width="1" height="6" fill="#1f2d1c" />
      <path d="M6 8 L26 8 L25 24 L7 24 Z" fill="#5b7548" />
      <path d="M6 8 L26 8 L26 10 L6 10 Z" fill="#445c37" />
      <rect x="7" y="22" width="18" height="2" fill="#1f2d1c" />
      <path d="M6 8 L26 8 M6 8 L7 24 M26 8 L25 24" stroke="#1f2d1c" fill="none" />
      <rect x="10" y="13" width="4" height="4" fill="#f0b34d" />
      <rect x="18" y="13" width="4" height="4" fill="#f0b34d" />
      {!hit && (<>
        <rect x="11" y="14" width="2" height="2" fill="#fff" opacity="0.5" />
        <rect x="19" y="14" width="2" height="2" fill="#fff" opacity="0.5" />
      </>)}
      <rect x="13" y="20" width="6" height="1" fill="#1f2d1c" />
      <rect x="8" y="24" width="16" height="12" fill="#2c332f" />
      <rect x="8" y="24" width="16" height="1" fill="#3a423d" />
      <rect x="8" y="24" width="1" height="12" fill="#11150f" />
      <rect x="23" y="24" width="1" height="12" fill="#11150f" />
      <rect x="8" y="35" width="16" height="1" fill="#11150f" />
      <rect x="8" y="30" width="16" height="2" fill="#3a2f1f" />
      <rect x="10" y="36" width="3" height="3" fill="#2c332f" />
      <rect x="19" y="36" width="3" height="3" fill="#2c332f" />
    </svg>
  );
}

function NullOracleSprite({ hit = false, dead = false }: { hit?: boolean; dead?: boolean }) {
  return (
    <svg className="sprite oracle-sprite" viewBox="0 0 32 40" shapeRendering="crispEdges" aria-label="Null Oracle" data-dead={dead}>
      <ellipse cx="16" cy="39" rx="10" ry="1" fill="rgba(0,0,0,0.55)" />
      <rect x="11" y="31" width="10" height="6" fill="#242a33" />
      <rect x="12" y="36" width="3" height="3" fill="#11161d" />
      <rect x="17" y="36" width="3" height="3" fill="#11161d" />
      <path d="M7 12 L25 12 L27 29 L5 29 Z" fill="#202734" />
      <path d="M9 14 L23 14 L24 28 L8 28 Z" fill="#111821" />
      <rect x="6" y="25" width="20" height="4" fill="#303949" />
      <rect x="8" y="29" width="16" height="2" fill="#0b0f14" />
      <rect x="4" y="18" width="4" height="9" fill="#151c25" />
      <rect x="24" y="18" width="4" height="9" fill="#151c25" />
      <path d="M10 8 L22 8 L25 13 L7 13 Z" fill="#303949" />
      <rect x="11" y="6" width="10" height="3" fill="#161d27" />
      <rect x="13" y="3" width="6" height="4" fill="#0f151e" />
      <rect x="9" y="12" width="14" height="1" fill="#536071" />
      <rect x="10" y="15" width="12" height="8" fill="#05080c" />
      <rect className="oracle-eye" x="12" y="17" width="8" height="4" fill={hit ? "#f5f0d0" : "#9bf3d0"} />
      <rect x="13" y="18" width="6" height="2" fill={hit ? "#ff776e" : "#0d1418"} />
      <rect x="15" y="16" width="2" height="6" fill={hit ? "#ff776e" : "#f3f6f8"} opacity="0.65" />
      <rect x="10" y="24" width="12" height="1" fill="#536071" opacity="0.7" />
      <rect x="13" y="26" width="6" height="1" fill="#536071" opacity="0.55" />
      <rect className="oracle-omen omen-a" x="4" y="9" width="2" height="2" fill="#9bf3d0" opacity="0.55" />
      <rect className="oracle-omen omen-b" x="27" y="11" width="2" height="2" fill="#9bf3d0" opacity="0.45" />
      <rect className="oracle-omen omen-c" x="2" y="23" width="2" height="2" fill="#9bf3d0" opacity="0.35" />
      <rect className="oracle-omen omen-d" x="28" y="25" width="2" height="2" fill="#9bf3d0" opacity="0.5" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

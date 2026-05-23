import "dotenv/config";

type ApiResponse = {
  json: (body: unknown) => void;
};

export default function handler(_req: unknown, res: ApiResponse) {
  const hasApiKey = Boolean(process.env.AI_API_KEY ?? process.env.VITE_AI_API_KEY);
  res.json({
    mode: hasApiKey ? "llm" : "fallback",
    model: hasApiKey ? (process.env.AI_MODEL ?? "gpt-4o-mini") : "local-rules",
    baseUrl: hasApiKey ? (process.env.AI_BASE_URL ?? "https://api.openai.com/v1") : null
  });
}

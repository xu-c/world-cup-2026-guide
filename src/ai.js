const PROMPT_VERSION = "world-cup-2026-insight-v1";
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

export function buildInsightPrompt({ type, match }) {
  const isSummary = type === "summary";
  const task = isSummary
    ? "Summarize the completed FIFA World Cup 2026 match from the supplied facts."
    : "Preview the upcoming FIFA World Cup 2026 match from the supplied facts.";

  return [
    task,
    "Return ONLY valid JSON. Do not wrap the response in markdown.",
    "Use concise Chinese suitable for a match guide.",
    "Do not invent player names, injuries, cards, xG, or quotes that are not provided.",
    "Do not claim certainty; predictions must be probabilistic.",
    "",
    "Required JSON schema:",
    JSON.stringify(
      {
        headline: "string, <= 28 Chinese characters",
        shortText: "string, 2 concise sentences",
        keyMoments: ["string", "string"],
        tacticalNotes: ["string", "string"],
        playersToWatch: ["string", "string"],
        probabilities: {
          homeWin: "number from 0 to 1",
          draw: "number from 0 to 1",
          awayWin: "number from 0 to 1",
        },
        confidence: "low | medium | high",
        generatedFor: type,
      },
      null,
      2,
    ),
    "",
    "Match facts:",
    JSON.stringify(match, null, 2),
  ].join("\n");
}

export function parseInsightJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

export function validateInsight(value, expectedType) {
  if (!value || typeof value !== "object") {
    throw new Error("AI insight must be an object");
  }

  const insight = {
    headline: requireText(value.headline, "headline", 80),
    shortText: requireText(value.shortText, "shortText", 500),
    keyMoments: requireTextArray(value.keyMoments, "keyMoments"),
    tacticalNotes: requireTextArray(value.tacticalNotes, "tacticalNotes"),
    playersToWatch: requireTextArray(value.playersToWatch, "playersToWatch"),
    probabilities: validateProbabilities(value.probabilities),
    confidence: String(value.confidence || "").toLowerCase(),
    generatedFor: value.generatedFor,
  };

  if (!CONFIDENCE_VALUES.has(insight.confidence)) {
    throw new Error("confidence must be low, medium, or high");
  }

  if (insight.generatedFor !== expectedType) {
    throw new Error(`generatedFor must be ${expectedType}`);
  }

  return insight;
}

export async function generateInsight({ type, match, fetchImpl = fetch }) {
  const prompt = buildInsightPrompt({ type, match });
  const config = getAiConfig();

  if (!config.apiKey) {
    return {
      insight: fallbackInsight(type, match),
      model: "local-fallback",
      promptVersion: PROMPT_VERSION,
    };
  }

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You generate structured Chinese football match guide content and return only valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const text = extractChatCompletionText(payload);
  try {
    return {
      insight: validateInsight(parseInsightJson(text), type),
      model: config.model,
      promptVersion: PROMPT_VERSION,
    };
  } catch (error) {
    console.error("AI response failed schema validation; using fallback insight", error);
    return {
      insight: fallbackInsight(type, match),
      model: "local-fallback",
      promptVersion: PROMPT_VERSION,
    };
  }
}

export function hasConfiguredAiProvider() {
  return Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
}

export function fallbackInsight(type, match) {
  const home = match.homeTeam || "主队";
  const away = match.awayTeam || "客队";
  const isSummary = type === "summary";

  return validateInsight(
    {
      headline: isSummary ? `${home} vs ${away} 赛后摘要` : `${home} vs ${away} 赛前预测`,
      shortText: isSummary
        ? `本场已经结束，比分和基础赛况已写入数据库。当前未配置 AI_API_KEY，因此使用本地结构化摘要占位。`
        : `这场比赛尚未开始，系统已基于赛程生成结构化预测占位。配置 AI_API_KEY 后会写入模型生成的预测。`,
      keyMoments: isSummary
        ? ["最终比分已确认", "赛后摘要会在首次刷新后缓存"]
        : ["开球时间临近时会提高数据刷新频率", "预测结果会按缓存策略复用"],
      tacticalNotes: ["关注双方阵型和压迫强度", "关注定位球与转换进攻效率"],
      playersToWatch: [home, away],
      probabilities: isSummary
        ? {
            homeWin: Number(match.homeScore > match.awayScore),
            draw: Number(match.homeScore === match.awayScore),
            awayWin: Number(match.awayScore > match.homeScore),
          }
        : { homeWin: 0.36, draw: 0.28, awayWin: 0.36 },
      confidence: "low",
      generatedFor: type,
    },
    type,
  );
}

function requireText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim().slice(0, maxLength);
}

function requireTextArray(value, name) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${name} must contain at least two items`);
  }

  return value.slice(0, 4).map((item) => requireText(item, name, 120));
}

function validateProbabilities(value) {
  if (!value || typeof value !== "object") {
    throw new Error("probabilities must be an object");
  }

  return {
    homeWin: requireProbability(value.homeWin, "homeWin"),
    draw: requireProbability(value.draw, "draw"),
    awayWin: requireProbability(value.awayWin, "awayWin"),
  };
}

function requireProbability(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }

  return number;
}

function getAiConfig() {
  const baseUrl = (
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  return {
    baseUrl,
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
  };
}

function extractChatCompletionText(payload) {
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI response did not include message content");
  return text;
}

import { validateStructuredInsight } from "./insight-schemas.js";

const PROMPT_VERSION = "world-cup-2026-insight-v2";
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

export function buildInsightPrompt({ type, match }) {
  const isSummary = type === "summary";
  const task = isSummary
    ? "Summarize the completed FIFA World Cup 2026 match from the supplied facts."
    : "Preview the upcoming FIFA World Cup 2026 match from the supplied facts.";
  const schema = isSummary ? summarySchema() : predictionSchema();

  return [
    task,
    "Return ONLY valid JSON. Do not wrap the response in markdown.",
    "Use concise Chinese suitable for a match guide.",
    "Do not invent player names, injuries, cards, xG, or quotes that are not provided.",
    "Do not claim certainty; predictions must be probabilistic.",
    "For predictions, include predictedScore, outcomeProbabilities, matchScript, scoreRationale, tacticalFactors, decisiveFactors, and riskFactors.",
    "For summaries, use officialEvents and technicalFacts from supplied facts only.",
    "Do not add shots, shots on target, possession, xG, injuries, quotes, or unavailable player status.",
    "If player data is not supplied, use team-level wording instead of inventing player names.",
    "",
    "Required JSON schema:",
    JSON.stringify(schema, null, 2),
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
    return fallbackInsightPayload(type, match);
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
    const structured = parseStructuredInsight(text, type, match);
    return {
      insight: legacyInsightFromStructured(structured),
      structured,
      schemaVersion: structured.schemaVersion,
      model: config.model,
      promptVersion: PROMPT_VERSION,
    };
  } catch (error) {
    console.error("AI response failed schema validation; using fallback insight", error);
    return fallbackInsightPayload(type, match);
  }
}

function parseStructuredInsight(text, type, match) {
  const parsed = parseInsightJson(text);
  if (parsed?.schemaVersion) return validateStructuredInsight(parsed, type);

  return legacyStructuredInsight(validateInsight(parsed, type), type, match);
}

export function hasConfiguredAiProvider() {
  return Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
}

export function fallbackInsight(type, match) {
  return legacyInsightFromStructured(fallbackStructuredInsight(type, match));
}

function fallbackInsightPayload(type, match) {
  const structured = fallbackStructuredInsight(type, match);
  return {
    insight: legacyInsightFromStructured(structured),
    structured,
    schemaVersion: structured.schemaVersion,
    model: "local-fallback",
    promptVersion: PROMPT_VERSION,
  };
}

function fallbackStructuredInsight(type, match) {
  return type === "summary" ? fallbackSummaryStructuredInsight(match) : fallbackPredictionStructuredInsight(match);
}

function fallbackPredictionStructuredInsight(match) {
  const home = match.homeTeam || "主队";
  const away = match.awayTeam || "客队";

  return validateStructuredInsight(
    {
      schemaVersion: "prediction-v2",
      type: "prediction",
      headline: `${home} vs ${away} 赛前预测`,
      shortText: "这场比赛尚未开始，系统已基于赛程生成结构化预测占位。配置 AI_API_KEY 后会写入模型生成的预测。",
      predictedScore: { home: 1, away: 1, label: "1-1" },
      outcomeProbabilities: { homeWin: 0.36, draw: 0.28, awayWin: 0.36 },
      matchScript: {
        summary: "双方赛前信息有限，预计比赛会在谨慎节奏中展开。",
        firstHalf: "上半场重点关注两队进入比赛状态的速度。",
        secondHalf: "下半场体能和换人节奏可能影响比赛走势。",
      },
      scoreRationale: ["赛前缺少更细官方技术信息", "双方都有通过定位球或转换进攻得分的可能"],
      tacticalFactors: ["关注双方阵型和压迫强度", "关注定位球与转换进攻效率"],
      decisiveFactors: ["防线专注度", "关键机会把握"],
      riskFactors: ["早段进球会改变比赛节奏", "赛前信息不足降低预测置信度"],
      playersToWatch: [home, away],
      confidence: "low",
      generatedFor: "prediction",
    },
    "prediction",
  );
}

function fallbackSummaryStructuredInsight(match) {
  const home = match.homeTeam || "主队";
  const away = match.awayTeam || "客队";
  const homeScore = nonNegativeScore(match.homeScore);
  const awayScore = nonNegativeScore(match.awayScore);
  const winner = homeScore > awayScore ? home : awayScore > homeScore ? away : "平局";
  const resultText = `${home} ${homeScore}-${awayScore} ${away}`;

  return validateStructuredInsight(
    {
      schemaVersion: "summary-v2",
      type: "summary",
      headline: `${home} vs ${away} 赛后摘要`,
      result: {
        homeScore,
        awayScore,
        winner,
        resultText,
      },
      matchStory: {
        summary: "本场已经结束，比分和基础赛况已写入数据库。当前未配置 AI_API_KEY，因此使用本地结构化摘要占位。",
        turningPoint: "官方详细事件尚未由本地占位内容展开。",
        closingPhase: "赛后摘要会在首次刷新后缓存，并在官方事实补全后更新。",
      },
      officialEvents: {
        goals: [],
        cards: [],
        substitutions: [],
      },
      technicalFacts: {
        formations: { home: null, away: null },
        attendance: null,
        venue: match.venue || null,
        officials: [],
      },
      aiAnalysis: {
        tacticalSummary: ["关注双方阵型和压迫强度", "关注定位球与转换进攻效率"],
        keyPlayerImpact: [],
        resultExplanation: ["最终比分已确认", "本地占位摘要不补充未经提供的技术统计"],
      },
      predictionReview: null,
      officialFactsStatus: "partial",
      missingOfficialFields: ["goals", "cards", "substitutions"],
      completionNotes: {
        fallback: {
          source: "local-fallback",
          label: "未配置 AI 提供商时生成的结构化占位内容",
        },
      },
      generatedFor: "summary",
    },
    "summary",
  );
}

function legacyInsightFromStructured(structured) {
  if (structured.schemaVersion === "prediction-v2") {
    return validateInsight(
      {
        headline: structured.headline,
        shortText: structured.shortText,
        keyMoments: atLeastTwo(structured.scoreRationale, structured.matchScript.summary),
        tacticalNotes: atLeastTwo(structured.tacticalFactors, structured.matchScript.firstHalf),
        playersToWatch: atLeastTwo(structured.playersToWatch, structured.headline),
        probabilities: structured.outcomeProbabilities,
        confidence: structured.confidence,
        generatedFor: "prediction",
      },
      "prediction",
    );
  }

  return validateInsight(
    {
      headline: structured.headline,
      shortText: structured.matchStory.summary,
      keyMoments: [structured.matchStory.turningPoint, structured.matchStory.closingPhase],
      tacticalNotes: atLeastTwo(structured.aiAnalysis.tacticalSummary, structured.matchStory.summary),
      playersToWatch: atLeastTwo(
        structured.aiAnalysis.keyPlayerImpact.length
          ? structured.aiAnalysis.keyPlayerImpact
          : [structured.result.winner, structured.result.resultText],
        structured.headline,
      ),
      probabilities: structured.predictionReview?.preMatchProbabilities || resultProbabilities(structured.result),
      confidence: "medium",
      generatedFor: "summary",
    },
    "summary",
  );
}

function legacyStructuredInsight(insight, type, match) {
  return type === "summary"
    ? legacySummaryStructuredInsight(insight, match)
    : legacyPredictionStructuredInsight(insight);
}

function legacyPredictionStructuredInsight(insight) {
  return validateStructuredInsight(
    {
      schemaVersion: "prediction-v2",
      type: "prediction",
      headline: insight.headline,
      shortText: insight.shortText,
      predictedScore: { home: 1, away: 1, label: "1-1" },
      outcomeProbabilities: insight.probabilities,
      matchScript: {
        summary: insight.shortText,
        firstHalf: insight.keyMoments[0],
        secondHalf: insight.keyMoments[1],
      },
      scoreRationale: insight.keyMoments,
      tacticalFactors: insight.tacticalNotes,
      decisiveFactors: insight.keyMoments,
      riskFactors: ["模型未提供 v2 风险因素", "赛前信息有限"],
      playersToWatch: insight.playersToWatch,
      confidence: insight.confidence,
      generatedFor: "prediction",
    },
    "prediction",
  );
}

function legacySummaryStructuredInsight(insight, match) {
  const home = match.homeTeam || "主队";
  const away = match.awayTeam || "客队";
  const homeScore = nonNegativeScore(match.homeScore);
  const awayScore = nonNegativeScore(match.awayScore);
  const winner = homeScore > awayScore ? home : awayScore > homeScore ? away : "平局";

  return validateStructuredInsight(
    {
      schemaVersion: "summary-v2",
      type: "summary",
      headline: insight.headline,
      result: {
        homeScore,
        awayScore,
        winner,
        resultText: `${home} ${homeScore}-${awayScore} ${away}`,
      },
      matchStory: {
        summary: insight.shortText,
        turningPoint: insight.keyMoments[0],
        closingPhase: insight.keyMoments[1],
      },
      officialEvents: {
        goals: [],
        cards: [],
        substitutions: [],
      },
      technicalFacts: {
        formations: { home: null, away: null },
        attendance: null,
        venue: match.venue || null,
        officials: [],
      },
      aiAnalysis: {
        tacticalSummary: insight.tacticalNotes,
        keyPlayerImpact: insight.playersToWatch,
        resultExplanation: insight.keyMoments,
      },
      predictionReview: null,
      officialFactsStatus: "partial",
      missingOfficialFields: ["goals", "cards", "substitutions"],
      completionNotes: {
        legacyModelResponse: {
          source: "ai",
          label: "模型返回 legacy JSON，已转换为 v2 结构",
        },
      },
      generatedFor: "summary",
    },
    "summary",
  );
}

function atLeastTwo(values, fallback) {
  const items = Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
  if (items.length >= 2) return items;
  if (items.length === 1) return [items[0], fallback || items[0]];
  return [fallback || "基础信息", "等待更多官方信息"];
}

function resultProbabilities(result) {
  return {
    homeWin: Number(result.homeScore > result.awayScore),
    draw: Number(result.homeScore === result.awayScore),
    awayWin: Number(result.awayScore > result.homeScore),
  };
}

function nonNegativeScore(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function predictionSchema() {
  return {
    schemaVersion: "prediction-v2",
    type: "prediction",
    headline: "string, <= 28 Chinese characters",
    shortText: "string, 2 concise sentences",
    predictedScore: { home: "non-negative integer", away: "non-negative integer", label: "home-away, e.g. 2-1" },
    outcomeProbabilities: {
      homeWin: "number from 0 to 1",
      draw: "number from 0 to 1",
      awayWin: "number from 0 to 1",
    },
    matchScript: {
      summary: "string",
      firstHalf: "string",
      secondHalf: "string",
    },
    scoreRationale: ["string"],
    tacticalFactors: ["string"],
    decisiveFactors: ["string"],
    riskFactors: ["string"],
    playersToWatch: ["string"],
    confidence: "low | medium | high",
    generatedFor: "prediction",
  };
}

function summarySchema() {
  return {
    schemaVersion: "summary-v2",
    type: "summary",
    headline: "string, <= 28 Chinese characters",
    result: {
      homeScore: "non-negative integer",
      awayScore: "non-negative integer",
      winner: "string",
      resultText: "string",
    },
    matchStory: {
      summary: "string",
      turningPoint: "string",
      closingPhase: "string",
    },
    officialEvents: {
      goals: [{ minute: "string", team: "string", player: "string", assist: "string | null", type: "goal | own_goal | penalty | string" }],
      cards: [{ minute: "string", team: "string", player: "string", card: "yellow | red | second_yellow | unknown" }],
      substitutions: [{ minute: "string", team: "string", playerOff: "string", playerOn: "string" }],
    },
    technicalFacts: {
      formations: { home: "string | null", away: "string | null" },
      attendance: "non-negative integer | null",
      venue: "string | null",
      officials: ["string"],
    },
    aiAnalysis: {
      tacticalSummary: ["string"],
      keyPlayerImpact: ["string"],
      resultExplanation: ["string"],
    },
    predictionReview: {
      predictedScore: "string",
      actualScore: "string",
      scoreHit: "boolean",
      outcomeHit: "boolean",
      preMatchProbabilities: {
        homeWin: "number from 0 to 1",
        draw: "number from 0 to 1",
        awayWin: "number from 0 to 1",
      },
      reviewText: "string",
    },
    officialFactsStatus: "complete | partial",
    missingOfficialFields: ["string"],
    completionNotes: {
      fieldName: { source: "official | ai | local-fallback", label: "string" },
    },
    generatedFor: "summary",
  };
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

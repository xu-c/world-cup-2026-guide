import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePredictionV2,
  validateSummaryV2,
  validateStructuredInsight,
} from "../src/insight-schemas.js";
import { buildInsightPrompt, generateInsight } from "../src/ai.js";

test("prediction-v2 validates score, probabilities, and rationale sections", () => {
  const prediction = validatePredictionV2({
    schemaVersion: "prediction-v2",
    type: "prediction",
    headline: "巴西小胜机会更高",
    shortText: "巴西预计会掌握更多控球时间。摩洛哥需要依靠转换进攻制造威胁。",
    predictedScore: { home: 2, away: 1, label: "2-1" },
    outcomeProbabilities: { homeWin: 0.52, draw: 0.25, awayWin: 0.23 },
    matchScript: {
      summary: "巴西主导推进，摩洛哥等待反击。",
      firstHalf: "上半场巴西会更主动。",
      secondHalf: "下半场空间会增大。",
    },
    scoreRationale: ["巴西创造机会能力更强", "摩洛哥反击仍有进球可能"],
    tacticalFactors: ["巴西边路推进更稳定", "摩洛哥需要保护禁区前沿"],
    decisiveFactors: ["定位球防守", "转换进攻效率"],
    riskFactors: ["早段进球会改变节奏", "淘汰赛压力会降低开放程度"],
    playersToWatch: ["巴西前场组合", "摩洛哥防线"],
    confidence: "medium",
    generatedFor: "prediction",
  });

  assert.equal(prediction.predictedScore.label, "2-1");
  assert.equal(prediction.outcomeProbabilities.homeWin, 0.52);
});

test("prediction-v2 rejects mismatched score labels", () => {
  assert.throws(
    () =>
      validatePredictionV2({
        schemaVersion: "prediction-v2",
        type: "prediction",
        headline: "比分标签错误",
        shortText: "这是一条结构完整但比分标签错误的预测。",
        predictedScore: { home: 2, away: 1, label: "1-1" },
        outcomeProbabilities: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
        matchScript: { summary: "a", firstHalf: "b", secondHalf: "c" },
        scoreRationale: ["a", "b"],
        tacticalFactors: ["a", "b"],
        decisiveFactors: ["a"],
        riskFactors: ["a"],
        playersToWatch: ["a"],
        confidence: "low",
        generatedFor: "prediction",
      }),
    /predictedScore.label/,
  );
});

test("prediction-v2 rejects null predicted score numbers", () => {
  assert.throws(
    () =>
      validatePredictionV2({
        schemaVersion: "prediction-v2",
        type: "prediction",
        headline: "比分字段错误",
        shortText: "这是一条结构完整但主队比分字段错误的预测。",
        predictedScore: { home: null, away: 1, label: "0-1" },
        outcomeProbabilities: { homeWin: 0.34, draw: 0.33, awayWin: 0.33 },
        matchScript: { summary: "a", firstHalf: "b", secondHalf: "c" },
        scoreRationale: ["a"],
        tacticalFactors: ["a"],
        decisiveFactors: ["a"],
        riskFactors: ["a"],
        playersToWatch: ["a"],
        confidence: "low",
        generatedFor: "prediction",
      }),
    /predictedScore.home/,
  );
});

test("prediction-v2 rejects null probabilities", () => {
  assert.throws(
    () =>
      validatePredictionV2({
        schemaVersion: "prediction-v2",
        type: "prediction",
        headline: "概率字段错误",
        shortText: "这是一条结构完整但主胜概率字段错误的预测。",
        predictedScore: { home: 1, away: 1, label: "1-1" },
        outcomeProbabilities: { homeWin: null, draw: 0.5, awayWin: 0.5 },
        matchScript: { summary: "a", firstHalf: "b", secondHalf: "c" },
        scoreRationale: ["a"],
        tacticalFactors: ["a"],
        decisiveFactors: ["a"],
        riskFactors: ["a"],
        playersToWatch: ["a"],
        confidence: "low",
        generatedFor: "prediction",
      }),
    /outcomeProbabilities.homeWin/,
  );
});

test("prediction-v2 rejects unsupported confidence values", () => {
  assert.throws(
    () =>
      validatePredictionV2({
        schemaVersion: "prediction-v2",
        type: "prediction",
        headline: "信心字段错误",
        shortText: "这是一条结构完整但信心字段错误的预测。",
        predictedScore: { home: 1, away: 1, label: "1-1" },
        outcomeProbabilities: { homeWin: 0.34, draw: 0.33, awayWin: 0.33 },
        matchScript: { summary: "a", firstHalf: "b", secondHalf: "c" },
        scoreRationale: ["a"],
        tacticalFactors: ["a"],
        decisiveFactors: ["a"],
        riskFactors: ["a"],
        playersToWatch: ["a"],
        confidence: "certain",
        generatedFor: "prediction",
      }),
    /confidence/,
  );
});

test("prediction-v2 rejects probability totals that do not sum to one", () => {
  assert.throws(
    () =>
      validatePredictionV2({
        schemaVersion: "prediction-v2",
        type: "prediction",
        headline: "概率总和错误",
        shortText: "这是一条结构完整但概率总和错误的预测。",
        predictedScore: { home: 1, away: 1, label: "1-1" },
        outcomeProbabilities: { homeWin: 1, draw: 1, awayWin: 1 },
        matchScript: { summary: "a", firstHalf: "b", secondHalf: "c" },
        scoreRationale: ["a"],
        tacticalFactors: ["a"],
        decisiveFactors: ["a"],
        riskFactors: ["a"],
        playersToWatch: ["a"],
        confidence: "medium",
        generatedFor: "prediction",
      }),
    /outcomeProbabilities must sum to 1/,
  );
});

test("summary-v2 accepts approved official facts and prediction review", () => {
  const summary = validateSummaryV2({
    schemaVersion: "summary-v2",
    type: "summary",
    headline: "主队末段守住胜局",
    result: {
      homeScore: 2,
      awayScore: 1,
      winner: "主队",
      resultText: "主队 2-1 取胜",
    },
    matchStory: {
      summary: "主队先建立领先，客队末段追回一球。",
      turningPoint: "第二粒进球扩大了容错空间。",
      closingPhase: "客队末段压上但未能扳平。",
    },
    officialEvents: {
      goals: [{ minute: "23'", team: "主队", player: "球员A", assist: null, type: "goal" }],
      cards: [{ minute: "55'", team: "客队", player: "球员B", card: "yellow" }],
      substitutions: [{ minute: "70'", team: "主队", playerOff: "球员C", playerOn: "球员D" }],
    },
    technicalFacts: {
      formations: { home: "4-3-3", away: "4-2-3-1" },
      attendance: 80824,
      venue: "示例体育场",
      officials: ["主裁判"],
    },
    aiAnalysis: {
      tacticalSummary: ["主队利用边路推进建立优势"],
      keyPlayerImpact: ["球员A的进球改变比赛节奏"],
      resultExplanation: ["主队领先后控制了风险"],
    },
    predictionReview: {
      predictedScore: "1-1",
      actualScore: "2-1",
      scoreHit: false,
      outcomeHit: false,
      preMatchProbabilities: { homeWin: 0.34, draw: 0.31, awayWin: 0.35 },
      reviewText: "赛前低估了主队把握机会的效率。",
    },
    officialFactsStatus: "complete",
    missingOfficialFields: [],
  });

  assert.equal(summary.technicalFacts.venue, "示例体育场");
  assert.equal(summary.predictionReview.actualScore, "2-1");
});

test("summary-v2 rejects unsupported technical stats", () => {
  assert.throws(
    () =>
      validateSummaryV2({
        schemaVersion: "summary-v2",
        type: "summary",
        headline: "包含不允许字段",
        result: { homeScore: 0, awayScore: 0, winner: "平局", resultText: "0-0" },
        matchStory: { summary: "均势", turningPoint: "无", closingPhase: "均势结束" },
        officialEvents: { goals: [], cards: [], substitutions: [] },
        technicalFacts: {
          formations: { home: "4-4-2", away: "4-4-2" },
          attendance: null,
          venue: "示例体育场",
          officials: [],
          shots: { home: 10, away: 8 },
        },
        aiAnalysis: { tacticalSummary: ["均势"], keyPlayerImpact: [], resultExplanation: ["机会有限"] },
        predictionReview: null,
        officialFactsStatus: "partial",
        missingOfficialFields: ["goals"],
      }),
    /unsupported technicalFacts field: shots/,
  );
});

test("summary-v2 rejects unsupported official facts status values", () => {
  assert.throws(
    () =>
      validateSummaryV2({
        schemaVersion: "summary-v2",
        type: "summary",
        headline: "状态字段错误",
        result: { homeScore: 0, awayScore: 0, winner: "平局", resultText: "0-0" },
        matchStory: { summary: "均势", turningPoint: "无", closingPhase: "均势结束" },
        officialEvents: { goals: [], cards: [], substitutions: [] },
        technicalFacts: {
          formations: { home: "4-4-2", away: "4-4-2" },
          attendance: null,
          venue: "示例体育场",
          officials: [],
        },
        aiAnalysis: { tacticalSummary: ["均势"], keyPlayerImpact: [], resultExplanation: ["机会有限"] },
        predictionReview: null,
        officialFactsStatus: "unknown",
        missingOfficialFields: [],
      }),
    /officialFactsStatus/,
  );
});

test("validateStructuredInsight dispatches by schemaVersion", () => {
  assert.throws(() => validateStructuredInsight({ schemaVersion: "unknown" }), /unknown schemaVersion/);
});

test("prediction prompt requests score rationale and match script", () => {
  const prompt = buildInsightPrompt({
    type: "prediction",
    match: { homeTeam: "巴西", awayTeam: "摩洛哥", status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
  });

  assert.match(prompt, /prediction-v2/);
  assert.match(prompt, /predictedScore/);
  assert.match(prompt, /outcomeProbabilities/);
  assert.match(prompt, /scoreRationale/);
  assert.match(prompt, /matchScript/);
  assert.match(prompt, /tacticalFactors/);
  assert.match(prompt, /decisiveFactors/);
  assert.match(prompt, /riskFactors/);
  assert.match(prompt, /playersToWatch/);
});

test("summary prompt requests v2 summary fields and forbids unsupported stats", () => {
  const prompt = buildInsightPrompt({
    type: "summary",
    match: { homeTeam: "主队", awayTeam: "客队", status: "finished", homeScore: 2, awayScore: 1 },
  });

  assert.match(prompt, /summary-v2/);
  assert.match(prompt, /result/);
  assert.match(prompt, /matchStory/);
  assert.match(prompt, /officialEvents/);
  assert.match(prompt, /technicalFacts/);
  assert.match(prompt, /aiAnalysis/);
  assert.match(prompt, /predictionReview/);
  assert.match(prompt, /predictionReview.*object \| null/s);
  assert.match(prompt, /Do not fabricate predictionReview/);
  assert.match(prompt, /existingPrediction/);
  assert.match(prompt, /officialFactsStatus/);
  assert.match(prompt, /missingOfficialFields/);
  assert.match(prompt, /completionNotes/);
  assert.match(prompt, /Do not add shots/);
  assert.match(prompt, /shots on target/);
  assert.match(prompt, /possession/);
  assert.match(prompt, /xG/);
  assert.match(prompt, /injuries/);
  assert.match(prompt, /quotes/);
  assert.match(prompt, /unavailable player status/);
});

test("generateInsight returns structured prediction-v2 payload", async () => {
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.AI_BASE_URL = "https://provider.example/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    const result = await generateInsight({
      type: "prediction",
      match: { homeTeam: "巴西", awayTeam: "摩洛哥", status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            schemaVersion: "prediction-v2",
            type: "prediction",
            headline: "巴西小胜机会更高",
            shortText: "巴西更可能控制节奏。摩洛哥需要依靠反击制造威胁。",
            predictedScore: { home: 2, away: 1, label: "2-1" },
            outcomeProbabilities: { homeWin: 0.52, draw: 0.25, awayWin: 0.23 },
            matchScript: { summary: "巴西主导推进。", firstHalf: "上半场巴西更主动。", secondHalf: "下半场空间增加。" },
            scoreRationale: ["巴西机会质量更高", "摩洛哥反击可能进球"],
            tacticalFactors: ["巴西边路推进", "摩洛哥压缩中路"],
            decisiveFactors: ["定位球", "转换效率"],
            riskFactors: ["早段进球改变节奏"],
            playersToWatch: ["巴西前场", "摩洛哥防线"],
            confidence: "medium",
            generatedFor: "prediction",
          }) } }],
        }),
      }),
    });

    assert.equal(result.insight.headline, "巴西小胜机会更高");
    assert.deepEqual(result.insight.probabilities, { homeWin: 0.52, draw: 0.25, awayWin: 0.23 });
    assert.equal(result.structured.predictedScore.label, "2-1");
    assert.equal(result.schemaVersion, "prediction-v2");
    assert.equal(result.model, "mimo-v2.5-pro");
    assert.equal(result.promptVersion, "world-cup-2026-insight-v2");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});

test("generateInsight fallback includes valid legacy and structured prediction payloads", async () => {
  const previous = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const result = await generateInsight({
      type: "prediction",
      match: { homeTeam: "W61", awayTeam: "W62", status: "scheduled" },
    });

    assert.equal(result.insight.generatedFor, "prediction");
    assert.equal(result.structured.schemaVersion, "prediction-v2");
    assert.equal(result.schemaVersion, "prediction-v2");
    assert.equal(validateStructuredInsight(result.structured, "prediction").schemaVersion, "prediction-v2");
  } finally {
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("OPENAI_API_KEY", previous.OPENAI_API_KEY);
  }
});

test("generateInsight falls back when provider envelope omits message content", async () => {
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.AI_BASE_URL = "https://provider.example/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    const result = await generateInsight({
      type: "prediction",
      match: { homeTeam: "W61", awayTeam: "W62", status: "scheduled" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{}] }),
      }),
    });

    assert.equal(result.model, "local-fallback");
    assert.equal(result.structured.schemaVersion, "prediction-v2");
    assert.equal(result.schemaVersion, "prediction-v2");
    assert.equal(result.insight.generatedFor, "prediction");
    assert.equal(validateStructuredInsight(result.structured, "prediction").schemaVersion, "prediction-v2");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});

test("generateInsight falls back when provider returns invalid JSON body", async () => {
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.AI_BASE_URL = "https://provider.example/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    const result = await generateInsight({
      type: "summary",
      match: { homeTeam: "主队", awayTeam: "客队", status: "finished", homeScore: 1, awayScore: 1 },
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    });

    assert.equal(result.model, "local-fallback");
    assert.equal(result.structured.schemaVersion, "summary-v2");
    assert.equal(result.schemaVersion, "summary-v2");
    assert.equal(result.insight.generatedFor, "summary");
    assert.equal(validateStructuredInsight(result.structured, "summary").schemaVersion, "summary-v2");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});

test("generateInsight fallback includes valid legacy and structured summary payloads", async () => {
  const previous = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const result = await generateInsight({
      type: "summary",
      match: { homeTeam: "主队", awayTeam: "客队", status: "finished", homeScore: 2, awayScore: 1 },
    });

    assert.equal(result.insight.generatedFor, "summary");
    assert.equal(result.structured.schemaVersion, "summary-v2");
    assert.equal(result.schemaVersion, "summary-v2");
    assert.equal(validateStructuredInsight(result.structured, "summary").schemaVersion, "summary-v2");
  } finally {
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("OPENAI_API_KEY", previous.OPENAI_API_KEY);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

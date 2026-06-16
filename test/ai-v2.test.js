import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePredictionV2,
  validateSummaryV2,
  validateStructuredInsight,
} from "../src/insight-schemas.js";

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

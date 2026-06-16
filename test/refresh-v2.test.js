import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getInsight, getMatchByFifaId, openDatabase, upsertInsight, upsertMatch } from "../src/db.js";
import { extractOfficialFacts, officialFactsHash } from "../src/official-facts.js";
import { refreshWorldCupData } from "../src/refresh.js";

test("refresh stores structured prediction before kickoff", async () => {
  const context = createDb();
  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("provider.example")) {
          return aiResponse(predictionV2({ headline: "主队小胜" }));
        }

        return jsonResponse({
          Results: [
            {
              IdMatch: "fixture-1",
              Home: { TeamName: "主队" },
              Away: { TeamName: "客队" },
              MatchStatus: 1,
              Date: "2026-06-14T20:00:00.000Z",
            },
          ],
        });
      },
    });

    const match = getMatchByFifaId(context.db, "fixture-1");
    const prediction = getInsight(context.db, match.id, "prediction");
    assert.equal(prediction.schemaVersion, "prediction-v2");
    assert.equal(prediction.structured.predictedScore.label, "2-1");
    assert.equal(prediction.frozenAt, null);
  } finally {
    previous.restore();
    context.close();
  }
});

test("refresh does not generate prediction after kickoff", async () => {
  const context = createDb();
  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });
  let aiCalled = false;

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-14T20:01:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("provider.example")) aiCalled = true;
        return jsonResponse({
          Results: [
            {
              IdMatch: "fixture-2",
              Home: { TeamName: "主队" },
              Away: { TeamName: "客队" },
              MatchStatus: 1,
              Date: "2026-06-14T20:00:00.000Z",
            },
          ],
        });
      },
    });

    const match = getMatchByFifaId(context.db, "fixture-2");
    assert.equal(aiCalled, false);
    assert.equal(getInsight(context.db, match.id, "prediction"), null);
  } finally {
    previous.restore();
    context.close();
  }
});

test("finished summary generation uses FIFA detail facts and existing prediction", async () => {
  const context = createDb();
  const existing = upsertMatch(context.db, scheduledMatch({ fifaId: "finished-with-detail" }));
  upsertInsight(context.db, existing.id, "prediction", predictionPayload());

  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    FIFA_MATCH_DETAIL_BASE_URL: "https://fifa.example/detail",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });
  let detailFetched = false;
  let prompt = "";

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-14T23:00:00.000Z"),
      fetchImpl: async (url, options) => {
        const href = String(url);
        if (href.includes("provider.example")) {
          prompt = JSON.parse(options.body).messages.at(-1).content;
          return aiResponse(summaryV2({ officialFactsStatus: "complete" }));
        }
        if (href.includes("/detail/finished-with-detail")) {
          detailFetched = true;
          return jsonResponse(completeDetail());
        }
        return jsonResponse({ Results: [finishedMatch({ fifaId: "finished-with-detail" })] });
      },
    });

    const match = getMatchByFifaId(context.db, "finished-with-detail");
    const summary = getInsight(context.db, match.id, "summary");
    assert.equal(detailFetched, true);
    assert.match(prompt, /"officialFacts"/);
    assert.match(prompt, /"existingPrediction"/);
    assert.equal(summary.schemaVersion, "summary-v2");
    assert.equal(summary.officialFactsStatus, "complete");
    assert.ok(summary.officialFactsHash);
    assert.deepEqual(summary.completionNotes, { goals: { source: "official", label: "官方进球数据完整" } });
    assert.equal(summary.finalizedAt, "2026-06-14T23:00:00.000Z");
  } finally {
    previous.restore();
    context.close();
  }
});

test("partial summaries do not regenerate when official facts are unchanged", async () => {
  const context = createDb();
  const sourceMatch = finishedMatch({ fifaId: "partial-unchanged" });
  const detail = partialDetail();
  const factsHash = officialFactsHash(extractOfficialFacts(normalizedFinishedMatch("partial-unchanged"), detail));
  const existing = upsertMatch(context.db, normalizedFinishedMatch("partial-unchanged"));
  upsertInsight(context.db, existing.id, "summary", summaryPayload({
    generatedAt: "2026-06-14T22:00:00.000Z",
    officialFactsStatus: "partial",
    officialFactsHash: factsHash,
  }));

  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    FIFA_MATCH_DETAIL_BASE_URL: "https://fifa.example/detail",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });
  let aiCalled = false;

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-14T22:15:00.000Z"),
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("provider.example")) aiCalled = true;
        if (href.includes("/detail/partial-unchanged")) return jsonResponse(detail);
        return jsonResponse({ Results: [sourceMatch] });
      },
    });

    const summary = getInsight(context.db, existing.id, "summary");
    assert.equal(aiCalled, false);
    assert.equal(summary.generatedAt, "2026-06-14T22:00:00.000Z");
    assert.equal(summary.officialFactsHash, factsHash);
  } finally {
    previous.restore();
    context.close();
  }
});

test("partial summaries regenerate when official facts changed and policy allows it", async () => {
  const context = createDb();
  const oldHash = "old-facts-hash";
  const existing = upsertMatch(context.db, normalizedFinishedMatch("partial-changed"));
  upsertInsight(context.db, existing.id, "summary", summaryPayload({
    generatedAt: "2026-06-14T22:00:00.000Z",
    officialFactsStatus: "partial",
    officialFactsHash: oldHash,
  }));

  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    FIFA_MATCH_DETAIL_BASE_URL: "https://fifa.example/detail",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-14T22:15:00.000Z"),
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("provider.example")) {
          return aiResponse(summaryV2({ headline: "补充后的摘要", officialFactsStatus: "partial" }));
        }
        if (href.includes("/detail/partial-changed")) return jsonResponse(partialDetail({ changed: true }));
        return jsonResponse({ Results: [finishedMatch({ fifaId: "partial-changed" })] });
      },
    });

    const summary = getInsight(context.db, existing.id, "summary");
    assert.equal(summary.headline, "补充后的摘要");
    assert.equal(summary.officialFactsStatus, "partial");
    assert.notEqual(summary.officialFactsHash, oldHash);
    assert.equal(summary.finalizedAt, null);
  } finally {
    previous.restore();
    context.close();
  }
});

test("final summary completion forces complete metadata and sends finalCompletion", async () => {
  const context = createDb();
  const existing = upsertMatch(context.db, normalizedFinishedMatch("final-completion"));
  upsertInsight(context.db, existing.id, "summary", summaryPayload({
    generatedAt: "2026-06-14T22:00:00.000Z",
    officialFactsStatus: "partial",
    officialFactsHash: "stale-facts",
  }));

  const previous = withEnv({
    FIFA_MATCHES_URL: "https://fifa.example/matches",
    FIFA_MATCH_DETAIL_BASE_URL: "https://fifa.example/detail",
    AI_API_KEY: "test-key",
    AI_BASE_URL: "https://provider.example/v1",
    AI_MODEL: "mimo-v2.5-pro",
  });
  let prompt = "";

  try {
    await refreshWorldCupData(context.store, {
      now: new Date("2026-06-16T20:01:00.000Z"),
      fetchImpl: async (url, options) => {
        const href = String(url);
        if (href.includes("provider.example")) {
          prompt = JSON.parse(options.body).messages.at(-1).content;
          return aiResponse(summaryV2({
            headline: "最终补全摘要",
            officialFactsStatus: "partial",
            completionNotes: { final: { source: "ai", label: "两日后最终补全" } },
          }));
        }
        if (href.includes("/detail/final-completion")) return jsonResponse(partialDetail());
        return jsonResponse({ Results: [finishedMatch({ fifaId: "final-completion" })] });
      },
    });

    const summary = getInsight(context.db, existing.id, "summary");
    assert.match(prompt, /"finalCompletion": true/);
    assert.equal(summary.headline, "最终补全摘要");
    assert.equal(summary.officialFactsStatus, "complete");
    assert.equal(summary.finalizedAt, "2026-06-16T20:01:00.000Z");
    assert.deepEqual(summary.completionNotes, { final: { source: "ai", label: "两日后最终补全" } });
  } finally {
    previous.restore();
    context.close();
  }
});

function createDb() {
  const dir = mkdtempSync(join(tmpdir(), "worldcup-refresh-v2-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  return {
    db,
    store: { driver: "sqlite", client: db },
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withEnv(values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return {
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

function jsonResponse(payload) {
  return { ok: true, json: async () => payload };
}

function aiResponse(content) {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

function scheduledMatch({ fifaId }) {
  return {
    fifaId,
    homeTeam: "主队",
    awayTeam: "客队",
    homeScore: null,
    awayScore: null,
    status: "scheduled",
    hasFinalScore: false,
    kickoffAt: "2026-06-14T20:00:00.000Z",
    updatedAt: "2026-06-14T12:00:00.000Z",
    sourceHash: "source-hash",
    raw: { fifaId },
  };
}

function finishedMatch({ fifaId }) {
  return {
    IdMatch: fifaId,
    Home: { TeamName: "主队" },
    Away: { TeamName: "客队" },
    HomeScore: 2,
    AwayScore: 1,
    MatchStatus: "finished",
    Date: "2026-06-14T20:00:00.000Z",
    LastUpdated: "2026-06-14T22:00:00.000Z",
  };
}

function normalizedFinishedMatch(fifaId) {
  return {
    fifaId,
    homeTeam: "主队",
    awayTeam: "客队",
    homeScore: 2,
    awayScore: 1,
    status: "finished",
    hasFinalScore: true,
    kickoffAt: "2026-06-14T20:00:00.000Z",
    updatedAt: "2026-06-14T22:00:00.000Z",
    sourceHash: "source-hash",
    raw: finishedMatch({ fifaId }),
  };
}

function completeDetail() {
  return {
    Home: {
      TeamName: "主队",
      Goals: [{ Minute: "23'", PlayerName: "球员A", Type: "goal" }],
      Bookings: [],
      Substitutions: [],
    },
    Away: {
      TeamName: "客队",
      Goals: [{ Minute: "79'", PlayerName: "球员B", Type: "goal" }],
      Bookings: [{ Minute: "55'", PlayerName: "球员C", CardType: "yellow" }],
      Substitutions: [{ Minute: "70'", PlayerOffName: "球员D", PlayerOnName: "球员E" }],
    },
    Stadium: { Name: "示例体育场" },
    Attendance: 80824,
    Officials: [{ Name: "主裁判" }],
  };
}

function partialDetail({ changed = false } = {}) {
  return {
    Home: {
      TeamName: "主队",
      Goals: changed ? [{ Minute: "23'", PlayerName: "球员A", Type: "goal" }] : [],
    },
    Away: {
      TeamName: "客队",
      Goals: [],
    },
    Stadium: { Name: "示例体育场" },
  };
}

function predictionV2({ headline = "主队小胜" } = {}) {
  return {
    schemaVersion: "prediction-v2",
    type: "prediction",
    headline,
    shortText: "主队更主动。客队保留反击空间。",
    predictedScore: { home: 2, away: 1, label: "2-1" },
    outcomeProbabilities: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
    matchScript: { summary: "主队推进更多。", firstHalf: "主队压上。", secondHalf: "客队反击。" },
    scoreRationale: ["主队机会更多", "客队仍可能进球"],
    tacticalFactors: ["边路推进", "防守转换"],
    decisiveFactors: ["定位球"],
    riskFactors: ["早段进球"],
    playersToWatch: ["主队", "客队"],
    confidence: "medium",
    generatedFor: "prediction",
  };
}

function summaryV2({
  headline = "主队末段守住胜局",
  officialFactsStatus = "complete",
  completionNotes = { goals: { source: "official", label: "官方进球数据完整" } },
} = {}) {
  return {
    schemaVersion: "summary-v2",
    type: "summary",
    headline,
    result: { homeScore: 2, awayScore: 1, winner: "主队", resultText: "主队 2-1 客队" },
    matchStory: {
      summary: "主队先建立领先，客队末段追回一球。",
      turningPoint: "首粒进球改变了比赛节奏。",
      closingPhase: "客队末段压上但未能扳平。",
    },
    officialEvents: {
      goals: [{ minute: "23'", team: "主队", player: "球员A", assist: null, type: "goal" }],
      cards: [],
      substitutions: [],
    },
    technicalFacts: {
      formations: { home: null, away: null },
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
      predictedScore: "2-1",
      actualScore: "2-1",
      scoreHit: true,
      outcomeHit: true,
      preMatchProbabilities: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
      reviewText: "赛前判断命中主队取胜方向。",
    },
    officialFactsStatus,
    missingOfficialFields: officialFactsStatus === "complete" ? [] : ["cards", "substitutions"],
    completionNotes,
    generatedFor: "summary",
  };
}

function predictionPayload() {
  return {
    insight: {
      headline: "主队小胜",
      shortText: "主队更主动。客队保留反击空间。",
      keyMoments: ["主队机会更多", "客队仍可能进球"],
      tacticalNotes: ["边路推进", "防守转换"],
      playersToWatch: ["主队", "客队"],
      probabilities: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
      confidence: "medium",
      generatedFor: "prediction",
    },
    structured: predictionV2(),
    schemaVersion: "prediction-v2",
    model: "test-model",
    promptVersion: "test",
    sourceHash: "source-hash",
    generatedAt: "2026-06-14T12:00:00.000Z",
  };
}

function summaryPayload({ generatedAt, officialFactsStatus, officialFactsHash: factsHash }) {
  return {
    insight: {
      headline: "已有部分摘要",
      shortText: "已有部分官方事实生成的摘要。",
      keyMoments: ["主队取得领先", "客队追回一球"],
      tacticalNotes: ["主队边路推进", "客队后段压上"],
      playersToWatch: ["主队", "客队"],
      probabilities: { homeWin: 1, draw: 0, awayWin: 0 },
      confidence: "medium",
      generatedFor: "summary",
    },
    structured: summaryV2({ headline: "已有部分摘要", officialFactsStatus }),
    schemaVersion: "summary-v2",
    officialFactsStatus,
    officialFactsHash: factsHash,
    model: "test-model",
    promptVersion: "test",
    sourceHash: "source-hash",
    generatedAt,
  };
}

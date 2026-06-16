# AI Insights V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build structured, professional AI pre-match predictions and post-match summaries that are cached server-side, grounded in official FIFA data, and safe to roll back.

**Architecture:** Add v2 insight schemas beside the existing insight model, store v2 payloads in new structured database columns, and render v2 content when present while keeping old fields as fallback. Refresh logic will freeze predictions at kickoff and finalize incomplete summaries after a two-day final completion pass.

**Tech Stack:** Node.js ESM, `node:test`, local SQLite via `node:sqlite`, Neon Postgres via `@neondatabase/serverless`, static frontend JavaScript/CSS, Vercel functions.

---

## File Map

- Create `src/insight-schemas.js`: validates and normalizes `prediction-v2` and `summary-v2` payloads.
- Create `src/official-facts.js`: extracts approved official facts from normalized matches and FIFA match-detail payloads.
- Modify `src/fifa.js`: add FIFA match-detail fetcher and export small helpers only if needed by tests.
- Modify `src/ai.js`: build separate v2 prompts, validate v2 responses, keep legacy fallback compatibility.
- Modify `src/policies.js`: add pre-kickoff prediction eligibility and partial-summary completion policy.
- Modify `src/refresh.js`: fetch official facts for finished matches, generate v2 insights, freeze predictions, run final completion.
- Modify `src/background-refresh.js`: trigger background refresh for due partial summaries without exposing UI controls.
- Modify `src/db.js` and `src/db/postgres.js`: add structured v2 columns and row mapping.
- Modify `public/app.js` and `public/styles.css`: render v2 prediction, summary, partial labels, field-level provenance, and prediction review.
- Add tests in `test/ai-v2.test.js`, `test/official-facts.test.js`, `test/db-v2.test.js`, `test/policies-v2.test.js`, `test/refresh-v2.test.js`, and extend `test/frontend.test.js`.

## Task 1: Add V2 Insight Schema Validation

**Files:**
- Create: `src/insight-schemas.js`
- Create: `test/ai-v2.test.js`

- [ ] **Step 1: Write failing schema tests**

Create `test/ai-v2.test.js`:

```js
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

test("validateStructuredInsight dispatches by schemaVersion", () => {
  assert.throws(() => validateStructuredInsight({ schemaVersion: "unknown" }), /unknown schemaVersion/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test test/ai-v2.test.js
```

Expected: fail with `Cannot find module '../src/insight-schemas.js'`.

- [ ] **Step 3: Implement `src/insight-schemas.js`**

Create `src/insight-schemas.js` with these exported functions and helpers:

```js
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);
const SUMMARY_STATUS_VALUES = new Set(["complete", "partial"]);
const ALLOWED_TECHNICAL_FACTS = new Set(["formations", "attendance", "venue", "officials"]);

export function validateStructuredInsight(value, expectedType = null) {
  if (!value || typeof value !== "object") throw new Error("structured insight must be an object");
  if (value.schemaVersion === "prediction-v2") return validatePredictionV2(value, expectedType);
  if (value.schemaVersion === "summary-v2") return validateSummaryV2(value, expectedType);
  throw new Error(`unknown schemaVersion: ${value.schemaVersion}`);
}

export function validatePredictionV2(value, expectedType = "prediction") {
  requireLiteral(value.schemaVersion, "prediction-v2", "schemaVersion");
  requireLiteral(value.type, "prediction", "type");
  requireLiteral(value.generatedFor, expectedType, "generatedFor");

  const predictedScore = validatePredictedScore(value.predictedScore);
  const prediction = {
    schemaVersion: "prediction-v2",
    type: "prediction",
    headline: requireText(value.headline, "headline", 80),
    shortText: requireText(value.shortText, "shortText", 500),
    predictedScore,
    outcomeProbabilities: validateProbabilities(value.outcomeProbabilities, "outcomeProbabilities"),
    matchScript: validateMatchScript(value.matchScript),
    scoreRationale: requireTextArray(value.scoreRationale, "scoreRationale", 1, 4),
    tacticalFactors: requireTextArray(value.tacticalFactors, "tacticalFactors", 1, 4),
    decisiveFactors: requireTextArray(value.decisiveFactors, "decisiveFactors", 1, 4),
    riskFactors: requireTextArray(value.riskFactors, "riskFactors", 1, 4),
    playersToWatch: requireTextArray(value.playersToWatch, "playersToWatch", 1, 4),
    confidence: String(value.confidence || "").toLowerCase(),
    generatedFor: "prediction",
  };

  if (!CONFIDENCE_VALUES.has(prediction.confidence)) {
    throw new Error("confidence must be low, medium, or high");
  }
  return prediction;
}

export function validateSummaryV2(value, expectedType = "summary") {
  requireLiteral(value.schemaVersion, "summary-v2", "schemaVersion");
  requireLiteral(value.type, "summary", "type");
  if (expectedType) requireLiteral(value.type, expectedType, "type");

  const summary = {
    schemaVersion: "summary-v2",
    type: "summary",
    headline: requireText(value.headline, "headline", 80),
    result: validateResult(value.result),
    matchStory: validateMatchStory(value.matchStory),
    officialEvents: validateOfficialEvents(value.officialEvents),
    technicalFacts: validateTechnicalFacts(value.technicalFacts),
    aiAnalysis: validateAiAnalysis(value.aiAnalysis),
    predictionReview: value.predictionReview ? validatePredictionReview(value.predictionReview) : null,
    officialFactsStatus: String(value.officialFactsStatus || ""),
    missingOfficialFields: Array.isArray(value.missingOfficialFields)
      ? value.missingOfficialFields.map((item) => requireText(item, "missingOfficialFields", 80))
      : [],
    completionNotes: validateCompletionNotes(value.completionNotes || {}),
    generatedFor: "summary",
  };

  if (!SUMMARY_STATUS_VALUES.has(summary.officialFactsStatus)) {
    throw new Error("officialFactsStatus must be complete or partial");
  }
  return summary;
}

function validatePredictedScore(value) {
  if (!value || typeof value !== "object") throw new Error("predictedScore must be an object");
  const home = requireNonNegativeInteger(value.home, "predictedScore.home");
  const away = requireNonNegativeInteger(value.away, "predictedScore.away");
  const label = requireText(value.label, "predictedScore.label", 20);
  if (label !== `${home}-${away}`) throw new Error("predictedScore.label must match home-away");
  return { home, away, label };
}

function validateProbabilities(value, name) {
  if (!value || typeof value !== "object") throw new Error(`${name} must be an object`);
  return {
    homeWin: requireProbability(value.homeWin, `${name}.homeWin`),
    draw: requireProbability(value.draw, `${name}.draw`),
    awayWin: requireProbability(value.awayWin, `${name}.awayWin`),
  };
}

function validateMatchScript(value) {
  if (!value || typeof value !== "object") throw new Error("matchScript must be an object");
  return {
    summary: requireText(value.summary, "matchScript.summary", 300),
    firstHalf: requireText(value.firstHalf, "matchScript.firstHalf", 300),
    secondHalf: requireText(value.secondHalf, "matchScript.secondHalf", 300),
  };
}

function validateResult(value) {
  if (!value || typeof value !== "object") throw new Error("result must be an object");
  return {
    homeScore: requireNonNegativeInteger(value.homeScore, "result.homeScore"),
    awayScore: requireNonNegativeInteger(value.awayScore, "result.awayScore"),
    winner: requireText(value.winner, "result.winner", 80),
    resultText: requireText(value.resultText, "result.resultText", 120),
  };
}

function validateMatchStory(value) {
  if (!value || typeof value !== "object") throw new Error("matchStory must be an object");
  return {
    summary: requireText(value.summary, "matchStory.summary", 500),
    turningPoint: requireText(value.turningPoint, "matchStory.turningPoint", 300),
    closingPhase: requireText(value.closingPhase, "matchStory.closingPhase", 300),
  };
}

function validateOfficialEvents(value) {
  if (!value || typeof value !== "object") throw new Error("officialEvents must be an object");
  return {
    goals: Array.isArray(value.goals) ? value.goals.map(validateGoal) : [],
    cards: Array.isArray(value.cards) ? value.cards.map(validateCard) : [],
    substitutions: Array.isArray(value.substitutions) ? value.substitutions.map(validateSubstitution) : [],
  };
}

function validateGoal(value) {
  return {
    minute: requireText(value.minute, "goal.minute", 40),
    team: requireText(value.team, "goal.team", 120),
    player: requireText(value.player, "goal.player", 120),
    assist: value.assist === null || value.assist === undefined ? null : requireText(value.assist, "goal.assist", 120),
    type: requireText(value.type || "goal", "goal.type", 40),
  };
}

function validateCard(value) {
  const card = requireText(value.card, "card.card", 40);
  if (!["yellow", "red", "second_yellow", "unknown"].includes(card)) {
    throw new Error(`unsupported card value: ${card}`);
  }
  return {
    minute: requireText(value.minute, "card.minute", 40),
    team: requireText(value.team, "card.team", 120),
    player: requireText(value.player, "card.player", 120),
    card,
  };
}

function validateSubstitution(value) {
  return {
    minute: requireText(value.minute, "substitution.minute", 40),
    team: requireText(value.team, "substitution.team", 120),
    playerOff: requireText(value.playerOff, "substitution.playerOff", 120),
    playerOn: requireText(value.playerOn, "substitution.playerOn", 120),
  };
}

function validateTechnicalFacts(value) {
  if (!value || typeof value !== "object") throw new Error("technicalFacts must be an object");
  for (const key of Object.keys(value)) {
    if (!ALLOWED_TECHNICAL_FACTS.has(key)) throw new Error(`unsupported technicalFacts field: ${key}`);
  }
  return {
    formations: {
      home: value.formations?.home ?? null,
      away: value.formations?.away ?? null,
    },
    attendance: value.attendance === null || value.attendance === undefined ? null : Number(value.attendance),
    venue: value.venue === null || value.venue === undefined ? null : requireText(value.venue, "technicalFacts.venue", 160),
    officials: Array.isArray(value.officials)
      ? value.officials.map((item) => requireText(item, "technicalFacts.officials", 120))
      : [],
  };
}

function validateAiAnalysis(value) {
  if (!value || typeof value !== "object") throw new Error("aiAnalysis must be an object");
  return {
    tacticalSummary: requireTextArray(value.tacticalSummary, "aiAnalysis.tacticalSummary", 1, 4),
    keyPlayerImpact: requireTextArray(value.keyPlayerImpact || [], "aiAnalysis.keyPlayerImpact", 0, 4),
    resultExplanation: requireTextArray(value.resultExplanation, "aiAnalysis.resultExplanation", 1, 4),
  };
}

function validatePredictionReview(value) {
  if (!value || typeof value !== "object") throw new Error("predictionReview must be an object");
  return {
    predictedScore: requireText(value.predictedScore, "predictionReview.predictedScore", 20),
    actualScore: requireText(value.actualScore, "predictionReview.actualScore", 20),
    scoreHit: Boolean(value.scoreHit),
    outcomeHit: Boolean(value.outcomeHit),
    preMatchProbabilities: validateProbabilities(value.preMatchProbabilities, "predictionReview.preMatchProbabilities"),
    reviewText: requireText(value.reviewText, "predictionReview.reviewText", 500),
  };
}

function validateCompletionNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, note]) => [
      key,
      {
        source: requireText(note.source, `completionNotes.${key}.source`, 80),
        label: requireText(note.label, `completionNotes.${key}.label`, 80),
      },
    ]),
  );
}

function requireLiteral(value, expected, name) {
  if (value !== expected) throw new Error(`${name} must be ${expected}`);
}

function requireText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be text`);
  return value.trim().slice(0, maxLength);
}

function requireTextArray(value, name, min, max) {
  if (!Array.isArray(value) || value.length < min) throw new Error(`${name} must contain at least ${min} items`);
  return value.slice(0, max).map((item) => requireText(item, name, 180));
}

function requireNonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
}

function requireProbability(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be between 0 and 1`);
  return number;
}
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
node --test test/ai-v2.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/insight-schemas.js test/ai-v2.test.js
git commit -m "Add v2 insight schema validation"
```

## Task 2: Extract Approved Official Facts

**Files:**
- Create: `src/official-facts.js`
- Modify: `src/fifa.js`
- Create: `test/official-facts.test.js`

- [ ] **Step 1: Write failing official fact tests**

Create `test/official-facts.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { extractOfficialFacts, factsCompleteness, officialFactsHash } from "../src/official-facts.js";
import { fetchFifaMatchDetail } from "../src/fifa.js";

test("extractOfficialFacts maps goals, cards, substitutions, formations, and officials", () => {
  const facts = extractOfficialFacts({
    fifaId: "400021443",
    homeTeam: "墨西哥",
    awayTeam: "南非",
    homeScore: 2,
    awayScore: 1,
    venue: "墨西哥城体育场",
    raw: {
      HomeTeam: {
        TeamName: [{ Locale: "zh-CN", Description: "墨西哥" }],
        Score: 2,
        Tactics: "4-3-3",
        Players: [{ IdPlayer: "p1", ShortName: "洛萨诺" }],
        Goals: [{ IdPlayer: "p1", Minute: "9'", Type: 2 }],
        Bookings: [{ IdPlayer: "p1", Minute: "23'", Card: 1 }],
        Substitutions: [{ Minute: "70'", PlayerOffName: "球员甲", PlayerOnName: "球员乙" }],
      },
      AwayTeam: {
        TeamName: [{ Locale: "zh-CN", Description: "南非" }],
        Score: 1,
        Tactics: "5-3-2",
        Players: [{ IdPlayer: "p2", ShortName: "莫科纳" }],
        Goals: [],
        Bookings: [],
        Substitutions: [],
      },
      Officials: [{ Name: [{ Locale: "zh-CN", Description: "主裁判" }] }],
      Attendance: "80824",
      Stadium: { Name: [{ Locale: "zh-CN", Description: "墨西哥城体育场" }] },
    },
  });

  assert.deepEqual(facts.technicalFacts.formations, { home: "4-3-3", away: "5-3-2" });
  assert.equal(facts.technicalFacts.attendance, 80824);
  assert.equal(facts.officialEvents.goals[0].player, "洛萨诺");
  assert.equal(facts.officialEvents.cards[0].card, "yellow");
  assert.equal(facts.officialEvents.substitutions[0].playerOn, "球员乙");
});

test("factsCompleteness is partial when approved detail arrays are unavailable", () => {
  const facts = extractOfficialFacts({
    homeTeam: "主队",
    awayTeam: "客队",
    homeScore: 1,
    awayScore: 0,
    raw: {
      HomeTeam: { Tactics: "4-4-2" },
      AwayTeam: { Tactics: "4-4-2" },
    },
  });

  assert.equal(factsCompleteness(facts).status, "partial");
  assert.deepEqual(factsCompleteness(facts).missingOfficialFields, ["goals", "cards", "substitutions"]);
});

test("officialFactsHash is stable for equivalent facts", () => {
  const left = officialFactsHash({ result: { homeScore: 1, awayScore: 0 }, officialEvents: { goals: [] } });
  const right = officialFactsHash({ officialEvents: { goals: [] }, result: { awayScore: 0, homeScore: 1 } });
  assert.equal(left, right);
});

test("fetchFifaMatchDetail uses official live football endpoint", async () => {
  let requestedUrl;
  const detail = await fetchFifaMatchDetail("400021443", async (url, options) => {
    requestedUrl = url;
    assert.equal(options.headers.Accept, "application/json");
    return { ok: true, json: async () => ({ IdMatch: 400021443 }) };
  });

  assert.equal(requestedUrl, "https://api.fifa.com/api/v3/live/football/400021443");
  assert.equal(detail.IdMatch, 400021443);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test test/official-facts.test.js
```

Expected: fail because `src/official-facts.js` and `fetchFifaMatchDetail` do not exist.

- [ ] **Step 3: Add FIFA detail fetcher**

Append this export to `src/fifa.js`:

```js
export async function fetchFifaMatchDetail(fifaId, fetchImpl = fetch) {
  const baseUrl = process.env.FIFA_MATCH_DETAIL_BASE_URL || "https://api.fifa.com/api/v3/live/football";
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fifaId)}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`FIFA match detail request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
```

- [ ] **Step 4: Implement official fact extraction**

Create `src/official-facts.js` with:

```js
import { createHash } from "node:crypto";

export function extractOfficialFacts(match, detail = null) {
  const raw = detail || match.raw || {};
  const home = raw.HomeTeam || raw.Home || {};
  const away = raw.AwayTeam || raw.Away || {};
  const homeName = teamName(home) || match.homeTeam;
  const awayName = teamName(away) || match.awayTeam;
  const playerNames = new Map([
    ...playersForTeam(home).map((player) => [String(player.IdPlayer), playerName(player)]),
    ...playersForTeam(away).map((player) => [String(player.IdPlayer), playerName(player)]),
  ]);

  return {
    result: {
      homeScore: numberOrNull(match.homeScore ?? home.Score),
      awayScore: numberOrNull(match.awayScore ?? away.Score),
      winner: winnerText(match.homeScore ?? home.Score, match.awayScore ?? away.Score, homeName, awayName),
      resultText: `${homeName} ${numberOrNull(match.homeScore ?? home.Score) ?? "-"}-${numberOrNull(match.awayScore ?? away.Score) ?? "-"} ${awayName}`,
    },
    officialEvents: {
      goals: [...eventsForTeam(home, homeName, "Goals"), ...eventsForTeam(away, awayName, "Goals")].map((event) => ({
        minute: text(event.Minute) || "",
        team: event.team,
        player: playerNames.get(String(event.IdPlayer)) || text(event.PlayerName) || "未知球员",
        assist: event.IdAssistPlayer ? playerNames.get(String(event.IdAssistPlayer)) || null : null,
        type: goalType(event.Type),
      })),
      cards: [...eventsForTeam(home, homeName, "Bookings"), ...eventsForTeam(away, awayName, "Bookings")].map((event) => ({
        minute: text(event.Minute) || "",
        team: event.team,
        player: playerNames.get(String(event.IdPlayer)) || text(event.PlayerName) || "未知球员",
        card: cardType(event.Card),
      })),
      substitutions: [
        ...eventsForTeam(home, homeName, "Substitutions"),
        ...eventsForTeam(away, awayName, "Substitutions"),
      ].map((event) => ({
        minute: text(event.Minute) || "",
        team: event.team,
        playerOff: text(event.PlayerOffName) || playerNames.get(String(event.IdPlayerOff)) || "未知球员",
        playerOn: text(event.PlayerOnName) || playerNames.get(String(event.IdPlayerOn)) || "未知球员",
      })),
    },
    technicalFacts: {
      formations: {
        home: text(home.Tactics),
        away: text(away.Tactics),
      },
      attendance: numberOrNull(raw.Attendance ?? match.attendance),
      venue: text(localized(raw.Stadium?.Name)) || match.venue || null,
      officials: Array.isArray(raw.Officials)
        ? raw.Officials.map((official) => text(localized(official.Name)) || text(official.DisplayName)).filter(Boolean)
        : [],
    },
    source: detail ? "detail" : "match",
  };
}

export function factsCompleteness(facts) {
  const missing = [];
  if (!Array.isArray(facts.officialEvents?.goals)) missing.push("goals");
  if (!Array.isArray(facts.officialEvents?.cards)) missing.push("cards");
  if (!Array.isArray(facts.officialEvents?.substitutions)) missing.push("substitutions");
  return {
    status: missing.length === 0 ? "complete" : "partial",
    missingOfficialFields: missing,
  };
}

export function officialFactsHash(facts) {
  return createHash("sha256").update(JSON.stringify(sortObject(facts))).digest("hex");
}

function eventsForTeam(team, name, key) {
  return Array.isArray(team[key]) ? team[key].map((event) => ({ ...event, team: name })) : [];
}

function playersForTeam(team) {
  return Array.isArray(team.Players) ? team.Players : [];
}

function playerName(player) {
  return text(player.ShortName) || text(player.PlayerName) || text(localized(player.Name)) || "未知球员";
}

function teamName(team) {
  return text(localized(team.TeamName)) || text(team.ShortClubName) || text(team.Name);
}

function winnerText(homeScore, awayScore, homeName, awayName) {
  const home = numberOrNull(homeScore);
  const away = numberOrNull(awayScore);
  if (home === null || away === null) return "未确认";
  if (home > away) return homeName;
  if (away > home) return awayName;
  return "平局";
}

function goalType(value) {
  if (value === 1) return "own_goal";
  if (value === 3) return "penalty";
  return "goal";
}

function cardType(value) {
  if (value === 1) return "yellow";
  if (value === 2) return "red";
  return "unknown";
}

function localized(value) {
  if (!Array.isArray(value)) return value;
  const preferred =
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("zh")) ||
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("en")) ||
    value[0];
  return preferred?.Description || preferred?.Name || preferred?.Value;
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
```

- [ ] **Step 5: Run fact extraction tests**

Run:

```bash
node --test test/official-facts.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/fifa.js src/official-facts.js test/official-facts.test.js
git commit -m "Extract official match facts"
```

## Task 3: Add Structured Insight Storage

**Files:**
- Modify: `src/db.js`
- Modify: `src/db/postgres.js`
- Create: `test/db-v2.test.js`

- [ ] **Step 1: Write failing SQLite storage tests**

Create `test/db-v2.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, upsertMatch, upsertInsight, getInsight } from "../src/db.js";

test("SQLite stores and reads structured insight metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "worldcup-db-v2-"));
  try {
    const db = openDatabase(join(dir, "test.db"));
    const match = upsertMatch(db, {
      fifaId: "fixture-1",
      homeTeam: "主队",
      awayTeam: "客队",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      groupName: "A组",
      stage: "小组赛",
      venue: "示例体育场",
      city: "示例城市",
      kickoffAt: "2026-06-20T20:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z",
      sourceHash: "match-hash",
      raw: {},
    });

    upsertInsight(db, match.id, "prediction", {
      insight: {
        headline: "主队小胜",
        shortText: "主队更主动。客队有反击机会。",
        keyMoments: ["节奏", "定位球"],
        tacticalNotes: ["主队边路", "客队反击"],
        playersToWatch: ["主队", "客队"],
        probabilities: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
        confidence: "medium",
        generatedFor: "prediction",
      },
      structured: {
        schemaVersion: "prediction-v2",
        type: "prediction",
        predictedScore: { home: 2, away: 1, label: "2-1" },
      },
      schemaVersion: "prediction-v2",
      officialFactsStatus: null,
      officialFactsHash: null,
      completionNotes: null,
      frozenAt: "2026-06-20T20:00:00.000Z",
      finalizedAt: null,
      model: "test-model",
      promptVersion: "test-prompt",
      sourceHash: "source-hash",
      generatedAt: "2026-06-15T10:00:00.000Z",
    });

    const insight = getInsight(db, match.id, "prediction");
    assert.equal(insight.schemaVersion, "prediction-v2");
    assert.equal(insight.structured.predictedScore.label, "2-1");
    assert.equal(insight.frozenAt, "2026-06-20T20:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test test/db-v2.test.js
```

Expected: fail because `structured` and metadata columns are not mapped.

- [ ] **Step 3: Update SQLite migration and mapping**

In `src/db.js`, after the `db.exec(...)` call in `migrate`, add an idempotent helper because SQLite throws if a column already exists:

```js
function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

Call after `db.exec(...)`:

```js
  addColumnIfMissing(db, "insights", "structured_json", "TEXT");
  addColumnIfMissing(db, "insights", "schema_version", "TEXT");
  addColumnIfMissing(db, "insights", "official_facts_status", "TEXT");
  addColumnIfMissing(db, "insights", "official_facts_hash", "TEXT");
  addColumnIfMissing(db, "insights", "completion_notes_json", "TEXT");
  addColumnIfMissing(db, "insights", "frozen_at", "TEXT");
  addColumnIfMissing(db, "insights", "finalized_at", "TEXT");
```

Extend `upsertInsight` insert/update columns and parameter object:

```js
structuredJson: payload.structured ? JSON.stringify(payload.structured) : null,
schemaVersion: payload.schemaVersion ?? payload.structured?.schemaVersion ?? null,
officialFactsStatus: payload.officialFactsStatus ?? null,
officialFactsHash: payload.officialFactsHash ?? null,
completionNotesJson: payload.completionNotes ? JSON.stringify(payload.completionNotes) : null,
frozenAt: payload.frozenAt ?? null,
finalizedAt: payload.finalizedAt ?? null,
```

Extend `rowToInsight`:

```js
structured: row.structured_json ? JSON.parse(row.structured_json) : null,
schemaVersion: row.schema_version,
officialFactsStatus: row.official_facts_status,
officialFactsHash: row.official_facts_hash,
completionNotes: row.completion_notes_json ? JSON.parse(row.completion_notes_json) : null,
frozenAt: row.frozen_at,
finalizedAt: row.finalized_at,
```

- [ ] **Step 4: Update Postgres migration and mapping**

In `src/db/postgres.js`, add after insights table creation:

```js
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS structured_json TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS schema_version TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS official_facts_status TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS official_facts_hash TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS completion_notes_json TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS frozen_at TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS finalized_at TEXT`;
```

Mirror the SQLite `upsertInsight` column list and `rowToInsight` mapping.

- [ ] **Step 5: Run DB and existing tests**

Run:

```bash
node --test test/db-v2.test.js
npm test
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/db/postgres.js test/db-v2.test.js
git commit -m "Store structured insight payloads"
```

## Task 4: Add Prediction Freeze and Summary Completion Policies

**Files:**
- Modify: `src/policies.js`
- Create: `test/policies-v2.test.js`
- Update: `test/policies.test.js`

- [ ] **Step 1: Write failing policy tests**

Create `test/policies-v2.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  isPredictionAllowed,
  shouldGenerateInsight,
  shouldRunFinalSummaryCompletion,
  shouldRefreshPartialSummary,
} from "../src/policies.js";

test("prediction is allowed before kickoff for scheduled matches", () => {
  assert.equal(
    isPredictionAllowed({
      match: { status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
      now: new Date("2026-06-14T19:59:00.000Z"),
    }),
    true,
  );
});

test("prediction is blocked at kickoff and for live matches", () => {
  assert.equal(
    isPredictionAllowed({
      match: { status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
      now: new Date("2026-06-14T20:00:00.000Z"),
    }),
    false,
  );

  assert.equal(
    isPredictionAllowed({
      match: { status: "live", kickoffAt: "2026-06-14T20:00:00.000Z" },
      now: new Date("2026-06-14T19:50:00.000Z"),
    }),
    false,
  );
});

test("shouldGenerateInsight does not update prediction after kickoff", () => {
  assert.equal(
    shouldGenerateInsight({
      match: { status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
      insightType: "prediction",
      existingInsight: null,
      now: new Date("2026-06-14T20:01:00.000Z"),
    }),
    false,
  );
});

test("partial summaries refresh after allowed interval", () => {
  assert.equal(
    shouldRefreshPartialSummary({
      match: { status: "finished", kickoffAt: "2026-06-14T20:00:00.000Z", hasFinalScore: true },
      summary: {
        officialFactsStatus: "partial",
        generatedAt: "2026-06-14T22:00:00.000Z",
        finalizedAt: null,
      },
      latestAttemptAt: "2026-06-14T22:00:00.000Z",
      now: new Date("2026-06-14T22:14:00.000Z"),
    }),
    false,
  );

  assert.equal(
    shouldRefreshPartialSummary({
      match: { status: "finished", kickoffAt: "2026-06-14T20:00:00.000Z", hasFinalScore: true },
      summary: {
        officialFactsStatus: "partial",
        generatedAt: "2026-06-14T22:00:00.000Z",
        finalizedAt: null,
      },
      latestAttemptAt: "2026-06-14T22:00:00.000Z",
      now: new Date("2026-06-14T22:15:00.000Z"),
    }),
    true,
  );
});

test("final summary completion runs once after two days", () => {
  assert.equal(
    shouldRunFinalSummaryCompletion({
      match: { status: "finished", kickoffAt: "2026-06-14T20:00:00.000Z", hasFinalScore: true },
      summary: { officialFactsStatus: "partial", finalizedAt: null },
      now: new Date("2026-06-16T20:01:00.000Z"),
    }),
    true,
  );

  assert.equal(
    shouldRunFinalSummaryCompletion({
      match: { status: "finished", kickoffAt: "2026-06-14T20:00:00.000Z", hasFinalScore: true },
      summary: { officialFactsStatus: "complete", finalizedAt: "2026-06-16T20:01:00.000Z" },
      now: new Date("2026-06-17T20:01:00.000Z"),
    }),
    false,
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test test/policies-v2.test.js
```

Expected: fail because new policy exports do not exist.

- [ ] **Step 3: Implement policy helpers**

Add to `src/policies.js`:

```js
const STARTED_STATUSES = new Set(["live", "in_progress", "halftime", "finished", "final", "full_time", "completed"]);
const TWO_DAYS_MINUTES = 2 * 24 * 60;

export function isPredictionAllowed({ match, now = new Date() }) {
  const status = String(match.status || "").toLowerCase();
  if (STARTED_STATUSES.has(status)) return false;
  const kickoff = new Date(match.kickoffAt);
  if (!Number.isFinite(kickoff.getTime())) return false;
  return now.getTime() < kickoff.getTime();
}

export function shouldRefreshPartialSummary({ match, summary, latestAttemptAt, now = new Date() }) {
  if (!isFinishedMatch(match) || summary?.officialFactsStatus !== "partial" || summary?.finalizedAt) return false;
  if (shouldRunFinalSummaryCompletion({ match, summary, now })) return true;
  const interval = ageInMinutes(match.kickoffAt, now) >= 24 * 60 ? 720 : 15;
  const anchor = latestAttemptAt || summary.generatedAt;
  if (!anchor) return true;
  return ageInMinutes(anchor, now) >= interval;
}

export function shouldRunFinalSummaryCompletion({ match, summary, now = new Date() }) {
  if (!isFinishedMatch(match) || summary?.officialFactsStatus !== "partial" || summary?.finalizedAt) return false;
  return ageInMinutes(match.kickoffAt, now) > TWO_DAYS_MINUTES;
}
```

Then change `shouldGenerateInsight` prediction branch:

```js
  if (insightType !== "prediction" || isFinishedMatch(match) || !isPredictionAllowed({ match, now })) {
    return false;
  }
```

- [ ] **Step 4: Update existing policy test expectations**

In `test/policies.test.js`, keep same-day unfinished test before kickoff. Add this assertion to the existing same-day test:

```js
  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "prediction",
      existingInsight: { generatedAt: "2026-06-14T08:30:00.000Z" },
      now: new Date("2026-06-14T20:00:00.000Z"),
    }),
    false,
  );
```

- [ ] **Step 5: Run policy tests**

Run:

```bash
node --test test/policies.test.js test/policies-v2.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/policies.js test/policies.test.js test/policies-v2.test.js
git commit -m "Freeze predictions after kickoff"
```

## Task 5: Generate V2 AI Content

**Files:**
- Modify: `src/ai.js`
- Update: `test/ai-v2.test.js`
- Update: `test/ai.test.js`

- [ ] **Step 1: Add failing AI generation tests**

Append to `test/ai-v2.test.js`:

```js
import { buildInsightPrompt, generateInsight } from "../src/ai.js";

test("prediction prompt requests score rationale and match script", () => {
  const prompt = buildInsightPrompt({
    type: "prediction",
    match: { homeTeam: "巴西", awayTeam: "摩洛哥", status: "scheduled", kickoffAt: "2026-06-14T20:00:00.000Z" },
  });

  assert.match(prompt, /prediction-v2/);
  assert.match(prompt, /predictedScore/);
  assert.match(prompt, /scoreRationale/);
  assert.match(prompt, /matchScript/);
});

test("summary prompt forbids unsupported technical stats", () => {
  const prompt = buildInsightPrompt({
    type: "summary",
    match: { homeTeam: "主队", awayTeam: "客队", status: "finished", homeScore: 2, awayScore: 1 },
  });

  assert.match(prompt, /summary-v2/);
  assert.match(prompt, /Do not add shots/);
  assert.match(prompt, /predictionReview/);
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
    assert.equal(result.structured.predictedScore.label, "2-1");
    assert.equal(result.schemaVersion, "prediction-v2");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});
```

- [ ] **Step 2: Run AI tests and verify failure**

Run:

```bash
node --test test/ai-v2.test.js
```

Expected: fail because prompts and result payload do not include v2 structured data.

- [ ] **Step 3: Update AI prompt and result mapping**

Modify `src/ai.js`:

- Import validators:

```js
import { validateStructuredInsight } from "./insight-schemas.js";
```

- Change prompt version:

```js
const PROMPT_VERSION = "world-cup-2026-insight-v2";
```

- In `buildInsightPrompt`, use two schema objects. For prediction include `schemaVersion: "prediction-v2"` and all prediction fields. For summary include `schemaVersion: "summary-v2"`, official event fields, technical facts, AI analysis, and prediction review.

- Add these prompt rules:

```js
"For predictions, include predictedScore, outcomeProbabilities, matchScript, scoreRationale, tacticalFactors, decisiveFactors, and riskFactors.",
"For summaries, use officialEvents and technicalFacts from supplied facts only.",
"Do not add shots, shots on target, possession, xG, injuries, quotes, or unavailable player status.",
"If player data is not supplied, use team-level wording instead of inventing player names.",
```

- After parsing model JSON, validate v2 and derive legacy fields:

```js
const structured = validateStructuredInsight(parseInsightJson(text), type);
return {
  insight: legacyInsightFromStructured(structured),
  structured,
  schemaVersion: structured.schemaVersion,
  model: config.model,
  promptVersion: PROMPT_VERSION,
};
```

- Add legacy mapper:

```js
function legacyInsightFromStructured(structured) {
  if (structured.schemaVersion === "prediction-v2") {
    return validateInsight({
      headline: structured.headline,
      shortText: structured.shortText,
      keyMoments: structured.scoreRationale,
      tacticalNotes: structured.tacticalFactors,
      playersToWatch: structured.playersToWatch,
      probabilities: structured.outcomeProbabilities,
      confidence: structured.confidence,
      generatedFor: "prediction",
    }, "prediction");
  }

  return validateInsight({
    headline: structured.headline,
    shortText: structured.matchStory.summary,
    keyMoments: [
      structured.matchStory.turningPoint,
      structured.matchStory.closingPhase,
    ],
    tacticalNotes: structured.aiAnalysis.tacticalSummary,
    playersToWatch: structured.aiAnalysis.keyPlayerImpact.length
      ? structured.aiAnalysis.keyPlayerImpact
      : [structured.result.winner, structured.result.resultText],
    probabilities: structured.predictionReview?.preMatchProbabilities || {
      homeWin: Number(structured.result.homeScore > structured.result.awayScore),
      draw: Number(structured.result.homeScore === structured.result.awayScore),
      awayWin: Number(structured.result.awayScore > structured.result.homeScore),
    },
    confidence: "medium",
    generatedFor: "summary",
  }, "summary");
}
```

- Update `fallbackInsight` to also return a valid `structured` payload through a new `fallbackStructuredInsight(type, match)` helper. Keep old `insight` fields valid.

- [ ] **Step 4: Run AI tests**

Run:

```bash
node --test test/ai.test.js test/ai-v2.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ai.js test/ai.test.js test/ai-v2.test.js
git commit -m "Generate structured v2 AI insights"
```

## Task 6: Integrate V2 Refresh Flow

**Files:**
- Modify: `src/refresh.js`
- Modify: `src/background-refresh.js`
- Create: `test/refresh-v2.test.js`
- Update: `test/background-refresh.test.js`

- [ ] **Step 1: Write failing refresh tests**

Create `test/refresh-v2.test.js` with focused assertions:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, getMatchByFifaId, getInsight } from "../src/db.js";
import { refreshWorldCupData } from "../src/refresh.js";

test("refresh stores frozen structured prediction before kickoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worldcup-refresh-v2-"));
  const previous = process.env.FIFA_MATCHES_URL;
  process.env.FIFA_MATCHES_URL = "https://fifa.example/matches";

  try {
    const db = openDatabase(join(dir, "test.db"));
    await refreshWorldCupData(db, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("/chat/completions")) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
            schemaVersion: "prediction-v2",
            type: "prediction",
            headline: "主队小胜",
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
          }) } }] }) };
        }
        return { ok: true, json: async () => ({ Results: [{
          IdMatch: "fixture-1",
          Home: { TeamName: "主队" },
          Away: { TeamName: "客队" },
          MatchStatus: 1,
          Date: "2026-06-14T20:00:00.000Z",
        }] }) };
      },
    });

    const match = getMatchByFifaId(db, "fixture-1");
    const prediction = getInsight(db, match.id, "prediction");
    assert.equal(prediction.schemaVersion, "prediction-v2");
    assert.equal(prediction.structured.predictedScore.label, "2-1");
  } finally {
    restoreEnv("FIFA_MATCHES_URL", previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh does not generate prediction after kickoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worldcup-refresh-v2-"));
  const previous = process.env.FIFA_MATCHES_URL;
  process.env.FIFA_MATCHES_URL = "https://fifa.example/matches";
  let aiCalled = false;

  try {
    const db = openDatabase(join(dir, "test.db"));
    await refreshWorldCupData(db, {
      now: new Date("2026-06-14T20:01:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("/chat/completions")) aiCalled = true;
        return { ok: true, json: async () => ({ Results: [{
          IdMatch: "fixture-2",
          Home: { TeamName: "主队" },
          Away: { TeamName: "客队" },
          MatchStatus: 1,
          Date: "2026-06-14T20:00:00.000Z",
        }] }) };
      },
    });
    assert.equal(aiCalled, false);
  } finally {
    restoreEnv("FIFA_MATCHES_URL", previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
```

- [ ] **Step 2: Run refresh tests and verify failure**

Run:

```bash
node --test test/refresh-v2.test.js
```

Expected: fail until refresh stores structured payload and policy blocks kickoff predictions.

- [ ] **Step 3: Update refresh pipeline**

In `src/refresh.js`:

- Import `fetchFifaMatchDetail`, `extractOfficialFacts`, `factsCompleteness`, and `officialFactsHash`.
- For finished matches, fetch detail once before summary generation:

```js
const detail = isFinishedMatch(sourceMatch)
  ? await fetchFifaMatchDetail(sourceMatch.fifaId, fetchImpl).catch(() => null)
  : null;
const officialFacts = isFinishedMatch(sourceMatch) ? extractOfficialFacts(sourceMatch, detail) : null;
```

- When generating summary, pass official facts and existing prediction into `generateInsight`:

```js
const payload = await generateInsight({
  type,
  match: {
    ...match,
    officialFacts,
    existingPrediction: type === "summary" ? await getInsight(db, row.id, "prediction") : null,
  },
  fetchImpl,
});
```

- When storing summary, include:

```js
officialFactsStatus: completeness.status,
officialFactsHash: officialFactsHash(officialFacts),
completionNotes: payload.structured?.completionNotes || null,
finalizedAt: completeness.status === "complete" ? now.toISOString() : null,
```

- When storing prediction, include:

```js
frozenAt: new Date(match.kickoffAt) <= now ? now.toISOString() : null,
```

Predictions should not be generated after kickoff because Task 4 policy blocks them.

- Add a helper `summaryNeedsRegeneration(existingSummary, factsHash, match, now)` that returns true when:

```js
!existingSummary ||
existingSummary.officialFactsStatus === "partial" &&
existingSummary.officialFactsHash !== factsHash &&
shouldRefreshPartialSummary({ match, summary: existingSummary, now })
```

- Add final completion path when `shouldRunFinalSummaryCompletion({ match, summary: existingSummary, now })` is true. In that path, pass `finalCompletion: true` into `generateInsight`, force `officialFactsStatus: "complete"`, set `finalizedAt`, and preserve field-level `completionNotes`.

- [ ] **Step 4: Update background refresh trigger**

In `src/background-refresh.js`, inside the finished-match branch, add:

```js
      if (match.summaryOfficialFactsStatus === "partial") {
        const policy = getMatchRefreshPolicy(match, now);
        const latestFinishedAt = refreshFinishedAt(latestRefresh);
        if (!latestFinishedAt || ageInMinutes(latestFinishedAt, now) >= (policy.dataTtlMinutes ?? 15)) {
          return { shouldRefresh: true, reason: "summary_partial" };
        }
      }
```

Also map `summaryOfficialFactsStatus` from DB in Task 3 query joins.

- [ ] **Step 5: Run refresh tests**

Run:

```bash
node --test test/refresh.test.js test/refresh-v2.test.js test/background-refresh.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/refresh.js src/background-refresh.js test/refresh-v2.test.js test/background-refresh.test.js
git commit -m "Integrate structured insight refresh"
```

## Task 7: Render V2 UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Update: `test/frontend.test.js`

- [ ] **Step 1: Add failing frontend source tests**

Append to `test/frontend.test.js`:

```js
test("frontend renders structured prediction score and rationale", () => {
  assert.match(appSource, /renderStructuredPrediction/);
  assert.match(appSource, /predictedScore/);
  assert.match(appSource, /比分预测/);
  assert.match(appSource, /预测依据/);
  assert.match(appSource, /风险因素/);
});

test("frontend renders summary partial and field-level completion markers", () => {
  assert.match(appSource, /官方数据补全中/);
  assert.match(appSource, /AI 辅助确认/);
  assert.match(appSource, /官方数据缺失/);
  assert.match(appSource, /renderCompletionNote/);
});

test("frontend renders post-match prediction review as secondary content", () => {
  assert.match(appSource, /predictionReview/);
  assert.match(appSource, /赛前预测回看/);
  assert.match(appSource, /赛前预测/);
});
```

- [ ] **Step 2: Run frontend tests and verify failure**

Run:

```bash
node --test test/frontend.test.js
```

Expected: fail until render functions are added.

- [ ] **Step 3: Update rendering flow**

In `public/app.js`, change `renderInsight(insight)`:

```js
function renderInsight(insight) {
  if (insight.structured?.schemaVersion === "prediction-v2") {
    return renderStructuredPrediction(insight.structured);
  }
  if (insight.structured?.schemaVersion === "summary-v2") {
    return renderStructuredSummary(insight.structured);
  }
  return renderLegacyInsight(insight);
}
```

Rename current function body to `renderLegacyInsight`.

Add:

```js
function renderStructuredPrediction(prediction) {
  return `
    <div class="grid insight-grid">
      <section class="panel prediction-hero">
        <h3>赛前预测</h3>
        <strong>${escapeHtml(prediction.headline)}</strong>
        <p>${escapeHtml(prediction.shortText)}</p>
        <div class="predicted-score">
          <span>比分预测</span>
          <strong>${escapeHtml(prediction.predictedScore.label)}</strong>
        </div>
      </section>
      <section class="panel probabilities">
        <h3>胜平负概率</h3>
        ${probabilityRow("主胜", prediction.outcomeProbabilities.homeWin)}
        ${probabilityRow("平局", prediction.outcomeProbabilities.draw)}
        ${probabilityRow("客胜", prediction.outcomeProbabilities.awayWin)}
      </section>
      <section class="panel">
        <h3>比赛走势</h3>
        <p>${escapeHtml(prediction.matchScript.summary)}</p>
        <ul>
          <li>${escapeHtml(prediction.matchScript.firstHalf)}</li>
          <li>${escapeHtml(prediction.matchScript.secondHalf)}</li>
        </ul>
      </section>
      <section class="panel">
        <h3>预测依据</h3>
        <ul>${prediction.scoreRationale.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel">
        <h3>关键因素</h3>
        <ul>${prediction.decisiveFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel subtle-panel">
        <h3>风险因素</h3>
        <ul>${prediction.riskFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </div>
  `;
}
```

Add:

```js
function renderStructuredSummary(summary) {
  const partialBadge =
    summary.officialFactsStatus === "partial"
      ? `<span class="status-chip muted" title="部分官方事件数据可能稍后补齐，系统会按刷新间隔自动更新。">官方数据补全中</span>`
      : "";

  return `
    <div class="grid insight-grid">
      <section class="panel summary-hero">
        <h3>赛后总结 ${partialBadge}</h3>
        <strong>${escapeHtml(summary.headline)}</strong>
        <p>${escapeHtml(summary.matchStory.summary)}</p>
      </section>
      <section class="panel">
        <h3>比赛脉络</h3>
        <ul>
          <li>${escapeHtml(summary.matchStory.turningPoint)}</li>
          <li>${escapeHtml(summary.matchStory.closingPhase)}</li>
        </ul>
      </section>
      <section class="panel">
        <h3>进球</h3>
        ${renderEventList(summary.officialEvents.goals, (goal) =>
          `${escapeHtml(goal.minute)} ${escapeHtml(goal.team)} ${escapeHtml(goal.player)}`
        )}
      </section>
      <section class="panel">
        <h3>红黄牌</h3>
        ${renderEventList(summary.officialEvents.cards, (card) =>
          `${escapeHtml(card.minute)} ${escapeHtml(card.team)} ${escapeHtml(card.player)} ${escapeHtml(card.card)}`
        )}
      </section>
      <section class="panel">
        <h3>官方技术事实</h3>
        ${renderTechnicalFacts(summary)}
      </section>
      <section class="panel">
        <h3>AI 赛后分析</h3>
        <ul>${summary.aiAnalysis.resultExplanation.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      ${summary.predictionReview ? renderPredictionReview(summary.predictionReview) : ""}
    </div>
  `;
}
```

Add helpers:

```js
function renderEventList(items, formatter) {
  if (!items || items.length === 0) return `<p class="muted-text">暂无官方事件记录</p>`;
  return `<ul>${items.map((item) => `<li>${formatter(item)}</li>`).join("")}</ul>`;
}

function renderTechnicalFacts(summary) {
  const facts = summary.technicalFacts;
  return `
    <dl class="facts-list">
      <dt>阵型</dt>
      <dd>${escapeHtml(facts.formations?.home || "暂缺")} - ${escapeHtml(facts.formations?.away || "暂缺")} ${renderCompletionNote(summary, "formations")}</dd>
      <dt>场馆</dt>
      <dd>${escapeHtml(facts.venue || "暂缺")} ${renderCompletionNote(summary, "venue")}</dd>
      <dt>上座人数</dt>
      <dd>${facts.attendance ?? "暂缺"} ${renderCompletionNote(summary, "attendance")}</dd>
      <dt>裁判</dt>
      <dd>${escapeHtml((facts.officials || []).join("、") || "暂缺")} ${renderCompletionNote(summary, "officials")}</dd>
    </dl>
  `;
}

function renderCompletionNote(summary, key) {
  const note = summary.completionNotes?.[key];
  if (!note) return "";
  const label = note.source === "ai" ? "AI 辅助确认" : "官方数据缺失";
  return `<span class="status-chip muted">${escapeHtml(note.label || label)}</span>`;
}

function renderPredictionReview(review) {
  return `
    <section class="panel subtle-panel prediction-review">
      <h3>赛前预测回看</h3>
      <p>预测比分 ${escapeHtml(review.predictedScore)} · 实际比分 ${escapeHtml(review.actualScore)}</p>
      <p>${review.scoreHit ? "比分命中" : "比分未命中"} · ${review.outcomeHit ? "赛果方向命中" : "赛果方向未命中"}</p>
      <div class="probabilities compact">
        <h4>赛前预测</h4>
        ${probabilityRow("主胜", review.preMatchProbabilities.homeWin)}
        ${probabilityRow("平局", review.preMatchProbabilities.draw)}
        ${probabilityRow("客胜", review.preMatchProbabilities.awayWin)}
      </div>
      <p>${escapeHtml(review.reviewText)}</p>
    </section>
  `;
}
```

- [ ] **Step 4: Add CSS**

Append to `public/styles.css`:

```css
.prediction-hero .predicted-score {
  display: inline-grid;
  gap: 0.25rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid rgba(13, 112, 76, 0.18);
  border-radius: 8px;
  background: rgba(13, 112, 76, 0.06);
}

.predicted-score span {
  color: var(--muted);
  font-size: 0.85rem;
}

.predicted-score strong {
  font-size: 1.8rem;
}

.status-chip.muted {
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.08);
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 500;
}

.subtle-panel {
  background: rgba(248, 250, 252, 0.72);
}

.facts-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.5rem 0.8rem;
}

.facts-list dt {
  color: var(--muted);
}

.facts-list dd {
  margin: 0;
}

.prediction-review {
  grid-column: 1 / -1;
}

.probabilities.compact .bar {
  height: 0.35rem;
}
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
node --test test/frontend.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/styles.css test/frontend.test.js
git commit -m "Render structured AI insights"
```

## Task 8: Final Verification and Build

**Files:**
- Modify if needed: `README.md`

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run Vercel build**

Run:

```bash
vercel build
```

Expected: build succeeds with no secret values printed.

- [ ] **Step 3: Inspect git diff for secrets**

Run:

```bash
git diff main...HEAD -- . ':!package-lock.json'
```

Expected: no database URLs, API keys, or provider secrets.

- [ ] **Step 4: Confirm branch history**

Run:

```bash
git log --oneline --decorate main..HEAD
```

Expected: commits include the design/spec commits and implementation commits for tasks 1-7.

- [ ] **Step 5: Commit README update only if behavior documentation changed**

If README needs a short user-facing note, add:

```md
AI insights are cached server-side. Predictions are generated only before kickoff and remain available after the match as a pre-match review. Post-match summaries use official FIFA facts and may show a low-key completion marker while official event data is still being finalized.
```

Then run:

```bash
git add README.md
git commit -m "Document structured AI insight behavior"
```

If README already covers this clearly, skip this commit.

## Self-Review Checklist

- Spec coverage:
  - Prediction-v2 schema: Task 1 and Task 5.
  - Summary-v2 schema: Task 1 and Task 5.
  - No unsupported post-match stats: Task 1, Task 2, Task 5, Task 7.
  - Prediction freeze after kickoff: Task 4 and Task 6.
  - Official facts extraction: Task 2 and Task 6.
  - Partial-summary UI marker: Task 7.
  - Two-day final completion: Task 4 and Task 6.
  - Field-level AI-assisted and missing-data markers: Task 7.
  - Rollback via legacy fields: Task 3, Task 5, Task 7.

- Commands to run before declaring implementation complete:

```bash
npm test
vercel build
git status --short --branch
```

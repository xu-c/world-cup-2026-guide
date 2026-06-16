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

test("prediction is blocked for started and completed statuses before kickoff", () => {
  for (const status of ["live", "halftime", "finished", "final", "full_time", "completed"]) {
    assert.equal(
      isPredictionAllowed({
        match: { status, kickoffAt: "2026-06-14T20:00:00.000Z" },
        now: new Date("2026-06-14T19:50:00.000Z"),
      }),
      false,
      status,
    );
  }
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

test("partial summaries refresh every twelve hours after the first day", () => {
  const match = {
    status: "finished",
    kickoffAt: "2026-06-14T20:00:00.000Z",
    hasFinalScore: true,
  };
  const summary = {
    officialFactsStatus: "partial",
    generatedAt: "2026-06-15T22:00:00.000Z",
    finalizedAt: null,
  };

  assert.equal(
    shouldRefreshPartialSummary({
      match,
      summary,
      latestAttemptAt: "2026-06-15T22:00:00.000Z",
      now: new Date("2026-06-16T09:59:00.000Z"),
    }),
    false,
  );

  assert.equal(
    shouldRefreshPartialSummary({
      match,
      summary,
      latestAttemptAt: "2026-06-15T22:00:00.000Z",
      now: new Date("2026-06-16T10:00:00.000Z"),
    }),
    true,
  );
});

test("partial summaries do not refresh after finalization or completion", () => {
  const match = {
    status: "finished",
    kickoffAt: "2026-06-14T20:00:00.000Z",
    hasFinalScore: true,
  };

  assert.equal(
    shouldRefreshPartialSummary({
      match,
      summary: { officialFactsStatus: "partial", finalizedAt: "2026-06-15T20:00:00.000Z" },
      latestAttemptAt: "2026-06-14T22:00:00.000Z",
      now: new Date("2026-06-15T20:00:00.000Z"),
    }),
    false,
  );

  assert.equal(
    shouldRefreshPartialSummary({
      match,
      summary: { officialFactsStatus: "complete", finalizedAt: null },
      latestAttemptAt: "2026-06-14T22:00:00.000Z",
      now: new Date("2026-06-15T20:00:00.000Z"),
    }),
    false,
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

import test from "node:test";
import assert from "node:assert/strict";

import {
  getMatchRefreshPolicy,
  shouldGenerateInsight,
} from "../src/policies.js";

const now = new Date("2026-06-14T12:00:00.000Z");

test("finished matches are treated as immutable after data and summary are stored", () => {
  const match = {
    status: "finished",
    kickoffAt: "2026-06-11T20:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    hasFinalScore: true,
  };

  assert.deepEqual(getMatchRefreshPolicy(match, now), {
    dataTtlMinutes: null,
    insightTtlMinutes: null,
    reason: "finished_locked",
  });

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "summary",
      existingInsight: { generatedAt: "2026-06-12T00:30:00.000Z" },
      now,
    }),
    false,
  );
});

test("finished matches without summaries generate exactly one summary", () => {
  const match = {
    status: "finished",
    kickoffAt: "2026-06-11T20:00:00.000Z",
    hasFinalScore: true,
  };

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "summary",
      existingInsight: null,
      now,
    }),
    true,
  );
});

test("same-day unfinished matches refresh frequently and keep predictions fresh", () => {
  const match = {
    status: "scheduled",
    kickoffAt: "2026-06-14T20:00:00.000Z",
  };

  assert.deepEqual(getMatchRefreshPolicy(match, now), {
    dataTtlMinutes: 15,
    insightTtlMinutes: 120,
    reason: "same_day_unfinished",
  });

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "prediction",
      existingInsight: { generatedAt: "2026-06-14T08:30:00.000Z" },
      now,
    }),
    true,
  );

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "prediction",
      existingInsight: { generatedAt: "2026-06-14T08:30:00.000Z" },
      now: new Date("2026-06-14T20:00:00.000Z"),
    }),
    false,
  );
});

test("future matches refresh at low frequency and reuse fresh predictions", () => {
  const match = {
    status: "scheduled",
    kickoffAt: "2026-06-20T20:00:00.000Z",
  };

  assert.deepEqual(getMatchRefreshPolicy(match, now), {
    dataTtlMinutes: 720,
    insightTtlMinutes: 720,
    reason: "future_low_frequency",
  });

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "prediction",
      existingInsight: { generatedAt: "2026-06-14T01:00:00.000Z" },
      now,
    }),
    false,
  );

  assert.equal(
    shouldGenerateInsight({
      match,
      insightType: "prediction",
      existingInsight: { generatedAt: "2026-06-13T23:59:00.000Z" },
      now,
    }),
    true,
  );
});

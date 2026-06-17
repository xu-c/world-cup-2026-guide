import test from "node:test";
import assert from "node:assert/strict";

import { shouldStartBackgroundRefresh } from "../src/background-refresh.js";

const now = new Date("2026-06-14T12:00:00.000Z");

test("starts a background refresh when the database has not been initialized", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [],
      latestRefresh: null,
      now,
    }),
    { shouldRefresh: true, reason: "empty_database" },
  );
});

test("does not refresh fully cached finished matches again", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 0,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: "赛后总结",
          summaryOfficialFactsStatus: "complete",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-12T00:00:00.000Z",
        started_at: "2026-06-12T00:00:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );
});

test("refreshes cached summaries marked for structured repair after the 15 minute floor", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 0,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: "赛后总结",
          summaryOfficialFactsStatus: "complete",
          summaryNeedsRepair: true,
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:44:00.000Z",
        started_at: "2026-06-14T11:43:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "summary_repair" },
  );
});

test("refreshes legacy finished summaries so they can upgrade to structured v2", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 0,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: "旧版赛后总结",
          summaryOfficialFactsStatus: null,
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-12T00:00:00.000Z",
        started_at: "2026-06-12T00:00:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "summary_legacy" },
  );
});

test("does not immediately re-run legacy summary upgrades before the 15 minute floor", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 0,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: "旧版赛后总结",
          summaryOfficialFactsStatus: null,
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:50:00.000Z",
        started_at: "2026-06-14T11:49:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );
});

test("refreshes a finished match once when its summary is missing", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 0,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: null,
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-12T00:00:00.000Z",
        started_at: "2026-06-12T00:00:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "finished_summary_missing" },
  );
});

test("refreshes due partial finished summaries without UI controls", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 1,
          kickoffAt: "2026-06-11T20:00:00.000Z",
          summaryHeadline: "部分赛后总结",
          summaryOfficialFactsStatus: "partial",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:44:00.000Z",
        started_at: "2026-06-14T11:44:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "summary_partial" },
  );
});

test("does not refresh old partial finished summaries before the twelve hour interval", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "finished",
          hasFinalScore: true,
          homeScore: 2,
          awayScore: 1,
          kickoffAt: "2026-06-12T20:00:00.000Z",
          summaryHeadline: "部分赛后总结",
          summaryOfficialFactsStatus: "partial",
          summaryGeneratedAt: "2026-06-14T00:00:00.000Z",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:44:00.000Z",
        started_at: "2026-06-14T11:44:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );
});

test("refreshes cached local fallback summaries when an AI provider is configured", () => {
  const previous = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "test-key";

  try {
    assert.deepEqual(
      shouldStartBackgroundRefresh({
        matches: [
          {
            status: "finished",
            hasFinalScore: true,
            homeScore: 2,
            awayScore: 0,
            kickoffAt: "2026-06-11T20:00:00.000Z",
            summaryHeadline: "本地占位总结",
            summaryModel: "local-fallback",
          },
        ],
        latestRefresh: {
          status: "success",
          finished_at: "2026-06-12T00:00:00.000Z",
          started_at: "2026-06-12T00:00:00.000Z",
        },
        now,
      }),
      { shouldRefresh: true, reason: "summary_local_fallback" },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.AI_API_KEY;
    } else {
      process.env.AI_API_KEY = previous;
    }
  }
});

test("does not refresh cached local fallback summaries without an AI provider", () => {
  const previous = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;

  try {
    assert.deepEqual(
      shouldStartBackgroundRefresh({
        matches: [
          {
            status: "finished",
            hasFinalScore: true,
            homeScore: 2,
            awayScore: 0,
            kickoffAt: "2026-06-11T20:00:00.000Z",
            summaryHeadline: "本地占位总结",
            summaryModel: "local-fallback",
          },
        ],
        latestRefresh: {
          status: "success",
          finished_at: "2026-06-12T00:00:00.000Z",
          started_at: "2026-06-12T00:00:00.000Z",
        },
        now,
      }),
      { shouldRefresh: false, reason: "nothing_due" },
    );
  } finally {
    if (previous !== undefined) process.env.AI_API_KEY = previous;
  }
});


test("does not refresh same-day unfinished matches before the 15 minute floor", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-14T20:00:00.000Z",
          predictionHeadline: "赛前预测",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:50:00.000Z",
        started_at: "2026-06-14T11:49:59.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );
});

test("refreshes same-day unfinished matches after 15 minutes", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-14T20:00:00.000Z",
          predictionHeadline: "赛前预测",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:44:00.000Z",
        started_at: "2026-06-14T11:44:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "same_day_unfinished" },
  );
});

test("does not immediately re-run just because a future prediction is missing", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-20T20:00:00.000Z",
          predictionHeadline: null,
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T11:50:00.000Z",
        started_at: "2026-06-14T11:50:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );
});

test("refreshes future matches at most every 12 hours", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-20T20:00:00.000Z",
          predictionHeadline: "赛前预测",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-14T01:00:00.000Z",
        started_at: "2026-06-14T01:00:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "nothing_due" },
  );

  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-20T20:00:00.000Z",
          predictionHeadline: "赛前预测",
        },
      ],
      latestRefresh: {
        status: "success",
        finished_at: "2026-06-13T23:59:00.000Z",
        started_at: "2026-06-13T23:59:00.000Z",
      },
      now,
    }),
    { shouldRefresh: true, reason: "future_low_frequency" },
  );
});

test("skips while a recent refresh is already running", () => {
  assert.deepEqual(
    shouldStartBackgroundRefresh({
      matches: [
        {
          status: "scheduled",
          kickoffAt: "2026-06-14T20:00:00.000Z",
        },
      ],
      latestRefresh: {
        status: "running",
        started_at: "2026-06-14T11:59:00.000Z",
      },
      now,
    }),
    { shouldRefresh: false, reason: "refresh_already_running" },
  );
});

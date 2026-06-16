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
  assert.equal(facts.technicalFacts.venue, "墨西哥城体育场");
  assert.deepEqual(facts.technicalFacts.officials, ["主裁判"]);
  assert.equal(facts.officialEvents.goals[0].player, "洛萨诺");
  assert.equal(facts.officialEvents.cards[0].card, "yellow");
  assert.equal(facts.officialEvents.substitutions[0].playerOn, "球员乙");
});

test("extractOfficialFacts supports Home and Away detail shapes", () => {
  const facts = extractOfficialFacts(
    {
      homeTeam: "主队",
      awayTeam: "客队",
      homeScore: 1,
      awayScore: 0,
      raw: {},
    },
    {
      Home: {
        TeamName: [{ Locale: "zh-CN", Description: "主队" }],
        Score: 1,
        Formation: "4-2-3-1",
        Players: [
          { IdPlayer: 10, ShortName: "射手" },
          { IdPlayer: 11, ShortName: "助攻者" },
        ],
        Goals: [{ IdPlayer: 10, IdAssistPlayer: 11, Minute: 61, Type: 3 }],
        Cards: [{ IdPlayer: 10, Minute: 74, Card: 2 }],
        Substitutions: [{ Minute: 80, IdPlayerOff: 10, IdPlayerOn: 12, PlayerOnName: "替补" }],
      },
      Away: {
        TeamName: [{ Locale: "zh-CN", Description: "客队" }],
        Score: 0,
        Formation: "4-4-2",
        Players: [],
        Goals: [],
        Cards: [],
        Substitutions: [],
      },
      Referees: [{ DisplayName: "VAR" }],
    },
  );

  assert.deepEqual(facts.result, {
    homeScore: 1,
    awayScore: 0,
    winner: "主队",
    resultText: "主队 1-0 客队",
  });
  assert.deepEqual(facts.technicalFacts.formations, { home: "4-2-3-1", away: "4-4-2" });
  assert.equal(facts.officialEvents.goals[0].assist, "助攻者");
  assert.equal(facts.officialEvents.goals[0].type, "penalty");
  assert.equal(facts.officialEvents.cards[0].card, "red");
  assert.equal(facts.technicalFacts.officials[0], "VAR");
});

test("extractOfficialFacts prefers stored match score over detail score", () => {
  const facts = extractOfficialFacts(
    {
      homeTeam: "主队",
      awayTeam: "客队",
      homeScore: 2,
      awayScore: 1,
      raw: {},
    },
    {
      HomeTeam: {
        TeamName: [{ Locale: "zh-CN", Description: "主队" }],
        Score: 0,
        Goals: [],
        Bookings: [],
        Substitutions: [],
      },
      AwayTeam: {
        TeamName: [{ Locale: "zh-CN", Description: "客队" }],
        Score: 0,
        Goals: [],
        Bookings: [],
        Substitutions: [],
      },
    },
  );

  assert.deepEqual(facts.result, {
    homeScore: 2,
    awayScore: 1,
    winner: "主队",
    resultText: "主队 2-1 客队",
  });
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

test("fetchFifaMatchDetail allows FIFA_MATCH_DETAIL_BASE_URL override", async () => {
  const previous = process.env.FIFA_MATCH_DETAIL_BASE_URL;
  process.env.FIFA_MATCH_DETAIL_BASE_URL = "https://example.test/detail/";

  try {
    let requestedUrl;
    await fetchFifaMatchDetail("match id", async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({}) };
    });
    assert.equal(requestedUrl, "https://example.test/detail/match%20id");
  } finally {
    if (previous === undefined) {
      delete process.env.FIFA_MATCH_DETAIL_BASE_URL;
    } else {
      process.env.FIFA_MATCH_DETAIL_BASE_URL = previous;
    }
  }
});

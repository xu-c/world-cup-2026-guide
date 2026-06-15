import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getMatchByFifaId, listMatches, openDatabase, upsertInsight, upsertMatch } from "../src/db.js";
import { refreshWorldCupData } from "../src/refresh.js";

test("refresh localizes but does not rescore a finished match after its summary is cached", async () => {
  const dbPath = join(tmpdir(), `worldcup-refresh-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);
  const store = { driver: "sqlite", client: db };

  const existing = upsertMatch(db, {
    fifaId: "locked-final",
    homeTeam: "墨西哥",
    awayTeam: "南非",
    homeScore: 2,
    awayScore: 0,
    status: "finished",
    hasFinalScore: true,
    groupName: "A组",
    stage: "小组赛",
    venue: "墨西哥城体育场",
    city: "墨西哥城",
    kickoffAt: "2026-06-11T19:00:00.000Z",
    updatedAt: "2026-06-11T22:00:00.000Z",
    sourceHash: "original",
    raw: { version: "original" },
  });

  upsertInsight(db, existing.id, "summary", {
    insight: {
      headline: "已缓存赛后总结",
      shortText: "这场比赛已经完成总结。",
      keyMoments: ["比分已确认", "总结已缓存"],
      tacticalNotes: ["主队控制节奏", "客队反击受限"],
      playersToWatch: ["墨西哥", "南非"],
      probabilities: { homeWin: 1, draw: 0, awayWin: 0 },
      confidence: "high",
      generatedFor: "summary",
    },
    model: "test",
    promptVersion: "test",
    sourceHash: "original",
    generatedAt: "2026-06-11T22:30:00.000Z",
  });

  const previousUrl = process.env.FIFA_MATCHES_URL;
  process.env.FIFA_MATCHES_URL = "https://fifa.test/matches";

  try {
    const result = await refreshWorldCupData(store, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async () => ({
        ok: true,
        json: async () => [
          {
            id: "locked-final",
            Home: { TeamName: [{ Locale: "zh-CN", Description: "墨西哥队" }] },
            Away: { TeamName: [{ Locale: "zh-CN", Description: "南非队" }] },
            HomeScore: 3,
            AwayScore: 0,
            Status: "finished",
            Date: "2026-06-11T19:00:00.000Z",
            LastUpdated: "2026-06-14T12:00:00.000Z",
            GroupName: [{ Locale: "zh-CN", Description: "A 组" }],
          },
          {
            id: "future-match",
            homeTeamName: "巴西",
            awayTeamName: "摩洛哥",
            Status: "scheduled",
            Date: "2026-06-20T20:00:00.000Z",
          },
        ],
      }),
    });

    const locked = getMatchByFifaId(db, "locked-final");
    assert.equal(result.matches, 2);
    assert.equal(locked.homeScore, 2);
    assert.equal(locked.homeTeam, "墨西哥队");
    assert.equal(locked.awayTeam, "南非队");
    assert.equal(locked.groupName, "A 组");
  } finally {
    if (previousUrl === undefined) {
      delete process.env.FIFA_MATCHES_URL;
    } else {
      process.env.FIFA_MATCHES_URL = previousUrl;
    }
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

test("refresh upgrades local fallback insights when an AI provider is configured", async () => {
  const dbPath = join(tmpdir(), `worldcup-upgrade-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);
  const store = { driver: "sqlite", client: db };

  const existing = upsertMatch(db, {
    fifaId: "fallback-final",
    homeTeam: "墨西哥",
    awayTeam: "南非",
    homeScore: 2,
    awayScore: 0,
    status: "finished",
    hasFinalScore: true,
    groupName: "A组",
    stage: "小组赛",
    venue: "墨西哥城体育场",
    city: "墨西哥城",
    kickoffAt: "2026-06-11T19:00:00.000Z",
    updatedAt: "2026-06-11T22:00:00.000Z",
    sourceHash: "original",
    raw: { version: "original" },
  });

  upsertInsight(db, existing.id, "summary", {
    insight: {
      headline: "本地占位总结",
      shortText: "这是一条本地 fallback。",
      keyMoments: ["比分已确认", "总结已缓存"],
      tacticalNotes: ["主队控制节奏", "客队反击受限"],
      playersToWatch: ["墨西哥", "南非"],
      probabilities: { homeWin: 1, draw: 0, awayWin: 0 },
      confidence: "low",
      generatedFor: "summary",
    },
    model: "local-fallback",
    promptVersion: "test",
    sourceHash: "original",
    generatedAt: "2026-06-11T22:30:00.000Z",
  });

  const previous = {
    FIFA_MATCHES_URL: process.env.FIFA_MATCHES_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.FIFA_MATCHES_URL = "https://fifa.test/matches";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://provider.test/v1";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    const result = await refreshWorldCupData(store, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("provider.test")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      headline: "真实模型赛后总结",
                      shortText: "墨西哥在比赛中更有效地控制了节奏。南非需要提升禁区前沿处理球质量。",
                      keyMoments: ["墨西哥早段取得主动", "第二球稳定局面"],
                      tacticalNotes: ["墨西哥压迫更连续", "南非转换速度不足"],
                      playersToWatch: ["墨西哥前场", "南非门将"],
                      probabilities: { homeWin: 1, draw: 0, awayWin: 0 },
                      confidence: "medium",
                      generatedFor: "summary",
                    }),
                  },
                },
              ],
            }),
          };
        }

        return {
          ok: true,
          json: async () => [
            {
              id: "fallback-final",
              homeTeamName: "墨西哥",
              awayTeamName: "南非",
              HomeScore: 2,
              AwayScore: 0,
              Status: "finished",
              Date: "2026-06-11T19:00:00.000Z",
              LastUpdated: "2026-06-11T22:00:00.000Z",
            },
          ],
        };
      },
    });

    const upgraded = db
      .prepare("SELECT headline, model FROM insights WHERE match_id = ? AND type = 'summary'")
      .get(existing.id);
    assert.equal(result.matches, 1);
    assert.equal(result.insightsGenerated, 1);
    assert.equal(upgraded.headline, "真实模型赛后总结");
    assert.equal(upgraded.model, "mimo-v2.5-pro");
  } finally {
    restoreEnv("FIFA_MATCHES_URL", previous.FIFA_MATCHES_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

test("refresh removes local seed matches after a real FIFA source is configured", async () => {
  const dbPath = join(tmpdir(), `worldcup-seed-cleanup-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);
  const store = { driver: "sqlite", client: db };

  upsertMatch(db, {
    fifaId: "seed-demo-match",
    homeTeam: "示例主队",
    awayTeam: "示例客队",
    homeScore: null,
    awayScore: null,
    status: "scheduled",
    hasFinalScore: false,
    kickoffAt: "2026-06-20T20:00:00.000Z",
    updatedAt: "2026-06-14T08:00:00.000Z",
    sourceHash: "seed",
    raw: { seed: true },
  });

  const previousUrl = process.env.FIFA_MATCHES_URL;
  process.env.FIFA_MATCHES_URL = "https://fifa.test/matches";

  try {
    await refreshWorldCupData(store, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async () => ({
        ok: true,
        json: async () => [
          {
            IdMatch: "400021464",
            Date: "2026-06-14T17:00:00Z",
            MatchStatus: 1,
            ResultType: 0,
            Home: {
              TeamName: [{ Locale: "en-GB", Description: "Germany" }],
              ShortClubName: "Germany",
            },
            Away: {
              TeamName: [{ Locale: "en-GB", Description: "Curaçao" }],
              ShortClubName: "Curaçao",
            },
            StageName: [{ Locale: "en-GB", Description: "First Stage" }],
            GroupName: [{ Locale: "en-GB", Description: "Group E" }],
          },
        ],
      }),
    });

    const rows = listMatches(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fifaId, "400021464");
  } finally {
    restoreEnv("FIFA_MATCHES_URL", previousUrl);
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

test("refresh caps AI generation per run while still importing all matches", async () => {
  const dbPath = join(tmpdir(), `worldcup-ai-cap-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);
  const store = { driver: "sqlite", client: db };

  const previous = {
    FIFA_MATCHES_URL: process.env.FIFA_MATCHES_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    MAX_INSIGHTS_PER_REFRESH: process.env.MAX_INSIGHTS_PER_REFRESH,
  };
  process.env.FIFA_MATCHES_URL = "https://fifa.test/matches";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://provider.test/v1";
  process.env.AI_MODEL = "mimo-v2.5-pro";
  process.env.MAX_INSIGHTS_PER_REFRESH = "1";

  try {
    const result = await refreshWorldCupData(store, {
      now: new Date("2026-06-14T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("provider.test")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      headline: "赛前预测",
                      shortText: "这是一条结构化预测。双方都有明确的比赛目标。",
                      keyMoments: ["开局节奏", "定位球质量"],
                      tacticalNotes: ["主队压迫", "客队转换"],
                      playersToWatch: ["主队", "客队"],
                      probabilities: { homeWin: 0.4, draw: 0.3, awayWin: 0.3 },
                      confidence: "medium",
                      generatedFor: "prediction",
                    }),
                  },
                },
              ],
            }),
          };
        }

        return {
          ok: true,
          json: async () => [
            {
              IdMatch: "400021464",
              Date: "2026-06-14T17:00:00Z",
              MatchStatus: 1,
              Home: { TeamName: [{ Locale: "en-GB", Description: "Germany" }] },
              Away: { TeamName: [{ Locale: "en-GB", Description: "Curaçao" }] },
            },
            {
              IdMatch: "400021465",
              Date: "2026-06-15T17:00:00Z",
              MatchStatus: 1,
              Home: { TeamName: [{ Locale: "en-GB", Description: "France" }] },
              Away: { TeamName: [{ Locale: "en-GB", Description: "Japan" }] },
            },
          ],
        };
      },
    });

    assert.equal(result.matches, 2);
    assert.equal(result.insightsGenerated, 1);
    assert.equal(listMatches(db).length, 2);
  } finally {
    restoreEnv("FIFA_MATCHES_URL", previous.FIFA_MATCHES_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
    restoreEnv("MAX_INSIGHTS_PER_REFRESH", previous.MAX_INSIGHTS_PER_REFRESH);
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

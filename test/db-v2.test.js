import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getInsight, openDatabase, upsertInsight, upsertMatch } from "../src/db.js";

test("SQLite insights round-trip structured v2 metadata", () => {
  const dbPath = join(tmpdir(), `worldcup-db-v2-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);

  try {
    const columns = db
      .prepare("PRAGMA table_info(insights)")
      .all()
      .map((column) => column.name);
    assert.ok(columns.includes("structured_json"));
    assert.ok(columns.includes("schema_version"));
    assert.ok(columns.includes("official_facts_status"));
    assert.ok(columns.includes("official_facts_hash"));
    assert.ok(columns.includes("completion_notes_json"));
    assert.ok(columns.includes("frozen_at"));
    assert.ok(columns.includes("finalized_at"));

    const match = upsertMatch(db, {
      fifaId: "structured-roundtrip",
      homeTeam: "巴西",
      awayTeam: "摩洛哥",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      groupName: "D组",
      stage: "小组赛",
      venue: "示例体育场",
      city: "示例城市",
      kickoffAt: "2026-06-20T20:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z",
      sourceHash: "match-hash",
      raw: { id: "structured-roundtrip" },
    });

    const structured = {
      schemaVersion: "prediction-v2",
      type: "prediction",
      headline: "巴西小胜机会更高",
      predictedScore: { home: 2, away: 1, label: "2-1" },
    };
    const completionNotes = {
      missingOfficialFields: ["lineups"],
      finalCompletionDueAt: "2026-06-22T20:00:00.000Z",
    };

    upsertInsight(db, match.id, "prediction", {
      insight: {
        headline: "巴西小胜机会更高",
        shortText: "巴西预计会掌握更多控球时间。",
        keyMoments: ["巴西掌握主动", "摩洛哥依靠反击"],
        tacticalNotes: ["巴西边路推进更稳定"],
        playersToWatch: ["巴西前场组合"],
        probabilities: { homeWin: 0.52, draw: 0.25, awayWin: 0.23 },
        confidence: "medium",
        generatedFor: "prediction",
      },
      structured,
      schemaVersion: "prediction-v2",
      officialFactsStatus: "partial",
      officialFactsHash: "facts-hash",
      completionNotes,
      frozenAt: "2026-06-20T20:00:00.000Z",
      finalizedAt: "2026-06-22T20:00:00.000Z",
      model: "test-model",
      promptVersion: "prediction-v2",
      sourceHash: "source-hash",
      generatedAt: "2026-06-16T10:05:00.000Z",
    });

    const insight = getInsight(db, match.id, "prediction");
    assert.equal(insight.headline, "巴西小胜机会更高");
    assert.deepEqual(insight.structured, structured);
    assert.equal(insight.schemaVersion, "prediction-v2");
    assert.equal(insight.officialFactsStatus, "partial");
    assert.equal(insight.officialFactsHash, "facts-hash");
    assert.deepEqual(insight.completionNotes, completionNotes);
    assert.equal(insight.frozenAt, "2026-06-20T20:00:00.000Z");
    assert.equal(insight.finalizedAt, "2026-06-22T20:00:00.000Z");
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

test("SQLite insights ignore malformed optional structured metadata", () => {
  const dbPath = join(tmpdir(), `worldcup-db-v2-malformed-${process.pid}-${Date.now()}.db`);
  const db = openDatabase(dbPath);

  try {
    const match = upsertMatch(db, {
      fifaId: "malformed-structured",
      homeTeam: "西班牙",
      awayTeam: "日本",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      groupName: "E组",
      stage: "小组赛",
      venue: "示例体育场",
      city: "示例城市",
      kickoffAt: "2026-06-21T20:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z",
      sourceHash: "match-hash",
      raw: { id: "malformed-structured" },
    });

    upsertInsight(db, match.id, "prediction", {
      insight: {
        headline: "西班牙控球优势明显",
        shortText: "西班牙预计会控制球权，日本需要提升转换效率。",
        keyMoments: ["西班牙控制中场", "日本等待反击"],
        tacticalNotes: ["西班牙控球更稳定"],
        playersToWatch: ["西班牙中场"],
        probabilities: { homeWin: 0.55, draw: 0.25, awayWin: 0.2 },
        confidence: "medium",
        generatedFor: "prediction",
      },
      model: "test-model",
      promptVersion: "legacy",
      sourceHash: "source-hash",
      generatedAt: "2026-06-16T10:05:00.000Z",
    });

    db.prepare(`
      UPDATE insights
      SET structured_json = ?, completion_notes_json = ?
      WHERE match_id = ? AND type = 'prediction'
    `).run("{not-json", "[also-not-json", match.id);

    const insight = getInsight(db, match.id, "prediction");
    assert.equal(insight.headline, "西班牙控球优势明显");
    assert.deepEqual(insight.probabilities, { homeWin: 0.55, draw: 0.25, awayWin: 0.2 });
    assert.equal(insight.structured, null);
    assert.equal(insight.completionNotes, null);
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

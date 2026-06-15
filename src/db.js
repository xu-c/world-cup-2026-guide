import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path = process.env.DATABASE_PATH || "./data/worldcup.db") {
  const dbPath = resolve(path);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fifa_id TEXT NOT NULL UNIQUE,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      status TEXT NOT NULL,
      group_name TEXT,
      stage TEXT,
      venue TEXT,
      city TEXT,
      kickoff_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('summary', 'prediction')),
      headline TEXT NOT NULL,
      short_text TEXT NOT NULL,
      key_moments_json TEXT NOT NULL,
      tactical_notes_json TEXT NOT NULL,
      players_to_watch_json TEXT NOT NULL,
      probabilities_json TEXT NOT NULL,
      confidence TEXT NOT NULL,
      generated_for TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
      UNIQUE(match_id, type)
    );

    CREATE TABLE IF NOT EXISTS refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      message TEXT
    );
  `);
}

export function upsertMatch(db, match) {
  const values = {
    fifaId: match.fifaId,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore ?? null,
    awayScore: match.awayScore ?? null,
    status: match.status,
    groupName: match.groupName ?? null,
    stage: match.stage ?? null,
    venue: match.venue ?? null,
    city: match.city ?? null,
    kickoffAt: match.kickoffAt,
    updatedAt: match.updatedAt,
    sourceHash: match.sourceHash,
    rawJson: JSON.stringify(match.raw || match),
  };

  db.prepare(`
    INSERT INTO matches (
      fifa_id, home_team, away_team, home_score, away_score, status,
      group_name, stage, venue, city, kickoff_at, updated_at, source_hash, raw_json
    ) VALUES (
      :fifaId, :homeTeam, :awayTeam, :homeScore, :awayScore, :status,
      :groupName, :stage, :venue, :city, :kickoffAt, :updatedAt, :sourceHash, :rawJson
    )
    ON CONFLICT(fifa_id) DO UPDATE SET
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      status = excluded.status,
      group_name = excluded.group_name,
      stage = excluded.stage,
      venue = excluded.venue,
      city = excluded.city,
      kickoff_at = excluded.kickoff_at,
      updated_at = excluded.updated_at,
      source_hash = excluded.source_hash,
      raw_json = excluded.raw_json
  `).run(values);

  return db.prepare("SELECT * FROM matches WHERE fifa_id = ?").get(match.fifaId);
}

export function deleteSeedMatches(db) {
  return db.prepare("DELETE FROM matches WHERE fifa_id LIKE 'seed-%'").run();
}

export function updateMatchDisplayFields(db, fifaId, match) {
  db.prepare(`
    UPDATE matches
    SET
      home_team = :homeTeam,
      away_team = :awayTeam,
      group_name = :groupName,
      stage = :stage,
      venue = :venue,
      city = :city,
      kickoff_at = :kickoffAt,
      updated_at = :updatedAt,
      source_hash = :sourceHash,
      raw_json = :rawJson
    WHERE fifa_id = :fifaId
  `).run({
    fifaId,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    groupName: match.groupName ?? null,
    stage: match.stage ?? null,
    venue: match.venue ?? null,
    city: match.city ?? null,
    kickoffAt: match.kickoffAt,
    updatedAt: match.updatedAt,
    sourceHash: match.sourceHash,
    rawJson: JSON.stringify(match.raw || match),
  });

  return db.prepare("SELECT * FROM matches WHERE fifa_id = ?").get(fifaId);
}

export function listMatches(db) {
  return db
    .prepare(
      `
      SELECT
        m.*,
        s.headline AS summary_headline,
        s.model AS summary_model,
        p.headline AS prediction_headline
        , p.model AS prediction_model
      FROM matches m
      LEFT JOIN insights s ON s.match_id = m.id AND s.type = 'summary'
      LEFT JOIN insights p ON p.match_id = m.id AND p.type = 'prediction'
      ORDER BY m.kickoff_at ASC, m.id ASC
    `,
    )
    .all()
    .map(rowToMatch);
}

export function getMatch(db, id) {
  const row = db.prepare("SELECT * FROM matches WHERE id = ?").get(id);
  if (!row) return null;

  const match = rowToMatch(row);
  match.insights = db
    .prepare("SELECT * FROM insights WHERE match_id = ? ORDER BY generated_at DESC")
    .all(id)
    .map(rowToInsight);
  return match;
}

export function getMatchByFifaId(db, fifaId) {
  const row = db
    .prepare(
      `
      SELECT
        m.*,
        s.headline AS summary_headline,
        s.model AS summary_model,
        p.headline AS prediction_headline
        , p.model AS prediction_model
      FROM matches m
      LEFT JOIN insights s ON s.match_id = m.id AND s.type = 'summary'
      LEFT JOIN insights p ON p.match_id = m.id AND p.type = 'prediction'
      WHERE m.fifa_id = ?
    `,
    )
    .get(fifaId);

  return row ? rowToMatch(row) : null;
}

export function getInsight(db, matchId, type) {
  const row = db
    .prepare("SELECT * FROM insights WHERE match_id = ? AND type = ?")
    .get(matchId, type);
  return row ? rowToInsight(row) : null;
}

export function upsertInsight(db, matchId, type, payload) {
  db.prepare(`
    INSERT INTO insights (
      match_id, type, headline, short_text, key_moments_json, tactical_notes_json,
      players_to_watch_json, probabilities_json, confidence, generated_for, model,
      prompt_version, source_hash, generated_at
    ) VALUES (
      :matchId, :type, :headline, :shortText, :keyMomentsJson, :tacticalNotesJson,
      :playersToWatchJson, :probabilitiesJson, :confidence, :generatedFor, :model,
      :promptVersion, :sourceHash, :generatedAt
    )
    ON CONFLICT(match_id, type) DO UPDATE SET
      headline = excluded.headline,
      short_text = excluded.short_text,
      key_moments_json = excluded.key_moments_json,
      tactical_notes_json = excluded.tactical_notes_json,
      players_to_watch_json = excluded.players_to_watch_json,
      probabilities_json = excluded.probabilities_json,
      confidence = excluded.confidence,
      generated_for = excluded.generated_for,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      source_hash = excluded.source_hash,
      generated_at = excluded.generated_at
  `).run({
    matchId,
    type,
    headline: payload.insight.headline,
    shortText: payload.insight.shortText,
    keyMomentsJson: JSON.stringify(payload.insight.keyMoments),
    tacticalNotesJson: JSON.stringify(payload.insight.tacticalNotes),
    playersToWatchJson: JSON.stringify(payload.insight.playersToWatch),
    probabilitiesJson: JSON.stringify(payload.insight.probabilities),
    confidence: payload.insight.confidence,
    generatedFor: payload.insight.generatedFor,
    model: payload.model,
    promptVersion: payload.promptVersion,
    sourceHash: payload.sourceHash,
    generatedAt: payload.generatedAt,
  });
}

export function startRefreshRun(db, startedAt) {
  const result = db
    .prepare("INSERT INTO refresh_runs (started_at, status) VALUES (?, 'running')")
    .run(startedAt);
  return result.lastInsertRowid;
}

export function finishRefreshRun(db, id, status, message, finishedAt) {
  db.prepare("UPDATE refresh_runs SET status = ?, message = ?, finished_at = ? WHERE id = ?").run(
    status,
    message,
    finishedAt,
    id,
  );
}

export function getLatestRefreshRun(db) {
  return db.prepare("SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1").get();
}

function rowToMatch(row) {
  return {
    id: row.id,
    fifaId: row.fifa_id,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeScore: row.home_score,
    awayScore: row.away_score,
    status: row.status,
    groupName: row.group_name,
    stage: row.stage,
    venue: row.venue,
    city: row.city,
    kickoffAt: row.kickoff_at,
    updatedAt: row.updated_at,
    sourceHash: row.source_hash,
    hasFinalScore: row.status === "finished" && row.home_score !== null && row.away_score !== null,
    summaryHeadline: row.summary_headline,
    summaryModel: row.summary_model,
    predictionHeadline: row.prediction_headline,
    predictionModel: row.prediction_model,
  };
}

function rowToInsight(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    type: row.type,
    headline: row.headline,
    shortText: row.short_text,
    keyMoments: JSON.parse(row.key_moments_json),
    tacticalNotes: JSON.parse(row.tactical_notes_json),
    playersToWatch: JSON.parse(row.players_to_watch_json),
    probabilities: JSON.parse(row.probabilities_json),
    confidence: row.confidence,
    generatedFor: row.generated_for,
    model: row.model,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    generatedAt: row.generated_at,
  };
}

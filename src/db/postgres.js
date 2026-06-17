import { neon } from "@neondatabase/serverless";

import { summaryNeedsRepair } from "../insight-schemas.js";

export async function openDatabase(env = process.env) {
  const sql = neon(env.DATABASE_URL);
  const store = { driver: "postgres", sql };
  await migrate(store);
  return store;
}

export async function migrate({ sql }) {
  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id BIGSERIAL PRIMARY KEY,
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
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS insights (
      id BIGSERIAL PRIMARY KEY,
      match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
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
      UNIQUE(match_id, type)
    )
  `;

  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS structured_json TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS schema_version TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS official_facts_status TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS official_facts_hash TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS completion_notes_json TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS frozen_at TEXT`;
  await sql`ALTER TABLE insights ADD COLUMN IF NOT EXISTS finalized_at TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS refresh_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      message TEXT
    )
  `;
}

export async function upsertMatch({ sql }, match) {
  const rows = await sql`
    INSERT INTO matches (
      fifa_id, home_team, away_team, home_score, away_score, status,
      group_name, stage, venue, city, kickoff_at, updated_at, source_hash, raw_json
    ) VALUES (
      ${match.fifaId},
      ${match.homeTeam},
      ${match.awayTeam},
      ${match.homeScore ?? null},
      ${match.awayScore ?? null},
      ${match.status},
      ${match.groupName ?? null},
      ${match.stage ?? null},
      ${match.venue ?? null},
      ${match.city ?? null},
      ${match.kickoffAt},
      ${match.updatedAt},
      ${match.sourceHash},
      ${JSON.stringify(match.raw || match)}
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
    RETURNING *
  `;

  return rows[0];
}

export async function deleteSeedMatches({ sql }) {
  await sql`DELETE FROM matches WHERE fifa_id LIKE 'seed-%'`;
}

export async function updateMatchDisplayFields({ sql }, fifaId, match) {
  const rows = await sql`
    UPDATE matches
    SET
      home_team = ${match.homeTeam},
      away_team = ${match.awayTeam},
      group_name = ${match.groupName ?? null},
      stage = ${match.stage ?? null},
      venue = ${match.venue ?? null},
      city = ${match.city ?? null},
      kickoff_at = ${match.kickoffAt},
      updated_at = ${match.updatedAt},
      source_hash = ${match.sourceHash},
      raw_json = ${JSON.stringify(match.raw || match)}
    WHERE fifa_id = ${fifaId}
    RETURNING *
  `;

  return rows[0];
}

export async function listMatches({ sql }) {
  const rows = await sql`
    SELECT
      m.*,
      s.headline AS summary_headline,
      s.model AS summary_model,
      s.official_facts_status AS summary_official_facts_status,
      s.structured_json AS summary_structured_json,
      p.headline AS prediction_headline
      , p.model AS prediction_model
    FROM matches m
    LEFT JOIN insights s ON s.match_id = m.id AND s.type = 'summary'
    LEFT JOIN insights p ON p.match_id = m.id AND p.type = 'prediction'
    ORDER BY m.kickoff_at ASC, m.id ASC
  `;

  return rows.map(rowToMatch);
}

export async function getMatch({ sql }, id) {
  const rows = await sql`SELECT * FROM matches WHERE id = ${id}`;
  if (!rows[0]) return null;

  const match = rowToMatch(rows[0]);
  const insights = await sql`
    SELECT * FROM insights WHERE match_id = ${id} ORDER BY generated_at DESC
  `;
  match.insights = insights.map(rowToInsight);
  return match;
}

export async function getMatchByFifaId({ sql }, fifaId) {
  const rows = await sql`
    SELECT
      m.*,
      s.headline AS summary_headline,
      s.model AS summary_model,
      s.official_facts_status AS summary_official_facts_status,
      s.structured_json AS summary_structured_json,
      p.headline AS prediction_headline
      , p.model AS prediction_model
    FROM matches m
    LEFT JOIN insights s ON s.match_id = m.id AND s.type = 'summary'
    LEFT JOIN insights p ON p.match_id = m.id AND p.type = 'prediction'
    WHERE m.fifa_id = ${fifaId}
  `;

  return rows[0] ? rowToMatch(rows[0]) : null;
}

export async function getInsight({ sql }, matchId, type) {
  const rows = await sql`
    SELECT * FROM insights WHERE match_id = ${matchId} AND type = ${type}
  `;
  return rows[0] ? rowToInsight(rows[0]) : null;
}

export async function upsertInsight({ sql }, matchId, type, payload) {
  await sql`
    INSERT INTO insights (
      match_id, type, headline, short_text, key_moments_json, tactical_notes_json,
      players_to_watch_json, probabilities_json, confidence, generated_for, model,
      prompt_version, source_hash, generated_at, structured_json, schema_version,
      official_facts_status, official_facts_hash, completion_notes_json, frozen_at,
      finalized_at
    ) VALUES (
      ${matchId},
      ${type},
      ${payload.insight.headline},
      ${payload.insight.shortText},
      ${JSON.stringify(payload.insight.keyMoments)},
      ${JSON.stringify(payload.insight.tacticalNotes)},
      ${JSON.stringify(payload.insight.playersToWatch)},
      ${JSON.stringify(payload.insight.probabilities)},
      ${payload.insight.confidence},
      ${payload.insight.generatedFor},
      ${payload.model},
      ${payload.promptVersion},
      ${payload.sourceHash},
      ${payload.generatedAt},
      ${optionalJson(payload.structured)},
      ${payload.schemaVersion ?? payload.structured?.schemaVersion ?? null},
      ${payload.officialFactsStatus ?? null},
      ${payload.officialFactsHash ?? null},
      ${optionalJson(payload.completionNotes)},
      ${payload.frozenAt ?? null},
      ${payload.finalizedAt ?? null}
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
      generated_at = excluded.generated_at,
      structured_json = excluded.structured_json,
      schema_version = excluded.schema_version,
      official_facts_status = excluded.official_facts_status,
      official_facts_hash = excluded.official_facts_hash,
      completion_notes_json = excluded.completion_notes_json,
      frozen_at = excluded.frozen_at,
      finalized_at = excluded.finalized_at
  `;
}

export async function startRefreshRun({ sql }, startedAt) {
  const rows = await sql`
    INSERT INTO refresh_runs (started_at, status)
    VALUES (${startedAt}, 'running')
    RETURNING id
  `;
  return rows[0].id;
}

export async function finishRefreshRun({ sql }, id, status, message, finishedAt) {
  await sql`
    UPDATE refresh_runs
    SET status = ${status}, message = ${message}, finished_at = ${finishedAt}
    WHERE id = ${id}
  `;
}

export async function getLatestRefreshRun({ sql }) {
  const rows = await sql`SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1`;
  return rows[0] || null;
}

function rowToMatch(row) {
  return {
    id: Number(row.id),
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
    summaryOfficialFactsStatus: row.summary_official_facts_status,
    summaryNeedsRepair: summaryNeedsRepair({
      structured: parseOptionalJson(row.summary_structured_json),
      officialFactsStatus: row.summary_official_facts_status,
    }),
    predictionHeadline: row.prediction_headline,
    predictionModel: row.prediction_model,
  };
}

function rowToInsight(row) {
  return {
    id: Number(row.id),
    matchId: Number(row.match_id),
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
    structured: parseOptionalJson(row.structured_json),
    schemaVersion: row.schema_version,
    officialFactsStatus: row.official_facts_status,
    officialFactsHash: row.official_facts_hash,
    completionNotes: parseOptionalJson(row.completion_notes_json),
    frozenAt: row.frozen_at,
    finalizedAt: row.finalized_at,
  };
}

function optionalJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseOptionalJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

import * as sqlite from "../db.js";
import * as postgres from "./postgres.js";

export function selectDatabaseDriver(env = process.env) {
  return env.DATABASE_URL ? "postgres" : "sqlite";
}

export async function openStore(env = process.env) {
  if (selectDatabaseDriver(env) === "postgres") {
    return postgres.openDatabase(env);
  }

  return {
    driver: "sqlite",
    client: sqlite.openDatabase(env.DATABASE_PATH),
  };
}

export async function upsertMatch(store, match) {
  if (store.driver === "postgres") return postgres.upsertMatch(store, match);
  return sqlite.upsertMatch(store.client, match);
}

export async function updateMatchDisplayFields(store, fifaId, match) {
  if (store.driver === "postgres") return postgres.updateMatchDisplayFields(store, fifaId, match);
  return sqlite.updateMatchDisplayFields(store.client, fifaId, match);
}

export async function deleteSeedMatches(store) {
  if (store.driver === "postgres") return postgres.deleteSeedMatches(store);
  return sqlite.deleteSeedMatches(store.client);
}

export async function listMatches(store) {
  if (store.driver === "postgres") return postgres.listMatches(store);
  return sqlite.listMatches(store.client);
}

export async function getMatch(store, id) {
  if (store.driver === "postgres") return postgres.getMatch(store, id);
  return sqlite.getMatch(store.client, id);
}

export async function getMatchByFifaId(store, fifaId) {
  if (store.driver === "postgres") return postgres.getMatchByFifaId(store, fifaId);
  return sqlite.getMatchByFifaId(store.client, fifaId);
}

export async function getInsight(store, matchId, type) {
  if (store.driver === "postgres") return postgres.getInsight(store, matchId, type);
  return sqlite.getInsight(store.client, matchId, type);
}

export async function upsertInsight(store, matchId, type, payload) {
  if (store.driver === "postgres") return postgres.upsertInsight(store, matchId, type, payload);
  return sqlite.upsertInsight(store.client, matchId, type, payload);
}

export async function startRefreshRun(store, startedAt) {
  if (store.driver === "postgres") return postgres.startRefreshRun(store, startedAt);
  return sqlite.startRefreshRun(store.client, startedAt);
}

export async function finishRefreshRun(store, id, status, message, finishedAt) {
  if (store.driver === "postgres") {
    return postgres.finishRefreshRun(store, id, status, message, finishedAt);
  }

  return sqlite.finishRefreshRun(store.client, id, status, message, finishedAt);
}

export async function getLatestRefreshRun(store) {
  if (store.driver === "postgres") return postgres.getLatestRefreshRun(store);
  return sqlite.getLatestRefreshRun(store.client);
}

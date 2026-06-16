import { createHash } from "node:crypto";

export async function fetchFifaMatches(fetchImpl = fetch) {
  if (!process.env.FIFA_MATCHES_URL) {
    return seedMatches();
  }

  const response = await fetchImpl(process.env.FIFA_MATCHES_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`FIFA request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return normalizeFifaPayload(payload);
}

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

export function normalizeFifaPayload(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : payload.matches || payload.Matches || payload.results || payload.Results || payload.data || [];

  if (!Array.isArray(candidates)) {
    throw new Error("FIFA payload did not include a match array");
  }

  return candidates.map(normalizeMatch).filter(Boolean);
}

function normalizeMatch(item, index) {
  const home = item.homeTeam || item.HomeTeam || item.home || item.Home || {};
  const away = item.awayTeam || item.AwayTeam || item.away || item.Away || {};
  const kickoff =
    item.kickoffAt || item.Date || item.date || item.MatchDate || item.LocalDate || item.UTCDate;

  const homeTeam = text(
    localized(home.TeamName) ||
      home.ShortClubName ||
      home.name ||
      localized(home.Name) ||
      item.homeTeamName ||
      item.HomeTeamName ||
      item.PlaceHolderA,
  );
  const awayTeam = text(
    localized(away.TeamName) ||
      away.ShortClubName ||
      away.name ||
      localized(away.Name) ||
      item.awayTeamName ||
      item.AwayTeamName ||
      item.PlaceHolderB,
  );
  if (!homeTeam || !awayTeam || !kickoff) return null;

  const homeScore = numeric(item.homeScore ?? item.HomeScore ?? item.HomeTeamScore ?? home.Score);
  const awayScore = numeric(item.awayScore ?? item.AwayScore ?? item.AwayTeamScore ?? away.Score);
  const status = normalizeStatus(item.status || item.Status || item.MatchStatus, homeScore, awayScore);
  const raw = item;

  return {
    fifaId: String(item.id || item.Id || item.matchId || item.MatchId || item.IdMatch || `fifa-${index}`),
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status,
    hasFinalScore: status === "finished" && homeScore !== null && awayScore !== null,
    groupName: text(item.groupName || localized(item.GroupName) || item.Group),
    stage: text(item.stage || localized(item.StageName) || item.Stage),
    venue: text(item.venue || localized(item.Stadium?.Name) || item.Venue),
    city: text(item.city || localized(item.Stadium?.CityName) || item.City),
    kickoffAt: new Date(kickoff).toISOString(),
    updatedAt: new Date(item.updatedAt || item.LastUpdated || Date.now()).toISOString(),
    sourceHash: hash(raw),
    raw,
  };
}

function seedMatches() {
  return [
    {
      fifaId: "seed-mex-rsa-2026-06-11",
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
    },
    {
      fifaId: "seed-usa-par-2026-06-12",
      homeTeam: "美国",
      awayTeam: "巴拉圭",
      homeScore: 4,
      awayScore: 1,
      status: "finished",
      hasFinalScore: true,
      groupName: "D组",
      stage: "小组赛",
      venue: "洛杉矶体育场",
      city: "洛杉矶",
      kickoffAt: "2026-06-13T01:00:00.000Z",
      updatedAt: "2026-06-13T03:15:00.000Z",
    },
    {
      fifaId: "seed-bra-mar-2026-06-14",
      homeTeam: "巴西",
      awayTeam: "摩洛哥",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      hasFinalScore: false,
      groupName: "C组",
      stage: "小组赛",
      venue: "迈阿密体育场",
      city: "迈阿密",
      kickoffAt: "2026-06-14T20:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    },
    {
      fifaId: "seed-aus-tur-2026-06-14",
      homeTeam: "澳大利亚",
      awayTeam: "土耳其",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      hasFinalScore: false,
      groupName: "D组",
      stage: "小组赛",
      venue: "西雅图体育场",
      city: "西雅图",
      kickoffAt: "2026-06-15T03:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    },
    {
      fifaId: "seed-eng-uru-2026-06-20",
      homeTeam: "英格兰",
      awayTeam: "乌拉圭",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      hasFinalScore: false,
      groupName: "E组",
      stage: "小组赛",
      venue: "达拉斯体育场",
      city: "达拉斯",
      kickoffAt: "2026-06-20T22:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    },
  ].map((match) => ({ ...match, sourceHash: hash(match), raw: match }));
}

function normalizeStatus(value, homeScore, awayScore) {
  if (value === 0 && homeScore !== null && awayScore !== null) return "finished";
  if (value === 1) return "scheduled";
  if (value === 3) return "live";

  const normalized = String(value || "").toLowerCase().replaceAll(" ", "_");
  if (["finished", "final", "full_time", "completed"].includes(normalized)) return "finished";
  if (["live", "in_progress", "first_half", "second_half", "halftime"].includes(normalized)) {
    return "live";
  }
  if (homeScore !== null && awayScore !== null && normalized.includes("finish")) return "finished";
  return "scheduled";
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function localized(value) {
  if (!Array.isArray(value)) return text(value);
  const preferred =
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("zh")) ||
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("en")) ||
    value[0];
  return text(preferred?.Description || preferred?.Name || preferred?.Value);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

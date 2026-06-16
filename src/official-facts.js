import { createHash } from "node:crypto";

const EVENT_KEYS = {
  goals: ["Goals"],
  cards: ["Bookings", "Cards"],
  substitutions: ["Substitutions"],
};
const OFFICIAL_FIELD_AVAILABILITY = Symbol("officialFieldAvailability");

export function extractOfficialFacts(match, detail = null) {
  const raw = detail || match.raw || {};
  const home = raw.HomeTeam || raw.Home || {};
  const away = raw.AwayTeam || raw.Away || {};
  const homeName = teamName(home) || match.homeTeam || "主队";
  const awayName = teamName(away) || match.awayTeam || "客队";
  const homeScore = numberOrNull(
    match.homeScore ?? raw.HomeScore ?? raw.HomeTeamScore ?? home.Score,
  );
  const awayScore = numberOrNull(
    match.awayScore ?? raw.AwayScore ?? raw.AwayTeamScore ?? away.Score,
  );
  const playerNames = new Map([
    ...playersForTeam(home).map((player) => [String(player.IdPlayer ?? player.id), playerName(player)]),
    ...playersForTeam(away).map((player) => [String(player.IdPlayer ?? player.id), playerName(player)]),
  ]);

  const availableOfficialFields = {
    goals: hasEventArray(home, EVENT_KEYS.goals) && hasEventArray(away, EVENT_KEYS.goals),
    cards: hasEventArray(home, EVENT_KEYS.cards) && hasEventArray(away, EVENT_KEYS.cards),
    substitutions:
      hasEventArray(home, EVENT_KEYS.substitutions) && hasEventArray(away, EVENT_KEYS.substitutions),
  };

  const facts = {
    result: {
      homeScore,
      awayScore,
      winner: winnerText(homeScore, awayScore, homeName, awayName),
      resultText: `${homeName} ${homeScore ?? "-"}-${awayScore ?? "-"} ${awayName}`,
    },
    officialEvents: {
      goals: [
        ...eventsForTeam(home, homeName, EVENT_KEYS.goals),
        ...eventsForTeam(away, awayName, EVENT_KEYS.goals),
      ].map((event) => ({
        minute: minuteText(event.Minute ?? event.MatchMinute ?? event.Time),
        team: event.team,
        player: playerLookup(playerNames, event.IdPlayer) || text(event.PlayerName) || text(event.ScorerName) || "未知球员",
        assist: playerLookup(playerNames, event.IdAssistPlayer) || text(event.AssistName) || null,
        type: goalType(event.Type ?? event.GoalType),
      })),
      cards: [
        ...eventsForTeam(home, homeName, EVENT_KEYS.cards),
        ...eventsForTeam(away, awayName, EVENT_KEYS.cards),
      ].map((event) => ({
        minute: minuteText(event.Minute ?? event.MatchMinute ?? event.Time),
        team: event.team,
        player: playerLookup(playerNames, event.IdPlayer) || text(event.PlayerName) || "未知球员",
        card: cardType(event.Card ?? event.CardType),
      })),
      substitutions: [
        ...eventsForTeam(home, homeName, EVENT_KEYS.substitutions),
        ...eventsForTeam(away, awayName, EVENT_KEYS.substitutions),
      ].map((event) => ({
        minute: minuteText(event.Minute ?? event.MatchMinute ?? event.Time),
        team: event.team,
        playerOff:
          text(event.PlayerOffName) ||
          playerLookup(playerNames, event.IdPlayerOff ?? event.IdPlayer) ||
          "未知球员",
        playerOn:
          text(event.PlayerOnName) ||
          playerLookup(playerNames, event.IdPlayerOn ?? event.IdSubstitutePlayer) ||
          "未知球员",
      })),
    },
    technicalFacts: {
      formations: {
        home: text(home.Tactics ?? home.Formation),
        away: text(away.Tactics ?? away.Formation),
      },
      attendance: numberOrNull(raw.Attendance ?? match.attendance),
      venue: text(localized(raw.Stadium?.Name)) || text(raw.Venue) || match.venue || null,
      officials: officials(raw),
    },
  };

  Object.defineProperty(facts, OFFICIAL_FIELD_AVAILABILITY, {
    value: availableOfficialFields,
  });

  return facts;
}

export function factsCompleteness(facts) {
  const missingOfficialFields = [];
  const availability = facts[OFFICIAL_FIELD_AVAILABILITY] || {};

  if (!Array.isArray(facts.officialEvents?.goals) || availability.goals === false) {
    missingOfficialFields.push("goals");
  }
  if (!Array.isArray(facts.officialEvents?.cards) || availability.cards === false) {
    missingOfficialFields.push("cards");
  }
  if (!Array.isArray(facts.officialEvents?.substitutions) || availability.substitutions === false) {
    missingOfficialFields.push("substitutions");
  }

  return {
    status: missingOfficialFields.length === 0 ? "complete" : "partial",
    missingOfficialFields,
  };
}

export function officialFactsHash(facts) {
  return createHash("sha256").update(JSON.stringify(sortObject(facts))).digest("hex");
}

function eventsForTeam(team, name, keys) {
  const events = firstArray(team, keys);
  return events.map((event) => ({ ...event, team: name }));
}

function firstArray(value, keys) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function hasEventArray(team, keys) {
  return keys.some((key) => Array.isArray(team?.[key]));
}

function playersForTeam(team) {
  return Array.isArray(team.Players) ? team.Players : [];
}

function playerName(player) {
  return text(player.ShortName) || text(player.PlayerName) || text(localized(player.Name)) || "未知球员";
}

function playerLookup(playerNames, id) {
  if (id === null || id === undefined || id === "") return null;
  return playerNames.get(String(id)) || null;
}

function teamName(team) {
  return text(localized(team.TeamName)) || text(team.ShortClubName) || text(localized(team.Name)) || text(team.Name);
}

function winnerText(homeScore, awayScore, homeName, awayName) {
  if (homeScore === null || awayScore === null) return "未确认";
  if (homeScore > awayScore) return homeName;
  if (awayScore > homeScore) return awayName;
  return "平局";
}

function goalType(value) {
  const code = normalizedCode(value);
  if (code === 1 || code === "own_goal") return "own_goal";
  if (code === 3 || code === "penalty") return "penalty";
  return "goal";
}

function cardType(value) {
  const code = normalizedCode(value);
  if (code === 1 || code === "yellow" || code === "yellow_card") return "yellow";
  if (code === 2 || code === "red" || code === "red_card") return "red";
  if (code === 3 || code === "second_yellow") return "second_yellow";
  return "unknown";
}

function normalizedCode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return normalized;
}

function officials(raw) {
  const items = Array.isArray(raw.Officials) ? raw.Officials : Array.isArray(raw.Referees) ? raw.Referees : [];
  return items
    .map((official) => text(localized(official.Name)) || text(official.DisplayName) || text(official.Name))
    .filter(Boolean);
}

function localized(value) {
  if (!Array.isArray(value)) return value;
  const preferred =
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("zh")) ||
    value.find((item) => String(item.Locale || "").toLowerCase().startsWith("en")) ||
    value[0];
  return preferred?.Description || preferred?.Name || preferred?.Value;
}

function minuteText(value) {
  const minute = text(value);
  return minute || "";
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

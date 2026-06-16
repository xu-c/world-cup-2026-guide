const FINAL_STATUSES = new Set(["finished", "final", "full_time", "completed"]);
const STARTED_STATUSES = new Set([
  "live",
  "in_progress",
  "halftime",
  "finished",
  "final",
  "full_time",
  "completed",
]);
const TWO_DAYS_MINUTES = 2 * 24 * 60;

export function isFinishedMatch(match) {
  return FINAL_STATUSES.has(String(match.status || "").toLowerCase()) && Boolean(match.hasFinalScore);
}

export function isPredictionAllowed({ match, now = new Date() }) {
  const status = String(match.status || "").toLowerCase();
  if (STARTED_STATUSES.has(status)) return false;

  const kickoff = new Date(match.kickoffAt);
  if (!Number.isFinite(kickoff.getTime())) return false;

  return now.getTime() < kickoff.getTime();
}

export function getMatchRefreshPolicy(match, now = new Date()) {
  if (isFinishedMatch(match)) {
    return {
      dataTtlMinutes: null,
      insightTtlMinutes: null,
      reason: "finished_locked",
    };
  }

  const status = String(match.status || "").toLowerCase();
  if (status === "live" || status === "in_progress" || status === "halftime") {
    return {
      dataTtlMinutes: 15,
      insightTtlMinutes: 30,
      reason: "live_match",
    };
  }

  if (isSameUtcDate(new Date(match.kickoffAt), now)) {
    return {
      dataTtlMinutes: 15,
      insightTtlMinutes: 120,
      reason: "same_day_unfinished",
    };
  }

  return {
    dataTtlMinutes: 720,
    insightTtlMinutes: 720,
    reason: "future_low_frequency",
  };
}

export function shouldRefreshMatchData(match, now = new Date()) {
  const policy = getMatchRefreshPolicy(match, now);
  if (policy.dataTtlMinutes === null) return false;
  if (!match.updatedAt) return true;

  return ageInMinutes(match.updatedAt, now) >= policy.dataTtlMinutes;
}

export function shouldGenerateInsight({ match, insightType, existingInsight, now = new Date() }) {
  if (insightType === "summary") {
    return isFinishedMatch(match) && !existingInsight;
  }

  if (insightType !== "prediction" || isFinishedMatch(match) || !isPredictionAllowed({ match, now })) {
    return false;
  }

  if (!existingInsight) return true;

  const policy = getMatchRefreshPolicy(match, now);
  if (policy.insightTtlMinutes === null) return false;

  return ageInMinutes(existingInsight.generatedAt, now) >= policy.insightTtlMinutes;
}

export function insightTypeForMatch(match) {
  return isFinishedMatch(match) ? "summary" : "prediction";
}

export function shouldRefreshPartialSummary({
  match,
  summary,
  latestAttemptAt,
  now = new Date(),
}) {
  if (!isPartialUnfinalizedFinishedSummary({ match, summary })) return false;
  if (shouldRunFinalSummaryCompletion({ match, summary, now })) return true;

  const interval = ageInMinutes(match.kickoffAt, now) >= 24 * 60 ? 720 : 15;
  const anchor = latestAttemptAt || summary.generatedAt;
  if (!anchor) return true;

  return ageInMinutes(anchor, now) >= interval;
}

export function shouldRunFinalSummaryCompletion({ match, summary, now = new Date() }) {
  if (!isPartialUnfinalizedFinishedSummary({ match, summary })) return false;

  const anchor = finalCompletionAnchor(match);
  if (!anchor) return false;

  return ageInMinutes(anchor, now) > TWO_DAYS_MINUTES;
}

function isPartialUnfinalizedFinishedSummary({ match, summary }) {
  return Boolean(
    isFinishedMatch(match) &&
      summary?.officialFactsStatus === "partial" &&
      !summary?.finalizedAt,
  );
}

function finalCompletionAnchor(match) {
  for (const value of [match.finishedAt, match.completedAt, match.endedAt, match.kickoffAt]) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return value;
  }
  return null;
}

function isSameUtcDate(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function ageInMinutes(dateLike, now) {
  return (now.getTime() - new Date(dateLike).getTime()) / 60_000;
}

const FINAL_STATUSES = new Set(["finished", "final", "full_time", "completed"]);

export function isFinishedMatch(match) {
  return FINAL_STATUSES.has(String(match.status || "").toLowerCase()) && Boolean(match.hasFinalScore);
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

  if (insightType !== "prediction" || isFinishedMatch(match)) {
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

import { getMatchRefreshPolicy, isFinishedMatch, shouldRefreshPartialSummary } from "./policies.js";
import { refreshWorldCupData } from "./refresh.js";
import { hasConfiguredAiProvider } from "./ai.js";

const RUNNING_LOCK_MINUTES = 10;

export function shouldStartBackgroundRefresh({ matches, latestRefresh, now = new Date() }) {
  if (!matches || matches.length === 0) {
    return { shouldRefresh: true, reason: "empty_database" };
  }

  if (isRecentRunningRefresh(latestRefresh, now)) {
    return { shouldRefresh: false, reason: "refresh_already_running" };
  }

  for (const match of matches) {
    if (isFinishedMatch(withFinalScoreFlag(match))) {
      if (!match.summaryHeadline) {
        return { shouldRefresh: true, reason: "finished_summary_missing" };
      }
      if (hasConfiguredAiProvider() && match.summaryModel === "local-fallback") {
        return { shouldRefresh: true, reason: "summary_local_fallback" };
      }
      if (match.summaryOfficialFactsStatus === "partial") {
        const latestFinishedAt = refreshFinishedAt(latestRefresh);
        if (shouldRefreshPartialSummary({
          match: withFinalScoreFlag(match),
          summary: {
            officialFactsStatus: match.summaryOfficialFactsStatus,
            generatedAt: match.summaryGeneratedAt,
            finalizedAt: match.summaryFinalizedAt,
          },
          latestAttemptAt: latestFinishedAt,
          now,
        })) {
          return { shouldRefresh: true, reason: "summary_partial" };
        }
      }
      continue;
    }

    if (!match.predictionHeadline) {
      const policy = getMatchRefreshPolicy(match, now);
      const latestFinishedAt = refreshFinishedAt(latestRefresh);
      if (!latestFinishedAt || ageInMinutes(latestFinishedAt, now) >= policy.dataTtlMinutes) {
        return { shouldRefresh: true, reason: "prediction_missing" };
      }
      continue;
    }

    const policy = getMatchRefreshPolicy(match, now);
    const latestFinishedAt = refreshFinishedAt(latestRefresh);
    if (!latestFinishedAt) {
      return { shouldRefresh: true, reason: policy.reason };
    }

    if (ageInMinutes(latestFinishedAt, now) >= policy.dataTtlMinutes) {
      return { shouldRefresh: true, reason: policy.reason };
    }
  }

  return { shouldRefresh: false, reason: "nothing_due" };
}

export function scheduleBackgroundRefresh({
  store,
  matches,
  latestRefresh,
  waitUntil,
  now = new Date(),
}) {
  const decision = shouldStartBackgroundRefresh({ matches, latestRefresh, now });
  if (!decision.shouldRefresh) return decision;

  const work = refreshWorldCupData(store, { now }).catch((error) => {
    console.error("Background refresh failed", error);
  });

  if (typeof waitUntil === "function") {
    waitUntil(work);
  } else {
    setTimeout(() => work, 0);
  }

  return decision;
}

function isRecentRunningRefresh(latestRefresh, now) {
  if (!latestRefresh || latestRefresh.status !== "running") return false;
  const startedAt = latestRefresh.started_at || latestRefresh.startedAt;
  if (!startedAt) return true;
  return ageInMinutes(startedAt, now) < RUNNING_LOCK_MINUTES;
}

function refreshFinishedAt(latestRefresh) {
  return latestRefresh?.finished_at || latestRefresh?.finishedAt || null;
}

function withFinalScoreFlag(match) {
  return {
    ...match,
    hasFinalScore:
      match.hasFinalScore ?? (match.homeScore !== null && match.awayScore !== null),
  };
}

function ageInMinutes(dateLike, now) {
  return (now.getTime() - new Date(dateLike).getTime()) / 60_000;
}

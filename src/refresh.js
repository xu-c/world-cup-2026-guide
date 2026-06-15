import { fetchFifaMatches } from "./fifa.js";
import {
  deleteSeedMatches,
  finishRefreshRun,
  getInsight,
  getMatchByFifaId,
  startRefreshRun,
  updateMatchDisplayFields,
  upsertInsight,
  upsertMatch,
} from "./db/index.js";
import { generateInsight } from "./ai.js";
import { hasConfiguredAiProvider } from "./ai.js";
import { insightTypeForMatch, isFinishedMatch, shouldGenerateInsight } from "./policies.js";

export async function refreshWorldCupData(db, { now = new Date(), fetchImpl = fetch } = {}) {
  const startedAt = now.toISOString();
  const runId = await startRefreshRun(db, startedAt);
  const maxInsights = getMaxInsightsPerRefresh();
  let upserted = 0;
  let insightsGenerated = 0;

  try {
    const matches = await fetchFifaMatches(fetchImpl);
    if (process.env.FIFA_MATCHES_URL) {
      await deleteSeedMatches(db);
    }

    for (const sourceMatch of matches) {
      const existingMatch = await getMatchByFifaId(db, sourceMatch.fifaId);
      const type = insightTypeForMatch(sourceMatch);
      const existingInsight = existingMatch ? await getInsight(db, existingMatch.id, type) : null;

      if (isLockedFinishedMatch(existingMatch, existingInsight)) {
        await updateMatchDisplayFields(db, sourceMatch.fifaId, sourceMatch);
        upserted += 1;
        continue;
      }

      const row = await upsertMatch(db, sourceMatch);
      upserted += 1;

      const match = {
        ...sourceMatch,
        id: row.id,
      };
      const insightForDecision = shouldUpgradeFallbackInsight(existingInsight) ? null : existingInsight;

      if (
        insightsGenerated < maxInsights &&
        shouldGenerateInsight({
          match,
          insightType: type,
          existingInsight: insightForDecision,
          now,
        })
      ) {
        const payload = await generateInsight({ type, match, fetchImpl });
        await upsertInsight(db, row.id, type, {
          ...payload,
          sourceHash: sourceMatch.sourceHash,
          generatedAt: now.toISOString(),
        });
        insightsGenerated += 1;
      }
    }

    const message = `matches=${upserted}; insights=${insightsGenerated}`;
    await finishRefreshRun(db, runId, "success", message, new Date().toISOString());
    return { status: "success", matches: upserted, insightsGenerated };
  } catch (error) {
    await finishRefreshRun(db, runId, "failed", error.message, new Date().toISOString());
    throw error;
  }
}

function isLockedFinishedMatch(match, insight) {
  return Boolean(
    match &&
      isFinishedMatch(match) &&
      match.summaryHeadline &&
      !(hasConfiguredAiProvider() && insight?.model === "local-fallback"),
  );
}

function shouldUpgradeFallbackInsight(insight) {
  return hasConfiguredAiProvider() && insight?.model === "local-fallback";
}

function getMaxInsightsPerRefresh() {
  const configured = Number(process.env.MAX_INSIGHTS_PER_REFRESH || 8);
  if (!Number.isFinite(configured) || configured < 0) return 8;
  return Math.floor(configured);
}

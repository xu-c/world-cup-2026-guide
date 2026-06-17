import { fetchFifaMatchDetail, fetchFifaMatches } from "./fifa.js";
import { extractOfficialFacts, factsCompleteness, officialFactsHash } from "./official-facts.js";
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
import { summaryNeedsRepair } from "./insight-schemas.js";
import {
  insightTypeForMatch,
  isFinishedMatch,
  shouldGenerateInsight,
  shouldRefreshPartialSummary,
  shouldRunFinalSummaryCompletion,
} from "./policies.js";

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

      const preserveFinishedScore = shouldPreserveFinishedScore(existingMatch);
      const row = preserveFinishedScore
        ? await updateMatchDisplayFields(db, sourceMatch.fifaId, sourceMatch)
        : await upsertMatch(db, sourceMatch);
      upserted += 1;

      const match = {
        ...sourceMatch,
        id: row.id,
        ...(preserveFinishedScore
          ? {
              homeScore: existingMatch.homeScore,
              awayScore: existingMatch.awayScore,
              status: existingMatch.status,
              hasFinalScore: existingMatch.hasFinalScore,
            }
          : {}),
      };

      if (insightsGenerated >= maxInsights) {
        continue;
      }

      const insightForDecision = shouldUpgradeFallbackInsight(existingInsight) ? null : existingInsight;
      const summaryContext =
        type === "summary"
          ? await buildSummaryContext({
              db,
              row,
              sourceMatch: match,
              fetchImpl,
            })
          : null;
      const finalCompletion =
        type === "summary" &&
        !summaryContext.detailFetchFailed &&
        shouldRunFinalSummaryCompletion({ match, summary: existingInsight, now });
      const shouldGenerate =
        type === "summary"
          ? (!summaryContext.detailFetchFailed &&
              (finalCompletion ||
                summaryNeedsRegeneration(existingInsight, summaryContext.factsHash, match, now))) ||
            shouldGenerateInsight({
              match,
              insightType: type,
              existingInsight: insightForDecision,
              now,
            })
          : shouldGenerateInsight({
              match,
              insightType: type,
              existingInsight: insightForDecision,
              now,
            });

      if (
        shouldGenerate
      ) {
        const generationMatch =
          type === "summary"
            ? {
                ...match,
                officialFacts: summaryContext.officialFacts,
                summaryOfficialFactsStatus: finalCompletion ? "complete" : summaryContext.completeness.status,
                missingOfficialFields: finalCompletion ? [] : summaryContext.completeness.missingOfficialFields,
                existingPrediction: summaryContext.existingPrediction,
                ...(finalCompletion ? { finalCompletion: true } : {}),
              }
            : match;
        let payload = await generateInsight({
          type,
          match: generationMatch,
          fetchImpl,
          ...(finalCompletion ? { finalCompletion: true } : {}),
        });
        if (type === "summary") {
          payload = normalizeSummaryPayloadForStorage({ payload, summaryContext, finalCompletion });
        }
        await upsertInsight(db, row.id, type, {
          ...payload,
          sourceHash: sourceMatch.sourceHash,
          generatedAt: now.toISOString(),
          ...insightStorageMetadata({ type, match, payload, summaryContext, finalCompletion, now }),
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
      insight?.schemaVersion === "summary-v2" &&
      !summaryNeedsRepair({ structured: insight.structured, officialFactsStatus: insight.officialFactsStatus }) &&
      !(insight?.officialFactsStatus === "partial" && !insight?.finalizedAt) &&
      !(hasConfiguredAiProvider() && insight?.model === "local-fallback"),
  );
}

function shouldPreserveFinishedScore(match) {
  return Boolean(match && isFinishedMatch(match) && match.summaryHeadline);
}

function shouldUpgradeFallbackInsight(insight) {
  return hasConfiguredAiProvider() && insight?.model === "local-fallback";
}

async function buildSummaryContext({ db, row, sourceMatch, fetchImpl }) {
  const detailResult = await fetchMatchDetailResult(sourceMatch.fifaId, fetchImpl);
  const detail = detailResult.ok ? detailResult.detail : null;
  const officialFacts = extractOfficialFacts(sourceMatch, detail);
  const completeness = factsCompleteness(officialFacts);

  return {
    existingPrediction: await getInsight(db, row.id, "prediction"),
    officialFacts,
    completeness,
    factsHash: officialFactsHash(officialFacts),
    detailFetchFailed: !detailResult.ok,
  };
}

async function fetchMatchDetailResult(fifaId, fetchImpl) {
  try {
    return {
      ok: true,
      detail: await fetchFifaMatchDetail(fifaId, fetchImpl),
    };
  } catch {
    return {
      ok: false,
      detail: null,
    };
  }
}

function summaryNeedsRegeneration(existingSummary, factsHash, match, now) {
  if (!existingSummary) return true;
  if (existingSummary.schemaVersion !== "summary-v2") return true;
  if (summaryNeedsRepair({ structured: existingSummary.structured, officialFactsStatus: existingSummary.officialFactsStatus })) {
    return true;
  }
  return Boolean(
    existingSummary.officialFactsStatus === "partial" &&
      existingSummary.officialFactsHash !== factsHash &&
      shouldRefreshPartialSummary({ match, summary: existingSummary, now }),
  );
}

function insightStorageMetadata({ type, match, payload, summaryContext, finalCompletion, now }) {
  if (type !== "summary") {
    return {
      frozenAt: new Date(match.kickoffAt) <= now ? now.toISOString() : null,
    };
  }

  const officialFactsStatus =
    payload.model === "local-fallback"
      ? "partial"
      : finalCompletion
        ? "complete"
        : summaryContext.completeness.status;
  return {
    officialFactsStatus,
    officialFactsHash: summaryContext.factsHash,
    completionNotes: payload.structured?.completionNotes || null,
    finalizedAt: officialFactsStatus === "complete" ? now.toISOString() : null,
  };
}

function normalizeSummaryPayloadForStorage({ payload, summaryContext, finalCompletion }) {
  const officialFactsStatus =
    payload.model === "local-fallback"
      ? "partial"
      : finalCompletion
        ? "complete"
        : summaryContext.completeness.status;
  const missingOfficialFields =
    officialFactsStatus === "complete" ? [] : summaryContext.completeness.missingOfficialFields;

  if (!payload.structured) return payload;

  return {
    ...payload,
    structured: {
      ...payload.structured,
      officialFactsStatus,
      missingOfficialFields,
    },
  };
}

function getMaxInsightsPerRefresh() {
  const configured = Number(process.env.MAX_INSIGHTS_PER_REFRESH || 8);
  if (!Number.isFinite(configured) || configured < 0) return 8;
  return Math.floor(configured);
}

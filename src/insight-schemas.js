const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);
const SUMMARY_STATUS_VALUES = new Set(["complete", "partial"]);
const ALLOWED_TECHNICAL_FACTS = new Set(["formations", "attendance", "venue", "officials"]);

export function validateStructuredInsight(value, expectedType = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("structured insight must be an object");
  }
  if (value.schemaVersion === "prediction-v2") return validatePredictionV2(value, expectedType ?? "prediction");
  if (value.schemaVersion === "summary-v2") return validateSummaryV2(value, expectedType ?? "summary");
  throw new Error(`unknown schemaVersion: ${value.schemaVersion}`);
}

export function summaryNeedsRepair({ structured, officialFactsStatus = null } = {}) {
  if (!structured || structured.schemaVersion !== "summary-v2") return false;
  if (officialFactsStatus && structured.officialFactsStatus && structured.officialFactsStatus !== officialFactsStatus) {
    return true;
  }
  return hasPlaceholderOfficialEventPlayers(structured.officialEvents);
}

export function validatePredictionV2(value, expectedType = "prediction") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prediction-v2 must be an object");
  }

  requireLiteral(value.schemaVersion, "prediction-v2", "schemaVersion");
  requireLiteral(value.type, "prediction", "type");
  requireLiteral(value.generatedFor, expectedType, "generatedFor");

  const prediction = {
    schemaVersion: "prediction-v2",
    type: "prediction",
    headline: requireText(value.headline, "headline", 80),
    shortText: requireText(value.shortText, "shortText", 500),
    predictedScore: validatePredictedScore(value.predictedScore),
    outcomeProbabilities: validateProbabilities(value.outcomeProbabilities, "outcomeProbabilities"),
    matchScript: validateMatchScript(value.matchScript),
    scoreRationale: requireTextArray(value.scoreRationale, "scoreRationale", 1, 4),
    tacticalFactors: requireTextArray(value.tacticalFactors, "tacticalFactors", 1, 4),
    decisiveFactors: requireTextArray(value.decisiveFactors, "decisiveFactors", 1, 4),
    riskFactors: requireTextArray(value.riskFactors, "riskFactors", 1, 4),
    playersToWatch: requireTextArray(value.playersToWatch, "playersToWatch", 1, 4),
    confidence: String(value.confidence || "").toLowerCase(),
    generatedFor: "prediction",
  };

  if (!CONFIDENCE_VALUES.has(prediction.confidence)) {
    throw new Error("confidence must be low, medium, or high");
  }

  return prediction;
}

export function validateSummaryV2(value, expectedType = "summary") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("summary-v2 must be an object");
  }

  requireLiteral(value.schemaVersion, "summary-v2", "schemaVersion");
  requireLiteral(value.type, "summary", "type");
  if (expectedType) requireLiteral(value.type, expectedType, "type");

  const summary = {
    schemaVersion: "summary-v2",
    type: "summary",
    headline: requireText(value.headline, "headline", 80),
    result: validateResult(value.result),
    matchStory: validateMatchStory(value.matchStory),
    officialEvents: validateOfficialEvents(value.officialEvents),
    technicalFacts: validateTechnicalFacts(value.technicalFacts),
    aiAnalysis: validateAiAnalysis(value.aiAnalysis),
    predictionReview: value.predictionReview ? validatePredictionReview(value.predictionReview) : null,
    officialFactsStatus: String(value.officialFactsStatus || ""),
    missingOfficialFields: Array.isArray(value.missingOfficialFields)
      ? value.missingOfficialFields.map((item) => requireText(item, "missingOfficialFields", 80))
      : [],
    completionNotes: validateCompletionNotes(value.completionNotes || {}),
    generatedFor: "summary",
  };

  if (!SUMMARY_STATUS_VALUES.has(summary.officialFactsStatus)) {
    throw new Error("officialFactsStatus must be complete or partial");
  }

  return summary;
}

function validatePredictedScore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("predictedScore must be an object");
  }

  const home = requireNonNegativeInteger(value.home, "predictedScore.home");
  const away = requireNonNegativeInteger(value.away, "predictedScore.away");
  const label = requireText(value.label, "predictedScore.label", 20);
  if (label !== `${home}-${away}`) throw new Error("predictedScore.label must match home-away");

  return { home, away, label };
}

function validateProbabilities(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }

  const probabilities = {
    homeWin: requireProbability(value.homeWin, `${name}.homeWin`),
    draw: requireProbability(value.draw, `${name}.draw`),
    awayWin: requireProbability(value.awayWin, `${name}.awayWin`),
  };
  const total = probabilities.homeWin + probabilities.draw + probabilities.awayWin;
  if (Math.abs(total - 1) > 0.02) {
    throw new Error(`${name} must sum to 1`);
  }

  return probabilities;
}

function validateMatchScript(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("matchScript must be an object");
  }

  return {
    summary: requireText(value.summary, "matchScript.summary", 300),
    firstHalf: requireText(value.firstHalf, "matchScript.firstHalf", 300),
    secondHalf: requireText(value.secondHalf, "matchScript.secondHalf", 300),
  };
}

function validateResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("result must be an object");
  }

  return {
    homeScore: requireNonNegativeInteger(value.homeScore, "result.homeScore"),
    awayScore: requireNonNegativeInteger(value.awayScore, "result.awayScore"),
    winner: requireText(value.winner, "result.winner", 80),
    resultText: requireText(value.resultText, "result.resultText", 120),
  };
}

function validateMatchStory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("matchStory must be an object");
  }

  return {
    summary: requireText(value.summary, "matchStory.summary", 500),
    turningPoint: requireText(value.turningPoint, "matchStory.turningPoint", 300),
    closingPhase: requireText(value.closingPhase, "matchStory.closingPhase", 300),
  };
}

function validateOfficialEvents(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("officialEvents must be an object");
  }

  return {
    goals: Array.isArray(value.goals) ? value.goals.map(validateGoal) : [],
    cards: Array.isArray(value.cards) ? value.cards.map(validateCard) : [],
    substitutions: Array.isArray(value.substitutions) ? value.substitutions.map(validateSubstitution) : [],
  };
}

function hasPlaceholderOfficialEventPlayers(officialEvents) {
  if (!officialEvents || typeof officialEvents !== "object") return false;
  return (
    (Array.isArray(officialEvents.goals) &&
      officialEvents.goals.some((goal) => isPlaceholderOfficialName(goal?.player))) ||
    (Array.isArray(officialEvents.cards) &&
      officialEvents.cards.some((card) => isPlaceholderOfficialName(card?.player))) ||
    (Array.isArray(officialEvents.substitutions) &&
      officialEvents.substitutions.some(
        (substitution) =>
          isPlaceholderOfficialName(substitution?.playerOff) ||
          isPlaceholderOfficialName(substitution?.playerOn),
      ))
  );
}

function validateGoal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("goal must be an object");
  }

  const player = requireText(value.player, "goal.player", 120);
  rejectPlaceholderOfficialName(player, "goal.player");

  return {
    minute: requireText(value.minute, "goal.minute", 40),
    team: requireText(value.team, "goal.team", 120),
    player,
    assist: value.assist === null || value.assist === undefined ? null : requireText(value.assist, "goal.assist", 120),
    type: requireText(value.type || "goal", "goal.type", 40),
  };
}

function validateCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("card must be an object");
  }

  const card = requireText(value.card, "card.card", 40);
  if (!["yellow", "red", "second_yellow", "unknown"].includes(card)) {
    throw new Error(`unsupported card value: ${card}`);
  }
  const player = requireText(value.player, "card.player", 120);
  rejectPlaceholderOfficialName(player, "card.player");

  return {
    minute: requireText(value.minute, "card.minute", 40),
    team: requireText(value.team, "card.team", 120),
    player,
    card,
  };
}

function validateSubstitution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("substitution must be an object");
  }

  const playerOff = requireText(value.playerOff, "substitution.playerOff", 120);
  const playerOn = requireText(value.playerOn, "substitution.playerOn", 120);
  rejectPlaceholderOfficialName(playerOff, "substitution.playerOff");
  rejectPlaceholderOfficialName(playerOn, "substitution.playerOn");

  return {
    minute: requireText(value.minute, "substitution.minute", 40),
    team: requireText(value.team, "substitution.team", 120),
    playerOff,
    playerOn,
  };
}

function rejectPlaceholderOfficialName(value, name) {
  if (isPlaceholderOfficialName(value)) {
    throw new Error(`placeholder official event player: ${name}`);
  }
}

function isPlaceholderOfficialName(value) {
  const text = String(value || "").trim();
  return (
    text === "[object Object]" ||
    text === "未知球员" ||
    text === "未提供" ||
    text === "未提供姓名" ||
    text === "未提供具体球员" ||
    text === "官方数据未提供具体球员" ||
    /^(主队|客队|.+队)球员$/u.test(text) ||
    /^(墨西哥|南非|荷兰|日本|科特迪瓦|厄瓜多尔|比利时|埃及|瑞典|突尼斯|伊拉克|挪威|美国|巴拉圭|澳大利亚|土耳其|法国|塞内加尔)球员$/u.test(text)
  );
}

function validateTechnicalFacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("technicalFacts must be an object");
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_TECHNICAL_FACTS.has(key)) throw new Error(`unsupported technicalFacts field: ${key}`);
  }

  return {
    formations: validateFormations(value.formations || {}),
    attendance: value.attendance === null || value.attendance === undefined ? null : requireNonNegativeInteger(value.attendance, "technicalFacts.attendance"),
    venue: value.venue === null || value.venue === undefined ? null : requireText(value.venue, "technicalFacts.venue", 160),
    officials: Array.isArray(value.officials)
      ? value.officials.map((item) => requireText(item, "technicalFacts.officials", 120))
      : [],
  };
}

function validateFormations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("technicalFacts.formations must be an object");
  }

  return {
    home: value.home === null || value.home === undefined ? null : requireText(value.home, "technicalFacts.formations.home", 40),
    away: value.away === null || value.away === undefined ? null : requireText(value.away, "technicalFacts.formations.away", 40),
  };
}

function validateAiAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("aiAnalysis must be an object");
  }

  return {
    tacticalSummary: requireTextArray(value.tacticalSummary, "aiAnalysis.tacticalSummary", 1, 4),
    keyPlayerImpact: requireTextArray(value.keyPlayerImpact || [], "aiAnalysis.keyPlayerImpact", 0, 4),
    resultExplanation: requireTextArray(value.resultExplanation, "aiAnalysis.resultExplanation", 1, 4),
  };
}

function validatePredictionReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("predictionReview must be an object");
  }

  return {
    predictedScore: requireText(value.predictedScore, "predictionReview.predictedScore", 20),
    actualScore: requireText(value.actualScore, "predictionReview.actualScore", 20),
    scoreHit: Boolean(value.scoreHit),
    outcomeHit: Boolean(value.outcomeHit),
    preMatchProbabilities: validateProbabilities(value.preMatchProbabilities, "predictionReview.preMatchProbabilities"),
    reviewText: requireText(value.reviewText, "predictionReview.reviewText", 500),
  };
}

function validateCompletionNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, note]) => {
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        throw new Error(`completionNotes.${key} must be an object`);
      }

      return [
        key,
        {
          source: requireText(note.source, `completionNotes.${key}.source`, 80),
          label: requireText(note.label, `completionNotes.${key}.label`, 80),
        },
      ];
    }),
  );
}

function requireLiteral(value, expected, name) {
  if (value !== expected) throw new Error(`${name} must be ${expected}`);
}

function requireText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be text`);
  return value.trim().slice(0, maxLength);
}

function requireTextArray(value, name, min, max) {
  if (!Array.isArray(value) || value.length < min) {
    throw new Error(`${name} must contain at least ${min} items`);
  }

  return value.slice(0, max).map((item) => requireText(item, name, 180));
}

function requireNonNegativeInteger(value, name) {
  const number = requireFiniteNumber(value, name);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
}

function requireProbability(value, name) {
  const number = requireFiniteNumber(value, name);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be between 0 and 1`);
  return number;
}

function requireFiniteNumber(value, name) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${name} must be a finite number`);
    const number = Number(trimmed);
    if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
    return number;
  }

  throw new Error(`${name} must be a finite number`);
}

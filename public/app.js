let currentDateKey = null;
let matches = [];
let selectedMatchId = null;
let latestMatchesSignature = "";
let pendingWheelDelta = 0;
let wheelAnimationFrame = null;
let softRefreshTimer = null;
let softRefreshInFlight = false;

const ACTIVE_REFRESH_INTERVAL_MS = 60_000;
const IDLE_REFRESH_INTERVAL_MS = 5 * 60_000;
const CARD_TYPE_LABELS = {
  yellow: "黄牌",
  red: "红牌",
  second_yellow: "两黄变红",
  unknown: "牌型暂缺",
};

const matchesEl = document.querySelector("#matches");
const detailEl = document.querySelector("#detail");
const dateNavEl = document.querySelector("#dateNav");

dateNavEl.addEventListener(
  "wheel",
  (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    const lineHeight = 16;
    const pageWidth = dateNavEl.clientWidth || 1;
    const deltaScale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? lineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? pageWidth
          : 1;
    pendingWheelDelta += event.deltaY * deltaScale;

    if (wheelAnimationFrame !== null) return;
    wheelAnimationFrame = requestAnimationFrame(() => {
      dateNavEl.scrollLeft += pendingWheelDelta;
      pendingWheelDelta = 0;
      wheelAnimationFrame = null;
    });
  },
  { passive: false },
);

await loadMatches();
scheduleSoftRefresh();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSoftRefresh();
});

async function loadMatches() {
  const response = await fetch("/api/matches");
  const data = await response.json();
  applyMatchData(data);
}

function applyMatchData(data, options = {}) {
  const previousDateKey = currentDateKey;
  const previousSelectedMatchId = selectedMatchId;
  matches = data.matches;
  latestMatchesSignature = matchDataSignature(data);

  if (options.preserveSelection) {
    preserveCurrentSelection(previousDateKey, previousSelectedMatchId);
  } else {
    initializeCurrentDate();
  }

  renderDateNav();
  renderMatches();
}

async function refreshMatchesIfChanged() {
  if (softRefreshInFlight) return;
  if (document.visibilityState === "hidden") {
    scheduleSoftRefresh();
    return;
  }

  softRefreshInFlight = true;
  try {
    const response = await fetch("/api/matches");
    const data = await response.json();
    const nextSignature = matchDataSignature(data);
    if (nextSignature !== latestMatchesSignature) {
      applyMatchData(data, { preserveSelection: true });
    }
  } catch (error) {
    console.error("Soft refresh failed", error);
  } finally {
    softRefreshInFlight = false;
    scheduleSoftRefresh();
  }
}

function scheduleSoftRefresh() {
  if (softRefreshTimer) clearTimeout(softRefreshTimer);
  const interval = shouldPollActively() ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
  softRefreshTimer = setTimeout(refreshMatchesIfChanged, interval);
}

function renderMatches() {
  const visible = visibleMatches();
  matchesEl.innerHTML = "";

  if (visible.length === 0) {
    matchesEl.innerHTML = `<p>没有符合条件的比赛。</p>`;
    detailEl.innerHTML = "";
    return;
  }

  for (const match of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `match-card${match.id === selectedMatchId ? " selected" : ""}`;
    button.dataset.matchId = String(match.id);
    button.innerHTML = `
      <div class="meta">
        <span>${escapeHtml(match.groupName || match.stage || "世界杯")}</span>
        <span>${formatDateTime(match.kickoffAt)}</span>
      </div>
      <div class="teams">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
      <div class="score">${scoreText(match)}</div>
      <div class="badge-row">
        <span class="badge">${statusText(match)}</span>
        ${match.summaryHeadline ? `<span class="badge">已有总结</span>` : ""}
        ${
          match.status !== "finished" && match.predictionHeadline
            ? `<span class="badge">已有预测</span>`
            : ""
        }
      </div>
    `;
    button.addEventListener("click", () => loadDetail(match.id, { reveal: true }));
    matchesEl.append(button);
  }

  const selectedStillVisible = visible.some((match) => match.id === selectedMatchId);
  if (!selectedMatchId || !selectedStillVisible) {
    selectedMatchId = visible[0].id;
  }
  loadDetail(selectedMatchId);
}

async function loadDetail(id, options = {}) {
  selectedMatchId = id;
  markSelectedCard(id);
  const response = await fetch(`/api/matches/${id}`);
  const data = await response.json();
  if (!response.ok) {
    detailEl.innerHTML = `<p>${escapeHtml(data.error || "读取失败")}</p>`;
    return;
  }

  const match = data.match;
  const insight = match.insights[0];
  detailEl.innerHTML = `
    <article class="detail-card">
      <button class="detail-close" type="button" aria-label="关闭详情">×</button>
      <div class="meta">${escapeHtml(match.venue || "")} ${escapeHtml(match.city || "")}</div>
      <h2>${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</h2>
      <div class="score">${scoreText(match)}</div>
      ${
        insight
          ? renderInsight(insight)
          : `<p>这场比赛的分析内容正在准备中。</p>`
      }
    </article>
  `;
  detailEl.classList.toggle("open", Boolean(options.reveal));
  detailEl.querySelector(".detail-close")?.addEventListener("click", () => {
    detailEl.classList.remove("open");
  });

  if (options.reveal && window.matchMedia("(max-width: 860px)").matches) {
    detailEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function renderDateNav() {
  const dateGroups = buildDateGroups();
  dateNavEl.innerHTML = "";

  for (const group of dateGroups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `date-pill${group.key === currentDateKey ? " active" : ""}`;
    button.dataset.dateKey = group.key;
    button.innerHTML = `
      <span>${escapeHtml(group.label)}</span>
      <strong>${escapeHtml(group.weekday)}</strong>
      <small>${group.count} 场</small>
    `;
    button.addEventListener("click", () => {
      currentDateKey = group.key;
      selectedMatchId = firstVisibleMatch()?.id ?? null;
      renderDateNav();
      renderMatches();
      button.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
    dateNavEl.append(button);
  }

  dateNavEl
    .querySelector(`[data-date-key="${currentDateKey}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderInsight(insight) {
  if (
    insight.structured?.schemaVersion === "prediction-v2" &&
    canRenderStructuredPrediction(insight.structured)
  ) {
    return renderStructuredPrediction(insight.structured);
  }
  if (
    insight.structured?.schemaVersion === "summary-v2" &&
    canRenderStructuredSummary(insight.structured)
  ) {
    return renderStructuredSummary(insight.structured);
  }
  return renderLegacyInsight(insight);
}

function renderLegacyInsight(insight) {
  return `
    <div class="grid">
      <section class="panel">
        <h3>${insight.type === "summary" ? "赛后总结" : "赛前预测"}</h3>
        <strong>${escapeHtml(insight.headline)}</strong>
        <p>${escapeHtml(insight.shortText)}</p>
      </section>
      <section class="panel">
        <h3>关键点</h3>
        <ul>${insight.keyMoments.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel">
        <h3>战术观察</h3>
        <ul>${insight.tacticalNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel probabilities">
        <h3>概率</h3>
        ${probabilityRow("主胜", insight.probabilities.homeWin)}
        ${probabilityRow("平局", insight.probabilities.draw)}
        ${probabilityRow("客胜", insight.probabilities.awayWin)}
      </section>
    </div>
  `;
}

function renderStructuredPrediction(prediction) {
  return `
    <div class="grid insight-grid">
      <section class="panel prediction-hero">
        <h3>赛前预测</h3>
        <strong>${escapeHtml(prediction.headline)}</strong>
        <p>${escapeHtml(prediction.shortText)}</p>
        <div class="predicted-score">
          <span>比分预测</span>
          <strong>${escapeHtml(prediction.predictedScore.label)}</strong>
        </div>
      </section>
      <section class="panel probabilities">
        <h3>胜平负概率</h3>
        ${probabilityRow("主胜", prediction.outcomeProbabilities.homeWin)}
        ${probabilityRow("平局", prediction.outcomeProbabilities.draw)}
        ${probabilityRow("客胜", prediction.outcomeProbabilities.awayWin)}
      </section>
      <section class="panel">
        <h3>比赛走势</h3>
        <p>${escapeHtml(prediction.matchScript.summary)}</p>
        <ul>
          <li>${escapeHtml(prediction.matchScript.firstHalf)}</li>
          <li>${escapeHtml(prediction.matchScript.secondHalf)}</li>
        </ul>
      </section>
      <section class="panel">
        <h3>预测依据</h3>
        <ul>${prediction.scoreRationale.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel">
        <h3>关键因素</h3>
        <ul>${prediction.decisiveFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
      <section class="panel subtle-panel">
        <h3>风险因素</h3>
        <ul>${prediction.riskFactors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </div>
  `;
}

function renderStructuredSummary(summary) {
  const partialBadge =
    summary.officialFactsStatus === "partial"
      ? `<span class="status-chip muted" title="部分官方事件数据可能稍后补齐，系统会按刷新间隔自动更新。">官方数据补全中</span>`
      : "";

  return `
    <div class="grid insight-grid">
      <section class="panel summary-hero">
        <h3>赛后总结 ${partialBadge}</h3>
        <strong>${escapeHtml(summary.headline)}</strong>
        <p>${escapeHtml(summary.matchStory.summary)}</p>
      </section>
      <section class="panel">
        <h3>比赛脉络</h3>
        <ul>
          <li>${escapeHtml(summary.matchStory.turningPoint)}</li>
          <li>${escapeHtml(summary.matchStory.closingPhase)}</li>
        </ul>
      </section>
      <section class="panel">
        <h3>官方事件</h3>
        <h4>进球</h4>
        ${renderEventList(
          summary.officialEvents.goals,
          (goal) =>
            `${escapeHtml(goal.minute)} ${escapeHtml(goal.team)} ${personName(goal.player)}${
              goal.assist ? ` · 助攻 ${personName(goal.assist)}` : ""
            }`,
        )}
        <h4>红黄牌</h4>
        ${renderEventList(
          summary.officialEvents.cards,
          (card) =>
            `${escapeHtml(card.minute)} ${escapeHtml(card.team)} ${personName(card.player)} ${escapeHtml(formatCardType(card.card))}`,
        )}
        <h4>换人</h4>
        ${renderEventList(
          summary.officialEvents.substitutions,
          (substitution) =>
            `${escapeHtml(substitution.minute)} ${escapeHtml(substitution.team)} ${personName(
              substitution.playerOn,
            )} 换下 ${personName(substitution.playerOff)}`,
        )}
      </section>
      <section class="panel">
        <h3>官方技术事实</h3>
        ${renderTechnicalFacts(summary)}
      </section>
      <section class="panel">
        <h3>AI 赛后分析</h3>
        ${renderAnalysisList("战术", summary.aiAnalysis.tacticalSummary)}
        ${renderAnalysisList("球员影响", summary.aiAnalysis.keyPlayerImpact)}
        ${renderAnalysisList("赛果解释", summary.aiAnalysis.resultExplanation)}
      </section>
      ${summary.predictionReview ? renderPredictionReview(summary.predictionReview) : ""}
    </div>
  `;
}

function renderEventList(items, formatter) {
  if (!items || items.length === 0) return `<p class="muted-text">暂无官方事件记录</p>`;
  return `<ul>${items.map((item) => `<li>${formatter(item)}</li>`).join("")}</ul>`;
}

function renderAnalysisList(label, items) {
  if (!items || items.length === 0) return "";
  return `
    <h4>${escapeHtml(label)}</h4>
    <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
}

function renderTechnicalFacts(summary) {
  const facts = summary.technicalFacts;
  const officials = Array.isArray(facts.officials) ? facts.officials : [];
  return `
    <dl class="facts-list">
      <dt>阵型</dt>
      <dd>${escapeHtml(facts.formations?.home || "暂缺")} - ${escapeHtml(facts.formations?.away || "暂缺")} ${renderCompletionNote(summary, "formations")}</dd>
      <dt>场馆</dt>
      <dd>${escapeHtml(facts.venue || "暂缺")} ${renderCompletionNote(summary, "venue")}</dd>
      <dt>上座人数</dt>
      <dd>${escapeHtml(String(facts.attendance ?? "暂缺"))} ${renderCompletionNote(summary, "attendance")}</dd>
      <dt>裁判</dt>
      <dd>${officials.length ? officials.map((official) => personName(official)).join("、") : "暂缺"} ${renderCompletionNote(summary, "officials")}</dd>
    </dl>
  `;
}

function formatCardType(cardType) {
  return CARD_TYPE_LABELS[cardType] || CARD_TYPE_LABELS.unknown;
}

function personName(value) {
  return `<span class="person-name">${escapeHtml(value)}</span>`;
}

function renderCompletionNote(summary, key) {
  const note = summary.completionNotes?.[key];
  if (!note) return "";
  if (note.source === "official") return "";
  const label = note.source === "ai" ? "AI 辅助确认" : "官方数据缺失";
  return `<span class="status-chip muted" title="${escapeHtml(note.label)}">${label}</span>`;
}

function renderPredictionReview(review) {
  return `
    <section class="panel subtle-panel prediction-review">
      <h3>赛前预测回看</h3>
      <p>预测比分 ${escapeHtml(review.predictedScore)} · 实际比分 ${escapeHtml(review.actualScore)}</p>
      <p>${review.scoreHit ? "比分命中" : "比分未命中"} · ${
        review.outcomeHit ? "赛果方向命中" : "赛果方向未命中"
      }</p>
      <div class="probabilities compact">
        <h4>赛前预测</h4>
        ${probabilityRow("主胜", review.preMatchProbabilities.homeWin)}
        ${probabilityRow("平局", review.preMatchProbabilities.draw)}
        ${probabilityRow("客胜", review.preMatchProbabilities.awayWin)}
      </div>
      <p>${escapeHtml(review.reviewText)}</p>
    </section>
  `;
}

function probabilityRow(label, value) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) * 100)));
  return `
    <div>
      <div class="meta">${label} ${percent}%</div>
      <div class="bar"><span style="width: ${percent}%"></span></div>
    </div>
  `;
}

function canRenderStructuredPrediction(prediction) {
  return (
    isObject(prediction) &&
    hasRenderableText(prediction.headline) &&
    hasRenderableText(prediction.shortText) &&
    isObject(prediction.predictedScore) &&
    hasRenderableText(prediction.predictedScore.label) &&
    hasRenderableProbabilities(prediction.outcomeProbabilities) &&
    isObject(prediction.matchScript) &&
    hasRenderableText(prediction.matchScript.summary) &&
    hasRenderableText(prediction.matchScript.firstHalf) &&
    hasRenderableText(prediction.matchScript.secondHalf) &&
    hasRenderableList(prediction.scoreRationale) &&
    hasRenderableList(prediction.decisiveFactors) &&
    hasRenderableList(prediction.riskFactors)
  );
}

function canRenderStructuredSummary(summary) {
  return (
    isObject(summary) &&
    hasRenderableText(summary.headline) &&
    isObject(summary.matchStory) &&
    hasRenderableText(summary.matchStory.summary) &&
    hasRenderableText(summary.matchStory.turningPoint) &&
    hasRenderableText(summary.matchStory.closingPhase) &&
    isObject(summary.officialEvents) &&
    Array.isArray(summary.officialEvents.goals) &&
    Array.isArray(summary.officialEvents.cards) &&
    Array.isArray(summary.officialEvents.substitutions) &&
    isObject(summary.technicalFacts) &&
    Array.isArray(summary.technicalFacts.officials) &&
    isObject(summary.aiAnalysis) &&
    Array.isArray(summary.aiAnalysis.tacticalSummary) &&
    Array.isArray(summary.aiAnalysis.keyPlayerImpact) &&
    Array.isArray(summary.aiAnalysis.resultExplanation) &&
    canRenderPredictionReview(summary.predictionReview)
  );
}

function canRenderPredictionReview(review) {
  if (!review) return true;
  return (
    isObject(review) &&
    hasRenderableText(review.predictedScore) &&
    hasRenderableText(review.actualScore) &&
    hasRenderableProbabilities(review.preMatchProbabilities) &&
    hasRenderableText(review.reviewText)
  );
}

function hasRenderableProbabilities(probabilities) {
  return (
    isObject(probabilities) &&
    Number.isFinite(Number(probabilities.homeWin)) &&
    Number.isFinite(Number(probabilities.draw)) &&
    Number.isFinite(Number(probabilities.awayWin))
  );
}

function hasRenderableList(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasRenderableText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scoreText(match) {
  if (match.homeScore === null || match.awayScore === null) return "未完赛";
  return `${match.homeScore} - ${match.awayScore}`;
}

function statusText(match) {
  const status = match.status;
  if (status === "finished") return "已完赛";
  if (status === "live") return "进行中";
  if (isFutureMatch(match.kickoffAt)) return "未开赛";
  return "未完赛";
}

function isFutureMatch(kickoffAt) {
  if (!kickoffAt) return false;
  const kickoffDate = dateKey(new Date(kickoffAt));
  const today = dateKey(new Date());
  return kickoffDate > today;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function initializeCurrentDate() {
  const dateGroups = buildDateGroups();
  if (dateGroups.length === 0) return;

  const todayKey = dateKey(new Date());
  const today = dateGroups.find((group) => group.key === todayKey);
  const next = dateGroups.find((group) => group.key > todayKey);
  currentDateKey = (today || next || dateGroups[0]).key;
  selectedMatchId = firstVisibleMatch()?.id ?? null;
}

function preserveCurrentSelection(previousDateKey, previousSelectedMatchId) {
  const dateGroups = buildDateGroups();
  if (dateGroups.length === 0) {
    currentDateKey = null;
    selectedMatchId = null;
    return;
  }

  const previousDateStillExists = dateGroups.some((group) => group.key === previousDateKey);
  if (previousDateStillExists) {
    currentDateKey = previousDateKey;
  } else {
    initializeCurrentDate();
  }

  const selectedStillExists = visibleMatches().some((match) => match.id === previousSelectedMatchId);
  selectedMatchId = selectedStillExists ? previousSelectedMatchId : firstVisibleMatch()?.id ?? null;
}

function buildDateGroups() {
  const groups = new Map();
  for (const match of matches) {
    const key = dateKey(new Date(match.kickoffAt));
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        count: 0,
        label: formatDateLabel(match.kickoffAt),
        weekday: formatWeekday(match.kickoffAt),
      });
    }
    groups.get(key).count += 1;
  }

  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function visibleMatches() {
  return matches.filter((match) => dateKey(new Date(match.kickoffAt)) === currentDateKey);
}

function firstVisibleMatch() {
  return visibleMatches()[0] || null;
}

function shouldPollActively() {
  return visibleMatches().some((match) => match.status !== "finished");
}

function matchDataSignature(data) {
  return JSON.stringify(
    data.matches.map((match) => [
      match.id,
      match.status,
      match.homeScore,
      match.awayScore,
      match.sourceHash,
      match.summaryHeadline,
      match.predictionHeadline,
    ]),
  );
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const key = dateKey(new Date(value));
  if (key === dateKey(new Date())) return "今天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markSelectedCard(id) {
  document.querySelectorAll(".match-card").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.matchId) === id);
  });
}

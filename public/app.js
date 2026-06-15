let currentFilter = "all";
let currentDateKey = null;
let matches = [];
let selectedMatchId = null;
let pendingWheelDelta = 0;
let wheelAnimationFrame = null;

const matchesEl = document.querySelector("#matches");
const detailEl = document.querySelector("#detail");
const dateNavEl = document.querySelector("#dateNav");

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    currentFilter = button.dataset.filter;
    selectedMatchId = firstVisibleMatch()?.id ?? null;
    renderMatches();
  });
});

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

async function loadMatches() {
  const response = await fetch("/api/matches");
  const data = await response.json();
  matches = data.matches;
  initializeCurrentDate();
  renderDateNav();
  renderMatches();
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
        <span class="badge">${statusText(match.status)}</span>
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

function probabilityRow(label, value) {
  const percent = Math.round(value * 100);
  return `
    <div>
      <div class="meta">${label} ${percent}%</div>
      <div class="bar"><span style="width: ${percent}%"></span></div>
    </div>
  `;
}

function scoreText(match) {
  if (match.homeScore === null || match.awayScore === null) return "未开赛";
  return `${match.homeScore} - ${match.awayScore}`;
}

function statusText(status) {
  if (status === "finished") return "已完赛";
  if (status === "live") return "进行中";
  return "未开赛";
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
  return matches.filter(
    (match) =>
      dateKey(new Date(match.kickoffAt)) === currentDateKey &&
      (currentFilter === "all" || match.status === currentFilter),
  );
}

function firstVisibleMatch() {
  return visibleMatches()[0] || null;
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

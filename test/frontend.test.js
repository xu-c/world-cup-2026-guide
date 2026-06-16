import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("date wheel scrolling is batched into animation frames", () => {
  assert.match(appSource, /requestAnimationFrame/);
  assert.match(appSource, /pendingWheelDelta/);
});

test("finished matches do not render prediction badges", () => {
  assert.match(
    appSource,
    /match\.status !== "finished"[\s\S]*match\.predictionHeadline[\s\S]*已有预测/,
  );
});

test("unfinished match wording replaces unstarted wording", () => {
  assert.match(appSource, /return "未完赛"/);
  assert.match(appSource, /return "进行中"/);
  assert.doesNotMatch(indexSource, /未开赛/);
  assert.doesNotMatch(appSource, /未开赛/);
});

test("date navigation is the only match list control", () => {
  assert.doesNotMatch(indexSource, /class="toolbar"/);
  assert.doesNotMatch(indexSource, /class="filter/);
  assert.doesNotMatch(appSource, /currentFilter/);
  assert.doesNotMatch(appSource, /querySelectorAll\("\.filter"\)/);
});

test("page soft-refreshes match data without reloading", () => {
  assert.match(appSource, /ACTIVE_REFRESH_INTERVAL_MS = 60_000/);
  assert.match(appSource, /document\.visibilityState === "hidden"/);
  assert.match(appSource, /matchDataSignature/);
  assert.match(appSource, /applyMatchData\(data, \{ preserveSelection: true \}\)/);
  assert.doesNotMatch(appSource, /location\.reload/);
});

test("page declares favicon and browser metadata", () => {
  assert.match(indexSource, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/);
  assert.match(indexSource, /<meta name="theme-color" content="#0d704c" \/>/);
  assert.match(indexSource, /name="description"/);
});

test("page includes footer copyright and source attribution", () => {
  assert.match(indexSource, /<footer class="site-footer">/);
  assert.match(indexSource, /© 2026 World Cup 2026 Guide/);
  assert.match(indexSource, /非官方观赛指南/);
  assert.match(indexSource, /FIFA 官方公开赛程接口/);
});

test("favicon is an SVG icon asset", () => {
  const faviconSource = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(faviconSource, /<svg/);
  assert.match(faviconSource, /viewBox="0 0 64 64"/);
  assert.match(faviconSource, /<title>足球图标<\/title>/);
  assert.match(faviconSource, /class="soccer-panel"/);
  assert.match(faviconSource, /class="soccer-seam"/);
});

test("frontend renders structured prediction score and rationale", () => {
  assert.match(appSource, /renderStructuredPrediction/);
  assert.match(appSource, /predictedScore/);
  assert.match(appSource, /比分预测/);
  assert.match(appSource, /预测依据/);
  assert.match(appSource, /风险因素/);
});

test("frontend renders summary partial and field-level completion markers", () => {
  assert.match(appSource, /官方数据补全中/);
  assert.match(appSource, /AI 辅助确认/);
  assert.match(appSource, /官方数据缺失/);
  assert.match(appSource, /renderCompletionNote/);
});

test("frontend renders post-match prediction review as secondary content", () => {
  assert.match(appSource, /predictionReview/);
  assert.match(appSource, /赛前预测回看/);
  assert.match(appSource, /赛前预测/);
});

test("frontend guards structured prediction before v2 rendering", () => {
  assert.match(appSource, /canRenderStructuredPrediction/);
  assert.match(
    appSource,
    /insight\.structured\?\.schemaVersion === "prediction-v2"[\s\S]*canRenderStructuredPrediction\(insight\.structured\)/,
  );
});

test("frontend guards structured summary before v2 rendering", () => {
  assert.match(appSource, /canRenderStructuredSummary/);
  assert.match(
    appSource,
    /insight\.structured\?\.schemaVersion === "summary-v2"[\s\S]*canRenderStructuredSummary\(insight\.structured\)/,
  );
});

test("frontend escapes official attendance values", () => {
  assert.match(appSource, /escapeHtml\(String\(facts\.attendance \?\? "暂缺"\)\)/);
});

test("frontend guards technical fact officials before summary v2 rendering", () => {
  assert.match(appSource, /Array\.isArray\(summary\.technicalFacts\.officials\)/);
});

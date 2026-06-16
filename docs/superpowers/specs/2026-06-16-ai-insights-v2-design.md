# AI Insights V2 Design

Date: 2026-06-16
Branch: `feature/ai-insights-v2`

## Goal

Upgrade the World Cup 2026 guide so AI content feels more professional and more useful while staying grounded in official FIFA data.

The feature has two independent content models:

- Pre-match prediction: AI expresses a structured forecast before kickoff.
- Post-match summary: AI explains the completed match from official facts and reviews the pre-match prediction.

Predictions and summaries must be generated server-side, cached in the database, and reused by visitors. User visits may trigger background refreshes, but visible responses must read the current database state.

## Non-Goals

- Do not add post-match technical-stat fields that cannot be reliably sourced from official FIFA data.
- Do not show shots, shots on target, possession, xG, injuries, quotes, or player availability unless a stable official FIFA source is confirmed.
- Do not update a prediction after kickoff.
- Do not expose refresh controls or operational status in the public UI.

## Official Data Boundary

The implementation may use official FIFA calendar and match-detail data already verified in this project:

- Schedule and match metadata: teams, kickoff time, competition, stage, group, venue, status, score, winner, attendance, officials.
- Match detail: formations, players, coaches, goals, bookings, substitutions.

The post-match technical area may contain only fields backed by this official data:

- Formations.
- Venue.
- Attendance.
- Officials.
- Goals.
- Cards.
- Substitutions.

Fields that are unavailable or not guaranteed, such as shots, shots on target, possession, xG, and territorial possession, must not appear as fixed post-match technical-stat fields.

## Pre-Match Prediction Model

Predictions use a dedicated schema. They are not summaries with a different title.

```json
{
  "schemaVersion": "prediction-v2",
  "type": "prediction",
  "headline": "一句话专业判断",
  "shortText": "两句话赛前概览",
  "predictedScore": {
    "home": 1,
    "away": 1,
    "label": "1-1"
  },
  "outcomeProbabilities": {
    "homeWin": 0.34,
    "draw": 0.31,
    "awayWin": 0.35
  },
  "matchScript": {
    "summary": "预计比赛如何展开",
    "firstHalf": "上半场可能的节奏",
    "secondHalf": "下半场可能的变化"
  },
  "scoreRationale": [
    "为什么预测这个比分",
    "哪些因素压低或抬高进球数"
  ],
  "tacticalFactors": [
    "阵型、攻守倾向、转换节奏等判断",
    "双方可能的关键对位"
  ],
  "decisiveFactors": [
    "最可能决定比赛走向的因素"
  ],
  "riskFactors": [
    "预测可能失准的原因"
  ],
  "playersToWatch": [
    "只在官方数据支持时填写；否则使用球队层面观察"
  ],
  "confidence": "low",
  "generatedFor": "prediction"
}
```

Validation rules:

- `predictedScore.home` and `predictedScore.away` must be non-negative integers.
- `predictedScore.label` must match the numeric score.
- `outcomeProbabilities.homeWin`, `draw`, and `awayWin` must each be between 0 and 1.
- The three probabilities should sum to approximately 1. Small rounding drift is allowed.
- All explanatory arrays must contain concise Chinese strings.
- The model must not invent player names. If reliable player data is unavailable, `playersToWatch` may describe team-level factors instead.

## Prediction Generation Rules

Prediction generation is allowed only when all of these are true:

- Match status is scheduled or otherwise not started.
- Current server time is before `kickoffAt`.
- Refresh TTL allows generation.

Prediction generation is forbidden when any of these are true:

- Current server time is at or after `kickoffAt`.
- FIFA status indicates live, halftime, finished, final, full time, or completed.
- A prediction already exists and the match is no longer pre-kickoff.

If FIFA changes the kickoff time before the match starts, the new official kickoff time is used for future eligibility checks.

After kickoff, existing prediction data is frozen permanently and may only be displayed as a pre-match prediction or post-match prediction review.

## Post-Match Summary Model

Summaries use a dedicated schema based on official facts. They should explain the match professionally, not just restate the score.

```json
{
  "schemaVersion": "summary-v2",
  "type": "summary",
  "headline": "一句话赛果结论",
  "result": {
    "homeScore": 2,
    "awayScore": 1,
    "winner": "主队",
    "resultText": "主队 2-1 取胜"
  },
  "matchStory": {
    "summary": "整场比赛的主线",
    "turningPoint": "关键转折点",
    "closingPhase": "比赛末段走势"
  },
  "officialEvents": {
    "goals": [
      {
        "minute": "23'",
        "team": "球队",
        "player": "球员",
        "assist": null,
        "type": "goal"
      }
    ],
    "cards": [
      {
        "minute": "55'",
        "team": "球队",
        "player": "球员",
        "card": "yellow"
      }
    ],
    "substitutions": [
      {
        "minute": "70'",
        "team": "球队",
        "playerOff": "下场球员",
        "playerOn": "上场球员"
      }
    ]
  },
  "technicalFacts": {
    "formations": {
      "home": "4-3-3",
      "away": "4-2-3-1"
    },
    "attendance": 80824,
    "venue": "Stadium name",
    "officials": ["Referee name"]
  },
  "aiAnalysis": {
    "tacticalSummary": [
      "阵型、换人、比赛走势观察"
    ],
    "keyPlayerImpact": [
      "仅基于官方事件和球员名单描述影响"
    ],
    "resultExplanation": [
      "为什么比赛走向形成该结果"
    ]
  },
  "predictionReview": {
    "predictedScore": "1-1",
    "actualScore": "2-1",
    "scoreHit": false,
    "outcomeHit": false,
    "preMatchProbabilities": {
      "homeWin": 0.34,
      "draw": 0.31,
      "awayWin": 0.35
    },
    "reviewText": "赛前判断与实际走势的差异说明"
  },
  "officialFactsStatus": "complete",
  "missingOfficialFields": []
}
```

Validation rules:

- `result` must match the stored official score.
- `officialEvents` must be extracted from official data, not invented by AI.
- `technicalFacts` must contain only approved official fields.
- `predictionReview` is included when a pre-match prediction exists. If no prediction exists, the field may be omitted or set to `null`.
- `officialFactsStatus` is either `complete` or `partial`.
- `missingOfficialFields` may list only approved official fields that are expected from FIFA data but not yet available for that match.

## Summary Completeness

A post-match summary can be partial immediately after a match if official detail data is incomplete.

Partial summaries:

- May be displayed.
- Must show a low-key UI label: `官方数据补全中`.
- Must not use warning styling or interrupt reading.
- Should include hover/help text: `部分官方事件数据可能稍后补齐，系统会按刷新间隔自动更新。`

Complete summaries:

- Show no completeness label.
- Are locked and reused from the database.

The UI label disappears automatically once `officialFactsStatus` becomes `complete`.

If a summary remains partial for more than two days after the official match finish time, the system performs one final completion pass:

- Fetch official detail data one last time.
- Ask AI to review only the still-uncertain approved fields.
- If AI can infer or normalize a missing approved field from already available official data, store that value with a low-key provenance marker.
- If a field still cannot be completed, store it as an explicit blank/missing value with a low-key marker.
- After this final pass, set `officialFactsStatus` to `complete` and stop future completion refreshes for that summary.

The final completion pass must not create unsupported technical stats. It may only resolve approved fields that are already part of the summary structure.

UI markers after the final pass:

- AI-assisted completion: show a low-key label such as `AI 辅助确认`.
- Final blank value: show a low-key label such as `官方数据缺失`.
- These labels are field-level markers, not a page-level incomplete-summary warning.

## Post-Match Prediction Review

Completed match pages should connect the pre-match prediction to the actual result without making it the main content.

The page should show:

- Actual score.
- Pre-match predicted score.
- Whether exact score was hit.
- Whether outcome direction was hit.
- Pre-match win/draw/loss probabilities, clearly labeled as `赛前预测`.
- A concise AI review explaining why the prediction aligned with or diverged from the match.

This block should be visually secondary to the post-match summary.

## Refresh Strategy

The refresh policy must preserve the existing low-frequency behavior and avoid repeated AI calls.

Pre-match:

- Future matches: at most once every 12 hours.
- Same-day unstarted matches: at most once every 15 minutes for match data; prediction refresh may remain lower frequency unless explicitly changed.
- Predictions are generated or refreshed only before kickoff.

Live or started:

- Match data may refresh according to the existing live/same-day policy.
- Prediction generation is disabled.

Finished:

- If no summary exists, generate one from available official facts.
- If summary is partial, check official details after the minimum allowed interval.
- If official facts changed and the summary is still partial, regenerate the summary.
- Recent finished matches may check at most once every 15 minutes.
- Finished matches older than 24 hours may check at most once every 12 hours.
- If a summary is still partial more than two days after the match finish time, perform one final completion pass using official data plus AI review of the remaining uncertain approved fields.
- After the final completion pass, mark the summary complete even if some approved fields remain blank with a low-key `官方数据缺失` marker.
- Complete summaries are locked.

## Storage Strategy

Keep the current `insights` table compatible with existing rows, and add a structured JSON field for v2 content.

Recommended additions:

- `structured_json`: complete prediction-v2 or summary-v2 payload.
- `schema_version`: `prediction-v2` or `summary-v2`.
- `official_facts_status`: `complete` or `partial` for summaries.
- `official_facts_hash`: hash of normalized official facts used to generate a summary.
- `finalized_at`: timestamp for summaries finalized by normal completion or the two-day final pass.
- `completion_notes_json`: field-level provenance for AI-assisted values and final blank values.
- `frozen_at`: timestamp for predictions frozen at kickoff or later.

The existing columns remain available for backward compatibility and easy rollback.

## UI Strategy

Pre-match detail view:

- Show predicted score prominently.
- Show win/draw/loss probabilities.
- Show match script, score rationale, decisive factors, and risk factors.
- Keep text structured and scannable.

Post-match detail view:

- Show post-match summary first.
- Show official events and technical facts from approved fields.
- Show AI tactical/result analysis.
- Show pre-match prediction review as a secondary block.
- Show the partial-summary label only when `officialFactsStatus` is `partial`.

## Testing

Add or update tests for:

- Prediction schema validation.
- Summary schema validation.
- Prediction cannot be generated at or after kickoff.
- Prediction cannot be generated for live or finished matches.
- Partial summaries can be regenerated only after allowed intervals.
- Partial summaries older than two days receive one final completion pass.
- Final blank fields are rendered with low-key field-level markers.
- AI-assisted completed fields are rendered with low-key field-level markers.
- Complete summaries are locked.
- Summary technical facts do not include unapproved stats.
- Frontend renders partial-summary label only for partial summaries.
- Frontend displays prediction review after a completed match when prediction data exists.

## Rollback Plan

The work stays on `feature/ai-insights-v2`.

Rollback options:

- Do not merge the branch.
- Revert the feature branch commits.
- Keep database additions unused and render old `insights` fields.
- Disable v2 rendering if `structured_json` is absent or invalid.

Because existing columns remain intact, old prediction and summary rendering can remain as a fallback.

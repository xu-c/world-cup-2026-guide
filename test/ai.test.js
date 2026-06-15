import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInsightPrompt,
  hasConfiguredAiProvider,
  generateInsight,
  parseInsightJson,
  validateInsight,
} from "../src/ai.js";

test("summary prompt requires a stable JSON schema with fixed sections", () => {
  const prompt = buildInsightPrompt({
    type: "summary",
    match: {
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      homeScore: 2,
      awayScore: 0,
      status: "finished",
      groupName: "Group A",
      kickoffAt: "2026-06-11T20:00:00.000Z",
    },
  });

  assert.match(prompt, /ONLY valid JSON/);
  assert.match(prompt, /"headline"/);
  assert.match(prompt, /"keyMoments"/);
  assert.match(prompt, /"tacticalNotes"/);
  assert.match(prompt, /"confidence"/);
});

test("prediction prompt requires probability fields and no fabricated certainty", () => {
  const prompt = buildInsightPrompt({
    type: "prediction",
    match: {
      homeTeam: "Brazil",
      awayTeam: "Morocco",
      status: "scheduled",
      groupName: "Group C",
      kickoffAt: "2026-06-14T20:00:00.000Z",
    },
  });

  assert.match(prompt, /homeWin/);
  assert.match(prompt, /draw/);
  assert.match(prompt, /awayWin/);
  assert.match(prompt, /Do not claim certainty/);
});

test("AI JSON parsing strips markdown fences and validates the fixed schema", () => {
  const parsed = parseInsightJson(`\`\`\`json
{
  "headline": "Mexico start with control",
  "shortText": "Mexico controlled the match and limited South Africa's best chances.",
  "keyMoments": ["Early pressure set the tone", "Second goal closed the match"],
  "tacticalNotes": ["Mexico pressed high", "South Africa struggled to progress centrally"],
  "playersToWatch": ["Mexico forward", "South Africa goalkeeper"],
  "probabilities": {"homeWin": 0.62, "draw": 0.22, "awayWin": 0.16},
  "confidence": "medium",
  "generatedFor": "summary"
}
\`\`\``);

  assert.equal(validateInsight(parsed, "summary").headline, "Mexico start with control");
});

test("custom AI provider uses OpenAI-compatible chat completions settings", async () => {
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };

  process.env.AI_BASE_URL = "https://provider.example/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    let request;
    const result = await generateInsight({
      type: "prediction",
      match: {
        homeTeam: "Brazil",
        awayTeam: "Morocco",
        status: "scheduled",
        kickoffAt: "2026-06-14T20:00:00.000Z",
      },
      fetchImpl: async (url, options) => {
        request = {
          url,
          headers: options.headers,
          body: JSON.parse(options.body),
        };

        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    headline: "巴西对阵摩洛哥前瞻",
                    shortText: "两队风格差异明显，巴西控球能力更强。摩洛哥需要依靠防守转换制造机会。",
                    keyMoments: ["开局控球权争夺", "定位球防守质量"],
                    tacticalNotes: ["巴西可能主导边路推进", "摩洛哥需要压缩中路空间"],
                    playersToWatch: ["巴西前场", "摩洛哥门将"],
                    probabilities: { homeWin: 0.54, draw: 0.25, awayWin: 0.21 },
                    confidence: "medium",
                    generatedFor: "prediction",
                  }),
                },
              },
            ],
          }),
        };
      },
    });

    assert.equal(request.url, "https://provider.example/v1/chat/completions");
    assert.equal(request.headers.Authorization, "Bearer test-key");
    assert.equal(request.body.model, "mimo-v2.5-pro");
    assert.equal(request.body.response_format.type, "json_object");
    assert.equal(result.model, "mimo-v2.5-pro");
    assert.equal(result.insight.generatedFor, "prediction");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});

test("AI provider detection supports the generic provider env vars", () => {
  const previous = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_API_KEY;
  assert.equal(hasConfiguredAiProvider(), false);

  process.env.AI_API_KEY = "test-key";
  assert.equal(hasConfiguredAiProvider(), true);

  restoreEnv("AI_API_KEY", previous.AI_API_KEY);
  restoreEnv("OPENAI_API_KEY", previous.OPENAI_API_KEY);
});

test("invalid AI provider JSON falls back to a valid local insight", async () => {
  const previous = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };

  process.env.AI_BASE_URL = "https://provider.example/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "mimo-v2.5-pro";

  try {
    const result = await generateInsight({
      type: "prediction",
      match: {
        homeTeam: "W61",
        awayTeam: "W62",
        status: "scheduled",
        kickoffAt: "2026-07-19T19:00:00.000Z",
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "决赛前瞻",
                  shortText: "双方尚未确定。",
                  keyMoments: ["开局"],
                  tacticalNotes: ["谨慎"],
                  playersToWatch: [],
                  probabilities: { homeWin: 0.34, draw: 0.32, awayWin: 0.34 },
                  confidence: "low",
                  generatedFor: "prediction",
                }),
              },
            },
          ],
        }),
      }),
    });

    assert.equal(result.model, "local-fallback");
    assert.equal(result.insight.playersToWatch.length, 2);
    assert.equal(result.insight.generatedFor, "prediction");
  } finally {
    restoreEnv("AI_BASE_URL", previous.AI_BASE_URL);
    restoreEnv("AI_API_KEY", previous.AI_API_KEY);
    restoreEnv("AI_MODEL", previous.AI_MODEL);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

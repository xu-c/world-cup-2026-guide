import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFifaPayload } from "../src/fifa.js";

test("normalizes FIFA calendar v3 localized match payloads", () => {
  const matches = normalizeFifaPayload({
    Results: [
      {
        IdMatch: "400021443",
        Date: "2026-06-11T19:00:00Z",
        LastUpdated: "2026-06-11T22:00:00Z",
        MatchStatus: 0,
        ResultType: 1,
        StageName: [
          { Locale: "en-GB", Description: "First Stage" },
          { Locale: "zh-CN", Description: "第一阶段" },
        ],
        GroupName: [
          { Locale: "en-GB", Description: "Group A" },
          { Locale: "zh-CN", Description: "A 组" },
        ],
        Home: {
          Score: 2,
          TeamName: [
            { Locale: "en-GB", Description: "Mexico" },
            { Locale: "zh-CN", Description: "墨西哥" },
          ],
          ShortClubName: "Mexico",
        },
        Away: {
          Score: 0,
          TeamName: [
            { Locale: "en-GB", Description: "South Africa" },
            { Locale: "zh-CN", Description: "南非" },
          ],
          ShortClubName: "South Africa",
        },
        HomeTeamScore: 2,
        AwayTeamScore: 0,
        Stadium: {
          Name: [{ Locale: "en-GB", Description: "Mexico City Stadium" }],
          CityName: [{ Locale: "en-GB", Description: "Mexico City" }],
        },
      },
    ],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].fifaId, "400021443");
  assert.equal(matches[0].homeTeam, "墨西哥");
  assert.equal(matches[0].awayTeam, "南非");
  assert.equal(matches[0].homeScore, 2);
  assert.equal(matches[0].awayScore, 0);
  assert.equal(matches[0].status, "finished");
  assert.equal(matches[0].groupName, "A 组");
  assert.equal(matches[0].stage, "第一阶段");
  assert.equal(matches[0].venue, "Mexico City Stadium");
  assert.equal(matches[0].city, "Mexico City");
});

test("keeps FIFA calendar placeholder knockout matches in the schedule", () => {
  const matches = normalizeFifaPayload({
    Results: [
      {
        IdMatch: "400021543",
        Date: "2026-07-19T19:00:00Z",
        MatchStatus: 1,
        ResultType: 0,
        StageName: [{ Locale: "en-GB", Description: "Final" }],
        PlaceHolderA: "W61",
        PlaceHolderB: "W62",
        Stadium: {
          Name: [{ Locale: "en-GB", Description: "New York New Jersey Stadium" }],
          CityName: [{ Locale: "en-GB", Description: "New York New Jersey" }],
        },
      },
    ],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].homeTeam, "W61");
  assert.equal(matches[0].awayTeam, "W62");
  assert.equal(matches[0].status, "scheduled");
  assert.equal(matches[0].hasFinalScore, false);
});

test("normalizes FIFA numeric live match status", () => {
  const matches = normalizeFifaPayload({
    Results: [
      {
        IdMatch: "400021500",
        Date: "2026-06-15T19:00:00Z",
        MatchStatus: 3,
        Home: {
          TeamName: [{ Locale: "zh-CN", Description: "法国" }],
          Score: 1,
        },
        Away: {
          TeamName: [{ Locale: "zh-CN", Description: "日本" }],
          Score: 0,
        },
        HomeTeamScore: 1,
        AwayTeamScore: 0,
      },
    ],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, "live");
  assert.equal(matches[0].hasFinalScore, false);
});

# 2026 世界杯观赛指南

一个可本地运行的 2026 世界杯观赛指南 MVP，提供赛程查询、已完赛 AI 总结、未开赛 AI 预测和服务端缓存。

## 技术选择

- 推荐平台：Vercel + Neon Postgres。前端由 Vercel 静态托管，API 使用 Vercel Functions，刷新任务使用 Vercel Cron。
- 本地开发：Node.js HTTP 服务 + Node 22 内置 SQLite，默认写入 `./data/worldcup.db`。
- 云端数据库：配置 `DATABASE_URL` 后自动使用 Neon/Postgres；未配置时使用本地 SQLite。
- AI：服务端刷新任务调用 OpenAI-compatible chat completions API。未配置 `AI_API_KEY` / `OPENAI_API_KEY` 时使用本地结构化占位内容，保证项目可直接运行。
- FIFA 数据：`src/fifa.js` 是独立适配器。当前生产环境使用 FIFA 官方 calendar API：`https://api.fifa.com/api/v3/calendar/matches?language=zh&count=500&idCompetition=17&idSeason=285023`。未配置时使用内置示例赛程，方便本地演示。

## 云平台评估

Vercel 适合这个项目的原因：

- 页面是静态前端，天然适合 CDN 托管。
- 查询接口是短请求，适合 Serverless Functions。
- Vercel Cron 可以按 `vercel.json` 的 `path` 定时请求生产部署 URL。
- Vercel Marketplace 可以接入 Neon、Supabase 等 Postgres 服务，适合保存比赛和 AI 缓存。
- Vercel Hobby 免费账户的 Cron 只能每天运行一次，所以项目采用“每日 Cron + 用户访问后台刷新”的策略。

需要迁移的地方：

- 生产环境不能依赖本地 SQLite 文件持久化，所以已增加 Postgres 适配器。
- 原来的长驻 `src/server.js` 只保留给本地开发；Vercel 使用 `api/` 目录下的函数。

备选方案：

- Render/Railway/Fly.io：可以继续跑长驻 Node 服务并挂持久卷，迁移成本更低。
- Vercel：更适合前端体验和全球访问，但必须使用云数据库。当前项目已按 Vercel 形态迁移。

## 快速开始

```bash
npm test
npm run local
```

打开：

```text
http://localhost:3000
```

手动刷新缓存：

```bash
npm run refresh
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

```bash
cp .env.example .env
```

关键配置：

- `DATABASE_PATH`：SQLite 文件路径。
- `DATABASE_URL`：云端 Postgres 连接串。设置后优先使用 Postgres。
- `ADMIN_REFRESH_SECRET`：生产环境刷新接口密钥。设置为非 `change-me` 后，调用 `POST /api/admin/refresh?secret=...` 或传 `x-refresh-secret`。
- `CRON_SECRET`：可选。设置后，定时刷新接口需要 `Authorization: Bearer <CRON_SECRET>` 或 `?secret=...`。
- `FIFA_MATCHES_URL`：FIFA 官方比赛 JSON 地址。
- `AI_BASE_URL`：OpenAI-compatible `/v1` API 地址。
- `AI_API_KEY`：配置后刷新任务会生成真实 AI 总结和预测。
- `AI_MODEL`：默认 `gpt-4.1-mini`。

## 刷新策略

服务端刷新入口是 `refreshWorldCupData`：

- 已完赛且已有比分：如果还没有赛后总结，会用官方事实生成 summary；如果 summary 仍缺少官方详情，会按限频继续补全。
- 赛后总结完整后锁定；完赛超过两天仍不完整时，会执行一次最终补全，然后把缺失字段低调标记并停止后续补全刷新。
- 当天未完赛：比赛数据 15 分钟 TTL；预测只允许在开赛前生成或更新。
- 进行中比赛：比赛数据 15 分钟 TTL；不再生成或更新赛前预测。
- 明天及以后比赛：比赛数据 12 小时 TTL；预测 12 小时 TTL。

用户访问页面只读取数据库，不直接调用 FIFA 或 AI。

### Vercel Hobby 刷新方式

- `vercel.json` 配置每天 08:00 UTC 自动请求一次 `/api/cron/refresh`。
- 用户访问 `GET /api/matches` 时，接口先读取数据库并立即返回当前缓存。
- 返回前会用 Vercel `waitUntil` 注册一个后台刷新任务；后台任务会先检查限频策略，不到时间不会请求 FIFA 或 AI。
- 如果最近已有刷新任务正在运行，新的访问不会再启动刷新，避免并发访问导致重复刷新。
- 已完赛且已有完整 summary 的比赛在后续刷新中会被跳过，即使同一次刷新是因为别的未完赛比赛触发。

## AI 输出格式

AI 必须返回固定 JSON。赛前预测和赛后总结使用独立结构：

```json
{
  "schemaVersion": "prediction-v2",
  "type": "prediction",
  "headline": "string",
  "predictedScore": { "home": 1, "away": 1, "label": "1-1" },
  "outcomeProbabilities": {
    "homeWin": 0.36,
    "draw": 0.28,
    "awayWin": 0.36
  },
  "matchScript": {
    "summary": "string",
    "firstHalf": "string",
    "secondHalf": "string"
  },
  "scoreRationale": ["string"],
  "tacticalFactors": ["string"],
  "decisiveFactors": ["string"],
  "riskFactors": ["string"],
  "confidence": "medium",
  "generatedFor": "prediction"
}
```

```json
{
  "schemaVersion": "summary-v2",
  "type": "summary",
  "headline": "string",
  "result": { "homeScore": 2, "awayScore": 1, "winner": "主队", "resultText": "主队 2-1 取胜" },
  "matchStory": {
    "summary": "string",
    "turningPoint": "string",
    "closingPhase": "string"
  },
  "officialEvents": {
    "goals": [],
    "cards": [],
    "substitutions": []
  },
  "technicalFacts": {
    "formations": { "home": "4-3-3", "away": "4-2-3-1" },
    "attendance": 80824,
    "venue": "string",
    "officials": []
  },
  "aiAnalysis": {
    "tacticalSummary": [],
    "keyPlayerImpact": [],
    "resultExplanation": []
  },
  "predictionReview": null,
  "officialFactsStatus": "complete",
  "missingOfficialFields": []
}
```

赛后技术事实只包含官方可稳定获取的字段：进球、红黄牌、换人、阵型、场馆、上座人数、裁判。射门、射正、控球率、xG 等未确认官方稳定来源的项目不会作为固定技术统计展示。

`src/ai.js` 会解析、去除 markdown 代码块、校验字段，并把 v2 结构派生为旧字段以兼容已有展示和存储逻辑。预测一旦开赛即冻结，赛后作为“赛前预测回看”展示。

## API

- `GET /api/matches`：赛程列表和最近刷新记录。
- `GET /api/matches/:id`：单场比赛详情和缓存的 AI 内容。
- `POST /api/admin/refresh`：服务端刷新 FIFA 数据并按策略生成 AI 内容。
- `GET /api/cron/refresh`：Vercel Cron 定时刷新入口。

## 生产部署建议

### Vercel + Neon

1. 在 Vercel 创建项目并导入仓库。
2. 在 Vercel Marketplace 添加 Neon Postgres，复制或自动注入 `DATABASE_URL`。
3. 在 Vercel 环境变量中设置：
   - `DATABASE_URL`
   - `FIFA_MATCHES_URL`
   - `AI_BASE_URL`
   - `AI_API_KEY`
   - `AI_MODEL`
   - `ADMIN_REFRESH_SECRET`
   - `CRON_SECRET`
4. 部署后访问 `/api/admin/refresh?secret=<ADMIN_REFRESH_SECRET>` 执行首次数据初始化。
5. `vercel.json` 已配置每天一次请求 `/api/cron/refresh`，兼容 Vercel Hobby 免费账户。

### 刷新频率建议

- 比赛日：Vercel Cron 每天一次，用户访问会后台触发受限频保护的刷新。
- 有比赛正在进行：业务逻辑也最多 15 分钟刷新一次，页面始终先读取缓存。
- 非比赛日：后续场次最多 12 小时刷新一次。
- 赛事结束后：关闭定时任务或改为每日一次健康刷新。

## 开源协议

本项目使用 MIT License。详见 `LICENSE`。

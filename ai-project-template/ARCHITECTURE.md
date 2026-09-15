# ARCHITECTURE.md

## Overview

SoloVerseは、Next.jsフロントエンド、Express API、SQLiteデータベース、クラウドLLMプロバイダーで構成されます。利用者の世界は全主要テーブルの`user_id`で分離され、APIはJWTから得た利用者IDを問い合わせ条件へ入れます。

バックエンドプロセスはHTTP APIに加えて、リアクションキューを30秒ごと、自律世界エンジンを約5分ごとに実行します。フロントエンドは30秒ポーリングで投稿、返信数、いいね数、未読通知を更新します。

## High-Level Flow

```text
Browser
  │  Next.js pages / React client state
  │  Bearer JWT + JSON over HTTP
  ▼
Express API (default :3001)
  ├── Auth / onboarding / timeline routes
  ├── Reaction queue worker (30 seconds)
  ├── Autonomous world engine (5-minute scheduler)
  └── LLM gateway and per-user in-process serialization
       │
       ├── Groq ───────┐
       ├── Gemini ─────┼── ordered fallback
       └── OpenRouter ─┘
  │
  ▼
SQLite via @libsql/client
  └── backend/soloverse.db by default
```

## Directory Structure

```text
.
├── README.md                         Setup, operation, API summary
├── .nvmrc                            Node.js 20.9.0
├── ai-project-template/              AI development and handoff documents
│   ├── AGENTS.md
│   ├── PROJECT.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── WORKFLOW.md
│   ├── TODO.md
│   └── docs/
│       ├── DECISIONS.md
│       └── HANDOFF.md
├── backend/
│   ├── server.js                     Express setup and background timers
│   ├── src/
│   │   ├── db/schema.js              Schema, migrations, indexes
│   │   ├── middleware/auth.js        JWT verification and user existence check
│   │   ├── routes/auth.js            Register, login, current session
│   │   ├── routes/onboarding.js      World creation, inspection, regeneration
│   │   ├── routes/timeline.js        Timeline, replies, likes, notifications
│   │   └── services/
│   │       ├── llm.js                Provider routing and prompt rules
│   │       ├── worldGenerator.js     Initial resident generation
│   │       ├── reactionScheduler.js  Delayed likes/replies and seed posts
│   │       ├── autonomousEngine.js   Autonomous posts, trends, growth, absence
│   │       └── worldTasks.js         Per-user in-process task serialization
│   └── test/                          Node test runner suites
├── frontend/
│   ├── app/                           Next.js App Router pages and global CSS
│   ├── components/                    Post, reply, notification, trend UI
│   └── lib/api.ts                     HTTP client and localStorage session data
└── docs/
    └── improvement-2026-09-15.md      Investigation and improvement record
```

## Frontend

Framework:

- Next.js 16.3.5 App Router
- React 19.3.0
- TypeScript 5.9.3

Routes:

| Route | Purpose |
|---|---|
| `/` | Login and registration |
| `/onboarding` | Four-step world setup and resident generation |
| `/timeline` | Timeline, posting, replies, likes, notifications, trends, residents |

Important components:

- `PostCard.tsx`: Main post rendering, reply preview, like and reply actions
- `ReplyPanel.tsx`: Recursive thread display and reply-to-specific-post flow
- `NotificationPanel.tsx`: Fetches notifications and marks them read on open
- `TrendPanel.tsx`: Trends, resident profiles, and explicit AI-world regeneration
- `utils.tsx`: Deterministic initials avatar, UTC-aware relative time, hashtag/mention display
- `lib/api.ts`: Adds Bearer token, parses JSON errors, clears invalid sessions

State management:

- No external state library.
- Page/component-local `useState`, `useRef`, and `useEffect`.
- JWT and a small user display object are stored in browser `localStorage`.
- Timeline polling runs every 30 seconds. Existing visible posts are refreshed in batches of up to 100 IDs; new roots are fetched with a `since` cursor.
- Older roots use `(created_at, id)` cursor pagination, 30 at a time.

## Backend

Framework / runtime:

- Node.js 20.9+ and Express 4, using CommonJS modules.
- JSON request body limit: 32 KB.
- CORS allowlist comes from `CORS_ORIGIN`; default is the local frontend.
- Security response headers are set in `server.js`.

Important services:

- `llm.js`: Expands configured providers into ordered model targets, paces calls per provider, applies request and total timeouts, cooldowns failing targets, strips obvious reasoning leakage, and validates JSON-shaped outputs when requested.
- `worldGenerator.js`: Calls the LLM in two batches of five residents, normalizes fields, prevents duplicate usernames within the generated set, and requires at least three valid residents.
- `reactionScheduler.js`: Schedules delayed likes/replies, guarantees a prompt reply for detected questions/calls, repairs missed recent direct replies, processes retryable queue items, and creates initial seed posts.
- `autonomousEngine.js`: Produces autonomous posts and reply chains, aggregates hashtags without an LLM, adds one or two residents after six hours up to 20, and generates absence reactions after 24 hours.
- `worldTasks.js`: Serializes work for the same user inside one Node process. It is not a distributed lock.

Background schedule:

| Job | Process cadence | Per-user rule |
|---|---:|---|
| Reaction queue | 30 seconds | Due queue rows, up to 20 per pass |
| Autonomous engine dispatcher | 5 minutes | Autonomous posts after configured interval, default 15 minutes |
| Trend aggregation | Checked every 5 minutes | Last 7 days, up to 500 posts, top 3 hashtags |
| Resident growth | Checked every 5 minutes | At least 6 hours since prior growth, max 20 residents |
| Absence reaction | Checked every 5 minutes | After 24 hours without user post; deduplicated for 48 hours |

## Database

Database:

- SQLite file through `@libsql/client`.
- Foreign keys are enabled at initialization and again per HTTP request.
- Schema creation, compatibility migrations, and indexes run at startup.

Important tables:

| Table | Purpose |
|---|---|
| `users` | Account identity, password hash, onboarding state |
| `world_settings` | Position, interests, atmosphere, exclusions, follower scale |
| `ai_characters` | Per-user AI resident profiles and reaction behavior |
| `posts` | User and AI posts; `reply_to` forms thread edges |
| `likes` | User/AI likes with unique `(post_id, liker_id)` |
| `reaction_queue` | Delayed like/reply/repost jobs and retry count |
| `notifications` | Like, reply, follow, and absence notifications |
| `trends` | Per-user top hashtags and counts |
| `character_growth_log` | Compatibility/audit log for added residents |
| `autonomous_log` | Last autonomous, trend, and growth timestamps per user |

Relationships:

- Most tables reference `users.id` with `ON DELETE CASCADE`.
- `likes.post_id` references `posts.id` with `ON DELETE CASCADE`.
- `posts.reply_to` is a logical self-reference but has no database foreign key.
- `posts.author_id` is polymorphic (`users` or `ai_characters`) and has no database foreign key.
- Queue and notification references to characters/posts are logical references without database foreign keys.

## APIs

All routes except health, registration, and login require a Bearer JWT.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health and configured model labels; never returns API keys |
| `/api/auth/register` | POST | Create account and return JWT |
| `/api/auth/login` | POST | Verify password and return JWT |
| `/api/auth/me` | GET | Return current DB-backed session user |
| `/api/onboarding/submit` | POST | Validate settings, generate residents, complete onboarding |
| `/api/onboarding/world` | GET | Read world settings and residents |
| `/api/onboarding/regenerate` | POST | Preserve account/user posts and replace AI world data |
| `/api/timeline` | GET | Read roots by page, `since`, `ids`, or `before` cursor |
| `/api/timeline/post` | POST | Create a root or reply and schedule reactions |
| `/api/timeline/like/:postId` | POST | Toggle the authenticated user's like |
| `/api/timeline/replies/:postId` | GET | Read nested replies up to depth 20 |
| `/api/timeline/notifications` | GET | Read latest 50 and mark unread notifications read |
| `/api/timeline/notifications/unread-count` | GET | Count unread notifications |
| `/api/timeline/trends` | GET | Read per-user hashtags |
| `/api/timeline/characters` | GET | Read resident profiles and activity counts |
| `/api/timeline/seed` | POST | Seed only when the user has no AI posts |

## External Services

| Service | Purpose |
|---|---|
| Groq | First configured LLM provider by default |
| Gemini | Second configured LLM provider by default, using its OpenAI-compatible endpoint |
| OpenRouter | Final configured fallback and free-model router by default |

All external LLM traffic passes through `backend/src/services/llm.js`. API keys remain server-side. Prompts can contain world settings, resident profiles, and user/AI post text.

## Authentication

- Registration lowercases email addresses and hashes passwords with bcrypt cost 10.
- Login and registration share an in-memory IP limiter: 10 attempts per 15 minutes.
- Successful login/registration returns an HMAC-signed JWT containing `userId`, valid for 30 days.
- Middleware verifies the token and checks that the referenced user still exists, with a 30-second in-memory existence cache.
- Frontend stores the token in `localStorage` and sends it in the `Authorization: Bearer` header.

## Authorization

- Authenticated routes derive `userId` only from the verified JWT.
- Timeline, post, like, reply, world, notification, trend, and resident queries include the authenticated `userId`.
- Reply/like targets are checked to belong to the same user's world.
- Smoke tests cover cross-user rejection for post IDs.

## Data Flow

### First-time world creation

1. Browser registers or logs in and receives a JWT.
2. User chooses position, interests, atmosphere, and exclusions.
3. Backend validates the values and calls the LLM twice to generate residents.
4. World settings, residents, onboarding status, and initial job timestamps are saved in one DB batch.
5. Timeline initialization calls `/api/timeline/seed`.
6. The LLM generates up to eight initial AI posts, backdated one to 72 hours to make the world appear inhabited.

### User post and AI reaction

1. Browser sends a root post or reply.
2. Backend validates length and ownership, then inserts the post.
3. Root posts get delayed like/reply queue rows. Detected questions/calls get at least one reply scheduled within the configured 1–10 minute limit, default three.
4. Queue worker processes due rows, creates likes/AI replies and notifications, and retries failures up to three times with five-minute spacing.
5. Browser polling refreshes new posts and counts.

### LLM fallback

1. Enabled providers and models are expanded from environment variables.
2. Requests are paced per provider and bounded by per-request and overall timeouts.
3. Rate limits, authentication failures, server errors, network errors, empty/truncated output, invalid JSON, or likely reasoning leakage move work to another target.
4. Failed targets enter an in-memory cooldown.

## Deployment

No deployment manifest, container definition, CI workflow, process manager, or infrastructure-as-code file is present.

[TODO: Define the production topology. The current implementation needs persistent SQLite storage, HTTPS, a configured CORS origin, and exactly one active background-job runner unless distributed locking is added.]

## Architectural Constraints

- One local SQLite database per backend deployment.
- Single-process background scheduler by default.
- Per-user serialization is in-memory only.
- Frontend and backend are separate npm packages; there is no root workspace manifest.
- Polling is used instead of push-based updates.
- LLM provider APIs must support the OpenAI chat-completions request/response shape used by the gateway.
- The backend depends on Node's built-in`fetch`, requiring the documented Node version.
- The application UI and prompt rules are primarily Japanese.

## Known Technical Debt

- Add database-enforced integrity for thread, queue, notification, and polymorphic author references where practical.
- Replace timeline reply-preview N+1 queries with a batched query.
- Decide whether to enable TypeScript strict mode and add lint/format tooling.
- Replace process-local rate limiting, cooldowns, and per-user locks before multi-instance deployment.
- Define migrations with explicit versions and atomic rollback behavior; current startup migration code rebuilds tables when cascade rules differ.
- Add production observability, queue metrics, backup/restore automation, and CI/CD.
- Add a stronger output moderation/evaluation layer; current safety and roleplay controls are primarily prompt- and heuristic-based.
- Resolve the frontend license metadata mismatch.

# DECISIONS.md

## Purpose

Record durable technical and product decisions so future developers and AI agents understand why the current implementation exists. Sources are current code, package/config files, the root README, `docs/improvement-2026-09-15.md`, and the available Git history. The history currently contains only the initial project commit, so earlier rationale may still be unavailable.

## 2026-09-15 — Use the GitHub `main` branch as the repository source of truth

### Status

Accepted and verified.

### Context

The project was pushed to GitHub after the initial documentation audit. Future work needs a single remote and branch against which status, history, and proposed changes can be reviewed.

### Decision

- Use `https://github.com/yuyuyu02h/soloverse.git` as the authoritative `origin`.
- Use `main` as the current default branch.
- Do not commit or push automatically; those remain explicit owner actions.
- [TODO: Define branch protection, pull-request review, versioning, and release conventions.]

### Consequences

- Local status and diffs can now be checked against `origin/main`.
- The current history contains only the initial commit, so it does not explain pre-import decisions.
- CI and repository governance still need to be configured.

### Source Evidence

- Local Git configuration and `refs/heads/main`
- Remote `refs/heads/main`, verified on 2026-09-15
- Initial commit `3127e0d` (`Initial SoloVerse project`)

## 2026-09-15 — Prioritize personal creative quality over public launch readiness

### Status

Accepted by the project owner.

### Context

SoloVerse is currently a personal creation. The owner does not intend to fully launch it as a public service at this stage and wants the product itself—especially post density, conversational meaning, resident personality, and design—to become compelling first.

### Decision

- Optimize first for the project owner's personal use and portfolio-quality completeness.
- Continue using free cloud LLM APIs and do not add a local LLM.
- Prioritize AI content quality, content density, user control, design, and maintainability.
- Defer public-service-only work such as email verification, public abuse operations, large-scale distributed infrastructure, and formal launch processes until the direction changes.
- Preserve baseline secret protection, tenant isolation, backups, and safe database upgrades even for personal use.

### Consequences

- Step 3 and Step 4 work may proceed alongside minimum reliability work instead of waiting for every production-readiness item.
- Public deployment must not be described as ready without reopening the deferred security and operations requirements.
- Success criteria should reflect personal experience quality rather than public growth metrics.

### Source Evidence

- Project owner direction provided on 2026-09-15
- `PROJECT.md`, “Product Direction”
- `ROADMAP.md`, “Current Direction”

## 2026-09-15 — Use cloud LLMs with ordered multi-provider fallback

### Status

Accepted and implemented.

### Context

SoloVerse requires generated residents, posts, and replies. The implementation is intended to use free service tiers where possible and must continue operating when a provider/model is temporarily unavailable or rate-limited.

### Decision

- Do not run a local LLM.
- Use provider order `groq,gemini,openrouter` by default.
- Skip providers without an API key.
- Try configured models in order within each provider.
- Pace calls, apply per-request/overall timeouts, and cooldown failing targets.

### Reason

The README and service comments explicitly describe free-tier conservation, quota/rate-limit handling, and failover as the purpose of this design.

### Alternatives Considered

- Local LLM: explicitly excluded by the documented project direction.
- Single cloud provider: not selected; it would remove the implemented fallback behavior.
- [TODO: No further alternative analysis is preserved in the current single-commit Git history.]

### Consequences

- The app requires at least one external API key and network access.
- User interests and conversation text can be sent to enabled providers.
- Quality, latency, availability, pricing, and data handling depend on external services.
- Retries and fallbacks can multiply free-tier consumption.

### Source Evidence

- `backend/src/services/llm.js`
- `backend/.env.example`
- Root `README.md`, “LLM設定”
- `docs/improvement-2026-09-15.md`

## 2026-09-15 — Use SQLite and one active background-job runner

### Status

Accepted for the current implementation.

### Context

The backend stores accounts, world state, posts, queue rows, and job timestamps. It also runs recurring reaction and autonomous-world work.

### Decision

- Store data in a local SQLite file through `@libsql/client`.
- Run startup schema creation/migrations.
- Run background work inside the backend process unless `BACKGROUND_JOBS=false`.
- Operate with one background-job-enabled process.
- Serialize same-user world work in memory.

### Reason

The README identifies the application as a personal/prototype-oriented system and explicitly documents persistent disk and single-runner requirements. Code comments identify the per-user serialization as a one-process mechanism.

### Alternatives Considered

- Multi-instance/distributed jobs: explicitly documented as requiring DB-backed locking or other coordination before use.
- Managed relational DB or external queue: [TODO: no recorded evaluation is available.]

### Consequences

- Local development is simple and requires no separate DB server.
- Persistent storage and backups are the deployer's responsibility.
- Multiple job-running instances can duplicate work.
- In-memory rate limits, cooldowns, and locks reset on process restart.

### Source Evidence

- `backend/src/db/schema.js`
- `backend/server.js`
- `backend/src/services/worldTasks.js`
- Root `README.md`, “運用・引き継ぎメモ”

## 2026-09-15 — Derive trends from actual hashtags without an LLM

### Status

Accepted and implemented.

### Context

Generated trend-filling content consumed LLM quota and could make the timeline less authentic.

### Decision

Aggregate unique hashtags per post from the latest seven days, scan at most 500 posts, and store the top three topics per user. Do not call an LLM for trend calculation.

### Reason

The improvement record explicitly prioritizes free-tier conservation and preventing generated trend posts from filling the world.

### Alternatives Considered

- LLM-generated trend labels/content: superseded by actual hashtag aggregation.
- Global trends across users: not selected; current data model keeps worlds isolated.

### Consequences

- Trend updates use no model quota.
- Worlds with no hashtags correctly show no trends.
- Trend quality depends on users and AI posts including hashtags.

### Source Evidence

- `backend/src/services/autonomousEngine.js`, `runTrendGeneration`
- `frontend/components/TrendPanel.tsx`
- `docs/improvement-2026-09-15.md`

## 2026-09-15 — Preserve user data during explicit AI-world regeneration

### Status

Accepted and implemented.

### Context

Changes to resident-generation prompts do not safely rewrite already generated residents/posts. Deleting the entire DB would also delete accounts and user-authored content.

### Decision

Provide an authenticated, explicitly confirmed regeneration flow that:

- generates replacement residents before deleting the current AI world
- preserves the account, settings, root user posts, and user-authored replies whose ancestors are preserved
- removes old AI residents, AI posts and descendants, AI likes, queue rows, notifications, trends, and growth data
- seeds new AI posts after replacement

### Reason

The API and UI comments explicitly state that the account and user posts must remain while AI-generated world data is rebuilt.

### Alternatives Considered

- Delete the entire SQLite DB: rejected by the implemented preservation requirement.
- Silently rewrite existing worlds on server startup: not selected; regeneration requires an authenticated user action and UI confirmation.

### Consequences

- A user can adopt improved generation rules without creating another account.
- Regeneration consumes multiple LLM calls.
- AI posts and AI notifications are intentionally destructive and cannot be restored without a DB backup.
- If new seed generation fails after resident replacement, the API returns a warning and a later timeline initialization can retry seeding.

### Source Evidence

- `backend/src/routes/onboarding.js`, `/regenerate`
- `frontend/components/TrendPanel.tsx`, `rebuildWorld`
- Root `README.md`

## Undocumented Decisions Requiring Owner Confirmation

- [TODO: Intended production hosting and operational ownership.]
- [TODO: What event, if any, should trigger reconsideration of a public or limited release.]
- [TODO: Authentication/session model for production, including localStorage versus HttpOnly cookies.]
- [TODO: Moderation, privacy disclosure, retention, deletion, and provider-consent policies.]
- [TODO: Git branch protection, pull-request review, versioning, and release conventions.]
- [TODO: License for the frontend/project; current package metadata conflicts.]

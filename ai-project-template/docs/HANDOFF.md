# HANDOFF.md

## Last Updated

2026-09-15 (Asia/Tokyo)

## Current Objective

The AI-development documentation is aligned with the current implementation. The active direction is a personal creative-quality milestone, not a full public launch: improve content density, conversational meaning, resident consistency, UI polish, and free-tier efficiency.

## Current State

SoloVerse is a two-package local web application:

- Next.js 16 / React 19 frontend
- Express 4 backend
- SQLite via `@libsql/client`
- JWT authentication
- Groq → Gemini → OpenRouter cloud-LLM fallback
- In-process reaction queue and autonomous-world scheduling

The implemented flow includes registration/login, onboarding, per-user AI residents, seed posts, root and nested posts, likes, notifications, hashtag trends, autonomous posts, resident growth, absence reactions, polling updates, and explicit AI-world regeneration that preserves user-authored data.

The project is a Git repository whose `origin/main` is `https://github.com/yuyuyu02h/soloverse.git`. Local `HEAD` and the remote branch were verified at initial commit `3127e0d`. CI configuration, deployment configuration, and a root npm workspace manifest are not present.

## Completed In This Documentation Session

- Inspected root structure, package manifests/locks, safe example configuration, source, tests, README, and improvement record.
- Did not read or record actual `.env` values or SQLite user data.
- Documented product scope, current stack, commands, status, and constraints.
- Documented frontend/backend/DB/API/LLM/background-job architecture and data flows.
- Documented current security controls, risks, and production decisions still required.
- Added project-specific AI-agent and development workflow rules.
- Recorded verified technical decisions and open decisions.
- Recorded known bugs, security work, technical debt, and owner questions.
- Verified the local Git repository, `origin` URL, `main` branch, initial commit, and matching remote head.
- Added `ROADMAP.md` with priorities, dependencies, implementation steps, and exit criteria across engineering, security, design, AI quality, product features, deployment, and beta validation.
- Recorded the owner's decision to prioritize personal creative quality and defer public-launch-only requirements.
- Added a dated free-tier analysis and quota-efficient content strategy in `docs/LLM_FREE_TIER.md`.

## Files Changed

Documentation only:

- `README.md`
- `ai-project-template/AGENTS.md`
- `ai-project-template/PROJECT.md`
- `ai-project-template/ARCHITECTURE.md`
- `ai-project-template/SECURITY.md`
- `ai-project-template/WORKFLOW.md`
- `ai-project-template/TODO.md`
- `ai-project-template/ROADMAP.md`
- `ai-project-template/docs/DECISIONS.md`
- `ai-project-template/docs/HANDOFF.md`
- `ai-project-template/docs/LLM_FREE_TIER.md`

No source code, package manifest, lockfile, environment file, or database was modified by this documentation task.

## Validation Performed

Documentation checks:

- Read all eight existing template Markdown files before editing, then created and reviewed `ROADMAP.md`.
- Cross-checked route lists with Express router declarations.
- Cross-checked dependencies/scripts with both `package.json` files and installed top-level versions.
- Cross-checked environment variable names with example files and `process.env` references without reading secret values.
- Cross-checked DB tables and relationships with `backend/src/db/schema.js`.
- Searched runtime source for unresolved `TODO`/`FIXME` markers; none were found outside documentation/dependency artifacts.
- Reviewed Git status and diff; documentation files are the only files changed by this task.
- Verified local `HEAD` and `origin/main` both resolve to `3127e0d`.

Tests:

- Most recent execution in the current work session: `npm --prefix backend test` — 15 tests passed, 0 failed.
- Tests used mock LLM servers and temporary DBs; real provider quota was not used.

Typecheck:

- Most recent execution in the current work session: `npm --prefix frontend run typecheck` — passed.

Lint:

- Not run; no lint script is defined.

Build:

- Most recent execution in the current work session: `npm --prefix frontend run build` — passed.

Manual verification:

- A prior local run supplied in the work session confirmed server startup, DB initialization, provider selection, seed creation, scheduler activity, autonomous generation, and separate user IDs.
- No new live provider calls or UI interaction were performed for this documentation-only task.

## Current Problems

- External model quality remains nondeterministic despite prompt/output guards.
- Timeline reply previews use an N+1 query pattern.
- Several logical database references lack foreign keys.
- TypeScript strict mode and lint/format tooling are not enabled.
- JWTs are stored in `localStorage`; session revocation is not implemented.
- Login limiting and job/LLM coordination are process-local.
- Production hosting, backup, monitoring, privacy, moderation, and account lifecycle are undefined.
- Frontend license metadata conflicts between package and lockfile.
- `frontend/tsconfig.tsbuildinfo` is a generated build cache but is currently tracked by Git.
- GitHub CI, branch protection, PR templates, and release conventions are not configured.
- A dedicated GitHub connector is not exposed in the current Codex environment; remote verification succeeded through local Git.
- The installed GitHub CLI credential is invalid in this environment; normal Git remote reads still work through the existing Git credential path.

## Unresolved Questions

- [TODO: What numerical acceptance criteria should define sufficient daily post density and acceptable content quality?]
- [TODO: Should the personal project remain local-only or eventually use private always-on hosting?]
- [TODO: What backup/restore, retention, and deletion policies are required?]
- [TODO: Which authentication/session hardening items are required before release?]
- [TODO: What moderation, abuse-reporting, and LLM-provider privacy disclosures are required?]
- [TODO: What branch-protection, review, versioning, and release rules should GitHub use?]
- [TODO: What project license should replace or confirm the conflicting current metadata?]

## Next Recommended Action

Use `ROADMAP.md` for the complete ordering. The first recommended slice is:

1. Add quota/usage and generated-versus-saved post measurement.
2. Add bounded refill and quality checks for discarded or low-quality generated posts.
3. Introduce a quota-efficient queued post pool and prioritize live replies.
4. Improve resident profiles, short-term memory, and UI design while maintaining minimum CI/data-safety work.
5. Reopen public-launch security and operations work only if the release direction changes.

## Important Context

- The application is not using a local LLM.
- At least one provider API key is required; missing providers are skipped.
- Tests must remain independent of real keys and quotas.
- User data is partitioned by `user_id`; ownership scoping is a critical invariant.
- One background-job-enabled backend process is the current operational model.
- Ordinary updates should not require deletion of `backend/soloverse.db`.
- AI-world regeneration intentionally removes AI-side world data but preserves the account and supported user-authored posts.
- Initial seed posts are intentionally backdated one to 72 hours.
- Trend generation counts real hashtags and makes no LLM call.

## Warnings

- Never print or commit `backend/.env`, API keys, JWTs, password hashes, or DB contents.
- Back up a real DB before migration, repair, or world-data manipulation.
- Do not run multiple background-job-enabled replicas without distributed coordination.
- Treat only this repository's `origin/main` as authoritative; do not import history from similarly named folders.
- Do not describe the app as production-ready until the owner resolves the production/security TODOs.

## Suggested Starting Files

- `ai-project-template/PROJECT.md`
- `ai-project-template/TODO.md`
- `ai-project-template/ROADMAP.md`
- `ai-project-template/ARCHITECTURE.md`
- `ai-project-template/SECURITY.md`
- `README.md`
- `backend/server.js`
- `backend/src/services/llm.js`
- `backend/src/services/reactionScheduler.js`
- `backend/src/services/autonomousEngine.js`
- `backend/src/db/schema.js`
- `frontend/app/timeline/page.tsx`

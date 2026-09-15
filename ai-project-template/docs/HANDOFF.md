# HANDOFF.md

## Last Updated

2026-09-15 (Asia/Tokyo)

## Current Objective

The AI-development documentation template has been adapted to the current SoloVerse implementation. The next product/engineering objective is not established by code or documentation.

[TODO: Project owner selects the next milestone.]

## Current State

SoloVerse is a two-package local web application:

- Next.js 16 / React 19 frontend
- Express 4 backend
- SQLite via `@libsql/client`
- JWT authentication
- Groq → Gemini → OpenRouter cloud-LLM fallback
- In-process reaction queue and autonomous-world scheduling

The implemented flow includes registration/login, onboarding, per-user AI residents, seed posts, root and nested posts, likes, notifications, hashtag trends, autonomous posts, resident growth, absence reactions, polling updates, and explicit AI-world regeneration that preserves user-authored data.

The current project root does not contain `.git`, CI configuration, deployment configuration, or a root npm workspace manifest.

## Completed In This Documentation Session

- Inspected root structure, package manifests/locks, safe example configuration, source, tests, README, and improvement record.
- Did not read or record actual `.env` values or SQLite user data.
- Documented product scope, current stack, commands, status, and constraints.
- Documented frontend/backend/DB/API/LLM/background-job architecture and data flows.
- Documented current security controls, risks, and production decisions still required.
- Added project-specific AI-agent and development workflow rules.
- Recorded verified technical decisions and open decisions.
- Recorded known bugs, security work, technical debt, and owner questions.
- Attempted Git inspection; confirmed no `.git` exists in this project root. Did not attribute history from sibling projects.

## Files Changed

Documentation only:

- `ai-project-template/AGENTS.md`
- `ai-project-template/PROJECT.md`
- `ai-project-template/ARCHITECTURE.md`
- `ai-project-template/SECURITY.md`
- `ai-project-template/WORKFLOW.md`
- `ai-project-template/TODO.md`
- `ai-project-template/docs/DECISIONS.md`
- `ai-project-template/docs/HANDOFF.md`

No source code, package manifest, lockfile, environment file, or database was modified by this documentation task.

## Validation Performed

Documentation checks:

- Read all eight template Markdown files before editing.
- Cross-checked route lists with Express router declarations.
- Cross-checked dependencies/scripts with both `package.json` files and installed top-level versions.
- Cross-checked environment variable names with example files and `process.env` references without reading secret values.
- Cross-checked DB tables and relationships with `backend/src/db/schema.js`.
- Searched runtime source for unresolved `TODO`/`FIXME` markers; none were found outside documentation/dependency artifacts.
- [TODO: Git diff/status review is unavailable until the authoritative `.git` metadata is restored or initialized.]

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
- Git history and change status are unavailable in this directory.

## Unresolved Questions

- [TODO: Is the intended release local/private or publicly accessible?]
- [TODO: What is the next milestone and its acceptance criteria?]
- [TODO: What hosting provider, domain, data region, availability target, and budget should be used?]
- [TODO: What user scale and performance targets are expected?]
- [TODO: What backup/restore, retention, and deletion policies are required?]
- [TODO: Which authentication/session hardening items are required before release?]
- [TODO: What moderation, abuse-reporting, and LLM-provider privacy disclosures are required?]
- [TODO: Should Git history be initialized here or restored from another authoritative repository?]
- [TODO: What project license should replace or confirm the conflicting current metadata?]

## Next Recommended Action

The ordering below is provisional and requires owner confirmation:

1. [TODO: Choose the release target and next milestone.]
2. [TODO: Establish the authoritative Git repository/history and license.]
3. If public hosting is intended, prioritize the security, privacy, backup, moderation, and single-runner deployment decisions in `TODO.md` before adding product features.

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
- Do not infer current Git history from `../soloverse2` or other similarly named folders.
- Do not describe the app as production-ready until the owner resolves the production/security TODOs.

## Suggested Starting Files

- `ai-project-template/PROJECT.md`
- `ai-project-template/TODO.md`
- `ai-project-template/ARCHITECTURE.md`
- `ai-project-template/SECURITY.md`
- `README.md`
- `backend/server.js`
- `backend/src/services/llm.js`
- `backend/src/services/reactionScheduler.js`
- `backend/src/services/autonomousEngine.js`
- `backend/src/db/schema.js`
- `frontend/app/timeline/page.tsx`

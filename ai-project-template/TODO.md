# TODO.md

## Current Objective

Use `ROADMAP.md` as the implementation sequence. The current milestone is a personal creative release: improve content density, conversational coherence, resident consistency, and visual quality while staying within free cloud-LLM allowances. General public launch is not a current objective.

## Now

- [ ] Define a small personal acceptance set for meaningful replies, resident consistency, repetition, and daily post density.
- [ ] Add LLM quota/usage and generated-versus-saved item measurements without logging prompts or private content.
- [ ] Refill invalid/filtered generation results to the requested post count within a bounded quota budget.
- [ ] Design a free-first content pool that gives user replies priority over autonomous background posts.
- [ ] Review and commit the documentation roadmap changes when ready.
- [ ] Remove `frontend/tsconfig.tsbuildinfo` from Git tracking and add the appropriate ignore rule.
- [ ] Add CI for backend tests, frontend typecheck, and frontend build.
- [ ] [TODO: Choose the project license and resolve the package/lockfile metadata mismatch.]

## Next

These are verified gaps. Detailed dependencies, priorities, sizes, and exit criteria are in `ROADMAP.md`.

- [ ] Improve resident profiles and compact short-term memory passed to reply/autonomous generation.
- [ ] Add topic relevance, specificity, persona consistency, and semantic repetition checks.
- [ ] Improve the timeline, composer, replies, and resident screens with shared UI components and responsive behavior.
- [ ] Decide and configure lint/format tooling.
- [ ] Decide whether to enable TypeScript `strict` mode and plan incremental fixes.
- [ ] Batch timeline reply-preview queries to remove the per-post N+1 query.
- [ ] Add database-enforced integrity or explicit cleanup guarantees for logical post, queue, notification, and polymorphic author references.
- [ ] Create explicit, versioned, atomic migrations with documented rollback/recovery behavior.
- [ ] Resolve `frontend/package.json` (`UNLICENSED`) versus `frontend/package-lock.json` (`ISC`) license metadata mismatch.

## Later

- [ ] If always-on hosting is wanted, define hosting, persistent SQLite storage, process supervision, and one active background-job runner.
- [ ] Define a lightweight personal backup/restore procedure; expand retention and disaster recovery only for hosted use.
- [ ] [TODO: Decide whether email verification, password reset, account deletion, and session management are required.]
- [ ] [TODO: Decide whether real-time delivery should replace or supplement 30-second polling.]
- [ ] [TODO: Decide whether public multi-user social interaction is intentionally out of scope.]
- [ ] [TODO: Decide whether images/uploads are in scope and define storage and moderation before implementation.]
- [ ] Add structured operational logging and metrics for request failures, provider fallbacks, quota/rate limits, queue depth, retries, and job duration.
- [ ] Add browser E2E tests for registration, onboarding, timeline updates, nested replies, notifications, and world regeneration.
- [ ] Evaluate distributed queue/lock/storage architecture only if multiple backend instances become a requirement.
- [ ] Re-evaluate public-launch authentication, moderation, privacy, and operations requirements only if the release direction changes.

## Blocked

- [ ] Production deployment documentation

Reason:

Not required for the current personal/local milestone. [TODO: Reopen only if always-on or public hosting becomes a goal.]

## Known Bugs / Behavior Risks

- [ ] External LLMs can still produce low-quality, repetitive, off-topic, or policy-violating content; current controls are prompts, output-shape validation, length limits, and simple heuristics.
- [ ] The timeline root query loads reply previews with one additional query per returned root post.
- [ ] Process-local cooldowns, task serialization, login limits, and scheduler guards do not coordinate across multiple server instances.
- [ ] A process restart resets model cooldown and login-attempt limiter state.
- [ ] Startup table-rebuild migrations are not represented by explicit version records and need production-data review.
- [ ] `posts.reply_to` and several character/post references can become orphaned if data is modified outside the supported application flows.

## Security Issues

- [ ] [TODO: Decide whether 30-day JWTs in `localStorage` meet the intended threat model; otherwise move to Secure, HttpOnly, SameSite cookies and add revocation.]
- [ ] Add and test an application Content-Security-Policy appropriate for the Next.js/Express deployment.
- [ ] Replace process-local login rate limiting before public or multi-instance deployment.
- [ ] [TODO: Define email ownership verification, recovery, account deletion, and session invalidation requirements.]
- [ ] [TODO: Define user consent/privacy disclosure for posts, interests, and conversation context sent to Groq, Gemini, and OpenRouter.]
- [ ] [TODO: Decide whether independent input/output moderation and abuse reporting are required.]
- [ ] Define production secret storage, access control, audit, and rotation.
- [ ] Define dependency vulnerability scanning and update cadence.
- [ ] Define HTTPS/HSTS behavior at the production edge.

## Technical Debt

- [ ] TypeScript compiler option `strict` is false.
- [ ] No lint or formatter script exists in either package.
- [ ] Frontend relies heavily on inline style objects and monolithic client pages.
- [ ] Frontend API response values use `any` rather than shared validated types.
- [ ] Backend is untyped CommonJS JavaScript.
- [ ] No root npm workspace/package manifest coordinates the two packages.
- [ ] No migration version table or migration CLI exists.
- [ ] No production observability, backup automation, or CI configuration exists.
- [ ] `frontend/tsconfig.tsbuildinfo` is tracked even though it is a generated TypeScript build cache.

## Recently Completed

Verified in source and `docs/improvement-2026-09-15.md`:

- [x] Added Groq → Gemini → OpenRouter multi-provider fallback and per-provider request pacing.
- [x] Added provider/model cooldowns, bounded timeouts, invalid-output detection, and retry controls.
- [x] Added per-user world-task serialization and seed idempotency.
- [x] Corrected reply targeting and chronology for generated conversations.
- [x] Added existing-post refresh and cursor pagination.
- [x] Replaced generated trends with per-user hashtag aggregation requiring no LLM call.
- [x] Added resident profiles, nested reply targeting, and AI-world regeneration.
- [x] Added Japanese question/call detection, prompt response scheduling, and repair of recently missed replies.
- [x] Strengthened prompts against fictional-character impersonation when the interest is a work/franchise.
- [x] Added backend provider, smoke, tenancy, and world regression tests.
- [x] Expanded root README and created this AI-development documentation set.
- [x] Established the GitHub repository at `https://github.com/yuyuyu02h/soloverse.git` with `main` as the default branch.
- [x] Verified local `HEAD` and `origin/main` both point to initial commit `3127e0d`.
- [x] Added a comprehensive staged implementation plan in `ROADMAP.md`.
- [x] Set the current direction to personal creative quality, not a full public launch.
- [x] Documented current provider free-tier behavior and a quota-efficient expansion plan in `docs/LLM_FREE_TIER.md`.

## Notes

- Do not use a real `.env`, API key, or developer DB for automated tests.
- Do not delete `backend/soloverse.db` as a routine upgrade step.
- Run one background-job-enabled backend process unless distributed coordination is implemented.
- Use `ROADMAP.md` for implementation order; keep this file focused on current actionable work and blockers.
- Keep `[TODO]` markers until the owner supplies a decision; do not silently convert unknown product decisions into requirements.

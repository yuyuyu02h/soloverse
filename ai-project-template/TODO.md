# TODO.md

## Current Objective

[TODO: The project owner must choose the next objective. The code and existing README do not establish whether the next milestone is local/private stabilization, public deployment, product expansion, or security hardening.]

## Now

- [ ] [TODO: Confirm the intended release target: local prototype, private hosted application, or public service.]
- [ ] [TODO: Confirm whether this directory should become the authoritative Git repository or whether history must be restored from another source.]
- [ ] [TODO: Prioritize the open security and production-readiness items below.]

## Next

These are verified gaps, but their ordering requires owner approval.

- [ ] Define production hosting, persistent SQLite storage, HTTPS, CORS origin, reverse-proxy trust, process supervision, and one active background-job runner.
- [ ] Define backup frequency, backup destination, retention, restore procedure, and a recovery test.
- [ ] Add CI for backend tests, frontend typecheck, and frontend build.
- [ ] Decide and configure lint/format tooling.
- [ ] Decide whether to enable TypeScript `strict` mode and plan incremental fixes.
- [ ] Batch timeline reply-preview queries to remove the per-post N+1 query.
- [ ] Add database-enforced integrity or explicit cleanup guarantees for logical post, queue, notification, and polymorphic author references.
- [ ] Create explicit, versioned, atomic migrations with documented rollback/recovery behavior.
- [ ] Resolve `frontend/package.json` (`UNLICENSED`) versus `frontend/package-lock.json` (`ISC`) license metadata mismatch.

## Later

- [ ] [TODO: Decide whether email verification, password reset, account deletion, and session management are required.]
- [ ] [TODO: Decide whether real-time delivery should replace or supplement 30-second polling.]
- [ ] [TODO: Decide whether public multi-user social interaction is intentionally out of scope.]
- [ ] [TODO: Decide whether images/uploads are in scope and define storage and moderation before implementation.]
- [ ] Add structured operational logging and metrics for request failures, provider fallbacks, quota/rate limits, queue depth, retries, and job duration.
- [ ] Add browser E2E tests for registration, onboarding, timeline updates, nested replies, notifications, and world regeneration.
- [ ] Evaluate distributed queue/lock/storage architecture only if multiple backend instances become a requirement.

## Blocked

- [ ] Git history review

Reason:

The current project root has no `.git` directory. Git commands also cannot be used in this macOS environment until the Xcode license is accepted. A similarly named sibling project has Git metadata, but it is not evidence for this directory's history.

- [ ] Production deployment documentation

Reason:

[TODO: Hosting provider, domain, traffic level, availability target, budget, data-retention policy, and operations owner are not specified in code or documentation.]

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

## Notes

- Do not use a real `.env`, API key, or developer DB for automated tests.
- Do not delete `backend/soloverse.db` as a routine upgrade step.
- Run one background-job-enabled backend process unless distributed coordination is implemented.
- Keep `[TODO]` markers until the owner supplies a decision; do not silently convert unknown product decisions into requirements.

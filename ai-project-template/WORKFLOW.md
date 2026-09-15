# WORKFLOW.md

## Standard Development Workflow

Use this workflow unless a task explicitly requires something different.

## 1. Understand

Read:

- the user's current request
- `ai-project-template/AGENTS.md`
- `ai-project-template/PROJECT.md`
- relevant sections of `ARCHITECTURE.md`, `SECURITY.md`, and `TODO.md`
- `ROADMAP.md` when choosing, scoping, or completing milestone work
- root `README.md`
- `docs/improvement-2026-09-15.md` when changing existing world behavior

Do not inspect actual `.env` values or DB contents unless the task explicitly requires that evidence. Never copy secrets or user data into output.

## 2. Investigate

Identify:

- whether the change is frontend, API, DB, background worker, or LLM behavior
- all reads and writes keyed by `user_id`
- external LLM calls and possible free-tier consumption
- behavior for an existing SQLite database
- possible race conditions between HTTP requests, the 30-second queue worker, and the five-minute engine dispatcher
- whether the change affects AI-world regeneration
- existing tests that cover the behavior

For bugs, gather evidence before editing. Prefer a temporary test DB and mock provider over the developer's real DB and API keys.

## 3. Plan

Choose the smallest change that preserves:

- account/world isolation
- existing database compatibility
- Groq → Gemini → OpenRouter fallback
- real-key-free automated tests
- single-runner background-job assumptions
- current API response behavior unless the task calls for an API change

If a product choice cannot be inferred, write `[TODO]` or ask the project owner instead of deciding silently.

## 4. Implement

Project conventions:

- Backend: CommonJS JavaScript, Express routers, parameterized `@libsql/client` queries.
- Frontend: Next.js App Router client components, TypeScript/TSX, React local state, existing inline-style/CSS-variable approach.
- LLM access: only through `backend/src/services/llm.js`.
- Per-user generation: use the existing serialization helper when work can overlap background generation.
- Schema: keep startup migration compatibility and back up real DBs before manual migration.
- Dependencies: do not add one unless the current stack cannot reasonably solve the problem.

Prefer:

```text
small change → focused check → next change → full relevant checks
```

## 5. Validate

### Backend

```bash
npm --prefix backend test
```

The suite uses Node's test runner, temporary SQLite databases, and local mock LLM HTTP servers. It must not use configured real API keys. Current coverage includes:

- provider/model fallback and cooldown behavior
- missing-key behavior
- registration, login, onboarding, seeding, post, reply, like, notification-related data flow
- cross-user post access rejection
- AI-world regeneration preserving user-authored posts
- seed idempotency and per-user serialization
- reply targets/timestamps and nested threads
- hashtag trend aggregation without LLM use
- questions/calls receiving scheduled replies, including repair of old misses
- resident-growth timing and limit behavior

### Frontend

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

There is no configured lint or formatter command.

```text
[TODO: Select and add lint/format checks, then update this workflow.]
```

### Manual checks when UI behavior changes

1. Register a new account.
2. Complete all four onboarding steps.
3. Confirm seed posts appear once.
4. Create a normal post and a question without a question mark.
5. Confirm the question displays a scheduled-response notice.
6. Wait for polling/queue processing and confirm counts and replies update without reload.
7. Reply to a root and a nested reply.
8. Open notifications and confirm unread count clears.
9. Add a hashtag and confirm trend aggregation after the engine pass.
10. If regeneration changed, confirm the account and user posts remain while AI data is replaced.
11. Repeat an object request using another account and confirm it cannot access the first account's data.

Manual checks that call a configured provider can consume free-tier quota; state this before running them.

## 6. Review

Review the final changed-file list, status, and diff. The authoritative remote is `origin` (`https://github.com/yuyuyu02h/soloverse.git`) and the default branch is `main`.

Check for:

- accidental `.env`, DB, build-output, or `node_modules` changes
- secrets, user content, tokens, or password hashes
- SQL missing a `user_id` ownership condition
- direct provider calls outside `llm.js`
- unbounded user or provider input
- broken existing-DB behavior
- duplicate background jobs or retry loops
- debug logging or prompt/content logging
- package-lock changes without a requested dependency change
- documentation made inaccurate by the implementation

Do not commit, push, force-push, or change branch protections unless the project owner explicitly requests it. [TODO: Define the normal branch, pull-request, review, and release conventions.]

## 7. Document

Update only the documents affected by the work:

- `PROJECT.md`: scope, status, stack, or environment changes
- `ARCHITECTURE.md`: routes, data flow, storage, background jobs, or external-service changes
- `SECURITY.md`: auth, authorization, secrets, data, or external-service risk changes
- `TODO.md`: newly found or completed work
- `ROADMAP.md`: milestone ordering, scope, dependencies, or completion status
- `docs/DECISIONS.md`: durable technical/product choices and their trade-offs
- `docs/HANDOFF.md`: current state, validation, unresolved work, and starting points
- root `README.md`: developer-facing setup and operation

## Bug Investigation Workflow

```text
Symptom
  ↓
Reproduce with temporary data where possible
  ↓
Collect logs, DB facts, and relevant source behavior
  ↓
Form one or more testable hypotheses
  ↓
Add or run a focused regression test
  ↓
Identify the root cause
  ↓
Implement the smallest safe fix
  ↓
Run focused and full relevant checks
  ↓
Review tenant, quota, and existing-DB risks
```

Do not modify multiple components speculatively and then infer the cause from an apparent improvement.

## Database Change Workflow

1. Describe the existing schema and affected data.
2. Confirm the target DB path without printing DB contents.
3. Design migration behavior for an existing DB.
4. Add a temporary-DB migration/regression test.
5. Back up material real data before an approved manual migration.
6. Avoid asking developers to delete `soloverse.db` as the default upgrade path.
7. Document rollback/recovery limitations.

## LLM Change Workflow

1. Keep provider-neutral behavior in `llm.js` where possible.
2. Preserve missing-key skipping and configured model order.
3. Bound request and total timeouts.
4. Avoid logging prompts, keys, or generated private content.
5. Validate JSON and text output before persistence.
6. Add mock-provider tests for success, rate limit, malformed output, and fallback behavior as relevant.
7. Consider quota multiplication caused by retries, onboarding batches, regeneration, and background jobs.

## Handoff Workflow

Before handing the project to another agent/session, update `docs/HANDOFF.md` with:

- current objective
- completed work
- exact files changed
- checks actually executed and their results
- checks not run and why
- unresolved issues and owner questions
- next recommended action
- risky files and assumptions

# AGENTS.md

## Purpose

This file defines the rules AI coding agents must follow when working on this project.

Read this file before making changes.

Also read:

- PROJECT.md
- ARCHITECTURE.md
- SECURITY.md
- WORKFLOW.md
- TODO.md
- ROADMAP.md
- docs/LLM_FREE_TIER.md when changing providers, model order, generation cadence, quota handling, or LLM usage

when relevant to the task.

---

## Core Principles

1. Understand before modifying.
2. Prefer the smallest change that solves the problem.
3. Do not introduce unnecessary dependencies or architectural changes.
4. Do not assume missing requirements.
5. Clearly distinguish facts from assumptions.
6. Preserve existing behavior unless the requested task requires changing it.
7. Do not silently change unrelated code.

---

## Before Making Changes

Before editing code:

1. Inspect the relevant files.
2. Understand the existing implementation.
3. Check PROJECT.md and ARCHITECTURE.md.
4. Check TODO.md for current project state.
5. Check SECURITY.md if the task involves:
   - authentication
   - authorization
   - payments
   - secrets
   - databases
   - external APIs
   - user data
6. Identify the minimum files that need modification.

For significant changes, briefly state the intended approach before implementation.

---

## Implementation Rules

Prefer:

- existing project conventions
- existing dependencies
- simple implementations
- type-safe code
- reusable existing utilities
- minimal diffs

Avoid:

- unnecessary rewrites
- speculative abstractions
- unrelated refactoring
- duplicate utilities
- adding dependencies without a clear reason
- changing architecture without justification

---

## Validation

After making changes, run the relevant available checks.

Examples:

- tests
- type checking
- lint
- build
- formatting
- relevant application-specific checks

Do not claim a check passed unless it was actually executed successfully.

If a check cannot be run, explicitly state why.

---

## Git Rules

Before completing significant work:

1. Review the diff.
2. Check for accidental changes.
3. Check for secrets.
4. Confirm only relevant files changed.

Never perform the following without explicit permission:

- force push
- history rewriting
- destructive reset
- branch deletion
- tag deletion
- destructive cleanup of untracked files

Do not commit secrets.

---

## Documentation

Update documentation when implementation changes make existing documentation inaccurate.

Update:

- ARCHITECTURE.md for architectural changes
- TODO.md when task status changes
- ROADMAP.md when milestone scope, ordering, or completion status changes
- docs/DECISIONS.md for important technical decisions
- docs/HANDOFF.md when handing work to another agent/session

Do not update documentation merely to create noise.

---

## User Authority

The project owner has final authority.

Explicit user instructions override project defaults unless they would cause an unsafe or clearly destructive action.

When requirements conflict, identify the conflict instead of silently choosing one.

---

## Project-Specific Rules

1. Read the root `README.md` and `docs/improvement-2026-09-15.md` before changing runtime behavior.
2. Do not add or restore a local LLM integration. All model calls currently go through `backend/src/services/llm.js` to Groq, Gemini, and OpenRouter.
3. Never read, print, copy, or commit actual values from `backend/.env` or data from `backend/soloverse.db` unless the owner explicitly requests a narrowly scoped data investigation. Prefer `.env.example` and test fixtures.
4. Preserve tenant isolation. Every route that handles world data must derive the user ID from verified authentication and scope reads/writes to that `user_id`.
5. When adding an object endpoint, test both successful access by the owner and rejection of another user's object ID.
6. Keep LLM provider behavior centralized in `backend/src/services/llm.js`. Do not call provider APIs directly from routes or other services.
7. Keep real API keys out of tests. Backend tests use temporary SQLite databases and mock HTTP LLM servers.
8. Preserve existing databases. Prefer additive or compatible startup migrations; do not require developers to delete `soloverse.db` for ordinary updates.
9. Treat changes to `schema.js`, authentication, world regeneration, queue processing, and background scheduling as high-risk. Review failure behavior and existing-data behavior explicitly.
10. Background jobs are designed for one active runner. Do not enable multiple job-running replicas without adding distributed locking/idempotency and documenting the change.
11. Frontend and backend are separate npm packages; use `npm --prefix frontend ...` and `npm --prefix backend ...` from the project root.
12. For backend changes, run `npm --prefix backend test`. For frontend changes, run both `npm --prefix frontend run typecheck` and `npm --prefix frontend run build`.
13. No lint or formatting script currently exists. Do not claim lint passed; [TODO: choose and configure lint/format tooling].
14. Update `ARCHITECTURE.md`, `SECURITY.md`, `TODO.md`, `docs/DECISIONS.md`, and `docs/HANDOFF.md` only when the change affects their subject.
15. The authoritative repository is `https://github.com/yuyuyu02h/soloverse.git`; the default branch is `main`. Review local status and diff before completion, but do not commit or push unless the project owner explicitly requests it. [TODO: define branch, pull-request, review, and release conventions].

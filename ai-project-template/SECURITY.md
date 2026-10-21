# SECURITY.md

## Purpose

This file defines security requirements and records security-relevant facts for SoloVerse. Security-sensitive changes require additional review and validation.

## 2026-09-16: Candidate pipeline and recovery

- Owner-requested private snapshots copy source, configuration and a consistent DB without printing their contents. `.recovery/` is ignored by Git; folders use mode 0700 and secret copies 0600. Never upload the snapshot to GitHub or an external model.
- Restoration verifies SHA-256 and requires a new destination. Keep the original project; do not use a destructive Git reset or DB deletion. See [recovery guide](../docs/RESTORE_2026-09-16.md).
- API telemetry stores numeric usage/status and fixed reason codes, not keys, prompts, provider error bodies or generated text. User IDs and usage metadata remain sensitive. Completed telemetry/candidates are pruned after 30 days by the enhanced worker.
- Candidate text, profiles and memory are tenant data. `/api/timeline/diagnostics` derives its user from JWT; provider-wide quota headers are local-operator-only. User-supplied query IDs cannot select another tenant.
- Structured context is sent to the selected cloud LLM, like existing posts/settings. Lightweight quality checks are not a complete safety/moderation or prompt-injection defense.
- Internal budgets do not guarantee zero billing; provider account settings remain authoritative. Only one active job runner is supported.

## Data Classification

Treat the following as confidential or sensitive:

- API keys and JWT signing secrets
- Passwords and password hashes
- Bearer tokens
- Email addresses and account identifiers
- User posts, replies, interests, exclusions, and world settings
- AI-generated content associated with a user
- SQLite database files and backups
- `.env` and other environment-specific configuration files

The repository currently contains a local `backend/.env` and a SQLite DB. Their contents must not be copied into documentation, logs, issues, commits, or AI prompts used for unrelated work.

## Secrets

Never expose or commit:

- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `JWT_SECRET`
- passwords, password hashes, JWTs, cookies, or DB contents

Use `backend/.env.example` only for variable names and safe placeholder values. The actual `backend/.env` is ignored by both root and backend ignore rules.

Current controls:

- The backend exits if `JWT_SECRET` is absent or equals a known weak placeholder.
- Production requires a JWT secret of at least 32 characters.
- `/api/health` reports only whether LLM access is configured and the provider/model labels; it does not return keys.
- LLM calls place keys only in server-side authorization headers.

[TODO: Define the production secret manager and rotation procedure.]

## Environment Files

Sensitive files include:

```text
.env
.env.local
.env.production
.env.development
backend/soloverse.db
*.db-wal
*.db-shm
```

Before any commit or release:

1. Confirm these paths remain ignored.
2. Inspect the proposed change for copied secret values or user data.
3. Never paste full environment files into debugging output.
4. Use explicit placeholder values in examples.

## User Input

All browser and external-service data is untrusted.

Current server-side validation includes:

- Email presence, simple format, lowercase normalization, and maximum length
- Password length from 8 to 128 characters
- Username presence and maximum length 30
- Onboarding enum allowlists and a 300-character interests limit
- Post presence and 140-character limit
- Reply target type and ownership checks
- Timeline ID list maximum of 100
- 32 KB JSON body limit
- Parameterized SQL values
- Basic type/length normalization of LLM-generated resident objects
- JSON validation/recovery and heuristic reasoning-leak detection for LLM responses

Gaps to account for:

- Email syntax validation is intentionally simple and does not prove ownership.
- LLM output safety relies substantially on prompts and heuristics, not a separate moderation service.
- User text is included in LLM prompts and can contain prompt-injection attempts.
- Frontend rendering uses React text nodes, which reduces direct HTML injection risk; do not introduce raw HTML rendering for post content without sanitization.

## Database

Requirements:

- Continue using parameterized values for all user-controlled SQL input.
- Every cross-user object access must include the authenticated `user_id`.
- Back up the SQLite DB before schema migration or manual repair.
- Do not delete or reset production data without explicit owner approval and a verified target path.
- Preserve `PRAGMA foreign_keys = ON` behavior.

Known integrity gaps:

- `posts.reply_to` is not a database foreign key.
- Polymorphic `posts.author_id` is not a database foreign key.
- `reaction_queue.character_id/post_id` and `notifications.character_id/post_id` are not database foreign keys.
- Startup cascade migration rebuilds tables and should be reviewed before production-scale data is used.

## Authentication

Current implementation:

- Passwords are hashed with bcrypt cost 10.
- JWTs are signed with `JWT_SECRET` and expire after 30 days.
- JWT payload contains `userId`.
- Middleware verifies the signature and checks that the user still exists.
- Registration and login share an IP-based in-memory limiter of 10 attempts per 15 minutes.
- Frontend stores JWTs in `localStorage`.

Required care:

- Never weaken password hashing or JWT verification for convenience.
- Do not trust the user object stored in `localStorage`; the backend already re-reads `/api/auth/me`.
- Preserve generic login failure messages so account existence is not disclosed by login.

Open production questions:

- [TODO: Decide whether to replace localStorage Bearer tokens with Secure, HttpOnly, SameSite cookies.]
- [TODO: Define JWT revocation/logout-all behavior and signing-key rotation.]
- [TODO: Replace or supplement the in-memory limiter with a persistent/distributed control before multi-instance or public deployment.]
- [TODO: Decide email verification, password recovery, MFA, and account deletion requirements.]

## Authorization

Authentication does not imply authorization.

Current controls:

- Protected endpoints derive `userId` from the verified JWT, not request bodies.
- Timeline, world, post, reply, like, notification, trend, resident, and regeneration queries are scoped to that `userId`.
- Reply and like targets are verified to be in the same user's world.
- Integration tests cover cross-user attempts to like, reply to, and fetch another user's post.

When adding an endpoint, add both a successful ownership test and a cross-user rejection test.

## Web Security

Current controls:

- Explicit CORS allowlist, defaulting to the local frontend origin
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- Referrer policy
- Permissions policy disabling camera, microphone, and geolocation
- Express `x-powered-by` disabled
- Next.js `poweredByHeader` disabled
- JSON body size limit

Known gaps / decisions required:

- No Content-Security-Policy is configured.
- HTTPS and HSTS depend on the undeclared production hosting layer.
- Bearer tokens in localStorage increase impact if an XSS vulnerability is introduced.
- No CSRF token is used; current API auth uses an explicit Bearer header rather than cookies. Reassess CSRF if cookie authentication is adopted.
- [TODO: Define the allowed production origins and reverse-proxy trust configuration.]

## External LLM Services

- Groq, Gemini, and OpenRouter receive server-generated prompts that can include user interests, posts, and recent conversation text.
- In `admired` worlds, the audience-director prompt sends the new user post plus world interests, atmosphere, and exclusions. Simulated engagement counts and local audience identities are not sent to the provider.
- API availability, data handling, retention, and free-tier terms are external dependencies and can change.
- Provider responses are untrusted input. Continue to bound lengths, validate JSON, and avoid unsafe HTML rendering.
- The current code logs provider/model labels and provider error messages, but not prompts or API keys. Review error logging before production because provider messages are externally controlled.

[TODO: Publish a privacy disclosure covering which data is sent to each enabled LLM provider, retention expectations, and user consent.]

[TODO: Decide whether a separate moderation and abuse-detection layer is required for user input and generated output.]

## Payments

No payment implementation is present.

[TODO: If payments are added, document server-side price validation, webhook signature verification, idempotency, and secret handling before implementation.]

## Destructive Operations

Require explicit user approval before:

- deleting or replacing production data
- dropping or rebuilding tables manually
- deleting accounts or worlds
- rotating production credentials
- modifying production authorization controls
- force pushing or rewriting Git history

The in-app world regeneration endpoint is intentionally destructive only to the authenticated user's AI residents, AI posts, AI reactions, celebrity audience scenes/comments, AI notifications, trends, and growth data. It preserves the account and user-authored posts, and the UI presents a confirmation first.

## Security Validation Checklist

For authentication, authorization, database, or external-service changes:

1. Run `npm --prefix backend test`.
2. Add or update cross-user isolation coverage.
3. Confirm no real API key is used by tests.
4. Review `.env`/DB ignore rules and the final changed-file list.
5. Check that new SQL values are parameterized.
6. Check request size, type, enum, ownership, and length boundaries.
7. Run `npm --prefix frontend run typecheck` and `npm --prefix frontend run build` for client changes.
8. Record unresolved security work in `TODO.md`.

## Current Security Findings

| Severity | Finding | Current mitigation / status |
|---|---|---|
| High if publicly deployed | No email verification, recovery, revocation UI, abuse reporting, or moderation operations | Prototype/individual-use posture is stated in README; production requirements are `[TODO]` |
| Medium | JWT is kept in `localStorage` for 30 days | React does not render raw post HTML; no CSP is present; authentication design decision remains `[TODO]` |
| Medium | Login rate limit is process-local and reset on restart | 10 attempts/15 minutes/IP in one process; replace before multi-instance/public use |
| Medium | User and conversation data is sent to external LLMs | API keys remain server-side; privacy disclosure/consent is `[TODO]` |
| Medium | Generated content is controlled mainly by prompts and simple heuristics | Output length/JSON checks exist; independent moderation is `[TODO]` |
| Low/Integrity | Several logical relationships lack DB foreign keys | API ownership checks and regeneration cleanup reduce risk; schema hardening remains open |
| Low | CSP/HSTS are not configured in the application | Other security headers exist; production proxy/deployment is `[TODO]` |

The accepted current scope is personal/local use, not public launch. Public-only findings remain recorded for future reconsideration, while secret protection, external-LLM data awareness, tenant isolation, and recoverable database handling still apply now. Severity must be reassessed if the release scope changes.

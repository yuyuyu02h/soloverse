# 🐦 The Flock — Full-Stack Twitter Clone

> A production-ready Twitter/X clone built as a technical challenge for **The Flock · Managed Software Teams**.  
> Fully functional social network with real-time updates, infinite scroll, image uploads, and a polished mobile-first UI.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma)](https://www.prisma.io)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **Auth** | Register / login with JWT stored in HTTP-only cookies (bcrypt cost 12) |
| 📝 **Tweets** | Create, delete, reply — up to 280 characters with optional image |
| 🖼️ **Image uploads** | Drag-and-drop or click-to-upload (JPEG, PNG, GIF, WEBP, max 5 MB) |
| ❤️ **Likes** | Optimistic UI — instant visual feedback, synced to the server |
| 👥 **Follow system** | Follow / unfollow with hover "Unfollow" state; follower/following counts |
| ⚡ **Real-time timeline** | Server-Sent Events (SSE) push new tweets instantly to all followers |
| 🔔 **Notifications** | In-app notifications for likes, follows, and replies with unread badge |
| 🔁 **Reply threads** | Nested reply chain with parent context on the tweet detail page |
| 🔍 **Search** | Debounced full-text search across usernames and display names |
| 📱 **Mobile-first** | Responsive layout with bottom nav, floating compose button (FAB) |
| ♾️ **Infinite scroll** | Cursor-based pagination — no LIMIT/OFFSET drift on fast-moving feeds |
| 🎨 **Skeleton screens** | Shimmer loading states instead of spinners |
| 🍞 **Toast notifications** | Non-blocking success/error feedback for all user actions |
| ⚙️ **Edit profile** | Change display name, bio, and avatar photo |
| 👀 **Who to follow** | Right-panel suggestions of users you're not following yet |
| 🐳 **Docker Compose** | One-command local setup with health-checked PostgreSQL |

---

## 🖥️ Screenshots

| Timeline | Profile | Mobile |
|----------|---------|--------|
| Skeleton loading → feed with SSE "Show N new tweets" banner | Header, banner, tabs (Tweets / Followers / Following) | Bottom nav + floating compose FAB |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router, TypeScript, Turbopack) |
| Styling | **Tailwind CSS v4** — utility-first, no config file |
| Database | **PostgreSQL 16** |
| ORM | **Prisma 7** with `@prisma/adapter-pg` driver adapter |
| Auth | **Custom JWT** via `jose` + `bcryptjs`, HTTP-only SameSite=Lax cookies |
| Real-time | **SSE (Server-Sent Events)** via in-memory `SSEBus` singleton |
| Validation | **Zod v4** |
| Testing | **Jest + ts-jest** (unit/integration), **Playwright** (E2E) |
| Containerisation | **Docker Compose** (multi-stage Dockerfile) |

---

## 🚀 Quick Start

### Option A — Local (Node.js + PostgreSQL)

**Prerequisites:** Node.js 20+, PostgreSQL 16+

```bash
git clone https://github.com/QuilaguyPrime/the-flock.git
cd the-flock
npm install

# Copy env file — edit DATABASE_URL if your Postgres uses different credentials
cp .env.example .env.local

# Create the database
createdb the_flock

# Generate Prisma client + create schema
npx prisma generate
npx prisma migrate dev --name init

# Seed with 11 sample users
npm run db:seed

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Option B — Docker Compose (zero local PostgreSQL needed)

```bash
git clone https://github.com/QuilaguyPrime/the-flock.git
cd the-flock

# Start app + database
docker compose up --build -d

# Run migrations
docker compose run --rm migrate

# Seed sample data
docker compose exec app npx tsx prisma/seed.ts
```

Open [http://localhost:3000](http://localhost:3000).

---

## 🔑 Sample Credentials

All seeded accounts share the password **`password123`**.

| Email | Username | Notes |
|-------|----------|-------|
| `demo@example.com` | `demo` | Demo account |
| `alice@example.com` | `alice` | Active user |
| `bob@example.com` | `bob` | Active user |
| `carol@example.com` | `carol` | Active user |
| … | `david`, `emma`, `frank`, `grace`, `henry`, `isabel`, `jack` | More accounts |

---

## 📁 Project Structure

```
the-flock/
├── app/
│   ├── (auth)/              # Login & register pages
│   ├── (main)/              # Authenticated layout + all pages
│   │   ├── timeline/        # Home feed
│   │   ├── search/          # People search
│   │   ├── notifications/   # Activity feed
│   │   ├── settings/        # Edit profile
│   │   ├── [username]/      # Profile page (tweets / followers / following)
│   │   └── [username]/status/[tweetId]/  # Tweet detail + replies
│   ├── api/                 # All route handlers
│   │   ├── auth/            # register, login, logout, me
│   │   ├── tweets/          # CRUD + likes + replies
│   │   ├── timeline/        # Paginated feed
│   │   ├── users/           # Profile, follow, search, suggestions
│   │   ├── events/          # SSE stream
│   │   ├── upload/          # Image upload
│   │   └── notifications/   # Activity + mark read
│   └── generated/prisma/    # Prisma generated client (gitignored)
├── components/              # Shared UI components
│   ├── AuthProvider.tsx     # Session context
│   ├── Toast.tsx            # Toast notification system
│   ├── TweetCard.tsx        # Single tweet display
│   ├── TweetComposer.tsx    # Compose box with image upload
│   ├── TweetSkeleton.tsx    # Shimmer loading state
│   ├── Timeline.tsx         # Feed with SSE + infinite scroll
│   ├── Sidebar.tsx          # Desktop navigation
│   ├── MobileNav.tsx        # Mobile bottom navigation
│   ├── ComposeFAB.tsx       # Mobile floating compose button
│   ├── WhoToFollow.tsx      # Suggestions panel
│   ├── LikeButton.tsx       # Optimistic like
│   ├── FollowButton.tsx     # Follow / Unfollow toggle
│   └── Avatar.tsx           # Image avatar with initials fallback
├── lib/
│   ├── auth.ts              # JWT sign/verify, cookie helpers
│   ├── db.ts                # Prisma singleton with PG adapter
│   ├── sse.ts               # SSE bus (pub/sub singleton)
│   ├── utils.ts             # cn(), formatRelativeTime(), etc.
│   └── useUnreadNotifications.ts  # Hook for notification badge
├── prisma/
│   ├── schema.prisma        # DB models
│   ├── migrations/          # SQL migration history
│   └── seed.ts              # Sample data
├── proxy.ts                 # Auth proxy (Next.js 16 middleware)
├── prisma.config.ts         # Prisma 7 datasource config
├── Dockerfile               # Multi-stage production image
└── docker-compose.yml       # App + PostgreSQL + migrate service
```

---

## 🏛️ Architecture Highlights

### Authentication
Custom JWT flow — no third-party providers. Tokens are signed with HS256 (`jose` library), stored as HTTP-only SameSite=Lax cookies, and verified in the proxy layer before any route renders. Password hashing uses bcrypt with cost factor 12 (~250ms/hash, sufficient brute-force resistance).

### Real-time Feed
A singleton `SSEBus` in `lib/sse.ts` maintains a `Map<userId, Set<callback>>`. When a tweet is created, the API finds all followers and calls `sseBus.publishToMany()`. Each follower's open `/api/events` connection receives the event over SSE, and the client appends it to a pending queue shown as a "Show N new tweets" banner — **no polling, no WebSocket overhead**.

> **Scaling note**: The in-memory bus works for single-process deployments. For multi-instance production, replace it with Redis Pub/Sub.

### Pagination
Timeline and profile feeds use **cursor-based pagination** (`id` as cursor, cuid2 is time-ordered). This avoids the classic LIMIT/OFFSET drift problem where rows inserted between pages cause items to be skipped or duplicated. The API fetches `PAGE_SIZE + 1` items; if the extra item exists, `hasMore = true` and it's trimmed from the response.

### Database Schema

```
User ─── Tweet (authorId)  1:N
       ─── Tweet (parentId) 1:N  (self-referential replies)
User ─── Like (userId, tweetId)   composite PK
User ─── Follow (followerId, followingId)  composite PK
User ─── Notification
```

All foreign keys have `onDelete: Cascade` so deleting a user cleans up all their data atomically.

---

## 🧪 Testing

```bash
# Unit + integration tests
npm test

# With coverage report
npm run test:coverage

# E2E tests (server must be running on :3000)
npm run dev &
npm run test:e2e
```

Tests use **Jest + ts-jest** with a mocked Prisma client for fast, isolated unit tests. E2E tests use **Playwright** with Chromium and a Pixel 5 mobile viewport.

---

## 🐳 Docker Reference

```bash
# Start everything
docker compose up --build

# Run migrations only
docker compose run --rm migrate

# Stop and remove containers
docker compose down

# Remove volumes too (wipes database)
docker compose down -v
```

The `uploads` volume persists user-uploaded images across container restarts.

---

## ⚖️ Known Trade-offs

| Area | Current approach | Production alternative |
|------|-----------------|----------------------|
| SSE scaling | In-memory bus (single process only) | Redis Pub/Sub |
| Image storage | `public/uploads/` on disk | S3 / Cloudflare R2 |
| JWT strategy | 30-day token, no refresh | Short-lived access + refresh tokens |
| Test DB | Mocked Prisma (fast, but less realistic) | Dedicated test Postgres instance |

---

## 🤖 Agentic engineering

The code in this repo was generated with **[Claude Code](https://claude.ai/code)** (claude-sonnet-4-6). The architecture was not. This section describes how the two fit together.

### 1. Decisions taken before any code was generated

These were settled first, and the prompts were written against them. Each one closed off alternatives that would have been cheaper to type and worse to live with.

**Data model and its relations.** Five models, with the shape of the join tables decided up front. `Like` and `Follow` carry composite primary keys — `@@id([userId, tweetId])` and `@@id([followerId, followingId])` — rather than surrogate `id` columns, so "like twice" and "follow twice" are impossible at the database level instead of being guarded by application code that can be bypassed by a second concurrent request. Replies are a self-relation on `Tweet` (`parentId → Tweet.id`) rather than a separate `Reply` model, because a reply *is* a tweet: one table, one timeline query, one delete path. Every foreign key is `onDelete: Cascade`, so deleting a user removes their tweets, likes, follows, and notifications in a single transaction rather than leaving orphans behind.

**The API contract.** REST route handlers under `app/api/`, with the response shapes fixed before the routes existed. Paginated collections return an envelope — `{ items, nextCursor, hasMore }` — so the client never has to infer the end of a feed from a short page. Single resources return the object directly. Errors are always `{ error: string }` with a real status code, which is what makes the frontend's `if (!res.ok)` branches uniform across every component. Auth state is derived server-side in `proxy.ts` before a route renders; no route handler re-implements it.

**Own JWT with `jose`, not an external provider.** NextAuth or Clerk would have been a five-minute install and would have made the auth layer someone else's black box. The challenge is a demonstration of backend work, so the token lifecycle is explicit and readable: HS256 signing in [lib/auth.ts](lib/auth.ts), a `tf_token` HTTP-only `SameSite=Lax` cookie, `secure` in production, verification in the proxy layer, bcrypt cost 12 (~250 ms/hash). `jose` over `jsonwebtoken` specifically because it runs on the Web Crypto API and therefore works in the Edge runtime, where `jsonwebtoken`'s Node crypto dependency does not — that constraint is what makes proxy-level verification possible at all.

**SSE over WebSockets.** The real-time requirement here is one-directional: the server tells the client a new tweet exists. WebSockets buy bidirectional messaging that this app never sends, and cost a second protocol, a connection lifecycle to manage, and a proxy configuration that has to be told not to buffer or terminate the upgrade. SSE is a plain HTTP response that carries the browser's own reconnect semantics for free. `/api/events` holds a `ReadableStream` per user, [lib/sse.ts](lib/sse.ts) is a `Map<userId, Set<listener>>`, and tweet creation resolves the author's followers and publishes to them. The known limit is stated rather than hidden: an in-memory bus is single-process, and multi-instance deployment means Redis Pub/Sub behind the same `sseBus` interface.

**Cursor pagination over `LIMIT`/`OFFSET`.** A timeline receives writes while a user is scrolling it. With `OFFSET`, every tweet inserted between page 1 and page 2 shifts the window and the user re-reads a row they already saw — or skips one. Cursor pagination anchors on the last row's `id` instead of a numeric position, so concurrent inserts cannot shift it. `cuid()` ids are monotonic by generation time, which makes the id usable as the cursor without a second sort key. Each query takes `PAGE_SIZE + 1` rows and trims the extra, so `hasMore` is exact and never costs a `COUNT(*)`.

### 2. The working cycle

**plan → generate → audit → iterate**, one feature per prompt.

Each prompt produced one coherent unit of work — the schema, then auth, then the tweet and timeline routes, then the social/SSE/upload routes, then components, then pages, then tests. Nothing was generated until the previous unit had been read and committed, which is why the history reads as fifteen scoped commits rather than one drop. Reviewing before committing is the part that matters: a diff you have not read is a diff you cannot defend, and generation speed is worthless if it outruns the rate at which you can actually verify output. The audit pass at the end (`d0deb35`) was a deliberate step, not a reaction to a failure — a full read of backend and frontend looking for what the per-feature reviews had let through.

### 3. What the audit found

Six runtime bugs, plus a set of Next.js 16 convention fixes. The bugs the audit caught were, in every case, ones the happy path did not reveal:

| Bug | Failure mode |
|-----|--------------|
| `imageUrl` validated with `z.string().url()` | Every tweet with an image rejected (see below) |
| Tweet detail page called `r.json()` with no `r.ok` check | A 404 or 500 body was set as the tweet and the page crashed on render |
| SSE keep-alive error path cleared the interval but never unsubscribed | Dangling listener retained per dropped connection — a slow leak in `sseBus` |
| `TweetComposer` upload branch had no `else` | Failed upload posted the tweet anyway: `201`, image silently gone, no error shown |
| Logout set cookie `maxAge: 0` without `expires` | Session cookie not reliably cleared across browsers |
| `prisma.config.ts` did not load `.env.local` | Prisma CLI commands ran against the wrong `DATABASE_URL` |

**The Zod bug, in detail** — it is the one worth explaining, because the chain is three files long and each file is individually correct.

`POST /api/upload` writes to `public/uploads/` and returns a root-relative path, `{ url: "/uploads/<uuid>.jpg" }`, which is exactly right for an asset Next.js serves statically. `POST /api/tweets` validated that field as `imageUrl: z.string().url().optional()`. Zod's `.url()` requires an absolute URL with a scheme, so a root-relative path fails it — every single time. Text tweets were unaffected. Tweets with an image were rejected with a `400`, and the message that reached the composer was `"Invalid URL"` on a form that has no URL field in it.

Two things made it survive to the audit. The failure only exists at the seam between two files that are each defensible in isolation — the upload route is right to return a relative path, and validating a URL field with `.url()` is the reflexive correct-looking choice. And the symptom was misdirection: an error about a URL, on a form where the user typed text and picked a file. Compounding it, the composer's upload branch was `if (upRes.ok) { imageUrl = up.url }` with no `else`, so the adjacent failure mode — upload itself failing — produced a `201` with the image quietly dropped. One path errored for a reason that pointed at the wrong thing; the neighbouring path did not error at all.

The fix is one line, `z.string().url()` → `z.string()`, plus an early return in the composer. Finding it required reading the upload route and the tweet route against each other and noticing that the string one produces is not in the set the other accepts. That is the work this section is describing. Writing the components was the fast part.

---

## 📄 License

[MIT](LICENSE)

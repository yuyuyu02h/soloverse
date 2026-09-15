# LLM_FREE_TIER.md

> Implementation update (2026-09-16): the capacity estimates and code analysis below describe the pre-pool/legacy implementation as inspected on 2026-09-15. Enhanced generation now has batched candidates, internal budgets, lightweight quality checks and short memory; see [current implementation](../../docs/FREE_CONTENT_PIPELINE.md). Provider quotas were not rechecked during this implementation task. Internal daily limits must not be mistaken for provider allowances.

## Status and Scope

調査日: 2026-09-15

SoloVerseの現在の無料クラウドLLM構成、無料枠の更新周期、投稿数と品質への影響、無料のまま改善する方針を記録します。無料枠とモデル提供状況は変更されるため、実際のアカウント画面とAPIレスポンスを正本とします。

実APIキー、プロンプト本文、利用者投稿、DB内容はこの文書へ記録しません。

## Current Provider Order

```text
Groq
  openai/gpt-oss-120b
  qwen/qwen3.8-27b
  openai/gpt-oss-20b
    ↓ failure / cooldown
Gemini
  gemini-3.5-flash-lite
  gemini-3.1-flash-lite
  gemini-2.5-flash-lite
    ↓ failure / cooldown
OpenRouter
  openrouter/free
```

Missing API keys are skipped. A malformed, truncated, reasoning-leaking, rate-limited, unauthorized, timed-out, or server-error response can move execution to another model/provider.

## Current Public Free Limits

### Groq

Groq's public Free Plan table currently lists the following limits for the models configured by SoloVerse:

| Model | RPM | RPD | TPM | TPD |
|---|---:|---:|---:|---:|
| `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 |
| `qwen/qwen3.8-27b` | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |

Limits are organization-level, and the first exhausted dimension applies. The exact account limit must be checked in the Groq Limits page. API responses expose remaining request/token values and reset countdowns through `x-ratelimit-*` headers; Groq does not state one fixed reset clock on the cited page.

Source: [Groq Rate Limits](https://console.groq.com/docs/rate-limits)

### Gemini

Gemini Free Tier limits vary by project, model, tier, account status, and sometimes region. Google no longer publishes one universally reliable static number for every account on the main rate-limit page; the active values shown in Google AI Studio are authoritative.

- Limits are applied per project, not per API key.
- The measured dimensions normally include RPM, input TPM, and RPD.
- RPD resets at midnight Pacific time: normally 16:00 Japan time during daylight saving and 17:00 during standard time.
- Free Tier provides free input/output for eligible models, but model eligibility and available capacity can change.
- Free Tier content may be used to improve Google's products.

Sources: [Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### OpenRouter

For free models, the current published account-wide limit is:

- No qualifying credit purchase: 50 free-model requests per day total.
- At least USD 10 in purchased credits: 1,000 free-model requests per day.
- Free models also have low availability and are not presented as production-grade capacity.
- `openrouter/free` selects an available free model, so output behavior can vary between requests.

OpenRouter documents daily resets at midnight UTC for daily key/workspace limits. The free-model dashboard/activity view should be checked for the exact current reset. Midnight UTC is 09:00 Japan time.

Sources: [OpenRouter FAQ](https://openrouter.ai/docs/faq), [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/model-variants/free)

## Does the Free Tier Expire?

The cited providers describe recurring Free Plan/Free Tier allowances, not a one-time trial expiration date for these API calls. No fixed end date is currently stated. This is not a lifetime guarantee: providers can change eligible models, quotas, regions, account eligibility, or the free program itself without matching this repository's release cycle.

The practical rule is:

1. Treat free access as renewable daily capacity, not owned permanent capacity.
2. Read the provider dashboard before changing defaults.
3. Handle 429 and model removal without data loss.
4. Keep model IDs configurable through environment variables.

## Why the Timeline Can Look Sparse

The current implementation itself limits visible content:

- Initial seeding requests at most eight posts and saves at most one per resident.
- Seed timestamps are intentionally distributed over the previous one to 72 hours; labels such as “2日前” do not mean the server ran for two days.
- The first autonomous run is normally eligible after the configured 15-minute interval.
- Autonomous generation requests four to six items per run.
- Returned items are discarded when the username is unknown, content is empty/exactly duplicated, or reply references are invalid.
- Discarded items are not currently regenerated to reach the requested count.
- Background generation only runs while the backend process remains running. Stopping `node server.js` stops new autonomous posts and queued replies.

If the backend runs continuously at the current 15-minute interval, one onboarded world can attempt up to 96 autonomous batches per day. At four to six saved items per successful batch, that is theoretically 384–576 generated posts per day, before filtering and failures. The configured autonomous output allowance is 1,800 tokens per call, while GPT-OSS receives additional reasoning allowance; 96 maximum-sized calls could approach or exceed Groq's published 200,000 TPD even before other generation work. Actual use is usually lower and must be measured. Therefore, raising the fixed frequency is not the first recommended fix; it can exhaust token limits and flood the timeline.

## Why Posts Can Be Meaningless

Free-model quality and free-capacity routing contribute, but they are not the only or necessarily the largest cause.

Verified implementation limits:

- Autonomous generation receives only the latest eight root posts.
- Direct replies receive the target, optional parent, and only the resident's last three posts.
- Resident personality is stored as short text rather than structured values, memories, relationships, or stable goals.
- Validation checks JSON shape, truncation, reasoning leakage, author handles, exact duplicates, and references, but not semantic relevance or factual continuity.
- `openrouter/free` can route different calls to different free models.
- A rejected Groq response can cause the same task to be answered by Qwen/Gemini/OpenRouter, increasing style variation.
- The supplied runtime log repeatedly rejected `openai/gpt-oss-120b` for reasoning leakage and then used Qwen. This confirms avoidable failed attempts and provider/model style switching in the current run, but does not by itself prove one model is always better.

Conclusion: a paid model could improve average output, but paying would not fix missing memory, weak semantic validation, discarded-count handling, or an offline backend. These should be improved first.

## Free-First Expansion Plan

Recommended order:

1. Measure each LLM attempt, accepted item count, rejection reason, 429, latency, and safe rate-limit headers without logging private text.
2. Prioritize user replies over autonomous background generation when daily capacity is low.
3. Generate a larger candidate pool in one call, validate each item, and refill only the missing count with a strict maximum attempt budget.
4. Add relevance, specificity, persona consistency, and semantic repetition scoring before persistence.
5. Give residents structured traits and a compact editable memory instead of sending only shallow profile text.
6. Compare configured models on the same small Japanese evaluation set; use measured acceptance and consistency instead of assuming that a larger or paid model is automatically better.
7. Temporarily demote a model when its invalid-output rate is high, rather than retrying it for every background task.
8. Pre-generate a half-day or one-day post pool with one or a few calls, then publish candidates gradually. Reserve live calls for replies.
9. Consider curated non-LLM background templates for low-value ambient activity, with enough variation and cooldowns to avoid obvious repetition.
10. Show a small local diagnostics panel: active provider/model, accepted posts, remaining/reset values when available, and why generation is waiting.

This plan can increase useful content per API request. It does not depend on a local LLM or a paid API.

## Operating Recommendation

- Keep Groq as the main capacity source while its account limits match the public values.
- Treat Gemini as a quality/capacity reserve whose exact daily allowance must be read from AI Studio.
- Keep OpenRouter as the last fallback; 50 requests per day is too small for the current 15-minute autonomous cadence if it becomes the sole working provider.
- Do not call every provider just to rotate usage. Prefer a measured budget router that moves only when quality, remaining quota, or errors justify it.
- Avoid increasing post frequency until accepted-count metrics and daily token consumption are visible.

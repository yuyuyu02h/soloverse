-- Preserve the reason for waiting separately from a failed generation.
ALTER TABLE content_pool_state ADD COLUMN defer_reason TEXT NOT NULL DEFAULT '';
-- Release only old empty pools blocked by provider quota under the previous fixed 30-minute delay.
UPDATE content_pool_state SET next_fill_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),defer_reason='provider_quota'
WHERE NOT EXISTS (SELECT 1 FROM content_candidates c WHERE c.user_id=content_pool_state.user_id AND c.theme_version=content_pool_state.theme_version AND c.state='pending')
AND EXISTS (SELECT 1 FROM content_events e JOIN world_theme_state w ON w.user_id=e.user_id WHERE e.user_id=content_pool_state.user_id AND e.job='seed_pool' AND e.outcome='deferred' AND e.reason='provider_quota' AND e.created_at>=w.changed_at);

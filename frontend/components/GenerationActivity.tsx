'use client';

import { useEffect } from 'react';
import { api, getToken } from '../lib/api';
import { SCREEN_PREVIEW } from '../lib/deployment';

// No UI changes: keep only a visible user's generation lease alive.
export function GenerationActivity() {
  useEffect(() => {
    if (SCREEN_PREVIEW) return;
    let pending = false;
    const renew = async () => {
      if (pending || !getToken() || document.visibilityState !== 'visible' || window.location.pathname.startsWith('/admin')) return;
      pending = true;
      try { await api.post('/api/auth/activity', {}); }
      catch { /* The regular API flow already handles invalid sessions and connection errors. */ }
      finally { pending = false; }
    };
    const onStorage = (event: StorageEvent) => {
      // Another tab changed accounts: discard the previous account's React state.
      if (event.key === 'sv_token' && event.oldValue !== event.newValue) window.location.href = '/';
    };
    void renew();
    const interval = window.setInterval(() => { void renew(); }, 60_000);
    document.addEventListener('visibilitychange', renew);
    window.addEventListener('sv-auth-change', renew);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', renew);
      window.removeEventListener('sv-auth-change', renew);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return null;
}

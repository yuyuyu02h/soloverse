// User actions remain immediate. Only background reads pause in hidden tabs.
export function startVisiblePolling(task: (resumed: boolean) => void | Promise<void>, intervalMs: number) {
  let stopped = false;
  let running = false;
  let resumePending = false;
  const run = async (resumed = false) => {
    if (stopped || document.visibilityState !== 'visible') return;
    if (running) { resumePending ||= resumed; return; }
    running = true;
    try { await task(resumed); }
    catch (error) { console.error('Refresh error:', error); }
    finally {
      running = false;
      if (resumePending) { resumePending = false; void run(true); }
    }
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') void run(true); };
  const interval = window.setInterval(() => { void run(); }, intervalMs);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

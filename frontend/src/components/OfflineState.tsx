import { useState, useSyncExternalStore } from 'react';

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function isOnline(): boolean {
  return navigator.onLine;
}

export function OfflineState() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true);
  const [checked, setChecked] = useState(false);
  if (online) return null;

  return (
    <div
      className="app-alert my-3 flex flex-wrap items-center justify-between gap-3"
      data-tone="warning"
    >
      <p role="status">
        {checked
          ? 'Still offline. Check your connection and try again.'
          : 'You’re offline. Reconnect to refresh chain and indexer data.'}
      </p>
      <button type="button" className="app-button" onClick={() => setChecked(true)}>
        Check connection
      </button>
    </div>
  );
}

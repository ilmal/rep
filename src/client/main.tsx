import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/design.css';
import './styles/shell.css';
import './styles/guide.css';
import App from './App';
import { getState, hydrate, persistNow, setState } from './store/core';
import { startSyncLoop } from './store/sync';
import { startInstallWatch } from './pwa/install';
import { initServiceWorker } from './pwa/sw-register';

// Capture `beforeinstallprompt` before React mounts, then register the service worker (workbox 'prompt' mode).
// The "New version ready · Reload" toast (never while a session is active) is rendered by <PwaHost/>.
startInstallWatch();
initServiceWorker();
// Flush state to disk whenever the app may be killed (phone lock, tab switch, close).
const flush = () => { void persistNow(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
hydrate().catch(() => undefined).then(() => { if (!getState().hydrated) setState((s) => { s.hydrated = true; }); startSyncLoop(); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <App />
    </BrowserRouter>
  </StrictMode>,
);

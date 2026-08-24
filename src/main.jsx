import { logger } from "./utils/logger";
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './i18n.js'
import App from './App.jsx'
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'

if (!import.meta.env.VITE_POSTHOG_PROJECT_TOKEN) {
  if (import.meta.env.DEV) {
    console.error('VITE_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_PROJECT_TOKEN is configured')
  }
} else {
  posthog.init(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    defaults: '2026-05-30',
  })
}

// Redacts financial/PII fields by name, anywhere in the event — not a value
// pattern match, so it only touches keys that are actually named this way
// (e.g. a debug context someone attaches later with {balance, amount}),
// without needing to know every place data could end up in an event.
const SENSITIVE_KEYS = /^(balance|amount|amounts|description|descriptions|email)$/i;
function scrubSensitive(value) {
  if (Array.isArray(value)) return value.map(scrubSensitive);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[Redacted]' : scrubSensitive(v);
    }
    return out;
  }
  return value;
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: __RELEASE__,
    sendDefaultPii: false, // no cookies/IP/headers — explicit, not just relying on the SDK default
    beforeSend: (event) => scrubSensitive(event),
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Replay's own privacy defaults (maskAllText/blockAllMedia) are already on —
    // separate from PostHog's ph-mask classes, which only affect PostHog's recorder.
    replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

// Sentry issue ARKONOMY-WEB-3 (2026-08-23): a dynamically-imported chunk
// 404'd 21s after a prod deploy went live — not app-level lazy routing
// (there is none in src/), but @capacitor/core's own registerPlugin(...,
// {web: () => import('./web-*.js')}) fallback, fetched on-demand the first
// time a Capacitor web-plugin call fires (App/Browser/etc.), not at page
// load. Landed as an unhandled promise rejection because nothing owned it.
//
// Confirmed against the installed Vite (8.1.5) source, not assumed
// (node_modules/vite/dist/node/chunks/node.js): the error object is on
// event.payload, not event.detail, and Vite re-throws (`if
// (!e.defaultPrevented) throw err`) unless preventDefault() is called —
// without it this would still double-report as an unhandled rejection on
// top of the handling below.
//
// Recovery is fail-safe, not fail-open: one silent auto-reload per tab
// (covers the transient CDN-propagation-race case this issue actually
// was), then if it happens AGAIN in the same tab — a real broken
// deployment, not a one-off race — stop reloading and show an explicit
// message instead of looping the user through silent reloads forever. The
// flag lives in sessionStorage on purpose: it needs no timeout/reset logic
// since the tab closing already clears it.
//
// Safe against two near-simultaneous failures (e.g. two lazy Capacitor
// calls firing close together): window.dispatchEvent(e) runs every
// listener synchronously to completion — including the sessionStorage
// write below — before control returns to Vite's own `throw err` check.
// JS's single-threaded execution means a second failure's handler can't
// start until the first one (guard check + write) has already finished,
// regardless of how close together the two underlying import() calls
// actually failed.
const PRELOAD_RETRY_FLAG = 'ark_preload_error_reloaded';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const alreadyRetried = sessionStorage.getItem(PRELOAD_RETRY_FLAG);

  Sentry.withScope((scope) => {
    scope.setTag('preload_error_stage', alreadyRetried ? 'gave_up' : 'auto_reload');
    Sentry.captureException(event.payload);
  });

  if (!alreadyRetried) {
    sessionStorage.setItem(PRELOAD_RETRY_FLAG, '1');
    window.location.reload();
    return;
  }

  showPreloadErrorMessage();
});

function showPreloadErrorMessage() {
  if (document.getElementById('ark-preload-error')) return; // already showing

  // Built via safe DOM methods (createElement + textContent), not
  // innerHTML — nothing here is interpolated from event.payload or any
  // other untrusted source today, but this avoids the footgun for whoever
  // touches it next.
  const overlay = document.createElement('div');
  overlay.id = 'ark-preload-error';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#0B1426;display:flex;align-items:center;justify-content:center;font-family:"DM Sans",sans-serif;';

  const box = document.createElement('div');
  box.style.cssText = 'text-align:center;color:#E8EDF5;padding:24px;';

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
  icon.textContent = '🔄';

  const title = document.createElement('h1');
  title.style.cssText = 'margin:0 0 8px;font-size:20px;';
  title.textContent = 'Update needed';

  const body = document.createElement('p');
  body.style.cssText = 'color:#7A8BA8;font-size:14px;margin:0 0 20px;';
  body.textContent = 'A new version is available. Please refresh the page.';

  const button = document.createElement('button');
  button.style.cssText = 'padding:12px 24px;background:linear-gradient(90deg,#38B6FF,#60A5FA);border:none;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;';
  button.textContent = 'Refresh';
  button.addEventListener('click', () => window.location.reload());

  box.append(icon, title, body, button);
  overlay.append(box);
  document.body.appendChild(overlay);
}

class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) {
    if (import.meta.env.DEV) logger.error('ErrorBoundary caught:', err, info);
    Sentry.captureException(err, { contexts: { react: { componentStack: info.componentStack } } });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#0B1426', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
          <div style={{ textAlign: 'center', color: '#E8EDF5' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😵</div>
            <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h1>
            <p style={{ color: '#7A8BA8', fontSize: 14, margin: '0 0 20px' }}>Please refresh the page to try again.</p>
            <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: 'linear-gradient(90deg, #38B6FF, #60A5FA)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PostHogProvider client={posthog}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PostHogProvider>
  </React.StrictMode>,
)

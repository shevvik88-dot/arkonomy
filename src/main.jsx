import { logger } from "./utils/logger";
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './i18n.js'
import App from './App.jsx'

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
    sendDefaultPii: false, // no cookies/IP/headers — explicit, not just relying on the SDK default
    beforeSend: (event) => scrubSensitive(event),
  });
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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

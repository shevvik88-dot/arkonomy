import { logger } from "./utils/logger";
import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n.js'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) {
    if (import.meta.env.DEV) logger.error('ErrorBoundary caught:', err, info);
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

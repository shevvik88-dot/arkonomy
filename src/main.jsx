import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n.js'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('[Arkonomy crash]', e, info); }
  render() {
    if (this.state.error) {
      window.hideSplash?.();
      return (
        <div style={{ minHeight: '100vh', background: '#0B1426', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ color: '#FF5C7A', fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Something went wrong</div>
          <pre style={{ color: '#9AA4B2', fontSize: 12, maxWidth: 480, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#111E33', padding: 16, borderRadius: 10 }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack?.slice(0, 800)}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 24, padding: '12px 28px', background: '#2F80FF', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
            Reload
          </button>
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

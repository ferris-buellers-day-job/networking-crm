import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/error-boundary.js';
import { ContactList } from './pages/contact-list.js';
import { ContactDetail } from './pages/contact-detail.js';
import { ContactForm } from './pages/contact-form.js';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  commit: string;
  integrity: {
    ok: boolean;
    warnings: number;
    lastChecked: string;
  };
}

function AppContent() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [debug, setDebug] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (data.status === 'ok' || data.status === 'degraded') {
          setStatus('ready');
        } else {
          setStatus('error');
          setDebug(JSON.stringify(data, null, 2));
        }
      })
      .catch((err) => {
        setStatus('error');
        setDebug(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (status === 'loading') {
    return <div>Loading...</div>;
  }

  if (status === 'error') {
    return (
      <div>
        <p>Error — see debug</p>
        {debug && <pre>{debug}</pre>}
      </div>
    );
  }

  return <div>Ready</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<AppContent />} />
          <Route path="/contacts" element={<ContactList />} />
          <Route path="/contacts/new" element={<ContactForm />} />
          <Route path="/contacts/:id/edit" element={<ContactForm />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

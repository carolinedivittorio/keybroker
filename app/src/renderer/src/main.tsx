import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';

async function start() {
  // Dev only: lets the UI render in a plain browser with sample data.
  if (import.meta.env.DEV && !window.keybroker) await import('./dev-stub');
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
start();

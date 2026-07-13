import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      keys.filter((key) => key.startsWith('chess-studio-local-')).forEach((key) => void caches.delete(key));
    });
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { updateViaCache: 'none' }).then(
      (registration) => registration.update(),
      (error) => console.error('Service worker registration failed', error),
    );
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root application element.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

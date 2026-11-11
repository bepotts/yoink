// Mounts the React application and loads its global styles.

import './monitoring/renderer';
import { reactErrorHandler } from '@sentry/react';
import { StrictMode } from 'react';
import log from 'electron-log/renderer';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

log.errorHandler.startCatching();

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root element');

createRoot(root, {
  onUncaughtError: reactErrorHandler((error) =>
    log.error('React uncaught error', error),
  ),
  onCaughtError: reactErrorHandler((error) =>
    log.error('React caught error', error),
  ),
  onRecoverableError: reactErrorHandler((error) =>
    log.warn('React recovered from an error', error),
  ),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

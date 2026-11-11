// Mounts the React application and loads its global styles.

import { StrictMode } from 'react';
import log from 'electron-log/renderer';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

log.errorHandler.startCatching();

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root element');

createRoot(root, {
  onUncaughtError: (error) => log.error('React uncaught error', error),
  onCaughtError: (error) => log.error('React caught error', error),
  onRecoverableError: (error) =>
    log.warn('React recovered from an error', error),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

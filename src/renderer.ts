/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 */

import './index.css';
import { formatVersions } from './shared/versions';

console.log(
  '👋 This message is being logged by the renderer process, included via Vite',
);

const versionsEl = document.querySelector('#versions');
if (versionsEl) {
  versionsEl.textContent = formatVersions(window.versions);
}

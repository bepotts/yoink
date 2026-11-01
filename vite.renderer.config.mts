// Configures the React renderer build and development support in Vite.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({ plugins: [react()] });

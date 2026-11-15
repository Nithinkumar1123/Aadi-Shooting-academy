import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Lets the app run behind Render's public hostname when started with `npm start`
  preview: { host: '0.0.0.0', allowedHosts: true },
});

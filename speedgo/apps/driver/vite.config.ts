import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// host:true lets you open the app from a phone on the same Wi-Fi (http://<your-laptop-ip>:5172).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5172,
    strictPort: true,
    host: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  preview: { port: 5172 },
});

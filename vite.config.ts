import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub repo name so assets resolve on Project Pages.
// Set to '/' instead if you deploy to a custom domain or user pages.
export default defineConfig({
  base: '/Slot-O-Clock/',
  plugins: [react()],
});

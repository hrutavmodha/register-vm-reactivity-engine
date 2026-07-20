import { defineConfig } from 'vite';
import { driftPlugin } from 'vite-plugin-drift';

export default defineConfig({
  plugins: [driftPlugin() as any],
  optimizeDeps: {
    exclude: ['driftjs']
  }
});

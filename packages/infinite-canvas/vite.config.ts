import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // FlowGraphV3 SSOT（宪法 P21）：直接消费 vendored 包的 TS 出口，不复制源码。
      '@kais/flowgraph-v3': path.resolve(__dirname, '../flowgraph-v3/ts/src/index.ts'),
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:10588',
        changeOrigin: true,
      },
      '/oss': {
        target: 'http://localhost:10588',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:10588',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

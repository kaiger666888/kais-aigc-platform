import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * packages/portal — 制片门户 shell（Phase 57-02 / U-07）。
 *
 * 与 infinite-canvas 的两处关键差异：
 *  - base '/portal/'（绝对路径）——/deliver/:ep 在 /portal 前缀之外共用同一
 *    index，相对 base 会让该页资产 404（57 Pitfall 2；director-desk
 *    base:'/director-desk/' 同款先例）。
 *  - '@ic' alias 跨包复用 infinite-canvas 的 tokens/registry/services
 *    （零复制；infinite-canvas vite alias 引 flowgraph-v3 同式先例）。
 *
 * 注意：/@ic/services/canvasApi 等模块读 import.meta.env（如 utils/mediaUrl 的
 * VITE_OSS_ORIGIN）——本包沿用同链不额外 define，静态托管（同源）路径形态即默认值。
 */
export default defineConfig({
  plugins: [react()],
  base: '/portal/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ic': path.resolve(__dirname, '../infinite-canvas/src'),
      '@kais/flowgraph-v3': path.resolve(__dirname, '../flowgraph-v3/ts/src/index.ts'),
    },
  },
  server: {
    port: 3002,
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

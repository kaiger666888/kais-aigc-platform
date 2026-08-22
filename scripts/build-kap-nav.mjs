/**
 * scripts/build-kap-nav.mjs — KapNavbar 产物构建（Phase 57-02 Task 2）。
 *
 * 产物（全部落 data/assets/，经 /assets 静态面服务）：
 *  - kap-nav.<hash8>.js   esbuild IIFE（自包含 kap-nav.ts，静态站 <script> 直引）
 *  - kap-nav.<hash8>.css  tokens.css 全文 concat + kap-nav.css（token 单源不复制值）
 *  - kap-nav.js / kap-nav.css  稳定名副本（同内容；React 宿主 index.html 引稳定名，
 *    deploy-portal.sh 部署期改写为 hash 名破 /assets maxAge 1d 缓存）
 *  - kap-nav.latest.json  两文件名 manifest
 *
 * 用法: node scripts/build-kap-nav.mjs
 */
import esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_TS = path.join(ROOT, 'packages/portal/src/nav/kap-nav.ts')
const SRC_CSS = path.join(ROOT, 'packages/portal/src/nav/kap-nav.css')
const TOKENS_CSS = path.join(ROOT, 'packages/infinite-canvas/src/theme/tokens.css')
const OUT_DIR = path.join(ROOT, 'data/assets')

async function main() {
  const jsResult = await esbuild.build({
    entryPoints: [SRC_TS],
    bundle: true,
    format: 'iife',
    target: 'es2018',
    minify: true,
    write: false,
  })
  const js = jsResult.outputFiles[0].text

  // css = tokens.css 全文 + kap-nav.css（构建期 concat —— 单 token 源，非复制值）
  const tokens = fs.readFileSync(TOKENS_CSS, 'utf8')
  const navCss = fs.readFileSync(SRC_CSS, 'utf8')
  const css = `${tokens}\n/* ── kap-nav（concat 自 packages/portal/src/nav/kap-nav.css）── */\n${navCss}\n`

  const hash = crypto.createHash('sha256').update(js).update(css).digest('hex').slice(0, 8)
  const jsName = `kap-nav.${hash}.js`
  const cssName = `kap-nav.${hash}.css`

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, jsName), js)
  fs.writeFileSync(path.join(OUT_DIR, cssName), css)
  // 稳定名副本（同内容）
  fs.writeFileSync(path.join(OUT_DIR, 'kap-nav.js'), js)
  fs.writeFileSync(path.join(OUT_DIR, 'kap-nav.css'), css)
  fs.writeFileSync(
    path.join(OUT_DIR, 'kap-nav.latest.json'),
    `${JSON.stringify({ js: jsName, css: cssName, builtAt: new Date().toISOString() }, null, 2)}\n`,
  )

  console.log(`✅ kap-nav → data/assets/${jsName} (${(js.length / 1024).toFixed(1)} KB)`)
  console.log(`✅ kap-nav → data/assets/${cssName} (${(css.length / 1024).toFixed(1)} KB, tokens concat)`)
  console.log('✅ manifest → data/assets/kap-nav.latest.json')
}

main().catch((err) => {
  console.error('❌ build-kap-nav failed:', err)
  process.exit(1)
})

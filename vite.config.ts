import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A hash of the recipe data, added to its URL (?v=...) so browsers can cache it for a year and
// still fetch it again the moment the data changes (see vercel.json).
const dataDir = new URL('./public/data/', import.meta.url)
const dataHash = createHash('sha1')
for (const f of readdirSync(dataDir).sort()) dataHash.update(readFileSync(new URL(f, dataDir)))

// `vite preview` sends production's security headers (vercel.json), so the CSP can be tested locally.
// Over plain http on localhost, upgrade-insecure-requests would send every request to https.
type HeaderRule = { source: string; headers: { key: string; value: string }[] }
const siteRule = (JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers as HeaderRule[]).find((h) => h.source === '/(.*)')
const siteHeaders = Object.fromEntries((siteRule?.headers ?? []).map(({ key, value }) => [key, value.replace('; upgrade-insecure-requests', '')]))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __DATA_VERSION__: JSON.stringify(dataHash.digest('hex').slice(0, 12)) },
  preview: { headers: siteHeaders },
  // Modpack copies, exports and the promo workspace are huge and never imported by the app.
  server: { watch: { ignored: ['**/references/**', '**/promo/**', '**/public/data/**', '**/public/textures/**'] } },
})

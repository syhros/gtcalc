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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __DATA_VERSION__: JSON.stringify(dataHash.digest('hex').slice(0, 12)) },
  // Modpack copies, exports and the promo workspace are huge and never imported by the app.
  server: { watch: { ignored: ['**/references/**', '**/promo/**', '**/public/data/**', '**/public/textures/**'] } },
})

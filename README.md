# gtcalc

**[gtcalc.app](https://gtcalc.app)** is a free GregTech calculator and production planner for GTCEu Minecraft modpacks. It runs in the browser; there's nothing to install and no login required.

Drop in machines, link their inputs and outputs, and gtcalc works out how many of each machine you need, which voltage tier to run them at, and how much EU/t the line draws.

## Features

- Real recipes from GTCEu, the Sky Greg modpack and GT New Horizons, with the game's own machine and item textures
- **Auto Ratio**: picks tiers and machine counts for a whole line in one click, within an EU/t budget
- **Max Flow**: raises the target as far as your limits allow
- **Best Route**: plans a chain all the way down to raw resources, from any machine input or from an Output node (pick the item you want and plan backwards)
- Overclocks, parallel hatches, multiblocks, generators and power balance
- Manual machine counts when you want to build it your own way
- **Community**: share flows, browse other people's builds, vote, favourite, comment and make copies
- Saved flows sync to your account across devices; JSON import and export, including GTNH Planner files

## How it's built

- React 19, TypeScript, Vite and Tailwind 4, hosted on Vercel (pushes to `main` deploy to gtcalc.app)
- Firebase Authentication and Firestore (London region); `firestore.rules` is the security boundary
- Vercel functions in `api/`: link-preview pages and images for shared flows (`flow.ts`, `og.ts`), the sitemap and the username check
- Recipe data in `public/data` and textures in `public/textures`, generated from a modpack instance by `npm run import-recipes`

## Working on it

```
npm ci
npm run dev        # local dev server (needs .env.local with the Firebase web config, see .env.example)
npm run build      # type-check and production build
npm run lint
```

Database rules and indexes: `npx firebase-tools deploy --only firestore --project greg-calc`.

### Recipe data

Packs are exported in game with the [Pack Extract](https://github.com/syhros/gtcalc-exporter) mod, then imported:

- Sky Greg: `node scripts/import-recipes.mjs --export "<export folder>"` writes `public/data/recipes.json` and the icons. It still reads the instance (default `references/Sky Greg`, or `--instance "<path>"`) for machine names, multiblocks and textures, and keeps the recipe ids of the previous `recipes.json` so saved flows still load.
- Base GTCEu: `npm run import-recipes -- --profile base` uses the game's recipe dump (`dumpRecipes: true` under `dev:` in `config/gtceu.yaml`, then start a world once) and writes `public/data/recipes-base.json`.
- GT New Horizons: `node scripts/import-gtnh.mjs --extract "<export folder>"` writes `public/data/recipes-gtnh*.json` and `public/textures/gtnh`.

Only recipes that end up in a GregTech line are kept: a recipe stays when it makes something from GregTech or its addons (or a fluid, or power), or makes something another kept recipe uses, repeated until nothing changes. Tinkers parts, Apotheosis gear and decorative blocks that never feed a GregTech line drop out. Recycling (macerating, arc smelting or melting one item back down) doesn't count as a use.

## Privacy

See [gtcalc.app/privacy](https://gtcalc.app/privacy) and [gtcalc.app/terms](https://gtcalc.app/terms). Contact: support@gtcalc.app.

## Third-party content

The recipe data in `public/data` and the textures and icons in `public/textures` are generated from Minecraft, GregTech and the mods in each pack. They are not gtcalc's and remain under their owners' licences: GregTech CEu Modern and GT5-Unofficial are LGPL-3.0, and the GT New Horizons modpack is CC BY-NC-SA 4.0. The GTNH data is derived from that modpack, so it is shared under CC BY-NC-SA 4.0 too: credit the GT New Horizons team, non-commercial use only, share-alike. Owners who want something removed can email support@gtcalc.app.

gtcalc is a free, fan-made tool and isn't affiliated with Mojang, Microsoft or the GregTech developers. Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

## License

gtcalc's own code is MIT licensed, copyright (c) 2026 syhros. See [LICENSE](LICENSE). The MIT licence does not cover the recipe data, textures and icons: they are third-party content under their owners' licences (see above and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).

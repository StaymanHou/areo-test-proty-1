# Web Flight Sim

Browser-based flight simulator for casual gamers. Open a URL, be flying within 30 seconds. Plausible physics (not study-level), four mission types.

See [`CLAUDE.md`](./CLAUDE.md) for project conventions and [`docs/product/`](./docs/product/) for vision / roadmap / arch / WBS.

## Setup

```sh
npm install
npm run dev
```

Open the URL the dev server prints (usually `http://localhost:5173`).

## Debug mode

Append `?debug=true` to the URL:

```
http://localhost:5173/?debug=true
```

Enables the Stats.js FPS counter (top-left) and the lil-gui tuning panel (top-right). Never exposed in production builds by default — the panels only mount when the `debug` query parameter is present.

## Build

```sh
npm run build
```

Outputs static files to `dist/`. Deploy that directory to any static host (Vercel / Netlify / Cloudflare Pages).

## Tech stack

TypeScript (strict) · Three.js · Rapier3D · Vite · lil-gui · stats.js. No backend.

## Project layout

```
src/
  engine/              game loop, input, assets, debug UI
  world/               scene, terrain, camera
  aircraft/            rigidbody, aerosurface, flightmodel, controls
  mission/             (Phase 2, empty)
  hud/                 (Phase 2, empty)
public/
  models/              GLTF aircraft, textures
  config/              aircraft.json tunable flight-model constants
```

See `CONVENTIONS.md` for coordinate rules, module boundaries, and debug-UI gating.

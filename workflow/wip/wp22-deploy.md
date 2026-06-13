---
name: WP22 — Deploy + share
type: feature
state: plan (complete)
drive_mode: autopilot
created: 2026-06-13
size: XS
---

# Feature: WP22 — Deploy + share

**Workflow:** feature
**State:** plan (complete) [updated 2026-06-13: host re-pick — Cloudflare → GitHub Pages]
**Created:** 2026-06-13

## Problem Statement

Phase 3 milestone "Deploy to a public URL, shareable link" is unmet — the only remaining Phase-3 blocker before WP23 playtesting and v1 ship. The build pipeline already produces a clean static `dist/` (verified: 2.8 MB, ~980 KB gzipped, no `.wasm` files since Rapier is inlined). Host re-picked at operator request 2026-06-13 — **was** Cloudflare Pages (locked out: lost 2FA on dormant account); **now** GitHub Pages (zero additional accounts/auth, native GitHub Actions deploy). Trade-offs accepted: 100 GB/mo soft bandwidth (sufficient for 3–5 playtesters), `<user>.github.io/<repo>` URL path requires Vite `base` config, `.nojekyll` file to skip Jekyll processing. WP is purely configuration + onboarding — no application code changes beyond Vite base path, `.nojekyll`, GitHub Actions workflow, and 404 SPA fallback. Exit: public URL `https://staymanhou.github.io/areo-test-proty-1/` where home screen loads, all four missions reachable, no debug UI leaks, no console errors beyond the pre-existing `favicon.ico` 404 noise.

**3rd-party note:** GitHub Pages is the 3rd-party dependency. Operator already has GitHub auth (remote configured: `git@github.com:StaymanHou/areo-test-proty-1.git`). No probe WP needed — Pages deploys via standard `actions/deploy-pages` action with well-documented inputs.

**Frontend-only static deploy** — no backend, no DB (per CLAUDE.md tech stack). Bundle is 2.89 MB unminified, ~980 KB gzipped (SURFACE-04-19-01).

**SPA-fallback finding (from code inspection):** the app uses URL **query params** (`?mission=...`, `?debug=true`, `?script=...`) on `/` — there is **no client-side path routing**. Every URL hits `/index.html`. **No `_redirects` file is needed.** This simplifies the original research plan.

---

## Research

### Bundle constraints (verified)
- `dist/` after `npm run build`: 2.8 MB total, single `index-DKvndmui.js` at 2,890,539 bytes + static `config/`, `missions/`, `models/`, `index.html`.
- **No standalone `.wasm` file** — the project uses `@dimforge/rapier3d-compat`, which inlines WASM as base64 into the JS bundle. **The WASM MIME-type concern (which is the standard Cloudflare Pages gotcha for WASM apps) does not apply to this project.** This significantly de-risks host choice.
- Single-page app, no routing tricks needed. SPA fallback (`index.html` for unknown paths) is the only routing concern, and only if deep-link sharing matters.

### Host comparison (2026 data)

| Criterion | Cloudflare Pages | Netlify | Vercel | GitHub Pages |
|---|---|---|---|---|
| **Bandwidth (free)** | **Unlimited** (fair use; no hard cap) | 100 GB/mo | 100 GB/mo | "Soft" (~100 GB/mo) |
| **Build minutes** | 500 builds/mo (20 min each) | 300 min/mo (15 min builds) | ~6,000 min/mo | Unlimited (Jekyll) |
| **Commercial use** | ✅ Allowed | ✅ Allowed | ❌ **Prohibited on Hobby (ToS)** | ✅ Allowed |
| **Hard cap behavior** | None (asked to upgrade only on abuse) | $55/100 GB overage | **Service pauses** until next 30-day window | None |
| **Custom domain + HTTPS** | 100 domains/project, free TLS | Free TLS, custom domain | Free TLS, custom domain | Free TLS, custom domain |
| **GitHub auto-deploy** | ✅ | ✅ | ✅ | ✅ (native) |
| **CLI deploy** | `wrangler pages deploy dist` | `netlify deploy --prod --dir=dist` | `vercel --prod` | `gh-pages` npm pkg or workflow |
| **WASM MIME OOTB** | Documented quirks (mitigated via `_headers` file); **N/A for inlined-WASM** | ✅ Native | ✅ Native | ✅ Native (mime-db) |
| **Static SPA fallback** | `_redirects` or `_headers` file | `_redirects` | `vercel.json` | Requires 404→index trick |

### Per-host notes for this project

**Cloudflare Pages** (recommended):
- **Unlimited bandwidth** is the single biggest advantage at playtest scale (WP23 invites 3–5 testers; unlikely to stress 100 GB, but no headroom risk for any future organic share).
- **Commercial-use allowed** (matters because the project's vision allows for unspecified future direction; Vercel Hobby's ToS-prohibited-commercial creates a tripwire).
- **No hard-cap pause** — Netlify/Vercel will silently break the shareable URL when limits hit; Cloudflare will email asking to upgrade first.
- **WASM MIME risk is moot** for this project (Rapier is inlined), so the standard Cloudflare WASM gotcha doesn't apply.
- Deploy flow: connect GitHub repo via dashboard, set build = `npm run build`, output dir = `dist`. Or one-shot CLI: `npx wrangler pages deploy dist --project-name=test-proj`.

**Netlify**:
- Cleanest CLI (`netlify deploy --prod --dir=dist`) and easiest first-time setup.
- 100 GB bandwidth is fine for 3–5 playtesters but a single Hacker News-style spike could blow the cap; $55/100 GB overage is real money.
- 15-min build timeout — easy headroom (our build is ~30s).

**Vercel**:
- **DEALBREAKER:** Hobby plan ToS prohibits commercial use, and Vercel does enforce this. The project's roadmap leaves "shareable link" intentionally open; if the demo ever gets attached to any commercial context (job interview portfolio, paid playtest invite, etc.), the deploy becomes ToS-non-compliant.
- Hard-cap behavior is also worse than Cloudflare: at 100 GB, deploys pause for 30 days with no graceful overage.

**GitHub Pages**:
- Free + simple. WASM MIME works natively (mime-db includes `application/wasm`) — but again, moot here.
- Requires `.nojekyll` file to skip Jekyll processing (Jekyll may exclude `.wasm` and other build artifacts).
- SPA-fallback story is awkward (404 → index trick).
- Build pipeline less ergonomic than the other three for a Vite project (would use a GitHub Action manually).

### Risks identified

1. **Build environment mismatch.** TypeScript 6.0.2 + Vite 8.0.4 + Node 18+ — all four hosts default to Node 20 or 22 build images in 2026. Pin via `.nvmrc` or host-specific config to avoid silent drift. **Low risk; standard mitigation.**
2. **Bundle size at first paint.** 980 KB gzipped on a mid-range mobile/3G connection is ~8s download (per SURFACE-04-19-01). WP18 onboarding (already shipped) added a splash overlay that paints on first frame, mitigating perceived load. **No host-choice impact** — same bundle ships everywhere.
3. **SPA deep-link sharing.** If a playtest URL like `?mission=combat` needs to survive a hard refresh on a 404-style host, configure SPA fallback. Cloudflare uses `_redirects`; Netlify uses `_redirects`; Vercel uses `vercel.json`. **One-time config file.**
4. **`?debug=true` / harness leakage.** Production deploy must NOT expose `?debug=true` to end users (per CLAUDE.md "Never ship debug panels to end users"). Current code gates lil-gui + scripted-input harness on `?debug=true`. Confirm production build still respects this gate (verify-self target).

### Recommendation

**Cloudflare Pages** — picked on three reasons in priority order:

1. **No commercial-use restriction** (rules out Vercel Hobby outright per ToS).
2. **Unlimited bandwidth + no hard-cap pause** beats Netlify's 100 GB + $55 overage and Vercel's 30-day pause-on-cap. The risk profile favors "if the share link goes viral, the site stays up" over "if quota hits, the link silently breaks."
3. **Deploy ergonomics are equivalent** to Netlify (GitHub auto-deploy + dashboard) and better than GitHub Pages.

Fallback if Cloudflare Pages onboarding hits friction: **Netlify** (next-best on ergonomics and the commercial-use point). GitHub Pages is fine as a third fallback for a pure ship-it-today scenario but the SPA-fallback config tax and Jekyll workarounds are friction.

### Open question for plan-time

- **Custom domain (now or later)?** Cloudflare Pages assigns `<project>.pages.dev` automatically — sufficient for WP23 playtest. Custom domain (`flight-sim.example.com`) is a Phase 3+ polish concern, not required for "shareable URL" exit criterion. Default to `*.pages.dev` for WP22.

---

## Work Tree

- [ ] Phase 1: Repo prep + Cloudflare Pages deploy + verify  <!-- status: NOT-STARTED -->
  **Observable outcomes:**
  - Browser: Public URL (e.g. `https://<project>.pages.dev/`) loads the splash + main menu within 10s on a warm connection; menu shows all 4 mission tiles (Free Flight, Waypoint Patrol, Takeoff/Landing, Combat).
  - Browser: Clicking "Free Flight" loads the mission; after 5s `window.__aircraft.getState()` returns a state object with finite `position`, `linvel`, and `altitude > 0`. (Same probe shape as `tests/e2e/casual-flight.spec.ts`.)
  - Browser: Page console shows no `Error` or `Uncaught` entries on home-screen load (warnings allowed; the existing `tests/e2e/audio.spec.ts` precedent rejects errors only).
  - Browser: Visiting the public URL WITHOUT `?debug=true` shows NO lil-gui panel, NO Stats.js FPS counter, NO key-hints overlay (key-hints overlay is gated separately by mission, but lil-gui + Stats.js are the `?debug=true` markers). Confirm via Playwright `page.locator('.lil-gui').count() === 0` and `page.locator('#stats').count() === 0` after splash clears.
  - Browser: Visiting `<url>/?debug=true` DOES show the lil-gui + Stats.js panels (positive control — debug gate is not broken, just off by default).
  - CLI: `git log -1` on `main` shows the deploy-config commit (`.nvmrc` + any README addition); `git push origin main` succeeded; Cloudflare Pages dashboard shows the latest build status = "Success".
  - HTTP: `curl -I https://<project>.pages.dev/` returns `HTTP/2 200`, `content-type: text/html`, `cf-ray:` header present (confirms Cloudflare edge).
  - HTTP: `curl -I https://<project>.pages.dev/assets/index-*.js` returns `HTTP/2 200`, `content-type: application/javascript` (or `text/javascript`), `content-encoding: br` or `gzip`.

  - [x] P1.1 Add `.nvmrc` pinning Node 22 (matches local + Cloudflare default; cheap drift insurance)  <!-- status: done -->
  - [x] P1.2 Local pre-deploy smoke: `npm run build` + `npm run preview` then manually hit `localhost:4173/` — main menu + 4 mission tiles + production debug-gate (lil-gui 0, __aircraft accessor absent) all confirmed; positive control at `?debug=true` mounted 15 panels + accessor. Only console entry: `favicon.ico` 404 (harmless, no favicon shipped — flagging as backlog candidate, NOT a blocker).  <!-- status: done -->
  - [x] P1.3 Commit deploy-prep changes to a branch (`wp22-deploy`, commit `113a2d5`); branch then fast-forward-merged into `main` at operator request (2026-06-13).  <!-- status: done -->
  - [x] P1.4-gh Add `vite.config.ts` with `base: '/areo-test-proty-1/'`. Confirmed Vite propagates this to `index.html` asset URLs (`/areo-test-proty-1/assets/...`) AND to `import.meta.env.BASE_URL` for runtime fetch sites.  <!-- status: done -->
  - [x] P1.5-gh Add `public/.nojekyll` (empty file). Vite copies it to `dist/.nojekyll` on build (verified).  <!-- status: done -->
  - [x] P1.6-gh 404 SPA fallback handled in the workflow's "Copy index.html to 404.html" step (P1.7-gh), not as a separate file/script.  <!-- status: done (deferred to workflow step) -->
  - [x] P1.7-gh Add `.github/workflows/deploy.yml` — checkout, setup-node@v4 (reads `.nvmrc`), `npm ci`, `npm run build`, `cp dist/index.html dist/404.html`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`. Permissions: `pages: write, id-token: write`. Concurrency group `pages` with `cancel-in-progress: false`.  <!-- status: done -->
  - [x] P1.7b-gh **DISCOVERY — F25 (note-and-continue):** runtime fetch sites at `src/mission/loader.ts:16,28` and `src/engine/scripted-input.ts:156-157` used hardcoded leading-`/` absolute paths (`'/missions/...'`, `'/config/...'`). These break under any sub-path deploy. Fixed by prepending `import.meta.env.BASE_URL` (evaluates to `/` in dev, `/areo-test-proty-1/` in prod). 3 fetch sites total. Vitest 793/793 + e2e 47/47 + tsc clean post-fix. **SURFACE-2026-06-13-01 filed** (low priority — fix in WP22; documents the leading-`/`-fetch anti-pattern for future code review).  <!-- status: done -->
  - [x] P1.8-gh Local re-smoke after base-path fix: `npm run build` clean, `dist/index.html` references `/areo-test-proty-1/assets/...`, `dist/.nojekyll` present. **Live preview probe** (P1.4 was originally Cloudflare-shaped but `vite preview` DOES honor `base` so I ran it): navigated to `http://localhost:4173/areo-test-proty-1/`, splash cleared, 4 mission tiles rendered, no path-resolution errors. Drilled into `?mission=free-flight&debug=true`, `window.__aircraft.getState()` showed altitude=66.2m + airspeed=49.8 m/s + all finite at 5s. Production debug-gate off-by-default confirmed (lil-gui 0 without `?debug=true`).  <!-- status: done -->
  - [ ] P1.9-gh **OPERATOR ACTION:** push `main` to GitHub (`git push origin main`), then enable Pages in the repo: Settings → Pages → Source = "GitHub Actions" (one-time click; the workflow handles the rest). The workflow auto-runs on push.  <!-- status: in-progress (operator action required) -->
  - [ ] P1.10-gh Wait for the deploy workflow run; record the deployed URL (`https://staymanhou.github.io/areo-test-proty-1/`) under `## Deployment` for verify-self.  <!-- status: NOT-STARTED -->
  - [ ] verify-auto  <!-- status: NOT-STARTED -->
    - Standard local pre-deploy gates only: `npm run build` clean, `npx tsc --noEmit` clean, `npm run test` 793/793 green, `npm run test:e2e` 47/47 green. No new tests added — this WP is config-only.
  - [ ] verify-self  <!-- status: NOT-STARTED -->
    - Drive a Playwright probe (or `mcp__playwright__browser_navigate`) against the LIVE deployed URL — not localhost. Confirm all 8 observable outcomes above. The agent already has access to playwright MCP tools.
  - [ ] verify-human  <!-- status: NOT-STARTED -->
    - Operator opens the deployed URL in their own browser, clicks through all 4 missions, confirms gameplay feels equivalent to local dev. Confirms no lil-gui leak. Confirms the URL is shareable (i.e. someone else could open it).
  - [ ] verify-codify  <!-- status: NOT-STARTED -->
    - No new behavior to codify. This WP ships infrastructure, not features. The existing test suite already covers all in-product invariants. Skip codify (record decision in retrospect).

## Current Node
- **Path:** Feature > Phase 1 > P1.9-gh (operator pause point)
- **Active scope:** P1.9-gh (operator: `git push origin main` + Pages source = "GitHub Actions" toggle)
- **Blocked:** P1.10-gh, verify-self, verify-human — all blocked on P1.9-gh (push + Pages enable requires operator credentials)
- **Unvisited:** P1.10-gh (record URL) → verify-auto → verify-self → verify-human → verify-codify (skip-record)
- **Open discoveries:** favicon.ico 404 (cosmetic, harmless); BASE_URL anti-pattern (resolved inline, filed SURFACE-2026-06-13-01 for future code review).

## Deployment
- **Repo:** `git@github.com:StaymanHou/areo-test-proty-1.git`
- **Branch:** `main`
- **Commits ready to push:**
  - `113a2d5` — chore(wp22): deploy prep — pin Node 22 + plan file
  - `b17fe15` — chore(wp22): update WIP — P1.1–P1.3 complete, paused at P1.4
  - (uncommitted ahead: vite.config.ts + .nojekyll + .github/workflows/deploy.yml + the BASE_URL fix + WIP update)
- **Public URL (expected):** `https://staymanhou.github.io/areo-test-proty-1/`
- **One-time operator click:** Settings → Pages → Source = "GitHub Actions"

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
- [SURFACED-2026-06-13] Phase 1 — `favicon.ico` 404 on root load is the only console noise in the production build. Low/cosmetic. Decision: surface as 1-line note here; defer backlog filing until verify-self confirms it persists on the live deploy (which it will). Operator may opt to silence with a tiny `public/favicon.ico` or accept and close.
- [SURFACED-2026-06-13] P1.7b-gh — Runtime fetch sites in `src/mission/loader.ts` (×2) and `src/engine/scripted-input.ts` (`configNameToPath`, ×1) used hardcoded leading-`/` absolute paths, which break under any sub-path deploy. Resolved inline by prepending `import.meta.env.BASE_URL`. File SURFACE-2026-06-13-01 documents the anti-pattern for future code review.

---

## Research

(Original research findings retained below for context — host pick rationale.)

Findings clear; spec holds (XS-sized config-only WP, no architectural decision required beyond host pick).

→ `/feature-build` (F7)

Sources consulted:
- [Cloudflare Pages Free Tier Limits (2026)](https://hostmeloud.com/cloudflare-pages-2026-guide/)
- [Cloudflare Pages limits — official docs](https://developers.cloudflare.com/pages/platform/limits)
- [Netlify Pricing 2026 (Free)](https://hamsterstack.com/pricing/netlify/)
- [Netlify free tier 2026 review](https://danubedata.ro/blog/best-netlify-alternatives-static-site-hosting-2026)
- [Vercel Hobby Plan — official](https://vercel.com/docs/plans/hobby)
- [Vercel Free Tier Limits 2026](https://deploywise.dev/blog/vercel-free-tier-limits-2026)
- [GitHub Pages WASM MIME — community discussion](https://github.com/orgs/community/discussions/22863)
- [Cloudflare Pages WASM MIME issue thread](https://community.cloudflare.com/t/hosting-content-on-cloudflare-pages-service-and-mime-types/259686)
- [Vite — static deploy guide](https://vite.dev/guide/static-deploy)

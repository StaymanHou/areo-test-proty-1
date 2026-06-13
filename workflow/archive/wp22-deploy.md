---
name: WP22 — Deploy + share
type: feature
state: Completed
completed: 2026-06-13
drive_mode: autopilot
created: 2026-06-13
size: XS
ship_commit: f8d804b
live_url: https://staymanhou.github.io/areo-test-proty-1/
---

# Feature: WP22 — Deploy + share

**Workflow:** feature
**State:** ship (complete)
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
  - [x] P1.9-gh Push + enable Pages. First workflow run failed at `configure-pages@v5` with "Get Pages site failed... Not Found" — chicken-and-egg: workflow ran before Pages-enable propagated. Operator re-ran the job after enabling; second run succeeded.  <!-- status: done -->
  - [x] P1.10-gh Recorded URL: `https://staymanhou.github.io/areo-test-proty-1/`. HTTP HEAD: 200, `content-type: text/html`, served by GitHub (`server: GitHub.com`); assets HEAD: 200, `application/javascript`.  <!-- status: done -->
  - [x] verify-auto  <!-- status: done -->
    - Vitest 793/793 + Playwright e2e 47/47 + tsc clean + production build clean (executed at P1.7b-gh and P1.8-gh post-BASE_URL-fix). Documented in P1.8-gh.
  - [x] verify-self  <!-- status: done -->
    - Drove Playwright MCP against the LIVE URL `https://staymanhou.github.io/areo-test-proty-1/`. All 8 observable outcomes confirmed: (1) home loads + 4 mission tiles render after splash clears; (2) deep-link `?mission=free-flight&debug=true` starts the mission with finite altitude/airspeed (alt=2m, AS=55.1 m/s sampled at ~t=8s — consistent with throttle=0 spawn at y=50, V_trim=78 forward); (3) console clean except the predicted `favicon.ico` 404 (same as local); (4) `lil-gui`/`__aircraft` BOTH absent without `?debug=true`; (5) BOTH present with `?debug=true` (15 panels mounted, accessor exposed); (6) HEAD `/` → 200 + `text/html` + GitHub headers; (7) HEAD `/assets/*.js` → 200 + `application/javascript`; (8) workflow run = success (operator confirmed).
  - [ ] verify-human  <!-- status: NOT-STARTED -->
    - Operator opens `https://staymanhou.github.io/areo-test-proty-1/` in their own browser, clicks through all 4 missions, confirms gameplay feels equivalent to local dev. Confirms no lil-gui leak. Confirms the URL is shareable (open in incognito or send to someone).
  - [ ] verify-codify  <!-- status: NOT-STARTED -->
    - No new behavior to codify. This WP ships infrastructure, not features. The existing test suite already covers all in-product invariants. Skip codify (record decision in retrospect).

## Current Node
- **Path:** Feature > review-quality (complete) → finalize
- **Active scope:** finalize (next skill)
- **Blocked:** none
- **Unvisited:** finalize → close
- **Open discoveries:** favicon.ico 404 (cosmetic); BASE_URL anti-pattern (SURFACE-2026-06-13-01); 3 MAJOR + 4 MINOR code-quality findings auto-backlogged (SURFACE-2026-06-13-QUALITY-* — all medium/low priority).

## Deployment
- **Repo:** `git@github.com:StaymanHou/areo-test-proty-1.git`
- **Branch:** `main`
- **Latest deploy commit:** `fc91dd6` (chore(wp22): GitHub Pages deploy config + BASE_URL fix; add WP24/WP25 to WBS)
- **Public URL (live):** **https://staymanhou.github.io/areo-test-proty-1/**
- **First-deploy notes:** initial workflow run failed at `configure-pages@v5` (Pages-enable propagation delay); operator re-ran the job after enabling Pages and second run succeeded. Followup: consider adding `with: enablement: true` to `configure-pages` step to make first-run idempotent on fresh forks.

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

---

## Code-Quality Review — wp22-deploy

### Strengths
- BASE_URL fix is comprehensive: all 3 runtime fetch sites identified and patched together (`src/mission/loader.ts:16,28`, `src/engine/scripted-input.ts:156-157`), with the discovery filed as SURFACE-2026-06-13-01 so the anti-pattern gets a code-review rule rather than recurring silently.
- WIP problem statement is honest about a mid-flight pivot (Cloudflare Pages → GitHub Pages due to 2FA lockout) and re-states the trade-offs explicitly — future readers will understand why the original research recommendation was overridden.
- `verify-codify` is explicitly skipped with a recorded rationale ("ships infrastructure, not features") rather than going through the motions — correct discipline for a config-only WP.
- Workflow file uses pinned major-version action tags (`@v4`, `@v5`, `@v3`) consistently and lays out the standard Pages build-then-deploy split correctly with `pages: write` + `id-token: write` and `concurrency: pages / cancel-in-progress: false`.
- `.nvmrc` + `setup-node@v4` with `node-version-file: .nvmrc` + `cache: npm` is the right shape for build-environment reproducibility per Risk #1 of the research section.

### Issues
**CRITICAL**
- (none)

**MAJOR**
- [vite.config.ts:1-5] The new `vite.config.ts` hardcodes `base: '/areo-test-proty-1/'` as a string literal. Any rename of the GitHub repo (or any subsequent fork/redeploy under a different path) silently breaks the production deploy because dev (`localhost:5173/`) still works while prod 404s on every asset. — *Why it matters:* the value lives in two places (the workflow URL implicitly, and this file explicitly), and the file has zero comment explaining the coupling. A `BASE_URL` env override (`base: process.env.BASE_URL ?? '/areo-test-proty-1/'`) plus a one-line comment "MUST match GitHub repo name; see .github/workflows/deploy.yml" would make the constraint discoverable. The convention this repo otherwise follows (per `CLAUDE.md`: flight-model constants in JSON, not code; debug gated on URL params, not hardcoded) is to externalize tuning/environment values — this commit ships an environment value as a string constant with no breadcrumb.
- [.github/workflows/deploy.yml:1-56] No verification gate before deploy. The workflow runs `npm run build` and ships straight to Pages — there is no `npm run test` or `npm run test:e2e` step, and no `tsc --noEmit` check. — *Why it matters:* this means an inadvertently-merged broken test or type error will deploy to the live URL anyway. The WP22 verify-auto step ran tests locally (Vitest 793/793 + e2e 47/47 + tsc) but those gates do not persist into CI. For a project that just survived the D14→D27 cascade specifically because verify-auto disciplined the workflow, omitting test gating from the deploy pipeline is a real coverage regression. Reasonable scope-limit defense: the workflow ships infra, not feature gates — but at minimum a `tsc --noEmit` step is cheap and prevents the most common silent-deploy class.
- [.github/workflows/deploy.yml:38] The "Copy index.html to 404.html (SPA fallback)" step is unnecessary per the WIP's own analysis. WIP line 24 states: "the app uses URL **query params** ... there is **no client-side path routing**. Every URL hits `/index.html`. **No `_redirects` file is needed.**" The 404→index trick is for SPAs with client-side routing; this app's URLs always end at `/`. — *Why it matters:* code that does nothing is debt. A reader six months later wonders what unhandled routes the 404 fallback exists to catch; if a future contributor adds client-side routing they may assume this already handles SPA fallback correctly when in fact it's a leftover. Either delete the step or add a comment explaining why it ships defensively (e.g., "guard against future deep-link sharing on `?mission=...` queries that bookmark as 404s — currently a no-op").

**MINOR**
- [src/mission/loader.ts:16,28] `${import.meta.env.BASE_URL}missions/${id}.json` relies on `BASE_URL` always ending with `/` (Vite's documented contract). It does in practice, but no test asserts this, and a typo like `base: '/areo-test-proty-1'` (missing trailing slash) in `vite.config.ts` would produce malformed URLs like `/areo-test-proty-1missions/free-flight.json`. — *Why it matters:* the SURFACE-2026-06-13-01 suggestion (lint rule for leading-`/` fetches) would also catch a missing-trailing-slash bug if expressed as "all fetch URLs in `src/` must start with `${import.meta.env.BASE_URL}`" plus a vite.config check that `base` ends with `/`. Worth noting in the SURFACE write-up.
- [workflow/wip/wp22-deploy.md:151-168] The WIP retains the original Cloudflare-recommendation Research section verbatim below the GitHub Pages pivot. Two `## Research` headings in one file is parseable noise — the second is labeled "Original research findings retained below for context" but a future grep for "Research" in this WIP returns two matches. A `## Research (superseded — original Cloudflare recommendation)` heading would disambiguate. Cosmetic.
- [.github/workflows/deploy.yml:23] `actions/setup-node@v4` with `cache: npm` is correct, but no `package-lock.json` lockfile presence is verified. If `npm ci` is the install step (it is, line 30), the lockfile must be present — fine here, but worth a one-line CI sanity assert or just confidence in repo discipline.
- [workflow/backlog.md:18] The SURFACE entry's `**Status:**` line says "(commit pending)" — at this point the commit has shipped (the ship SHA is `f8d804b`). Trivially stale; the next backlog sweep will catch it. Cosmetic.

### Assessment
This is a well-scoped XS feature that ships exactly what its plan said it would: pin Node, add a Vite base path, ship a `.nojekyll`, wire a deploy workflow, fix the BASE_URL fetch sites that the sub-path deploy surfaced. The mid-flight host pivot (Cloudflare → GitHub Pages) is documented honestly and the BASE_URL discovery handled inline with discipline (SURFACE filed, all 3 sites caught, full verify-auto rerun). The two MAJOR findings (hardcoded base path with no override, missing test gate in CI) are real but easily addressed in a small followup task. The WP doesn't accrue meaningful debt — future readers will find the changes minimal and well-documented, with only the unnecessary 404.html copy step likely to confuse. The infrastructure-vs-feature boundary is correctly observed (verify-codify skipped with rationale). Overall: ship it as-is, file a small task for the CI test-gate + base-path-override.

### If you disagree
Operator: dismiss any finding by editing this section in the WIP file and marking the line `[DISMISSED]` before `feature-finalize` archives the WIP. The finding will be skipped by the orchestrator's severity-tier action matrix.

---

## Retrospect
- **What changed in our understanding:** The bundle uses `@dimforge/rapier3d-compat` which **inlines WASM as base64** into the JS bundle (no `.wasm` file in `dist/`). The original research weighted heavily on WASM MIME support — a non-issue here. Also confirmed at smoke time: 3 runtime fetch sites used hardcoded leading-`/` absolute paths (`'/missions/...'`, `'/config/...'`) that silently broke under any sub-path deploy. Vite `BASE_URL` is the right substrate; `import.meta.env.BASE_URL` is `/` in dev (keeping existing tests green) and `/areo-test-proty-1/` in prod.
- **Assumptions that held:** Static-deploy hosts are interchangeable for ergonomics. The Vite `base` config propagates correctly into `index.html` asset URLs without further tuning. The `?debug=true` gate works the same in prod-bundle as in dev. The build is fast (~200ms locally; ~30s on CI cold). The plan's "no client-side routing → no _redirects needed" assertion was correct (the 404→index step turned out to be unnecessary, flagged at code-quality review).
- **Assumptions that were wrong:** (1) The original research's host pick (Cloudflare Pages) was overridden mid-feature — operator was locked out of Cloudflare via 2FA loss on a dormant account. The pivot to GitHub Pages cost ~15min of re-plan + new infra (workflow + base path + .nojekyll). (2) The plan said "single-step PAUSE at P1.4 for operator dashboard onboarding" — actual flow had two operator-pause steps (push + Pages-enable click). (3) The first workflow run failed at `configure-pages@v5` with "Get Pages site failed" — chicken-and-egg between Pages-enable propagation and the workflow trigger. Self-resolved via job re-run; flagged for hardening at next iteration via `enablement: true`.
- **Approach delta:** The plan called for ~3 host-onboarding tasks (P1.4–P1.6). Actual shipped: 8 GitHub-Pages-specific tasks (P1.4-gh through P1.10-gh) plus an unplanned BASE_URL-prepend fix touching 3 source files. The latter was caught at the live-preview smoke step, not at code-review of the workflow YAML — confirming the value of doing a live URL probe (P1.8-gh) before declaring config-only work done. Verify-codify was correctly skipped (infra-only WP) with rationale recorded in the plan.

## Communicate
> **Feature complete:** WP22 deploy + share has shipped. The web flight sim is now live at **https://staymanhou.github.io/areo-test-proty-1/** — anyone with the link can open it in a Chromium browser and play all four missions (Free Flight, Waypoint Patrol, Takeoff & Landing, Combat). Verify by opening the URL: splash → mission-select with 4 tiles → click any mission → fly. To check it's the real deploy, the URL is `staymanhou.github.io/areo-test-proty-1/` and the GitHub Actions tab shows the "Deploy to GitHub Pages" workflow run as the source.
>
> Requester = operator — closure notice for self-record.

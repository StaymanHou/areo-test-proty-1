# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-04-19-01 — Bundle size: Rapier WASM dominates build
- **Source:** feature:build (WP1 verify-auto)
- **Target level:** product:arch or feature (Phase 3 polish)
- **Type:** perf / tech-debt
- **Summary:** The first production build clocked in at ~2.7 MB unminified / ~978 KB gzipped — above Vite's default 500 KB warning threshold. Dominated by Rapier WASM which is currently bundled inline.
- **Context:** Relates to R1 in research.md (WASM load UX). At 978 KB gzipped, first-load on a mid-range connection is meaningful. WP18 (onboarding) already plans to preload WASM in parallel with splash — this is the mitigation. No action needed before Phase 3.
- **Suggested action:** Leave as-is for Phase 1/2. At Phase 3 WP18/WP21, measure real load time and consider: (a) code-splitting Rapier via dynamic import, (b) loading WASM from `@dimforge/rapier3d-compat`'s external `.wasm` file instead of inlining.
- **Priority:** low (tracked, not urgent)
- **Status:** pending

### SURFACE-2026-04-19-02 — Destructive-scaffold near-miss (already mitigated)
- **Source:** feature:build (WP1 Phase 1)
- **Target level:** process / tooling
- **Type:** lesson
- **Summary:** `npm create vite@latest . -- --template vanilla-ts --overwrite=ignore` **deletes** the existing directory contents (in Vite 9 the flag's name is misleading — "ignore" means "silently overwrite/ignore existing files", which effectively wipes non-template files). This destroyed `docs/product/`, `workflow/`, and `CLAUDE.md`. Full recovery possible only because all content was in the conversation transcript.
- **Context:** Root cause: took a risky action (a scaffolder that alters the whole dir) without first initializing git as a safety baseline. The WP1 plan itself had noted "scaffold into temp dir + copy" as a fallback — I should have used it.
- **Suggested action:** Memory note for future sessions: before running any scaffolder, auto-initializer, template, or CLI that might alter the working directory, **`git init` first** if not already a repo. If git exists, confirm clean or stash first. This is cheap insurance.
- **Priority:** low (already handled this time; captured as a future-session lesson)
- **Status:** resolved (recovery complete; future-session lesson captured)

## Resolved

*(move items from Open here when closed by later work)*

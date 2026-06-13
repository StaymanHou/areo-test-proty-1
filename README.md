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
  mission/             missions + HUD hooks (free flight, waypoint, takeoff/landing, combat)
  hud/                 DOM-overlay HUD, key hints, mission select
public/
  models/              procedural meshes; textures
  config/              aircraft.json + aircraft-mig15.json + aircraft-aerobatic.json
```

See `CONVENTIONS.md` for coordinate rules, module boundaries, and debug-UI gating.

---

## Physics fidelity

A casual-flight-feel sim, not a study-level one. The table below documents *what is actually modeled* in code versus what a real airplane has. Plain talk: anything in the **Modeled** column is computed every physics tick from first-principles formulas; anything in **Approximated** is present but coarse; anything in **Not modeled** is silently absent and the sim doesn't try to fake it.

### Forces and moments

| Phenomenon | Status | How (or why not) |
|---|---|---|
| 6DOF rigid-body dynamics | **Modeled** | Rapier3D rigid body, fixed-timestep 60 Hz integrator. Position, orientation, linear + angular velocity all evolve per tick. |
| Gravity | **Modeled** | Constant `g = 9.81 m/s²` world-down (Rapier `setGravity`). No latitude/altitude variation. |
| Air density | **Approximated** | Constant `ρ = 1.225 kg/m³` (sea-level ISA). Does **not** thin with altitude — a climb to 10 km feels the same as sea level. |
| Lift (per surface) | **Modeled** | `F_L = ½·ρ·V²·A·CL` applied at each `AeroSurface`'s world position. CL looked up by piecewise-linear curve at the local angle of attack. |
| Drag — profile | **Modeled** | `F_D = ½·ρ·V²·A·CD` per surface, along the local airflow. CD from the same piecewise curve. |
| Drag — induced (CL²) | **Modeled** | Per-surface `CD += k · CL²` (D18 textbook lifting-line). `k_wing ≈ 0.26`, `k_h-stab ≈ 0.14`. Couples turning/climbing into airspeed loss. |
| Drag — fuselage parasitic | **Modeled** | Body-level `F = ½·ρ·V²·area·cd0` at body origin (no moment arm). `cd0 ≈ 0.14`, `area ≈ 0.69 m²`. |
| Stall | **Modeled** | CL curve peaks at `±15°` AoA, drops to a post-stall plateau, returns toward 0 at `±90°`. Lift collapse + drag rise at the same point. |
| Pitch-rate damping (β4 / `clQ`) | **Modeled** | Non-dimensional `ΔCL = clQ · ω_dampAxis · c̄ / (2·max(V, V_REF))` per surface (D17 textbook form, Etkin & Reid §5.10). Damps pitch oscillation. |
| AoA-rate damping (β5 / `clAlphaDot`) | **Modeled** | `ΔCL = clAlphaDot · dα/dt · c̄ / (2·max(V, V_REF))` per surface (D16). Damps the long-period phugoid mode. |
| Per-surface incidence (trim) | **Modeled** | Each surface's fixed mount angle `incidenceRad` (D10). Cessna wings sit at +2°, h-stab at −1°. Creates the L=W equilibrium attractor at V_trim ≈ 78 m/s. |
| Control surface deflections | **Modeled** | Aileron → wings (anti-symmetric), elevator → h-stab, rudder → v-stab. Each surface rotates about its span axis; deflection is clamped to `maxDeflectionRad` and feeds back into the same AoA computation. |
| Thrust | **Approximated** | Single force along body `−Z` (nose-forward), magnitude `throttle · maxN`. No prop disk, no spool-up curve, no throttle lag. |
| Side-force / β (sideslip) | **Modeled, emergent** | Comes for free from the v-stab feeling its own AoA in side-slipping flow — no separate β model. |
| Banking-to-turn | **Modeled, emergent** | Roll tilts the lift vector, horizontal component pulls the nose around. Falls out of the per-surface model, not hand-coded. |
| Adverse yaw | **Modeled, emergent** | Differential induced drag from anti-symmetric aileron deflection. Subtle but present. |
| Phugoid mode | **Modeled** | Long-period (~10–14s) airspeed/altitude exchange. β5 (`clAlphaDot`) is tuned to damp it; observable as small oscillation around V_trim after a disturbance. |
| Ground contact | **Approximated** | Rapier collider on the runway/terrain. Aircraft can land or crash but there is no tyre model, suspension, or rolling friction — the gear is a static collider. |
| Propeller / engine torque | **Not modeled** | No P-factor, no torque roll, no gyroscopic precession. A real Cessna wants right-rudder on takeoff; this one doesn't. |
| Ground effect | **Not modeled** | No CL bump or induced-drag reduction near the runway. Flare-on-landing feels artificial. |
| Wind / turbulence / gusts | **Not modeled** | Atmosphere is dead still. Wind is a wind-noise audio cue only — it has no force on the aircraft. |
| Compressibility / Mach effects | **Not modeled** | No drag rise near M=1, no shock-stall. The MiG-15 can theoretically exceed Mach 1 in level flight and nothing in the physics would notice. |
| Atmosphere model (T, P, ρ vs altitude) | **Not modeled** | Constant ρ regardless of altitude. No service ceiling. |
| Reynolds number / viscosity | **Not modeled** | Aerodynamic coefficients are fixed; no Re-dependent CL_max or CD_min variation. |
| Aeroelasticity / flex / flutter | **Not modeled** | Airframe is rigid. |
| Fuel burn / mass change | **Not modeled** | Mass is constant. Infinite fuel. |
| Center-of-gravity shift | **Not modeled** | Mass distribution (inertia tensor) is constant. |
| Asymmetric thrust / engine-out | **Not modeled** | Single thrust force on the centerline; multi-engine asymmetry is irrelevant since the model is single-engine on the body axis. |
| Spin departure / autorotation | **Not modeled directly** | Stall + yaw rate may produce some rotation but there's no dedicated spin model. Stalled flight tends to recover by itself in this sim. |
| Magnus / spinning-projectile aero | **Not modeled** | Combat projectiles fly in straight lines (ballistic + gravity-free over 1500 m range). |

### Coefficients per airframe (`public/config/`)

| Knob | Cessna trainer (`aircraft.json`) | MiG-15 jet (`aircraft-mig15.json`) |
|---|---|---|
| Mass | 1000 kg | 3000 kg |
| Inertia (Ixx pitch, Iyy yaw, Izz roll) | 1500 / 3000 / 1500 | 6750 / 13500 / 6750 |
| Max thrust | 4500 N (T/W ≈ 0.46) | 30000 N (T/W ≈ 1.02) |
| Wing area per side | 6 m² | 9 m² |
| Wing incidence | +2.0° | 0° |
| Aileron deflection limit | ±5° | ±10° |
| H-stab incidence | −1.0° | −0.5° |
| Induced-drag k (wing) | 0.26 | 0.26 |
| Fuselage cd0 × area | 0.14 × 0.69 m² | 0.14 × 0.69 m² |
| β4 wing `clQ` | 1.83 | 1.83 |
| β5 wing `clAlphaDot` | 4.67 | 4.67 |

V_trim (the L=W equilibrium airspeed for level flight, derived in `arch.md` D24/D25 and codified in CLAUDE.md Rule #9) is **~78 m/s** for the Cessna. All missions spawn at this airspeed so the airframe enters every scene at its natural cruise point; throttle alone determines whether it climbs, holds, or descends.

---

## Behavioral fidelity

What a pilot or sim-aware player will recognize, and what will feel "off" if they look for it.

### Faithful and observable

These behaviors emerge from the per-surface model — they were not hand-coded as rules but fall out of the physics when you fly:

- **Pitch with elevator, roll with aileron, yaw with rudder.** Standard primary control mapping; deflections feed back as additional AoA on the moving surface.
- **Bank-to-turn.** Rolling tilts the lift vector; the horizontal component yaws the nose. Coordinated turns work without rudder if you're patient; rudder helps tighten them.
- **Stall break.** Pulling elevator past the AoA limit (~15°) drops lift sharply and increases drag — the nose drops, airspeed recovers, you can fly out of it. Visible as a sudden altitude sag.
- **Phugoid (airspeed / altitude oscillation).** After a disturbance (release stick from a climb), the aircraft trades altitude for airspeed in a slow ~10–14 second oscillation. β5 damping keeps it bounded; you can see it on the altimeter as a small wobble.
- **Trim airspeed (V_trim).** Hands-off at full throttle from V_trim, the Cessna climbs; at 0 throttle it descends along a glideslope; at ~mid throttle it holds altitude. This is real airframe equilibrium, not a scripted "hover" state.
- **Glide ratio when engine-out.** At 0 throttle, V_trim is held by trading altitude — you get a real glide angle (≈8:1 for the Cessna params).
- **Induced drag in turns.** Hard turns cost airspeed because CL² rises with bank load factor → more induced drag.
- **Speed → control authority.** Same stick input at low speed produces less moment (because dynamic pressure ½ρV² is lower). Below stall the controls go mushy.
- **Cessna vs MiG-15 character difference.** The Cessna is heavy-feeling, slow-rolling (5° aileron cap), accelerates lazily (T/W 0.46), and can't keep up a vertical climb. The MiG (T/W ≈ 1.02, 10° aileron cap) climbs vertically, rolls faster, and has noticeably higher V_trim. The same flight model produces both behaviors purely from configuration.

### Not yet faithful

These will feel wrong to anyone with a real-airplane reference:

- **Takeoff roll.** The Cessna's T/W of 0.46 isn't enough to reach takeoff speed on the 600 m runway (filed as `SURFACE-2026-06-06-09`). Missions work around this by spawning the aircraft at V_trim in the air; you don't taxi out and accelerate down the runway.
- **Landing flare.** No ground effect → the airplane sinks at the same rate near the ground as at altitude. Flaring feels like hitting concrete.
- **No torque or P-factor on the prop.** A real Cessna at full power needs right rudder; this one tracks straight.
- **No wind.** Crosswind landings are not a thing. Wind noise is purely an audio cue.
- **Constant air density.** Altitude doesn't degrade engine or wing performance. No service ceiling — you can climb until you get bored.
- **No fuel.** Infinite endurance, constant mass, constant CG.
- **Compressibility absent on the jet.** The MiG-15 with T/W ≈ 1 will accelerate past Mach 1 in a dive with nothing pushing back. No transonic drag rise, no shock buffet.
- **Spin behavior is sketchy.** Cross-controlled stall ought to depart into a spin; here it usually just mushes and recovers because β/yaw coupling at the stall AoA isn't tuned for departure.
- **Engine response is instantaneous.** No spool-up time on the jet, no idle-to-full lag on the prop. Throttle → thrust is a direct multiplication.
- **No gyroscopic effects.** Yaw-during-pitch, pitch-during-yaw coupling from a spinning prop is absent.
- **Ground physics is a flat collider.** No wheel friction model, no brake authority, no nose-wheel steering — the gear is a static collider that stops you.
- **Damage model is binary** (combat only). Aircraft has 6 HP total; bullets remove HP and the aircraft is either fine or destroyed. No control-surface damage, no engine fire, no asymmetric damage states.

### Summary

The sim is faithful to anything *aerodynamic-coefficient-and-rigid-body shaped*: per-surface lift/drag, AoA, stall, the long-period modes, control coupling, T/W and wing-loading differences between airframes. It is intentionally silent about everything *atmospheric, propulsive, or structural* — the things a real-airplane pilot uses to fly precisely (wind correction, prop torque, ground effect, mixture, engine response curves, fuel) are absent because v1 targets a casual gamer who has no reference for them.

See [`docs/product/arch.md`](docs/product/arch.md) — especially decisions D2 (aerosurface primitive), D17 (β4 pitch damping), D16 (β5 AoA-rate damping), D18 (drag polar) — for the derivations and rationale behind the modeled column. The deferred items in the "Not modeled" rows above are not bugs; they are conscious v1 scope decisions documented in [`docs/product/roadmap.md`](docs/product/roadmap.md).

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
} from 'three';
import type { AircraftConfig } from './physics-core/config';

export type AircraftVariant = 'cessna' | 'mig15' | 'default';

/**
 * Heuristic variant selection from an AircraftConfig — keeps `aircraft.json`
 * schema unchanged. High thrust → jet (mig15), otherwise prop (cessna).
 * The 20000 N threshold sits between the production Cessna (6000 N) and
 * MiG-15 (30000 N) airframes; tune up if a third airframe sits in between.
 */
export function inferAircraftVariant(config: AircraftConfig): AircraftVariant {
  if (config.thrust.maxN >= 20000) return 'mig15';
  return 'cessna';
}

/**
 * Build a procedural Three.js mesh group for an aircraft. The mesh is purely
 * cosmetic — the Rapier collider is sized to the placeholder fuselage box
 * (1 × 0.6 × 6) by AircraftBody and does not depend on which variant ships
 * here.
 *
 * All child meshes carry `castShadow = true` so the WP20 Phase 1 directional
 * sun produces a visible ground shadow.
 */
export function buildAircraftMesh(
  config: AircraftConfig,
  variant: AircraftVariant = 'default',
): Group {
  switch (variant) {
    case 'cessna':
      return buildCessnaMesh(config);
    case 'mig15':
      return buildMig15Mesh(config);
    case 'default':
    default:
      return buildPlaceholderMesh(config);
  }
}

/** Preserved Phase-1 placeholder — fuselage box + slab wings + slab tail. */
function buildPlaceholderMesh(config: AircraftConfig): Group {
  const group = new Group();
  const fuselage = new Mesh(
    new BoxGeometry(1, 0.6, 6),
    new MeshStandardMaterial({ color: 0x4488ff }),
  );
  fuselage.castShadow = true;
  group.add(fuselage);

  const wingMat = new MeshStandardMaterial({ color: 0x2266cc });
  for (const s of config.surfaces) {
    if (s.name === 'wing-left' || s.name === 'wing-right') {
      const wing = new Mesh(new BoxGeometry(3, 0.1, 1.2), wingMat);
      wing.position.copy(s.position);
      wing.castShadow = true;
      group.add(wing);
    } else if (s.name === 'h-stab') {
      const tail = new Mesh(new BoxGeometry(2, 0.1, 0.6), wingMat);
      tail.position.copy(s.position);
      tail.castShadow = true;
      group.add(tail);
    } else if (s.name === 'v-stab') {
      const fin = new Mesh(new BoxGeometry(0.1, 1, 0.6), wingMat);
      fin.position.copy(s.position);
      fin.castShadow = true;
      group.add(fin);
    }
  }
  return group;
}

/** Cessna-class: cylindrical fuselage + nose cone + straight high-mounted wings. */
function buildCessnaMesh(config: AircraftConfig): Group {
  const group = new Group();

  // Fuselage: cylinder along Z (aircraft long axis). Three.js Cylinder is
  // along Y by default — rotate to lie along Z.
  const fuselageMat = new MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.55 });
  const fuselage = new Mesh(new CylinderGeometry(0.45, 0.45, 5, 16), fuselageMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);

  // Nose cone (tapered toward +Z forward direction — but the aircraft flies
  // along -Z, so "forward" in body frame is -Z. Place cone at -Z end.)
  const nose = new Mesh(new ConeGeometry(0.45, 1.2, 16), fuselageMat);
  nose.rotation.x = -Math.PI / 2; // tip toward -Z
  nose.position.z = -3.1;
  nose.castShadow = true;
  group.add(nose);

  // Blue stripe along fuselage centerline (thin box on top of cylinder).
  const stripeMat = new MeshStandardMaterial({ color: 0x3366aa, roughness: 0.4 });
  const stripe = new Mesh(new BoxGeometry(0.04, 0.04, 5.5), stripeMat);
  stripe.position.y = 0.42;
  stripe.castShadow = true;
  group.add(stripe);

  // High-wing: rectangular slabs mounted ABOVE fuselage center.
  const wingMat = new MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.55 });
  for (const s of config.surfaces) {
    if (s.name === 'wing-left' || s.name === 'wing-right') {
      const wing = new Mesh(new BoxGeometry(4.5, 0.12, 1.4), wingMat);
      wing.position.copy(s.position);
      wing.position.y += 0.55; // lift above fuselage centerline (high-wing)
      wing.castShadow = true;
      group.add(wing);

      // Wing strut from fuselage to underside — Cessna's signature.
      const strut = new Mesh(new BoxGeometry(0.06, 0.6, 0.06), wingMat);
      strut.position.set(s.position.x * 0.4, 0.25, s.position.z);
      strut.castShadow = true;
      group.add(strut);
    } else if (s.name === 'h-stab') {
      const tail = new Mesh(new BoxGeometry(2.4, 0.1, 0.7), wingMat);
      tail.position.copy(s.position);
      tail.castShadow = true;
      group.add(tail);
    } else if (s.name === 'v-stab') {
      // Trapezoidal vertical fin via extruded 2D shape.
      const finShape = new Shape();
      finShape.moveTo(0, 0);
      finShape.lineTo(0.9, 0);
      finShape.lineTo(0.7, 1.1);
      finShape.lineTo(0.1, 1.1);
      finShape.lineTo(0, 0);
      const fin = new Mesh(
        new ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false }),
        wingMat,
      );
      // Center the extrusion on YZ plane along the surface position.
      fin.rotation.y = Math.PI / 2;
      fin.position.set(s.position.x - 0.04, s.position.y - 0.05, s.position.z - 0.45);
      fin.castShadow = true;
      group.add(fin);
    }
  }

  return group;
}

/** MiG-15-class: short stocky fuselage, intake cone at nose, swept wings, swept fin. */
function buildMig15Mesh(config: AircraftConfig): Group {
  const group = new Group();

  const bodyMat = new MeshStandardMaterial({ color: 0x5a6b3c, roughness: 0.6 });

  // Fuselage cylinder — shorter and thicker than Cessna.
  const fuselage = new Mesh(new CylinderGeometry(0.7, 0.65, 4.4, 18), bodyMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);

  // Nose intake cone — opens forward (-Z); render as a cone with the wide end
  // at the front. Smaller radius at the back makes it look like an air intake.
  const intake = new Mesh(new ConeGeometry(0.6, 1.4, 18, 1, true), bodyMat);
  intake.rotation.x = -Math.PI / 2;
  intake.position.z = -2.9;
  intake.castShadow = true;
  group.add(intake);

  // Dorsal hump above fuselage (signature MiG-15 silhouette).
  const hump = new Mesh(new BoxGeometry(0.85, 0.45, 1.8), bodyMat);
  hump.position.set(0, 0.55, -0.2);
  hump.castShadow = true;
  group.add(hump);

  // Swept-back wings — build as 2D Shape extruded into thin slabs. Sweep
  // angle ~35° at leading edge.
  const wingMat = new MeshStandardMaterial({ color: 0x5a6b3c, roughness: 0.55 });

  function buildSweptWing(spanSign: 1 | -1, root: Vector3): Mesh {
    // Wing planform in (x = span outboard, z = chord, here spanwise positive
    // ahead of the root): trapezoid swept back 35°.
    //
    // Root chord 1.6 m, tip chord 0.8 m, half-span 3.2 m, sweep 35°.
    const span = 3.2;
    const rootChord = 1.6;
    const tipChord = 0.8;
    const sweepZ = span * Math.tan((35 * Math.PI) / 180);
    const shape = new Shape();
    shape.moveTo(0, 0); // root LE
    shape.lineTo(0, rootChord); // root TE
    shape.lineTo(span, sweepZ + tipChord); // tip TE
    shape.lineTo(span, sweepZ); // tip LE
    shape.lineTo(0, 0);
    const geom = new ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    const wing = new Mesh(geom, wingMat);
    // ExtrudeGeometry authors the Shape in its local XY plane (span along
    // shape-X, chord along shape-Y) and extrudes along shape-Z (thickness).
    // Rotate +π/2 around X so shape-Y (chord) → world +Z (trailing edge
    // sits BEHIND the wing root, since the aircraft flies along world -Z)
    // and shape-Z (thickness) → world -Y. Without this rotation entirely
    // the wing renders edge-on; with -π/2 the wing flies backward.
    wing.rotation.x = Math.PI / 2;
    // Wing built in +X span; mirror by scaling for the opposite side.
    wing.scale.x = spanSign;
    // Lift to mid-fuselage height; align root chord around root.z.
    wing.position.set(root.x, root.y - 0.04, root.z - rootChord / 2);
    wing.castShadow = true;
    return wing;
  }

  let rootZ = 0;
  for (const s of config.surfaces) {
    if (s.name === 'wing-left') {
      rootZ = s.position.z;
      const w = buildSweptWing(-1, new Vector3(0, 0, s.position.z));
      group.add(w);
    } else if (s.name === 'wing-right') {
      rootZ = s.position.z;
      const w = buildSweptWing(1, new Vector3(0, 0, s.position.z));
      group.add(w);
    } else if (s.name === 'h-stab') {
      // Swept h-stab — small symmetric trapezoid.
      const span = 1.4;
      const root = 0.9;
      const tip = 0.45;
      const sweepZ = span * Math.tan((30 * Math.PI) / 180);
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0, root);
      shape.lineTo(span, sweepZ + tip);
      shape.lineTo(span, sweepZ);
      shape.lineTo(0, 0);
      // Same rotation reasoning as buildSweptWing: lay the shape flat with
      // chord (shape-Y) → world +Z (trailing edge behind root) and the
      // 0.06m extrusion (shape-Z) → world -Y (below the chord plane).
      const left = new Mesh(new ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }), wingMat);
      left.rotation.x = Math.PI / 2;
      left.scale.x = -1;
      left.position.set(0, s.position.y, s.position.z - root / 2);
      left.castShadow = true;
      const right = new Mesh(new ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }), wingMat);
      right.rotation.x = Math.PI / 2;
      right.position.set(0, s.position.y, s.position.z - root / 2);
      right.castShadow = true;
      group.add(left, right);
    } else if (s.name === 'v-stab') {
      // Tall swept vertical fin.
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.lineTo(1.1, 0);
      shape.lineTo(1.6, 1.5);
      shape.lineTo(0.7, 1.5);
      shape.lineTo(0, 0);
      const fin = new Mesh(new ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), wingMat);
      fin.rotation.y = Math.PI / 2;
      fin.position.set(s.position.x - 0.04, s.position.y, s.position.z - 0.7);
      fin.castShadow = true;
      group.add(fin);
    }
  }
  // Silence unused-var lint without changing semantics — rootZ is set as a
  // side-effect of iterating wings but not currently consumed.
  void rootZ;

  return group;
}

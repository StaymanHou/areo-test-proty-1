import {
  CubeTexture,
  DataTexture,
  RGBAFormat,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';

export type SkyboxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface CloudOptions {
  /** Number of cloud blobs stamped per side face. Default: 6. */
  count?: number;
  /** Seed for the deterministic RNG that places clouds. Default: 1337. */
  seed?: number;
  /** Cloud color. Default: near-white. */
  color?: [number, number, number];
}

export interface SkyboxOptions {
  faceSize?: number;
  /** Top-of-sky color (zenith). Default: deep blue. */
  zenithColor?: [number, number, number];
  /** Horizon color where sky meets ground. Default: light blue. */
  horizonColor?: [number, number, number];
  /** Below-horizon ground tint. Default: muted brown-grey. */
  groundColor?: [number, number, number];
  /** Side face on which to draw the sun disc, or null for no sun. Default: 'px'. */
  sunFace?: SkyboxFace | null;
  /** UV coordinates [0..1] of the sun centre on its face. Default: [0.5, 0.4]. */
  sunUv?: [number, number];
  /** Sun disc radius as a fraction of face size. Default: 0.06. */
  sunRadius?: number;
  /** Sun color. Default: warm white. */
  sunColor?: [number, number, number];
  /** Cloud stamping options, or `false` to disable clouds entirely. Default: enabled with defaults. */
  clouds?: CloudOptions | false;
  /** Horizon haze band intensity 0..1 — 0 disables, 1 lifts the bottom 30% of side faces fully to horizon-haze color. Default: 0.6. */
  hazeStrength?: number;
  /** Horizon haze color (warmer/lighter than horizon). Default: pale warm grey. */
  hazeColor?: [number, number, number];
}

const DEFAULT_CLOUDS: Required<CloudOptions> = {
  count: 6,
  seed: 1337,
  color: [245, 248, 252],
};

const DEFAULT: Required<Omit<SkyboxOptions, 'sunFace' | 'clouds'>> & {
  sunFace: SkyboxFace | null;
  clouds: CloudOptions | false;
} = {
  faceSize: 512,
  zenithColor: [60, 110, 200],
  horizonColor: [180, 210, 235],
  groundColor: [80, 75, 65],
  sunFace: 'px',
  sunUv: [0.5, 0.4],
  sunRadius: 0.06,
  sunColor: [255, 240, 210],
  clouds: DEFAULT_CLOUDS,
  hazeStrength: 0.6,
  hazeColor: [220, 220, 215],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function setPixel(data: Uint8Array, size: number, x: number, y: number, c: [number, number, number]) {
  const i = (y * size + x) * 4;
  data[i] = Math.round(c[0]);
  data[i + 1] = Math.round(c[1]);
  data[i + 2] = Math.round(c[2]);
  data[i + 3] = 255;
}

/**
 * Paint a side face (px / nx / pz / nz) with a vertical gradient:
 * y = 0 (top of texture) → zenith
 * y = size-1 (bottom of texture) → horizon
 *
 * Side faces all use the same gradient so adjacent edges match exactly.
 */
export function paintSideFaceRGBA(
  size: number,
  zenith: [number, number, number],
  horizon: [number, number, number],
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const c = lerpColor(zenith, horizon, t);
    for (let x = 0; x < size; x++) {
      setPixel(data, size, x, y, c);
    }
  }
  return data;
}

/** Paint a flat-color face. Used for +Y (zenith) and −Y (ground tint). */
export function paintSolidFaceRGBA(size: number, color: [number, number, number]): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(data, size, x, y, color);
    }
  }
  return data;
}

/**
 * Stamp a soft-edged sun disc onto an existing RGBA face, in-place.
 * `cx`, `cy` in pixels, `radius` in pixels. Edge falls off linearly over a
 * 30%-of-radius soft band.
 */
export function stampSunDiscRGBA(
  data: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
): void {
  const inner = radius * 0.7;
  const yMin = Math.max(0, Math.floor(cy - radius));
  const yMax = Math.min(size - 1, Math.ceil(cy + radius));
  const xMin = Math.max(0, Math.floor(cx - radius));
  const xMax = Math.min(size - 1, Math.ceil(cx + radius));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const alpha = d <= inner ? 1 : 1 - (d - inner) / (radius - inner);
      const i = (y * size + x) * 4;
      data[i] = Math.round(lerp(data[i], color[0], alpha));
      data[i + 1] = Math.round(lerp(data[i + 1], color[1], alpha));
      data[i + 2] = Math.round(lerp(data[i + 2], color[2], alpha));
    }
  }
}

/**
 * Stamp a soft elliptical cloud blob onto an existing RGBA face, in-place. The
 * cloud is alpha-blended over the existing pixel data with a quadratic falloff
 * (sharper than the sun disc's linear edge — produces fluffier-looking edges).
 */
export function stampCloudRGBA(
  data: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: [number, number, number],
  maxAlpha: number,
): void {
  const yMin = Math.max(0, Math.floor(cy - ry));
  const yMax = Math.min(size - 1, Math.ceil(cy + ry));
  const xMin = Math.max(0, Math.floor(cx - rx));
  const xMax = Math.min(size - 1, Math.ceil(cx + rx));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      // Quadratic falloff: full opacity at center, zero at ellipse edge.
      const alpha = maxAlpha * (1 - d2) * (1 - d2);
      const i = (y * size + x) * 4;
      data[i] = Math.round(lerp(data[i], color[0], alpha));
      data[i + 1] = Math.round(lerp(data[i + 1], color[1], alpha));
      data[i + 2] = Math.round(lerp(data[i + 2], color[2], alpha));
    }
  }
}

/**
 * Apply a horizon haze band to an existing side-face RGBA buffer, in-place.
 * Lifts pixels in the lower 30% of the face toward `hazeColor`, with strength
 * peaking at the horizon (bottom 5%) and falling off linearly to zero at 30%.
 *
 * Preserves the bottom row exactly (seam guarantee: horizon row stays uniform
 * across all side faces).
 */
export function applyHorizonHazeRGBA(
  data: Uint8Array,
  size: number,
  hazeColor: [number, number, number],
  hazeStrength: number,
): void {
  if (hazeStrength <= 0) return;
  const bandStartY = Math.floor(size * 0.7);
  const lastY = size - 1;
  for (let y = bandStartY; y <= lastY; y++) {
    // t goes 0..1 as y traverses the haze band.
    const t = (y - bandStartY) / Math.max(1, lastY - bandStartY);
    const alpha = hazeStrength * t * t;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(lerp(data[i], hazeColor[0], alpha));
      data[i + 1] = Math.round(lerp(data[i + 1], hazeColor[1], alpha));
      data[i + 2] = Math.round(lerp(data[i + 2], hazeColor[2], alpha));
    }
  }
}

/** mulberry32 — small deterministic PRNG, seedable. Returns 0..1. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stamp `count` clouds onto a side face using the supplied RNG. Cloud centers
 * fall in vertical UV band [0.1, 0.55] (above horizon haze, below zenith) so
 * they appear at recognizable mid-sky height. Ellipse dimensions vary per blob.
 */
export function stampCloudsRGBA(
  data: Uint8Array,
  size: number,
  count: number,
  color: [number, number, number],
  rng: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const cx = rng() * size;
    const cy = (0.1 + rng() * 0.45) * size;
    const rx = (0.08 + rng() * 0.1) * size;
    const ry = rx * (0.35 + rng() * 0.25); // flatter ellipse
    const maxAlpha = 0.55 + rng() * 0.3;
    stampCloudRGBA(data, size, cx, cy, rx, ry, color, maxAlpha);
  }
}

function makeFaceTexture(data: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface SkyboxResult {
  cubeTexture: CubeTexture;
  faces: { px: DataTexture; nx: DataTexture; py: DataTexture; ny: DataTexture; pz: DataTexture; nz: DataTexture };
}

export function createProceduralSkybox(opts: SkyboxOptions = {}): SkyboxResult {
  const faceSize = opts.faceSize ?? DEFAULT.faceSize;
  const zenithColor = opts.zenithColor ?? DEFAULT.zenithColor;
  const horizonColor = opts.horizonColor ?? DEFAULT.horizonColor;
  const groundColor = opts.groundColor ?? DEFAULT.groundColor;
  const sunFace = opts.sunFace === null ? null : opts.sunFace ?? DEFAULT.sunFace;
  const sunUv = opts.sunUv ?? DEFAULT.sunUv;
  const sunRadius = opts.sunRadius ?? DEFAULT.sunRadius;
  const sunColor = opts.sunColor ?? DEFAULT.sunColor;
  const clouds = opts.clouds === false ? false : { ...DEFAULT_CLOUDS, ...(opts.clouds ?? {}) };
  const hazeStrength = opts.hazeStrength ?? DEFAULT.hazeStrength;
  const hazeColor = opts.hazeColor ?? DEFAULT.hazeColor;

  if (faceSize <= 0 || !Number.isInteger(faceSize)) {
    throw new Error(`createProceduralSkybox: faceSize must be a positive integer, got ${faceSize}`);
  }

  const sideFaces: SkyboxFace[] = ['px', 'nx', 'pz', 'nz'];
  const faceData: Record<SkyboxFace, Uint8Array> = {
    px: paintSideFaceRGBA(faceSize, zenithColor, horizonColor),
    nx: paintSideFaceRGBA(faceSize, zenithColor, horizonColor),
    pz: paintSideFaceRGBA(faceSize, zenithColor, horizonColor),
    nz: paintSideFaceRGBA(faceSize, zenithColor, horizonColor),
    py: paintSolidFaceRGBA(faceSize, zenithColor),
    ny: paintSolidFaceRGBA(faceSize, groundColor),
  };

  // Clouds first (alpha-blended into the gradient sky), then haze (lifts the
  // horizon band including any cloud pixels in that band), then sun (sits on
  // top — never occluded by clouds or haze).
  if (clouds !== false) {
    // One RNG seeded per face, each face derived from base seed + a per-face
    // offset. Keeps faces visually distinct but reproducible.
    const faceSeedOffset: Record<SkyboxFace, number> = {
      px: 0, nx: 1000, pz: 2000, nz: 3000, py: 0, ny: 0,
    };
    for (const face of sideFaces) {
      const rng = mulberry32(clouds.seed! + faceSeedOffset[face]);
      stampCloudsRGBA(faceData[face], faceSize, clouds.count!, clouds.color!, rng);
    }
  }

  for (const face of sideFaces) {
    applyHorizonHazeRGBA(faceData[face], faceSize, hazeColor, hazeStrength);
  }

  if (sunFace !== null) {
    if (!sideFaces.includes(sunFace)) {
      throw new Error(`createProceduralSkybox: sunFace must be one of px/nx/pz/nz, got ${sunFace}`);
    }
    const cx = sunUv[0] * faceSize;
    const cy = sunUv[1] * faceSize;
    const radiusPx = sunRadius * faceSize;
    stampSunDiscRGBA(faceData[sunFace], faceSize, cx, cy, radiusPx, sunColor);
  }

  const px = makeFaceTexture(faceData.px, faceSize);
  const nx = makeFaceTexture(faceData.nx, faceSize);
  const py = makeFaceTexture(faceData.py, faceSize);
  const ny = makeFaceTexture(faceData.ny, faceSize);
  const pz = makeFaceTexture(faceData.pz, faceSize);
  const nz = makeFaceTexture(faceData.nz, faceSize);

  // Three's uploadCubeTexture detects the data-texture path via
  // `texture.image[0].isDataTexture` (three.module.js:12411) and then reads
  // `.image` (the {data,width,height} record) from each face. So we must pass
  // the DataTexture instances themselves, not their raw image records.
  const cubeTexture = new CubeTexture([px, nx, py, ny, pz, nz]);
  cubeTexture.format = RGBAFormat;
  cubeTexture.magFilter = LinearFilter;
  cubeTexture.minFilter = LinearFilter;
  cubeTexture.colorSpace = SRGBColorSpace;
  cubeTexture.generateMipmaps = false;
  cubeTexture.needsUpdate = true;

  return { cubeTexture, faces: { px, nx, py, ny, pz, nz } };
}

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
}

const DEFAULT: Required<Omit<SkyboxOptions, 'sunFace'>> & { sunFace: SkyboxFace | null } = {
  faceSize: 256,
  zenithColor: [60, 110, 200],
  horizonColor: [180, 210, 235],
  groundColor: [80, 75, 65],
  sunFace: 'px',
  sunUv: [0.5, 0.4],
  sunRadius: 0.06,
  sunColor: [255, 240, 210],
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

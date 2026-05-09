import {
  DataTexture,
  RGBAFormat,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Wrapping,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  type ColorSpace,
} from 'three';

export interface CheckerTextureOptions {
  size?: number;
  tilesPerSide?: number;
  color1?: [number, number, number];
  color2?: [number, number, number];
  wrap?: Wrapping;
  magFilter?: MagnificationTextureFilter;
  minFilter?: MinificationTextureFilter;
  colorSpace?: ColorSpace;
}

const DEFAULT_CHECKER: Required<Omit<CheckerTextureOptions, 'wrap' | 'magFilter' | 'minFilter' | 'colorSpace'>> = {
  size: 1024,
  tilesPerSide: 32,
  color1: [80, 110, 70],
  color2: [60, 90, 55],
};

export function paintCheckerRGBA(
  size: number,
  tilesPerSide: number,
  color1: [number, number, number],
  color2: [number, number, number],
): Uint8Array {
  if (size <= 0 || !Number.isInteger(size)) {
    throw new Error(`paintCheckerRGBA: size must be a positive integer, got ${size}`);
  }
  if (tilesPerSide <= 0 || !Number.isInteger(tilesPerSide)) {
    throw new Error(`paintCheckerRGBA: tilesPerSide must be a positive integer, got ${tilesPerSide}`);
  }
  const data = new Uint8Array(size * size * 4);
  const tilePx = size / tilesPerSide;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / tilePx);
      const ty = Math.floor(y / tilePx);
      const c = (tx + ty) % 2 === 0 ? color1 : color2;
      const i = (y * size + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

export function createCheckerTexture(opts: CheckerTextureOptions = {}): DataTexture {
  const size = opts.size ?? DEFAULT_CHECKER.size;
  const tilesPerSide = opts.tilesPerSide ?? DEFAULT_CHECKER.tilesPerSide;
  const color1 = opts.color1 ?? DEFAULT_CHECKER.color1;
  const color2 = opts.color2 ?? DEFAULT_CHECKER.color2;

  const data = paintCheckerRGBA(size, tilesPerSide, color1, color2);
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = opts.wrap ?? RepeatWrapping;
  tex.wrapT = opts.wrap ?? RepeatWrapping;
  tex.magFilter = opts.magFilter ?? LinearFilter;
  tex.minFilter = opts.minFilter ?? LinearMipmapLinearFilter;
  tex.colorSpace = opts.colorSpace ?? SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface SolidStripeTextureOptions {
  size?: number;
  background?: [number, number, number];
  stripeColor?: [number, number, number];
  stripeWidthFraction?: number;
  dashCount?: number;
  dashGapFraction?: number;
}

export function paintRunwayStripeRGBA(opts: Required<SolidStripeTextureOptions>): Uint8Array {
  const { size, background, stripeColor, stripeWidthFraction, dashCount, dashGapFraction } = opts;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = background[0];
      data[i + 1] = background[1];
      data[i + 2] = background[2];
      data[i + 3] = 255;
    }
  }
  const stripeHalfW = (size * stripeWidthFraction) / 2;
  const xCenter = size / 2;
  const segmentLen = size / dashCount;
  const gapLen = segmentLen * dashGapFraction;
  const dashLen = segmentLen - gapLen;
  for (let y = 0; y < size; y++) {
    const segmentPos = y % segmentLen;
    if (segmentPos > dashLen) continue;
    const xStart = Math.floor(xCenter - stripeHalfW);
    const xEnd = Math.ceil(xCenter + stripeHalfW);
    for (let x = xStart; x < xEnd; x++) {
      if (x < 0 || x >= size) continue;
      const i = (y * size + x) * 4;
      data[i] = stripeColor[0];
      data[i + 1] = stripeColor[1];
      data[i + 2] = stripeColor[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

export function createRunwayStripeTexture(opts: SolidStripeTextureOptions = {}): DataTexture {
  const filled: Required<SolidStripeTextureOptions> = {
    size: opts.size ?? 256,
    background: opts.background ?? [40, 40, 40],
    stripeColor: opts.stripeColor ?? [240, 240, 240],
    stripeWidthFraction: opts.stripeWidthFraction ?? 0.04,
    dashCount: opts.dashCount ?? 12,
    dashGapFraction: opts.dashGapFraction ?? 0.4,
  };
  const data = paintRunwayStripeRGBA(filled);
  const tex = new DataTexture(data, filled.size, filled.size, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

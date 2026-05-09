import { describe, it, expect } from 'vitest';
import { DataTexture, RepeatWrapping, LinearFilter } from 'three';
import {
  createCheckerTexture,
  createRunwayStripeTexture,
  paintCheckerRGBA,
  paintRunwayStripeRGBA,
} from './textures';

describe('paintCheckerRGBA', () => {
  it('produces an RGBA buffer of the expected length', () => {
    const data = paintCheckerRGBA(8, 2, [0, 0, 0], [255, 255, 255]);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(8 * 8 * 4);
  });

  it('alternates colors between adjacent tiles', () => {
    const size = 4;
    const tiles = 2;
    const data = paintCheckerRGBA(size, tiles, [10, 20, 30], [200, 210, 220]);
    const tilePx = size / tiles;
    const colorAt = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(colorAt(0, 0)).toEqual([10, 20, 30]);
    expect(colorAt(tilePx, 0)).toEqual([200, 210, 220]);
    expect(colorAt(0, tilePx)).toEqual([200, 210, 220]);
    expect(colorAt(tilePx, tilePx)).toEqual([10, 20, 30]);
  });

  it('writes alpha=255 everywhere', () => {
    const data = paintCheckerRGBA(4, 2, [0, 0, 0], [255, 255, 255]);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });

  it('rejects non-positive size', () => {
    expect(() => paintCheckerRGBA(0, 2, [0, 0, 0], [255, 255, 255])).toThrow();
    expect(() => paintCheckerRGBA(-4, 2, [0, 0, 0], [255, 255, 255])).toThrow();
  });

  it('rejects non-positive tilesPerSide', () => {
    expect(() => paintCheckerRGBA(8, 0, [0, 0, 0], [255, 255, 255])).toThrow();
  });

  it('produces identical output across calls with the same args (determinism)', () => {
    const a = paintCheckerRGBA(16, 4, [50, 60, 70], [180, 190, 200]);
    const b = paintCheckerRGBA(16, 4, [50, 60, 70], [180, 190, 200]);
    expect(a).toEqual(b);
  });
});

describe('createCheckerTexture', () => {
  it('returns a DataTexture with the configured size', () => {
    const tex = createCheckerTexture({ size: 128, tilesPerSide: 8 });
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.image.width).toBe(128);
    expect(tex.image.height).toBe(128);
  });

  it('defaults to RepeatWrapping on both axes', () => {
    const tex = createCheckerTexture({ size: 32, tilesPerSide: 4 });
    expect(tex.wrapS).toBe(RepeatWrapping);
    expect(tex.wrapT).toBe(RepeatWrapping);
  });

  it('uses LinearFilter for magnification by default', () => {
    const tex = createCheckerTexture({ size: 32, tilesPerSide: 4 });
    expect(tex.magFilter).toBe(LinearFilter);
  });

  it('uses default options when none supplied', () => {
    const tex = createCheckerTexture();
    expect(tex.image.width).toBe(1024);
    expect(tex.image.height).toBe(1024);
  });
});

describe('paintRunwayStripeRGBA', () => {
  it('produces an RGBA buffer of the expected length', () => {
    const data = paintRunwayStripeRGBA({
      size: 8,
      background: [40, 40, 40],
      stripeColor: [240, 240, 240],
      stripeWidthFraction: 0.5,
      dashCount: 2,
      dashGapFraction: 0,
    });
    expect(data.length).toBe(8 * 8 * 4);
  });

  it('paints background everywhere when stripe width is zero', () => {
    const data = paintRunwayStripeRGBA({
      size: 8,
      background: [10, 20, 30],
      stripeColor: [240, 240, 240],
      stripeWidthFraction: 0,
      dashCount: 1,
      dashGapFraction: 0,
    });
    for (let i = 0; i < 8 * 8; i++) {
      const off = i * 4;
      expect([data[off], data[off + 1], data[off + 2]]).toEqual([10, 20, 30]);
    }
  });
});

describe('createRunwayStripeTexture', () => {
  it('returns a DataTexture with default dimensions', () => {
    const tex = createRunwayStripeTexture();
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.image.width).toBe(256);
    expect(tex.image.height).toBe(256);
  });

  it('honours a configured size', () => {
    const tex = createRunwayStripeTexture({ size: 64 });
    expect(tex.image.width).toBe(64);
  });
});

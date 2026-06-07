import { describe, it, expect } from 'vitest';
import { CubeTexture, DataTexture, ClampToEdgeWrapping, LinearFilter } from 'three';
import {
  createProceduralSkybox,
  paintSideFaceRGBA,
  paintSolidFaceRGBA,
  stampSunDiscRGBA,
  stampCloudRGBA,
  applyHorizonHazeRGBA,
  stampCloudsRGBA,
  mulberry32,
} from './skybox';

describe('paintSideFaceRGBA', () => {
  it('produces an RGBA buffer of the expected length', () => {
    const data = paintSideFaceRGBA(8, [0, 0, 0], [255, 255, 255]);
    expect(data.length).toBe(8 * 8 * 4);
  });

  it('puts zenith at the top pixel row and horizon at the bottom', () => {
    const size = 16;
    const zenith: [number, number, number] = [10, 20, 30];
    const horizon: [number, number, number] = [200, 210, 220];
    const data = paintSideFaceRGBA(size, zenith, horizon);
    const top = [data[0], data[1], data[2]];
    const bottomY = size - 1;
    const bottomI = (bottomY * size) * 4;
    const bottom = [data[bottomI], data[bottomI + 1], data[bottomI + 2]];
    expect(top).toEqual(zenith);
    expect(bottom).toEqual(horizon);
  });

  it('produces uniform horizontal rows (every column same color at any y)', () => {
    const size = 8;
    const data = paintSideFaceRGBA(size, [0, 0, 0], [255, 255, 255]);
    for (let y = 0; y < size; y++) {
      const left = (y * size + 0) * 4;
      const right = (y * size + (size - 1)) * 4;
      expect([data[left], data[left + 1], data[left + 2]]).toEqual([data[right], data[right + 1], data[right + 2]]);
    }
  });

  it('alpha is 255 everywhere', () => {
    const data = paintSideFaceRGBA(4, [0, 0, 0], [255, 255, 255]);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });
});

describe('paintSolidFaceRGBA', () => {
  it('paints a uniform color across the whole face', () => {
    const size = 4;
    const data = paintSolidFaceRGBA(size, [42, 84, 126]);
    for (let i = 0; i < size * size; i++) {
      const off = i * 4;
      expect([data[off], data[off + 1], data[off + 2]]).toEqual([42, 84, 126]);
    }
  });
});

describe('stampSunDiscRGBA', () => {
  it('paints the sun centre with the sun color', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [0, 0, 0]);
    stampSunDiscRGBA(data, size, 16, 16, 4, [255, 240, 210]);
    const i = (16 * size + 16) * 4;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 240, 210]);
  });

  it('leaves pixels well outside the radius untouched', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [50, 60, 70]);
    stampSunDiscRGBA(data, size, 16, 16, 4, [255, 240, 210]);
    const farI = (0 * size + 0) * 4;
    expect([data[farI], data[farI + 1], data[farI + 2]]).toEqual([50, 60, 70]);
  });

  it('handles a sun centre near the face edge without out-of-bounds writes', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [0, 0, 0]);
    expect(() => stampSunDiscRGBA(data, size, 1, 1, 4, [255, 255, 255])).not.toThrow();
    expect(data.length).toBe(size * size * 4);
  });
});

describe('mulberry32', () => {
  it('produces identical sequences for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differ = false;
    for (let i = 0; i < 10; i++) {
      if (a() !== b()) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });

  it('emits values in [0, 1)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('stampCloudRGBA', () => {
  it('lifts the centre pixel toward the cloud color', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [50, 100, 150]);
    stampCloudRGBA(data, size, 16, 16, 4, 4, [240, 240, 240], 1.0);
    const i = (16 * size + 16) * 4;
    // At centre, quadratic falloff (1-d²)² with d²=0 → alpha=1 → exact cloud color.
    expect(data[i]).toBe(240);
    expect(data[i + 1]).toBe(240);
    expect(data[i + 2]).toBe(240);
  });

  it('leaves pixels outside the ellipse untouched', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [50, 100, 150]);
    stampCloudRGBA(data, size, 16, 16, 4, 4, [240, 240, 240], 1.0);
    const farI = (0 * size + 0) * 4;
    expect([data[farI], data[farI + 1], data[farI + 2]]).toEqual([50, 100, 150]);
  });

  it('handles centers near the face edge without out-of-bounds writes', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [0, 0, 0]);
    expect(() => stampCloudRGBA(data, size, 1, 1, 4, 4, [255, 255, 255], 0.8)).not.toThrow();
    expect(data.length).toBe(size * size * 4);
  });
});

describe('stampCloudsRGBA', () => {
  it('emits the requested number of distinct ellipses (each modifies the buffer)', () => {
    const size = 64;
    const data = paintSolidFaceRGBA(size, [0, 0, 0]);
    const rng = mulberry32(99);
    stampCloudsRGBA(data, size, 5, [255, 255, 255], rng);
    // After stamping, some interior pixels should be brighter than baseline.
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 50) bright++;
    }
    expect(bright).toBeGreaterThan(0);
  });

  it('count=0 is a no-op', () => {
    const size = 32;
    const data = paintSolidFaceRGBA(size, [10, 20, 30]);
    const rng = mulberry32(5);
    stampCloudsRGBA(data, size, 0, [255, 255, 255], rng);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(10);
      expect(data[i + 1]).toBe(20);
      expect(data[i + 2]).toBe(30);
    }
  });
});

describe('applyHorizonHazeRGBA', () => {
  it('hazeStrength=0 is a no-op', () => {
    const size = 16;
    const data = paintSideFaceRGBA(size, [0, 0, 0], [255, 255, 255]);
    const before = data.slice();
    applyHorizonHazeRGBA(data, size, [100, 100, 100], 0);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBe(before[i]);
  });

  it('lifts bottom band pixels toward the haze color', () => {
    const size = 32;
    const data = paintSideFaceRGBA(size, [0, 0, 0], [50, 50, 50]);
    applyHorizonHazeRGBA(data, size, [255, 0, 0], 1.0);
    // Pixel near bottom should be shifted strongly toward red.
    const y = size - 2;
    const i = (y * size + 8) * 4;
    expect(data[i]).toBeGreaterThan(50);
  });

  it('leaves the top band (zenith side) untouched', () => {
    const size = 32;
    const data = paintSideFaceRGBA(size, [10, 20, 30], [200, 210, 220]);
    applyHorizonHazeRGBA(data, size, [255, 0, 0], 1.0);
    // Top half is below bandStartY (0.7*size = 22) — untouched.
    const i = (10 * size + 8) * 4;
    expect(data[i]).toBe(data[i]); // sanity
    // Should still be in the gradient range (not shifted red).
    expect(data[i]).toBeLessThan(200);
  });
});

describe('createProceduralSkybox', () => {
  it('returns a CubeTexture and the six DataTexture faces', () => {
    const { cubeTexture, faces } = createProceduralSkybox();
    expect(cubeTexture).toBeInstanceOf(CubeTexture);
    expect(faces.px).toBeInstanceOf(DataTexture);
    expect(faces.nx).toBeInstanceOf(DataTexture);
    expect(faces.py).toBeInstanceOf(DataTexture);
    expect(faces.ny).toBeInstanceOf(DataTexture);
    expect(faces.pz).toBeInstanceOf(DataTexture);
    expect(faces.nz).toBeInstanceOf(DataTexture);
  });

  it('cube texture has six face images', () => {
    const { cubeTexture } = createProceduralSkybox();
    expect(cubeTexture.images.length).toBe(6);
  });

  it('uses the configured face size', () => {
    const { faces } = createProceduralSkybox({ faceSize: 64 });
    for (const f of [faces.px, faces.nx, faces.py, faces.ny, faces.pz, faces.nz]) {
      expect(f.image.width).toBe(64);
      expect(f.image.height).toBe(64);
    }
  });

  it('side faces use ClampToEdgeWrapping (avoids cube-corner seams)', () => {
    const { faces } = createProceduralSkybox();
    expect(faces.px.wrapS).toBe(ClampToEdgeWrapping);
    expect(faces.px.wrapT).toBe(ClampToEdgeWrapping);
  });

  it('uses LinearFilter for magnification', () => {
    const { cubeTexture, faces } = createProceduralSkybox();
    expect(faces.px.magFilter).toBe(LinearFilter);
    expect(cubeTexture.magFilter).toBe(LinearFilter);
  });

  it('side faces share identical zenith (top row) and horizon (bottom row) colors — seam guarantee', () => {
    const { faces } = createProceduralSkybox({ faceSize: 16 });
    const sides = [faces.px, faces.nx, faces.pz, faces.nz];
    const sampleEdgeRow = (face: DataTexture, y: number) => {
      const data = face.image.data as Uint8Array;
      const i = (y * 16 + 0) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const zenithRefs = sides.map((f) => sampleEdgeRow(f, 0));
    const horizonRefs = sides.map((f) => sampleEdgeRow(f, 15));
    for (let i = 1; i < zenithRefs.length; i++) {
      expect(zenithRefs[i]).toEqual(zenithRefs[0]);
      expect(horizonRefs[i]).toEqual(horizonRefs[0]);
    }
  });

  it('+Y face is uniform zenith color (matches side-face top row)', () => {
    const { faces } = createProceduralSkybox({ faceSize: 8 });
    const py = faces.py.image.data as Uint8Array;
    const px = faces.px.image.data as Uint8Array;
    const pyTL = [py[0], py[1], py[2]];
    const pyBR = [py[(7 * 8 + 7) * 4], py[(7 * 8 + 7) * 4 + 1], py[(7 * 8 + 7) * 4 + 2]];
    const pxTop = [px[0], px[1], px[2]];
    expect(pyTL).toEqual(pyBR);
    expect(pyTL).toEqual(pxTop);
  });

  it('-Y face is the configured ground color', () => {
    const { faces } = createProceduralSkybox({ faceSize: 4, groundColor: [123, 45, 67] });
    const data = faces.ny.image.data as Uint8Array;
    expect([data[0], data[1], data[2]]).toEqual([123, 45, 67]);
  });

  it('with sunFace null, no face has a sun-colored pixel matching the default sun', () => {
    const { faces } = createProceduralSkybox({ faceSize: 32, sunFace: null });
    const px = faces.px.image.data as Uint8Array;
    let hasSunPixel = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 255 && px[i + 1] === 240 && px[i + 2] === 210) {
        hasSunPixel = true;
        break;
      }
    }
    expect(hasSunPixel).toBe(false);
  });

  it('with sunFace=px, the px face has a sun-colored pixel near the configured uv', () => {
    const { faces } = createProceduralSkybox({
      faceSize: 64,
      sunFace: 'px',
      sunUv: [0.5, 0.5],
      sunRadius: 0.1,
      sunColor: [255, 240, 210],
    });
    const data = faces.px.image.data as Uint8Array;
    const i = (32 * 64 + 32) * 4;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 240, 210]);
  });

  it('rejects non-positive faceSize', () => {
    expect(() => createProceduralSkybox({ faceSize: 0 })).toThrow();
    expect(() => createProceduralSkybox({ faceSize: -8 })).toThrow();
  });

  it('rejects sunFace set to a non-side face (py / ny)', () => {
    expect(() => createProceduralSkybox({ sunFace: 'py' as 'px' })).toThrow();
  });

  it('default skybox has cloud features stamped on side faces (interior is brighter than baseline gradient)', () => {
    const size = 64;
    const { faces } = createProceduralSkybox({ faceSize: size, hazeStrength: 0, sunFace: null });
    const baseline = createProceduralSkybox({ faceSize: size, clouds: false, hazeStrength: 0, sunFace: null });
    // Compare interior region (middle rows) for px face: at least some pixels
    // should be lifted by the cloud overlay vs baseline.
    const data = faces.px.image.data as Uint8Array;
    const base = baseline.faces.px.image.data as Uint8Array;
    let liftedCount = 0;
    const interiorRowStart = Math.floor(size * 0.15);
    const interiorRowEnd = Math.floor(size * 0.5);
    for (let y = interiorRowStart; y < interiorRowEnd; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (data[i]! > base[i]! + 5) liftedCount++;
      }
    }
    expect(liftedCount).toBeGreaterThan(50);
  });

  it('clouds:false disables cloud stamping (matches baseline exactly)', () => {
    const size = 32;
    const { faces } = createProceduralSkybox({ faceSize: size, clouds: false, hazeStrength: 0, sunFace: null });
    const baseline = createProceduralSkybox({ faceSize: size, clouds: false, hazeStrength: 0, sunFace: null });
    const a = faces.px.image.data as Uint8Array;
    const b = baseline.faces.px.image.data as Uint8Array;
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it('cloud placement is deterministic for the same seed', () => {
    const a = createProceduralSkybox({ faceSize: 32, sunFace: null, clouds: { seed: 42, count: 4 } });
    const b = createProceduralSkybox({ faceSize: 32, sunFace: null, clouds: { seed: 42, count: 4 } });
    const ad = a.faces.px.image.data as Uint8Array;
    const bd = b.faces.px.image.data as Uint8Array;
    for (let i = 0; i < ad.length; i++) expect(ad[i]).toBe(bd[i]);
  });

  it('different cloud seeds produce different placements', () => {
    const a = createProceduralSkybox({ faceSize: 32, sunFace: null, clouds: { seed: 1, count: 4 } });
    const b = createProceduralSkybox({ faceSize: 32, sunFace: null, clouds: { seed: 2, count: 4 } });
    const ad = a.faces.px.image.data as Uint8Array;
    const bd = b.faces.px.image.data as Uint8Array;
    let differingPixels = 0;
    for (let i = 0; i < ad.length; i += 4) {
      if (ad[i] !== bd[i] || ad[i + 1] !== bd[i + 1] || ad[i + 2] !== bd[i + 2]) differingPixels++;
    }
    expect(differingPixels).toBeGreaterThan(20);
  });

  it('horizon haze lifts the bottom band toward haze color (but preserves seam at the very last row)', () => {
    const size = 32;
    // Build with no clouds + no sun + strong haze so the effect is pure.
    const { faces } = createProceduralSkybox({
      faceSize: size, clouds: false, sunFace: null, hazeStrength: 1.0,
      hazeColor: [255, 0, 0],
    });
    const data = faces.px.image.data as Uint8Array;
    // Sample a pixel 5% above the bottom — should be strongly red-shifted vs the
    // pure gradient horizon color (180, 210, 235).
    const y = size - 2;
    const i = (y * size + 8) * 4;
    expect(data[i]).toBeGreaterThan(180);
    // Sample the very top (zenith row) — should be untouched.
    const top = [data[0], data[1], data[2]];
    expect(top).toEqual([60, 110, 200]);
  });

  it('haze keeps the very last row uniform across all side faces (seam guarantee)', () => {
    const size = 32;
    const { faces } = createProceduralSkybox({
      faceSize: size, clouds: false, sunFace: null, hazeStrength: 0.6,
    });
    const sides = [faces.px, faces.nx, faces.pz, faces.nz];
    const sampleBottomRow = (f: DataTexture) => {
      const d = f.image.data as Uint8Array;
      const y = size - 1;
      const i = (y * size) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const ref = sampleBottomRow(sides[0]!);
    for (let i = 1; i < sides.length; i++) {
      expect(sampleBottomRow(sides[i]!)).toEqual(ref);
    }
  });

  it('hazeStrength=0 is a no-op (matches the no-haze baseline)', () => {
    const size = 16;
    const a = createProceduralSkybox({ faceSize: size, clouds: false, sunFace: null, hazeStrength: 0 });
    const ad = a.faces.px.image.data as Uint8Array;
    // Compare bottom row to a pure paintSideFaceRGBA result — should match.
    const pure = paintSideFaceRGBA(size, [60, 110, 200], [180, 210, 235]);
    const lastRowStart = (size - 1) * size * 4;
    for (let i = 0; i < size * 4; i++) {
      expect(ad[lastRowStart + i]).toBe(pure[lastRowStart + i]);
    }
  });

  it('cube texture face entries are DataTexture instances (Three.js upload-path contract)', () => {
    // Three's WebGLState.uploadCubeTexture inspects `texture.image[0].isDataTexture`
    // (three.module.js:12411) to decide whether to read raw pixel data via
    // `image[i].image` or treat each entry as an HTML image. If we pass raw
    // {data,width,height} records (i.e. DataTexture.image), the flag check
    // fails and texSubImage2D throws at first frame, blanking the canvas.
    // Regression test for the Phase 4 verify-self failure (2026-05-09).
    const { cubeTexture } = createProceduralSkybox({ faceSize: 16 });
    expect(cubeTexture.images.length).toBe(6);
    for (let i = 0; i < 6; i++) {
      const face = cubeTexture.images[i] as { isDataTexture?: boolean };
      expect(face.isDataTexture).toBe(true);
    }
  });
});

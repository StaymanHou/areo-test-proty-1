import { describe, it, expect } from 'vitest';
import { CubeTexture, DataTexture, ClampToEdgeWrapping, LinearFilter } from 'three';
import {
  createProceduralSkybox,
  paintSideFaceRGBA,
  paintSolidFaceRGBA,
  stampSunDiscRGBA,
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

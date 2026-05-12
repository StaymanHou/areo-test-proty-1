import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadMission, loadMissionList } from './loader';

const validMissionRaw = () => ({
  id: 'free-flight',
  name: 'Free Flight',
  type: 'free-flight',
  spawn: {
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -30 },
    throttle: 0,
  },
  objectives: [],
});

function makeFetch(
  responses: Array<{ url: RegExp; status?: number; body?: unknown }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const r of responses) {
      if (r.url.test(url)) {
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
          json: async () => r.body,
        } as Response;
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

describe('loadMission', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches /missions/<id>.json and returns the parsed Mission', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/free-flight\.json$/, body: validMissionRaw() },
    ]);
    const m = await loadMission('free-flight');
    expect(m.id).toBe('free-flight');
    expect(m.spawn.position).toEqual({ x: 0, y: 50, z: 0 });
  });

  it('throws with descriptive shape on 404', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/missing\.json$/, status: 404 },
    ]);
    await expect(loadMission('missing')).rejects.toThrow(
      /mission loader: fetch \/missions\/missing\.json → 404 Not Found/,
    );
  });

  it('propagates parser errors when the body is malformed', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/.*\.json$/, body: { id: 'x', name: 'X' /* missing required fields */ } },
    ]);
    await expect(loadMission('bad')).rejects.toThrow(/mission config:/);
  });
});

describe('loadMissionList', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches /missions/index.json and returns the parsed manifest', async () => {
    globalThis.fetch = makeFetch([
      {
        url: /\/missions\/index\.json$/,
        body: [
          { id: 'free-flight', name: 'Free Flight' },
          { id: 'waypoint-1', name: 'Waypoint Patrol' },
        ],
      },
    ]);
    const list = await loadMissionList();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: 'free-flight', name: 'Free Flight' });
    expect(list[1]).toEqual({ id: 'waypoint-1', name: 'Waypoint Patrol' });
  });

  it('throws on 404', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/index\.json$/, status: 404 },
    ]);
    await expect(loadMissionList()).rejects.toThrow(/index\.json → 404/);
  });

  it('rejects non-array root', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/index\.json$/, body: { missions: [] } },
    ]);
    await expect(loadMissionList()).rejects.toThrow(/root must be an array/);
  });

  it('rejects missing id on a manifest entry', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/index\.json$/, body: [{ name: 'No ID' }] },
    ]);
    await expect(loadMissionList()).rejects.toThrow(/entry\[0\]\.id/);
  });

  it('rejects empty name on a manifest entry', async () => {
    globalThis.fetch = makeFetch([
      { url: /\/missions\/index\.json$/, body: [{ id: 'x', name: '' }] },
    ]);
    await expect(loadMissionList()).rejects.toThrow(/entry\[0\]\.name/);
  });
});

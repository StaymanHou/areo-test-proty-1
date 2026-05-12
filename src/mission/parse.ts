// Mission JSON parser — mirrors `parseAircraftConfig` style (strict, finite-
// number, descriptive errors, unknown-field rejection). Failures throw with
// a `mission config: ...` prefix so the source is unambiguous in logs.

import type { Vec3Plain } from '../aircraft/state';
import {
  FAIL_CONDITIONS,
  MISSION_TYPES,
  OBJECTIVE_KINDS,
  WIN_CONDITIONS,
  type FailCondition,
  type Mission,
  type MissionType,
  type Objective,
  type SpawnConfig,
  type WinCondition,
} from './types';

function asFiniteNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`mission config: ${where} must be a finite number`);
  }
  return value;
}

function asVec3(value: unknown, where: string): Vec3Plain {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`mission config: ${where} must be {x:number, y:number, z:number}`);
  }
  const v = value as Record<string, unknown>;
  return {
    x: asFiniteNumber(v.x, `${where}.x`),
    y: asFiniteNumber(v.y, `${where}.y`),
    z: asFiniteNumber(v.z, `${where}.z`),
  };
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`mission config: ${where} has unknown field "${key}"`);
    }
  }
}

const SPAWN_KEYS = ['position', 'linvel', 'throttle'] as const;

function parseSpawn(raw: unknown): SpawnConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('mission config: spawn must be an object');
  }
  const r = raw as Record<string, unknown>;
  rejectUnknownKeys(r, SPAWN_KEYS, 'spawn');
  const throttle = asFiniteNumber(r.throttle, 'spawn.throttle');
  if (throttle < 0 || throttle > 1) {
    throw new Error('mission config: spawn.throttle must be in [0, 1]');
  }
  return {
    position: asVec3(r.position, 'spawn.position'),
    linvel: asVec3(r.linvel, 'spawn.linvel'),
    throttle,
  };
}

const REACH_WAYPOINT_KEYS = ['kind', 'position', 'radius', 'order'] as const;
const TOUCHDOWN_KEYS = ['kind', 'runway', 'maxVSpeed'] as const;
const DESTROY_TARGET_KEYS = ['kind', 'targetId'] as const;
const RUNWAY_KEYS = ['center', 'halfExtents'] as const;

function parseObjective(raw: unknown, where: string): Objective {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`mission config: ${where} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== 'string' || !(OBJECTIVE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `mission config: ${where}.kind must be one of: ${OBJECTIVE_KINDS.join(', ')}`,
    );
  }
  if (kind === 'reach-waypoint') {
    rejectUnknownKeys(r, REACH_WAYPOINT_KEYS, where);
    const radius = asFiniteNumber(r.radius, `${where}.radius`);
    if (radius <= 0) {
      throw new Error(`mission config: ${where}.radius must be > 0`);
    }
    const order = asFiniteNumber(r.order, `${where}.order`);
    if (!Number.isInteger(order) || order < 0) {
      throw new Error(`mission config: ${where}.order must be a non-negative integer`);
    }
    return {
      kind: 'reach-waypoint',
      position: asVec3(r.position, `${where}.position`),
      radius,
      order,
    };
  }
  if (kind === 'touchdown') {
    rejectUnknownKeys(r, TOUCHDOWN_KEYS, where);
    if (typeof r.runway !== 'object' || r.runway === null) {
      throw new Error(`mission config: ${where}.runway must be an object`);
    }
    const runway = r.runway as Record<string, unknown>;
    rejectUnknownKeys(runway, RUNWAY_KEYS, `${where}.runway`);
    const maxVSpeed = asFiniteNumber(r.maxVSpeed, `${where}.maxVSpeed`);
    if (maxVSpeed <= 0) {
      throw new Error(`mission config: ${where}.maxVSpeed must be > 0`);
    }
    return {
      kind: 'touchdown',
      runway: {
        center: asVec3(runway.center, `${where}.runway.center`),
        halfExtents: asVec3(runway.halfExtents, `${where}.runway.halfExtents`),
      },
      maxVSpeed,
    };
  }
  // kind === 'destroy-target'
  rejectUnknownKeys(r, DESTROY_TARGET_KEYS, where);
  if (typeof r.targetId !== 'string' || r.targetId.length === 0) {
    throw new Error(`mission config: ${where}.targetId must be a non-empty string`);
  }
  return { kind: 'destroy-target', targetId: r.targetId };
}

const MISSION_KEYS = [
  'id',
  'name',
  'type',
  'spawn',
  'objectives',
  'winCondition',
  'failCondition',
  'timeoutSec',
  'scriptHook',
] as const;

export function parseMission(raw: unknown): Mission {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('mission config: root must be an object');
  }
  const r = raw as Record<string, unknown>;
  rejectUnknownKeys(r, MISSION_KEYS, 'root');

  if (typeof r.id !== 'string' || r.id.length === 0) {
    throw new Error('mission config: id must be a non-empty string');
  }
  if (typeof r.name !== 'string' || r.name.length === 0) {
    throw new Error('mission config: name must be a non-empty string');
  }
  if (typeof r.type !== 'string' || !(MISSION_TYPES as readonly string[]).includes(r.type)) {
    throw new Error(
      `mission config: type must be one of: ${MISSION_TYPES.join(', ')}`,
    );
  }
  const type = r.type as MissionType;

  const spawn = parseSpawn(r.spawn);

  if (!Array.isArray(r.objectives)) {
    throw new Error('mission config: objectives must be an array');
  }
  const objectives = r.objectives.map((entry, i) =>
    parseObjective(entry, `objectives[${i}]`),
  );

  let winCondition: WinCondition = 'all-objectives';
  if (r.winCondition !== undefined) {
    if (
      typeof r.winCondition !== 'string' ||
      !(WIN_CONDITIONS as readonly string[]).includes(r.winCondition)
    ) {
      throw new Error(
        `mission config: winCondition must be one of: ${WIN_CONDITIONS.join(', ')}`,
      );
    }
    winCondition = r.winCondition as WinCondition;
  }

  let failCondition: FailCondition = 'crash';
  if (r.failCondition !== undefined) {
    if (
      typeof r.failCondition !== 'string' ||
      !(FAIL_CONDITIONS as readonly string[]).includes(r.failCondition)
    ) {
      throw new Error(
        `mission config: failCondition must be one of: ${FAIL_CONDITIONS.join(', ')}`,
      );
    }
    failCondition = r.failCondition as FailCondition;
  }

  let timeoutSec: number | undefined;
  if (r.timeoutSec !== undefined) {
    timeoutSec = asFiniteNumber(r.timeoutSec, 'timeoutSec');
    if (timeoutSec <= 0) {
      throw new Error('mission config: timeoutSec must be > 0');
    }
  }
  if (failCondition === 'timeout' && timeoutSec === undefined) {
    throw new Error(
      'mission config: failCondition "timeout" requires a positive timeoutSec',
    );
  }

  let scriptHook: string | undefined;
  if (r.scriptHook !== undefined) {
    if (typeof r.scriptHook !== 'string' || r.scriptHook.length === 0) {
      throw new Error('mission config: scriptHook must be a non-empty string');
    }
    scriptHook = r.scriptHook;
  }

  return {
    id: r.id,
    name: r.name,
    type,
    spawn,
    objectives,
    winCondition,
    failCondition,
    ...(timeoutSec !== undefined ? { timeoutSec } : {}),
    ...(scriptHook !== undefined ? { scriptHook } : {}),
  };
}

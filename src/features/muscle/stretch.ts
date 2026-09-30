/// <reference types="node" />
import loadMujoco from "@mujoco/mujoco";

/**
 * Calculates stretch ratios for each muscle given baseline and current lengths.
 *
 * @param baseLengths - Array-like collection of baseline muscle lengths.
 * @param currentLengths - Array-like collection of current muscle lengths.
 * @returns Array of stretch ratios (current / base). If base <= 0, returns NaN as an invalid indicator.
 * @throws Error if the lengths of baseLengths and currentLengths do not match.
 */
export function calculateStretchRatios(
  baseLengths: ArrayLike<number>,
  currentLengths: ArrayLike<number>
): number[] {
  if (baseLengths.length !== currentLengths.length) {
    throw new Error(
      `Length mismatch: baseLengths has ${baseLengths.length} items but currentLengths has ${currentLengths.length} items`
    );
  }

  const result: number[] = new Array(baseLengths.length);
  for (let i = 0; i < baseLengths.length; i++) {
    const base = baseLengths[i];
    const current = currentLengths[i];
    if (base <= 0) {
      result[i] = Number.NaN;
    } else {
      result[i] = current / base;
    }
  }
  return result;
}

/**
 * Maps a muscle stretch ratio to a hex color string.
 *
 * - ratio = 1.0: neutral color (#f0f0f0)
 * - ratio > 1.0: warm colors (yellow to orange to red)
 * - ratio < 1.0: cold colors (light blue to deep blue)
 * - invalid (NaN/Infinity): neutral slate gray (#94a3b8)
 */
export function getStretchColorHex(ratio: number): string {
  if (Number.isNaN(ratio) || !Number.isFinite(ratio)) {
    return "#94a3b8";
  }

  if (Math.abs(ratio - 1.0) < 1e-6) {
    return "#f0f0f0";
  }

  if (ratio > 1.0) {
    // Warm gradient: 1.0 -> 1.1 (yellow) -> 1.2+ (red)
    const t = Math.min(1.0, (ratio - 1.0) / 0.2);
    if (t < 0.5) {
      // 1.0 to 1.1: Neutral #f0f0f0 (240, 240, 240) -> Yellow #facc15 (250, 204, 21)
      const k = t / 0.5;
      const r = Math.round(240 + (250 - 240) * k);
      const g = Math.round(240 + (204 - 240) * k);
      const b = Math.round(240 + (21 - 240) * k);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } else {
      // 1.1 to 1.2+: Yellow #facc15 (250, 204, 21) -> Red #ef4444 (239, 68, 68)
      const k = (t - 0.5) / 0.5;
      const r = Math.round(250 + (239 - 250) * k);
      const g = Math.round(204 + (68 - 204) * k);
      const b = Math.round(21 + (68 - 21) * k);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
  } else {
    // Cold gradient: 1.0 -> 0.9 (light blue) -> 0.8- (deep blue)
    const t = Math.min(1.0, (1.0 - ratio) / 0.2);
    if (t < 0.5) {
      // 1.0 to 0.9: Neutral #f0f0f0 (240, 240, 240) -> Light blue #38bdf8 (56, 189, 248)
      const k = t / 0.5;
      const r = Math.round(240 + (56 - 240) * k);
      const g = Math.round(240 + (189 - 240) * k);
      const b = Math.round(240 + (248 - 240) * k);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } else {
      // 0.9 to 0.8-: Light blue #38bdf8 (56, 189, 248) -> Deep blue #1e3a8a (30, 58, 138)
      const k = (t - 0.5) / 0.5;
      const r = Math.round(56 + (30 - 56) * k);
      const g = Math.round(189 + (58 - 189) * k);
      const b = Math.round(248 + (138 - 248) * k);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
  }
}

/**
 * 3D tendon path points (including wrap objects) for a muscle.
 */
export interface MuscleTendonPath {
  actuatorId: number;
  actuatorName: string;
  tendonId: number;
  points: [number, number, number][];
  stretchRatio: number;
}

/**
 * Extracted mesh data for a skeletal bone geom.
 */
export interface SkeletonMeshData {
  geomId: number;
  geomName: string;
  vertices: Float32Array;
  indices: Uint32Array;
  /** 4x4 matrix in row-major order: [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz, 0, 0, 0, 1] */
  transform: number[];
}

/**
 * Wrapper class managing the MuJoCo MyoFullBody simulation.
 */
export class MyoSimulation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly mujoco: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly model: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly data: any;

  loadTimeMs?: number;

  private readonly cachedBaseLengths: Float64Array;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(mujoco: any, model: any, data: any) {
    this.mujoco = mujoco;
    this.model = model;
    this.data = data;

    // Initialize to default pose qpos0 and forward simulation
    this.resetToDefaultPose();

    // Cache baseline actuator lengths
    this.cachedBaseLengths = new Float64Array(this.model.nu);
    this.cachedBaseLengths.set(this.data.actuator_length);
  }

  /**
   * Resets simulation qpos to model default qpos0 and runs forward kinematics.
   */
  resetToDefaultPose(): void {
    this.data.qpos.set(this.model.qpos0);
    this.mujoco.mj_forward(this.model, this.data);
  }

  /**
   * Returns a copy of the baseline actuator lengths (at qpos0).
   */
  getBaseActuatorLengths(): Float64Array {
    return new Float64Array(this.cachedBaseLengths);
  }

  /**
   * Returns a copy of the current actuator lengths.
   */
  getCurrentActuatorLengths(): Float64Array {
    const current = new Float64Array(this.model.nu);
    current.set(this.data.actuator_length);
    return current;
  }

  /**
   * Applies the forward bend pose (hip_flexion_r / hip_flexion_l at 90 deg, others at qpos0)
   * and runs forward kinematics.
   */
  applyForwardBendPose(): void {
    this.resetToDefaultPose();

    const hipFlexionAngle = (90 * Math.PI) / 180; // 90 degrees in radians

    const hipR = this.model.jnt("hip_flexion_r");
    const hipL = this.model.jnt("hip_flexion_l");

    this.data.qpos[hipR.qposadr] = hipFlexionAngle;
    this.data.qpos[hipL.qposadr] = hipFlexionAngle;

    this.mujoco.mj_forward(this.model, this.data);
  }

  /**
   * Gets actuator ID by name.
   */
  getActuatorId(name: string): number {
    return this.model.actuator(name).id;
  }

  /**
   * Gets all actuator names in model order.
   */
  getActuatorNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < this.model.nu; i++) {
      names.push(this.model.actuator(i).name);
    }
    return names;
  }

  /**
   * Extracts tendon routing path points (including wrapping) for all muscle actuators.
   */
  getMuscleTendonPaths(stretchRatios?: number[]): MuscleTendonPath[] {
    const paths: MuscleTendonPath[] = [];

    for (let i = 0; i < this.model.nu; i++) {
      const actuatorName = this.model.actuator(i).name;
      const tendonId = this.model.actuator_trnid[i * 2];
      const wrapadr = this.data.ten_wrapadr[tendonId];
      const wrapnum = this.data.ten_wrapnum[tendonId];

      const points: [number, number, number][] = [];
      for (let p = 0; p < wrapnum; p++) {
        const idx = (wrapadr + p) * 3;
        points.push([
          this.data.wrap_xpos[idx],
          this.data.wrap_xpos[idx + 1],
          this.data.wrap_xpos[idx + 2],
        ]);
      }

      const stretchRatio =
        stretchRatios && stretchRatios[i] !== undefined ? stretchRatios[i] : 1.0;

      paths.push({
        actuatorId: i,
        actuatorName,
        tendonId,
        points,
        stretchRatio,
      });
    }

    return paths;
  }

  /**
   * Extracts skeletal bone meshes (geom_type === 7 && geom_group === 0) with their current poses.
   */
  getSkeletonMeshes(): SkeletonMeshData[] {
    const meshes: SkeletonMeshData[] = [];

    for (let i = 0; i < this.model.ngeom; i++) {
      // 7 = mjGEOM_MESH, group 0 = bones
      if (this.model.geom_type[i] === 7 && this.model.geom_group[i] === 0) {
        const geomName = this.model.geom(i).name;
        const meshId = this.model.geom_dataid[i];

        const vertAdr = this.model.mesh_vertadr[meshId];
        const vertNum = this.model.mesh_vertnum[meshId];
        const faceAdr = this.model.mesh_faceadr[meshId];
        const faceNum = this.model.mesh_facenum[meshId];

        const vertices = new Float32Array(vertNum * 3);
        for (let v = 0; v < vertNum * 3; v++) {
          vertices[v] = this.model.mesh_vert[vertAdr * 3 + v];
        }

        const indices = new Uint32Array(faceNum * 3);
        for (let f = 0; f < faceNum * 3; f++) {
          indices[f] = this.model.mesh_face[faceAdr * 3 + f];
        }

        // 3x3 rotation matrix (row-major) and position
        const r = this.data.geom_xmat;
        const p = this.data.geom_xpos;
        const g9 = i * 9;
        const g3 = i * 3;

        const transform = [
          r[g9 + 0],
          r[g9 + 1],
          r[g9 + 2],
          p[g3 + 0],
          r[g9 + 3],
          r[g9 + 4],
          r[g9 + 5],
          p[g3 + 1],
          r[g9 + 6],
          r[g9 + 7],
          r[g9 + 8],
          p[g3 + 2],
          0,
          0,
          0,
          1,
        ];

        meshes.push({
          geomId: i,
          geomName,
          vertices,
          indices,
          transform,
        });
      }
    }

    return meshes;
  }

  /**
   * Releases allocated WebAssembly heap memory for model and data.
   */
  dispose(): void {
    if (this.data) {
      this.data.delete();
    }
    if (this.model) {
      this.model.delete();
    }
  }
}

/**
 * Loads MyoFullBody model using Node.js fs (for tests and Node environments).
 */
export async function loadMyoSimulationFromFs(modelDir: string): Promise<MyoSimulation> {
  const fs = await import("fs");
  const path = await import("path");
  const mujoco = await loadMujoco();

  // Ensure virtual directories exist in MuJoCo MEMFS
  try {
    mujoco.FS.mkdir("/model");
  } catch {
    // Directory may already exist
  }
  try {
    mujoco.FS.mkdir("/model/meshes");
  } catch {
    // Directory may already exist
  }

  // Write XML model file
  const xmlPath = path.join(modelDir, "myofullbody.xml");
  const xmlContent = fs.readFileSync(xmlPath, "utf-8");
  mujoco.FS.writeFile("/model/myofullbody.xml", xmlContent);

  // Write STL mesh files
  const meshesDir = path.join(modelDir, "meshes");
  if (fs.existsSync(meshesDir)) {
    const meshFiles = fs.readdirSync(meshesDir);
    for (const file of meshFiles) {
      const filePath = path.join(meshesDir, file);
      const data = fs.readFileSync(filePath);
      mujoco.FS.writeFile(`/model/meshes/${file}`, data);
    }
  }

  const model = mujoco.MjModel.from_xml_path("/model/myofullbody.xml");
  const data = new mujoco.MjData(model);

  return new MyoSimulation(mujoco, model, data);
}

/**
 * Loads MyoFullBody model in browser environment via HTTP fetch requests.
 *
 * @param baseUrl - Base URL pointing to public/models/myo (default: '/models/myo')
 * @param onProgress - Callback reporting (loadedItems, totalItems, message)
 */
export async function loadMyoSimulationFromFetch(
  baseUrl = "/models/myo",
  onProgress?: (loaded: number, total: number, message: string) => void
): Promise<MyoSimulation> {
  const startTime = performance.now();
  const mujoco = await loadMujoco();

  try {
    mujoco.FS.mkdir("/model");
  } catch {
    // Directory may already exist
  }
  try {
    mujoco.FS.mkdir("/model/meshes");
  } catch {
    // Directory may already exist
  }

  onProgress?.(0, 71, "Fetching myofullbody.xml...");
  const xmlRes = await fetch(`${baseUrl}/myofullbody.xml`);
  if (!xmlRes.ok) {
    throw new Error(
      `Failed to fetch myofullbody.xml: ${xmlRes.status} ${xmlRes.statusText}`
    );
  }
  const xmlContent = await xmlRes.text();
  mujoco.FS.writeFile("/model/myofullbody.xml", xmlContent);

  // Extract all unique mesh files referenced by the model
  const meshFileMatches = xmlContent.matchAll(/file="meshes\/([^"]+)"/g);
  const meshFiles = Array.from(new Set(Array.from(meshFileMatches, (m) => m[1])));

  let loadedCount = 1;
  const total = meshFiles.length + 1;

  await Promise.all(
    meshFiles.map(async (file) => {
      const res = await fetch(`${baseUrl}/meshes/${file}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch mesh meshes/${file}: ${res.statusText}`);
      }
      const buf = await res.arrayBuffer();
      mujoco.FS.writeFile(`/model/meshes/${file}`, new Uint8Array(buf));
      loadedCount++;
      onProgress?.(loadedCount, total, `Loading meshes (${loadedCount}/${total})...`);
    })
  );

  onProgress?.(total, total, "Initializing MuJoCo model...");
  const model = mujoco.MjModel.from_xml_path("/model/myofullbody.xml");
  const data = new mujoco.MjData(model);

  const sim = new MyoSimulation(mujoco, model, data);
  sim.loadTimeMs = performance.now() - startTime;

  return sim;
}

/**
 * Result of measuring pose computation time.
 */
export interface PoseBenchmarkResult {
  /** Time for a single pose calculation in milliseconds (qpos setup -> mj_forward -> calculate stretch ratios) */
  singleMs: number;
  /** Average time across multiple iterations in milliseconds */
  avgMs: number;
  /** Number of iterations executed */
  iterations: number;
}

/**
 * Measures the pose computation time:
 * Sets joint angles for forward bend, executes mj_forward, and calculates stretch ratios for all 416 muscles.
 * Does NOT include Three.js rendering.
 *
 * @param sim - MyoSimulation instance
 * @param iterations - Number of repetitions to compute average (default: 100)
 */
export function measurePoseComputationTime(
  sim: MyoSimulation,
  iterations = 100
): PoseBenchmarkResult {
  const baseLengths = sim.getBaseActuatorLengths();

  // 1. Measure single run
  const tStartSingle = performance.now();
  sim.applyForwardBendPose();
  const singleCurrent = sim.getCurrentActuatorLengths();
  calculateStretchRatios(baseLengths, singleCurrent);
  const singleMs = performance.now() - tStartSingle;

  // 2. Measure multiple runs for average
  const tStartIter = performance.now();
  for (let i = 0; i < iterations; i++) {
    sim.applyForwardBendPose();
    const cur = sim.getCurrentActuatorLengths();
    calculateStretchRatios(baseLengths, cur);
  }
  const avgMs = (performance.now() - tStartIter) / iterations;

  return {
    singleMs,
    avgMs,
    iterations,
  };
}

/**
 * Formatted benchmark metrics container.
 */
export interface BenchmarkMetrics {
  loadTimeMs: number;
  singlePoseMs: number;
  avgPoseMs: number;
  iterations: number;
}

/**
 * Logs benchmark results to console.info in a clear structured format.
 */
export function logBenchmarkResults(metrics: BenchmarkMetrics): void {
  console.info(
    `[MuJoCo Benchmark Results]\n` +
      `  • (a) Model Load Time: ${metrics.loadTimeMs.toFixed(1)} ms (fetch start -> model creation)\n` +
      `  • (b) Pose Computation Time (single): ${metrics.singlePoseMs.toFixed(3)} ms (qpos -> mj_forward -> 416 ratios)\n` +
      `  • (b) Pose Computation Time (100 runs avg): ${metrics.avgPoseMs.toFixed(3)} ms`
  );
}

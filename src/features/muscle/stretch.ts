/// <reference types="node" />
import loadMujoco from "@mujoco/mujoco";
import fs from "fs";
import path from "path";

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
 * Wrapper class managing the MuJoCo MyoFullBody simulation.
 */
export class MyoSimulation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly mujoco: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly model: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly data: any;

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

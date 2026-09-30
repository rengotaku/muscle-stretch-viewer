import type { MyoSimulation } from "./stretch";

/** localStorage key holding the JSON array of presets. */
export const PRESETS_STORAGE_KEY = "muscle-stretch-viewer.presets.v1";

/** A saved pose: independent joint angles (rad) keyed by joint name. */
export interface PosePreset {
  name: string;
  angles: Record<string, number>;
}

export type PresetWriteResult =
  | { ok: true; presets: PosePreset[] }
  | { ok: false; error: string };

function isPreset(value: unknown): value is PosePreset {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { name?: unknown; angles?: unknown };
  return (
    typeof v.name === "string" &&
    typeof v.angles === "object" &&
    v.angles !== null &&
    !Array.isArray(v.angles)
  );
}

export type PresetReadResult =
  | { ok: true; presets: PosePreset[] }
  | { ok: false; error: string };

const READ_FAILED_MESSAGE =
  "保存済みのプリセットを読み込めなかったため、上書きを防ぐために保存を中止しました";

/**
 * Reads saved presets, distinguishing failure from an empty list. getItem errors,
 * broken JSON and a non-array top level are failures; individual malformed entries
 * are skipped and still count as success.
 */
export function readPresets(): PresetReadResult {
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (raw === null) return { ok: true, presets: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, error: READ_FAILED_MESSAGE };
    return { ok: true, presets: parsed.filter(isPreset) };
  } catch {
    return { ok: false, error: READ_FAILED_MESSAGE };
  }
}

/** Reads saved presets; returns an empty list when they cannot be read. */
export function loadPresets(): PosePreset[] {
  const result = readPresets();
  return result.ok ? result.presets : [];
}

function writePresets(presets: PosePreset[]): PresetWriteResult {
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    return { ok: true, presets };
  } catch {
    return {
      ok: false,
      error:
        "ブラウザの保存領域に書き込めませんでした（容量超過またはプライベートブラウズの可能性があります）",
    };
  }
}

/** Captures the 71 independent joint angles of the current pose (dependent joints are not stored). */
export function capturePose(sim: MyoSimulation): Record<string, number> {
  const angles: Record<string, number> = {};
  for (const joint of sim.getIndependentJoints()) {
    angles[joint.name] = sim.getJointAngle(joint.name);
  }
  return angles;
}

/** Saves a preset; an existing preset with the same name is replaced in place. */
export function savePreset(
  name: string,
  angles: Record<string, number>
): PresetWriteResult {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, error: "プリセット名を入力してください" };
  }
  const next: PosePreset = { name: trimmed, angles: { ...angles } };
  const read = readPresets();
  if (!read.ok) return read;
  const current = read.presets;
  const exists = current.some((p) => p.name === trimmed);
  const presets = exists
    ? current.map((p) => (p.name === trimmed ? next : p))
    : [...current, next];
  return writePresets(presets);
}

/** Removes the preset with the given name. */
export function deletePreset(name: string): PresetWriteResult {
  const read = readPresets();
  if (!read.ok) return read;
  return writePresets(read.presets.filter((p) => p.name !== name));
}

/**
 * Applies a preset: resets to the default pose, then sets each stored independent
 * joint through setJointAngle (which clamps to jnt_range and recomputes dependent joints).
 * Unknown joint names and non-finite values are ignored.
 */
export function applyPreset(sim: MyoSimulation, preset: PosePreset): void {
  sim.resetToDefaultPose();
  const known = new Set(sim.getIndependentJoints().map((j) => j.name));
  for (const [jointName, angle] of Object.entries(preset.angles)) {
    if (!known.has(jointName)) continue;
    if (typeof angle !== "number" || !Number.isFinite(angle)) continue;
    sim.setJointAngle(jointName, angle);
  }
}

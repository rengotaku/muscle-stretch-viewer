/// <reference types="node" />
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import path from "path";
import {
  calculateStretchRatios,
  loadMyoSimulationFromFs,
  type MyoSimulation,
} from "./stretch";
import {
  PRESETS_STORAGE_KEY,
  applyPreset,
  capturePose,
  deletePreset,
  loadPresets,
  savePreset,
} from "./presets";

describe("Pose presets (localStorage)", () => {
  let sim: MyoSimulation;

  beforeAll(async () => {
    sim = await loadMyoSimulationFromFs(path.resolve(process.cwd(), "public/models/myo"));
  });

  afterAll(() => {
    sim?.dispose();
  });

  // src/test/setup.ts replaces localStorage with a plain object that does not inherit
  // Storage.prototype, so a spy on Storage.prototype.setItem would never fire. Use jsdom's
  // real Storage (sessionStorage) as window.localStorage for this file.
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: window.sessionStorage,
      configurable: true,
      writable: true,
    });
    window.localStorage.clear();
    sim.resetToDefaultPose();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  const ratioOf = (name: string): number => {
    const ratios = calculateStretchRatios(
      sim.getBaseActuatorLengths(),
      sim.getCurrentActuatorLengths()
    );
    return ratios[sim.getActuatorId(name)];
  };

  it("P1: 膝90を保存すると一覧に出て、angles のキーは独立関節 71 個ちょうどで連動関節を含まない", () => {
    sim.setJointAngle("knee_angle_r", (90 * Math.PI) / 180);

    const result = savePreset("膝90", capturePose(sim));

    expect(result.ok).toBe(true);
    const list = loadPresets();
    expect(list.map((p) => p.name)).toEqual(["膝90"]);

    const stored = JSON.parse(window.localStorage.getItem(PRESETS_STORAGE_KEY) ?? "null");
    const keys = Object.keys(stored[0].angles).sort();
    const independent = sim
      .getIndependentJoints()
      .map((j) => j.name)
      .sort();
    expect(independent.length).toBe(71);
    expect(keys).toEqual(independent);
    expect(keys).not.toContain("knee_angle_translation2_r");
    expect(stored[0].angles.knee_angle_r).toBeCloseTo((90 * Math.PI) / 180, 9);
  });

  it("P2: 基準姿勢に戻してから読み込むと knee_angle_r が 90° で、連動関節と vasint_r の伸び率が保存前と一致する", () => {
    sim.setJointAngle("knee_angle_r", (90 * Math.PI) / 180);
    const depBefore = sim.getJointAngle("knee_angle_translation2_r");
    const ratioBefore = ratioOf("vasint_r");
    savePreset("膝90", capturePose(sim));

    sim.resetToDefaultPose();
    expect(sim.getJointAngle("knee_angle_r")).not.toBeCloseTo((90 * Math.PI) / 180, 3);

    const preset = loadPresets().find((p) => p.name === "膝90");
    expect(preset).toBeDefined();
    applyPreset(sim, preset!);

    expect(sim.getJointAngle("knee_angle_r")).toBeCloseTo((90 * Math.PI) / 180, 9);
    expect(sim.getJointAngle("knee_angle_translation2_r")).toBeCloseTo(depBefore, 9);
    expect(ratioOf("vasint_r")).toBeCloseTo(ratioBefore, 9);
  });

  it("P3: 保存済みプリセットを削除すると一覧からも localStorage からも消える", () => {
    savePreset("膝90", capturePose(sim));
    expect(loadPresets()).toHaveLength(1);

    const result = deletePreset("膝90");

    expect(result.ok).toBe(true);
    expect(loadPresets()).toEqual([]);
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    expect(raw === null || JSON.parse(raw).length === 0).toBe(true);
    expect(raw === null || !raw.includes("膝90")).toBe(true);
  });

  it("P4: localStorage の値が壊れた JSON でも例外を投げず、一覧は空", () => {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, "{not json");

    expect(() => loadPresets()).not.toThrow();
    expect(loadPresets()).toEqual([]);
  });

  it("P5: setItem が例外を投げても save は例外を投げず、失敗を返し、シミュレーションは動き続ける", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    let result: ReturnType<typeof savePreset> | undefined;
    expect(() => {
      result = savePreset("膝90", capturePose(sim));
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.error.length > 0).toBe(true);
    expect(loadPresets()).toEqual([]);

    const set = sim.setJointAngle("knee_angle_r", 1.0);
    expect(set).toBeCloseTo(1.0, 9);
    expect(sim.getJointAngle("knee_angle_r")).toBeCloseTo(1.0, 9);
  });

  it("P6: 保存済みの値が可動域の最大 + 1 rad なら、読み込むと最大値にクランプされる", () => {
    const knee = sim.getIndependentJoints().find((j) => j.name === "knee_angle_r")!;
    window.localStorage.setItem(
      PRESETS_STORAGE_KEY,
      JSON.stringify([{ name: "範囲外", angles: { knee_angle_r: knee.max + 1 } }])
    );

    const preset = loadPresets()[0];
    applyPreset(sim, preset);

    expect(sim.getJointAngle("knee_angle_r")).toBeCloseTo(knee.max, 9);
  });

  it("P7: 同じ名前で 2 回保存しても一覧は 1 件で、中身が 2 回目の値に置き換わる", () => {
    sim.setJointAngle("knee_angle_r", 0.5);
    savePreset("同名", capturePose(sim));
    sim.setJointAngle("knee_angle_r", 1.2);
    savePreset("同名", capturePose(sim));

    const list = loadPresets();
    expect(list).toHaveLength(1);
    expect(list[0].angles.knee_angle_r).toBeCloseTo(1.2, 9);
  });

  it("追加テスト: 別名の保存は追加され、削除は指定名だけを消す / 一覧の取り違え防止", () => {
    savePreset("A", capturePose(sim));
    savePreset("B", capturePose(sim));
    expect(loadPresets().map((p) => p.name)).toEqual(["A", "B"]);
    deletePreset("A");
    expect(loadPresets().map((p) => p.name)).toEqual(["B"]);
  });

  it("追加テスト: 形式が不正な要素は読み飛ばし、正しい要素は残す / 配列でない値・部分的破損への耐性", () => {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(loadPresets()).toEqual([]);

    window.localStorage.setItem(
      PRESETS_STORAGE_KEY,
      JSON.stringify([
        null,
        { name: 1, angles: {} },
        { name: "ok", angles: { knee_angle_r: 0.3 } },
      ])
    );
    expect(loadPresets().map((p) => p.name)).toEqual(["ok"]);
  });

  it("追加テスト: 未知の関節名や数値でない値は無視して読み込める / 古いモデルのデータ耐性", () => {
    applyPreset(sim, {
      name: "x",
      angles: {
        no_such_joint: 1,
        knee_angle_r: "a" as unknown as number,
        hip_flexion_r: 0.4,
      },
    });
    expect(sim.getJointAngle("hip_flexion_r")).toBeCloseTo(0.4, 9);
  });

  it("追加テスト: 空白だけの名前は保存されない / 名前検証", () => {
    const result = savePreset("   ", capturePose(sim));
    expect(result.ok).toBe(false);
    expect(loadPresets()).toEqual([]);
  });

  it("追加テスト: getItem が例外を投げても loadPresets は空を返す / プライベートブラウズ相当", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPresets()).toEqual([]);
  });
});

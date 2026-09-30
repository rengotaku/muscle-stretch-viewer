/// <reference types="node" />
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import {
  calculateStretchRatios,
  loadMyoSimulationFromFs,
  type MyoSimulation,
} from "./stretch";

describe("Muscle stretch ratio calculation and MyoFullBody simulation", () => {
  // --- T1 ---
  describe("T1: calculateStretchRatios", () => {
    it("T1: 各筋で「現在 ÷ 基準」が返り、基準が 0 以下の筋は例外にせず無効値として区別できる", () => {
      const baseLengths = [1.0, 2.0, 0.0, -0.5, 4.0];
      const currentLengths = [1.2, 1.0, 1.5, 0.5, 4.0];

      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      expect(ratios[0]).toBeCloseTo(1.2, 6);
      expect(ratios[1]).toBeCloseTo(0.5, 6);
      expect(Number.isNaN(ratios[2])).toBe(true);
      expect(Number.isNaN(ratios[3])).toBe(true);
      expect(ratios[4]).toBeCloseTo(1.0, 6);
    });

    it("追加テスト: T1_length_mismatch / 配列長不一致の不整合検知", () => {
      const baseLengths = [1.0, 2.0];
      const currentLengths = [1.0];
      expect(() => calculateStretchRatios(baseLengths, currentLengths)).toThrow(
        /mismatch/i
      );
    });

    it("追加テスト: T1_empty_arrays / 空配列の境界値処理", () => {
      const ratios = calculateStretchRatios([], []);
      expect(ratios).toEqual([]);
    });

    it("追加テスト: T1_negative_base / 負数筋長の境界値処理", () => {
      const ratios = calculateStretchRatios([-1.0], [1.0]);
      expect(Number.isNaN(ratios[0])).toBe(true);
    });
  });

  // --- T2, T3, T3b, T4 (MuJoCo MyoFullBody model) ---
  describe("T2 - T4: MuJoCo MyoFullBody simulation", () => {
    let sim: MyoSimulation;

    beforeAll(async () => {
      const modelDir = path.resolve(process.cwd(), "public/models/myo");
      sim = await loadMyoSimulationFromFs(modelDir);
    });

    afterAll(() => {
      if (sim) {
        sim.dispose();
      }
    });

    it("T2: 基準姿勢のまま伸び率を計算すると、全筋の伸び率が 1.0（許容誤差 1e-6）", () => {
      sim.resetToDefaultPose();
      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      expect(ratios.length).toBe(416);
      for (let i = 0; i < ratios.length; i++) {
        expect(ratios[i]).toBeCloseTo(1.0, 6);
      }
    });

    it("追加テスト: MyoSimulation_getActuatorNames / 416筋の名称リスト取得の検証", () => {
      const names = sim.getActuatorNames();
      expect(names.length).toBe(416);
      expect(names).toContain("bflh_r");
      expect(names).toContain("recfem_r");
    });

    it("T3: 前屈ポーズで股関節と膝をまたぐハムストリングス 6 筋がすべて 1.1 より大きい", () => {
      sim.applyForwardBendPose();
      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      const hamstrings = [
        "bflh_r",
        "semimem_r",
        "semiten_r",
        "bflh_l",
        "semimem_l",
        "semiten_l",
      ];

      for (const name of hamstrings) {
        const id = sim.getActuatorId(name);
        const ratio = ratios[id];
        expect(ratio).toBeGreaterThan(1.1);
      }
    });

    it("T3b: 前屈ポーズで膝だけをまたぐ大腿二頭筋短頭 2 筋の伸び率は 1.0（許容誤差 1e-6）", () => {
      sim.applyForwardBendPose();
      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      const shortHeads = ["bfsh_r", "bfsh_l"];

      for (const name of shortHeads) {
        const id = sim.getActuatorId(name);
        const ratio = ratios[id];
        expect(ratio).toBeCloseTo(1.0, 6);
      }
    });

    it("T4: 前屈ポーズで大腿直筋 2 筋の伸び率は 1.0 未満", () => {
      sim.applyForwardBendPose();
      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      const rectusFemoris = ["recfem_r", "recfem_l"];

      for (const name of rectusFemoris) {
        const id = sim.getActuatorId(name);
        const ratio = ratios[id];
        expect(ratio).toBeLessThan(1.0);
      }
    });

    it("追加テスト: MyoSimulation_getMuscleTendonPaths / wrap込み腱経路点と伸び率の紐付け取得検証", () => {
      sim.applyForwardBendPose();
      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      const paths = sim.getMuscleTendonPaths(ratios);
      expect(paths.length).toBe(416);

      // Check bflh_r (hamstrings)
      const bflh = paths.find((p) => p.actuatorName === "bflh_r");
      expect(bflh).toBeDefined();
      expect(bflh!.points.length).toBeGreaterThanOrEqual(2);
      expect(bflh!.stretchRatio).toBeGreaterThan(1.1);

      // Check recfem_r (rectus femoris)
      const recfem = paths.find((p) => p.actuatorName === "recfem_r");
      expect(recfem).toBeDefined();
      expect(recfem!.stretchRatio).toBeLessThan(1.0);
    });

    it("追加テスト: MyoSimulation_getSkeletonMeshes / 骨格メッシュ頂点・面・変換行列の取得検証", () => {
      const meshes = sim.getSkeletonMeshes();
      expect(meshes.length).toBe(102);

      const firstMesh = meshes[0];
      expect(firstMesh.vertices.length).toBeGreaterThan(0);
      expect(firstMesh.indices.length).toBeGreaterThan(0);
      expect(firstMesh.transform.length).toBe(16);
    });

    it("追加テスト: measurePoseComputationTime / ポーズ計算時間（単発および複数回平均）の計測検証", async () => {
      const { measurePoseComputationTime } = await import("./stretch");

      const result = measurePoseComputationTime(sim, 10);
      expect(result.iterations).toBe(10);
      expect(typeof result.singleMs).toBe("number");
      expect(Number.isFinite(result.singleMs)).toBe(true);
      expect(result.singleMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.avgMs).toBe("number");
      expect(Number.isFinite(result.avgMs)).toBe(true);
      expect(result.avgMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("STEP2: getStretchColorHex", () => {
    it("追加テスト: getStretchColorHex / 伸び率に応じた寒色・中立・暖色の色マッピング検証", async () => {
      const { getStretchColorHex } = await import("./stretch");

      // Neutral: ratio = 1.0
      const neutralColor = getStretchColorHex(1.0);
      expect(neutralColor.toLowerCase()).toBe("#f0f0f0");

      // Warm (stretched): ratio = 1.2+
      const stretchedColor = getStretchColorHex(1.25);
      // Red hue should dominate (R > B and R > G)
      const rWarm = parseInt(stretchedColor.slice(1, 3), 16);
      const bWarm = parseInt(stretchedColor.slice(5, 7), 16);
      expect(rWarm).toBeGreaterThan(bWarm);

      // Cold (shortened): ratio = 0.8-
      const shortenedColor = getStretchColorHex(0.75);
      // Blue hue should dominate (B > R)
      const rCold = parseInt(shortenedColor.slice(1, 3), 16);
      const bCold = parseInt(shortenedColor.slice(5, 7), 16);
      expect(bCold).toBeGreaterThan(rCold);

      // Invalid: NaN
      const invalidColor = getStretchColorHex(Number.NaN);
      expect(invalidColor).toBe("#94a3b8");
    });
  });

  // --- STEP1: U1 - U4 ---
  describe("STEP1: U1 - U4: Independent joints, dependent joint polynomial calculation, and clamping", () => {
    let sim: MyoSimulation;

    beforeAll(async () => {
      const modelDir = path.resolve(process.cwd(), "public/models/myo");
      sim = await loadMyoSimulationFromFs(modelDir);
    });

    afterAll(() => {
      if (sim) {
        sim.dispose();
      }
    });

    it("U1: 基準姿勢から独立関節の一覧を取ると71個であり、free jointと連動関節51個を含まず各最小・最大がjnt_rangeと一致する", () => {
      sim.resetToDefaultPose();
      const joints = sim.getIndependentJoints();

      expect(joints.length).toBe(71);

      // free joint (root) を含まない
      expect(joints.some((j) => j.name === "root")).toBe(false);

      // 連動関節（equality制約51個のobj1）を含まない
      const depJointIds = new Set<number>();
      for (let i = 0; i < sim.model.neq; i++) {
        if (sim.model.eq_type[i] === 2) {
          depJointIds.add(sim.model.eq_obj1id[i]);
        }
      }
      expect(depJointIds.size).toBe(51);

      for (const joint of joints) {
        expect(depJointIds.has(joint.id)).toBe(false);
        const expectedMin = sim.model.jnt_range[joint.id * 2];
        const expectedMax = sim.model.jnt_range[joint.id * 2 + 1];
        expect(joint.range[0]).toBe(expectedMin);
        expect(joint.range[1]).toBe(expectedMax);
        expect(joint.min).toBe(expectedMin);
        expect(joint.max).toBe(expectedMax);
      }
    });

    it("U2: 基準姿勢から knee_angle_r を 90° にすると連動関節 knee_angle_translation2_r が多項式の計算値と一致（許容誤差 1e-9）", () => {
      sim.resetToDefaultPose();
      const angle90 = (90 * Math.PI) / 180;
      sim.setJointAngle("knee_angle_r", angle90);

      // 多項式係数: knee_angle_translation2_constraint_r
      const kneeR = sim.model.jnt("knee_angle_r");
      const trans2R = sim.model.jnt("knee_angle_translation2_r");

      // 該当の equality constraint を探索
      let eqIndex = -1;
      for (let i = 0; i < sim.model.neq; i++) {
        if (
          sim.model.eq_type[i] === 2 &&
          sim.model.eq_obj1id[i] === trans2R.id &&
          sim.model.eq_obj2id[i] === kneeR.id
        ) {
          eqIndex = i;
          break;
        }
      }
      expect(eqIndex).toBeGreaterThanOrEqual(0);

      const qpos0_dep = sim.model.qpos0[trans2R.qposadr];
      const qpos0_src = sim.model.qpos0[kneeR.qposadr];
      const x = angle90 - qpos0_src;
      const c0 = sim.model.eq_data[eqIndex * 11 + 0];
      const c1 = sim.model.eq_data[eqIndex * 11 + 1];
      const c2 = sim.model.eq_data[eqIndex * 11 + 2];
      const c3 = sim.model.eq_data[eqIndex * 11 + 3];
      const c4 = sim.model.eq_data[eqIndex * 11 + 4];
      const expected =
        qpos0_dep + c0 + c1 * x + c2 * x * x + c3 * x * x * x + c4 * x * x * x * x;

      const actual = sim.getJointAngle("knee_angle_translation2_r");
      expect(actual).toBeCloseTo(expected, 9);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9);
    });

    it("U3: U2と同じ姿勢で伸び率を計算すると vasint_r > 1.1、bfsh_r < 0.8、bfsh_l は 1.0（許容誤差 1e-6）", () => {
      sim.resetToDefaultPose();
      const angle90 = (90 * Math.PI) / 180;
      sim.setJointAngle("knee_angle_r", angle90);

      const baseLengths = sim.getBaseActuatorLengths();
      const currentLengths = sim.getCurrentActuatorLengths();
      const ratios = calculateStretchRatios(baseLengths, currentLengths);

      const vasintRId = sim.getActuatorId("vasint_r");
      const bfshRId = sim.getActuatorId("bfsh_r");
      const bfshLId = sim.getActuatorId("bfsh_l");

      // 中間広筋 vasint_r が 1.1 より大きい（実測 1.152）
      expect(ratios[vasintRId]).toBeGreaterThan(1.1);
      // 大腿二頭筋短頭 bfsh_r が 0.8 未満（実測 0.730）
      expect(ratios[bfshRId]).toBeLessThan(0.8);
      // 反対側 bfsh_l は 1.0（許容誤差 1e-6）
      expect(ratios[bfshLId]).toBeCloseTo(1.0, 6);
    });

    it("U4: 基準姿勢で可動域外の値（jnt_range の最大 + 1 rad）を入れると最大値にクランプされる", () => {
      sim.resetToDefaultPose();
      const knee = sim.getIndependentJoints().find((j) => j.name === "knee_angle_r")!;
      const overMax = knee.range[1] + 1.0;

      const clamped = sim.setJointAngle("knee_angle_r", overMax);
      expect(clamped).toBe(knee.range[1]);
      expect(sim.getJointAngle("knee_angle_r")).toBe(knee.range[1]);
    });

    it("追加テスト: U4_clamp_min / 可動域下限外の値（jnt_range の最小 - 1 rad）を入れると最小値にクランプされる境界値の検証", () => {
      sim.resetToDefaultPose();
      const knee = sim.getIndependentJoints().find((j) => j.name === "knee_angle_r")!;
      const underMin = knee.range[0] - 1.0;

      const clamped = sim.setJointAngle("knee_angle_r", underMin);
      expect(clamped).toBe(knee.range[0]);
      expect(sim.getJointAngle("knee_angle_r")).toBe(knee.range[0]);
    });

    it("追加テスト: U2_unsupported_joint_or_locked / 相手のない制約（Abs_t1, Abs_t2等）が qpos0 + c0 に固定されることの検証", () => {
      sim.resetToDefaultPose();
      // knee_angle_r を動かしても Abs_t1, Abs_t2 は変化しない
      sim.setJointAngle("knee_angle_r", 1.0);

      const t1 = sim.getJointAngle("Abs_t1");
      const t2 = sim.getJointAngle("Abs_t2");
      const expectedT1 = sim.model.qpos0[sim.model.jnt("Abs_t1").qposadr];
      const expectedT2 = sim.model.qpos0[sim.model.jnt("Abs_t2").qposadr];

      expect(t1).toBeCloseTo(expectedT1, 9);
      expect(t2).toBeCloseTo(expectedT2, 9);
    });

    it("追加テスト: U1_total_joint_count_and_types / 全123関節の内訳（free 1 + 連動 51 + 独立 71 = 123）の不変条件検証", () => {
      expect(sim.model.njnt).toBe(123);
      const independentJoints = sim.getIndependentJoints();
      expect(independentJoints.length).toBe(71);

      let freeCount = 0;
      for (let i = 0; i < sim.model.njnt; i++) {
        if (sim.model.jnt_type[i] === 0) {
          freeCount++;
        }
      }
      expect(freeCount).toBe(1);
      expect(sim.model.neq).toBe(51);
      expect(freeCount + sim.model.neq + independentJoints.length).toBe(123);
    });

    it("追加テスト: evaluatePolynomial_calculation / 多項式評価ヘルパー関数の単体検証", async () => {
      const { evaluatePolynomial, calculateDependentJointPosition } =
        await import("./stretch");

      // c0 + c1*x + c2*x^2 + c3*x^3 + c4*x^4
      const coef = [1, 2, 3, 4, 5];
      // x = 2 -> 1 + 2(2) + 3(4) + 4(8) + 5(16) = 1 + 4 + 12 + 32 + 80 = 129
      expect(evaluatePolynomial(coef, 2)).toBe(129);

      // x = 0 -> 1
      expect(evaluatePolynomial(coef, 0)).toBe(1);

      // calculateDependentJointPosition with src
      // qpos0_dep = 10, qpos0_src = 1, q_src = 3 -> x = 2 -> 10 + 129 = 139
      expect(calculateDependentJointPosition(10, coef, 3, 1)).toBe(139);

      // calculateDependentJointPosition without src (locked joint)
      // qpos0_dep = 10, coef[0] = 1 -> 11
      expect(calculateDependentJointPosition(10, coef)).toBe(11);
    });

    it("追加テスト: STEP2_joint_body_groups / 71個の独立関節が7つの部位グループ（体幹3、右脚7、左脚7、右腕7、右手指20、左腕7、左手指20）に完全分類される検証", async () => {
      const { getJointBodyGroup, BODY_PART_GROUPS } = await import("./stretch");

      expect(BODY_PART_GROUPS.length).toBe(7);
      const joints = sim.getIndependentJoints();
      expect(joints.length).toBe(71);

      const counts: Record<string, number> = {
        torso: 0,
        leg_r: 0,
        leg_l: 0,
        arm_r: 0,
        hand_r: 0,
        arm_l: 0,
        hand_l: 0,
      };

      for (const j of joints) {
        const group = getJointBodyGroup(j.name);
        expect(counts).toHaveProperty(group);
        counts[group]++;
        expect(j.group).toBe(group);
      }

      expect(counts.torso).toBe(3);
      expect(counts.leg_r).toBe(7);
      expect(counts.leg_l).toBe(7);
      expect(counts.arm_r).toBe(7);
      expect(counts.hand_r).toBe(20);
      expect(counts.arm_l).toBe(7);
      expect(counts.hand_l).toBe(20);
    });

    it("追加テスト: STEP2_setJointAngle_full_pipeline / setJointAngle呼び出し後に連動関節・筋長・伸び率が一貫して更新される検証", () => {
      sim.resetToDefaultPose();

      // 初期状態では全筋 1.0
      const baseLengths = sim.getBaseActuatorLengths();
      let ratios = calculateStretchRatios(baseLengths, sim.getCurrentActuatorLengths());
      expect(ratios[sim.getActuatorId("vasint_r")]).toBeCloseTo(1.0, 5);

      // 膝を 90度 (PI/2 rad) に曲げる
      const angle90 = Math.PI / 2;
      const clamped = sim.setJointAngle("knee_angle_r", angle90);
      expect(clamped).toBeCloseTo(angle90, 6);

      // 連動関節が自動で計算されていること
      const trans2 = sim.getJointAngle("knee_angle_translation2_r");
      expect(trans2).toBeGreaterThan(0);

      // 伸び率が更新されていること
      ratios = calculateStretchRatios(baseLengths, sim.getCurrentActuatorLengths());
      expect(ratios[sim.getActuatorId("vasint_r")]).toBeGreaterThan(1.1);

      // 骨格メッシュの変換行列も取得可能であること
      const meshes = sim.getSkeletonMeshes();
      expect(meshes.length).toBeGreaterThan(0);
    });
  });
});

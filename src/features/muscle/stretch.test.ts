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
  });
});

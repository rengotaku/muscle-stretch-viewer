import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MuscleViewer } from "./MuscleViewer";
import * as stretchModule from "./stretch";

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class MockOrbitControls {
    target = { set: vi.fn() };
    enableDamping = false;
    dampingFactor = 0.05;
    update = vi.fn();
    dispose = vi.fn();
  }
  return { OrbitControls: MockOrbitControls };
});

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

function createStatefulSim() {
  const angles: Record<string, number> = { knee_angle_r: 0, flex_extension: 0 };
  const joints = [
    {
      id: 1,
      name: "knee_angle_r",
      range: [0, 2.0944],
      min: 0,
      max: 2.0944,
      defaultValue: 0,
      group: "leg_r",
    },
    {
      id: 2,
      name: "flex_extension",
      range: [-1.35, 0.75],
      min: -1.35,
      max: 0.75,
      defaultValue: 0,
      group: "torso",
    },
  ];
  return {
    loadTimeMs: 1,
    applyForwardBendPose: vi.fn(),
    resetToDefaultPose: vi.fn(() => {
      for (const k of Object.keys(angles)) angles[k] = 0;
    }),
    getSkeletonMeshes: vi.fn().mockReturnValue([]),
    getBaseActuatorLengths: vi.fn().mockReturnValue(new Float64Array([0.3])),
    getCurrentActuatorLengths: vi.fn().mockReturnValue(new Float64Array([0.3])),
    getMuscleTendonPaths: vi.fn().mockReturnValue([]),
    getIndependentJoints: vi.fn().mockReturnValue(joints),
    getJointAngle: vi.fn((name: string) => angles[name]),
    setJointAngle: vi.fn((name: string, rad: number) => {
      angles[name] = rad;
      return rad;
    }),
    dispose: vi.fn(),
  } as unknown as stretchModule.MyoSimulation;
}

describe("MuscleViewer presets UI", () => {
  const originalWebGL = window.WebGLRenderingContext;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    // setup.ts の localStorage は Storage.prototype を継承しないため、本物の Storage を使う
    Object.defineProperty(window, "localStorage", {
      value: window.sessionStorage,
      configurable: true,
      writable: true,
    });
    window.localStorage.clear();
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
      function WebGLRenderingContext() {};
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue({}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    vi.spyOn(stretchModule, "loadMyoSimulationFromFetch").mockResolvedValue(
      createStatefulSim()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
      originalWebGL;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  const kneeSlider = () => screen.getByLabelText("knee_angle_r") as HTMLInputElement;

  it("追加テスト: presets_save_and_load / 保存 → 一覧に出る → 別姿勢 → 読み込むとスライダーが保存時の値に戻る", async () => {
    render(<MuscleViewer />);
    await waitFor(() => expect(kneeSlider()).toBeInTheDocument());

    fireEvent.change(kneeSlider(), { target: { value: "90" } });
    expect(Number(kneeSlider().value)).toBeCloseTo(90, 0);

    fireEvent.change(screen.getByLabelText("プリセット名"), {
      target: { value: "膝90" },
    });
    fireEvent.click(screen.getByLabelText("プリセットを保存"));

    expect(screen.getByLabelText("膝90 を読み込む")).toBeInTheDocument();
    expect((screen.getByLabelText("プリセット名") as HTMLInputElement).value).toBe("");

    fireEvent.change(kneeSlider(), { target: { value: "10" } });
    expect(Number(kneeSlider().value)).toBeCloseTo(10, 0);

    fireEvent.click(screen.getByLabelText("膝90 を読み込む"));
    expect(Number(kneeSlider().value)).toBeCloseTo(90, 0);

    fireEvent.click(screen.getByLabelText("膝90 を削除"));
    expect(screen.queryByLabelText("膝90 を読み込む")).not.toBeInTheDocument();
  });

  it("追加テスト: presets_save_failure_shown / setItem が例外でもエラー文言が出て、画面とスライダーは動き続ける（P5 の画面側）", async () => {
    render(<MuscleViewer />);
    await waitFor(() => expect(kneeSlider()).toBeInTheDocument());

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    fireEvent.change(screen.getByLabelText("プリセット名"), {
      target: { value: "膝90" },
    });
    fireEvent.click(screen.getByLabelText("プリセットを保存"));

    expect(screen.getByRole("alert")).toHaveTextContent("書き込めませんでした");
    expect(screen.queryByLabelText("膝90 を読み込む")).not.toBeInTheDocument();

    fireEvent.change(kneeSlider(), { target: { value: "30" } });
    expect(Number(kneeSlider().value)).toBeCloseTo(30, 0);
  });

  it("追加テスト: presets_initial_load / 初回表示時に保存済みプリセットが一覧に出る", async () => {
    window.localStorage.setItem(
      "muscle-stretch-viewer.presets.v1",
      JSON.stringify([{ name: "既存", angles: { knee_angle_r: 1 } }])
    );
    render(<MuscleViewer />);
    expect(await screen.findByLabelText("既存 を読み込む")).toBeInTheDocument();
  });

  it("追加テスト: presets_initial_read_failure_shown / 保存データが壊れた状態で開くとプリセット欄にエラー文言が出る", async () => {
    window.localStorage.setItem("muscle-stretch-viewer.presets.v1", "{not json");
    render(<MuscleViewer />);
    await waitFor(() => expect(kneeSlider()).toBeInTheDocument());

    expect(screen.getByRole("alert")).toHaveTextContent("読み込めなかった");
    expect(window.localStorage.getItem("muscle-stretch-viewer.presets.v1")).toBe(
      "{not json"
    );
  });
});

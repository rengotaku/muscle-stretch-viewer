import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { MuscleViewer } from "./MuscleViewer";
import * as stretchModule from "./stretch";

const { mockControlsDispose, mockControlsUpdate, mockRendererDispose, mockRender } =
  vi.hoisted(() => ({
    mockControlsDispose: vi.fn(),
    mockControlsUpdate: vi.fn(),
    mockRendererDispose: vi.fn(),
    mockRender: vi.fn(),
  }));

// Mock OrbitControls
vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class MockOrbitControls {
    target = { set: vi.fn() };
    enableDamping = false;
    dampingFactor = 0.05;
    update = mockControlsUpdate;
    dispose = mockControlsDispose;
  }
  return {
    OrbitControls: MockOrbitControls,
  };
});

// Mock WebGLRenderer in three module
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = mockRender;
    dispose = mockRendererDispose;
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

describe("MuscleViewer unmount cleanup", () => {
  const originalWebGLRenderingContext = window.WebGLRenderingContext;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Enable WebGL mock in jsdom
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
      function WebGLRenderingContext() {};
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockImplementation((contextId: string) => {
        if (
          contextId === "webgl" ||
          contextId === "webgl2" ||
          contextId === "experimental-webgl"
        ) {
          return {};
        }
        return null;
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
      originalWebGLRenderingContext;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  it("disposes controls, scene geometries, materials without duplicates, and renderer on unmount", async () => {
    const callOrder: string[] = [];
    mockControlsDispose.mockImplementation(() => {
      callOrder.push("controls.dispose");
    });
    mockRendererDispose.mockImplementation(() => {
      callOrder.push("renderer.dispose");
    });

    const mockSimDispose = vi.fn().mockImplementation(() => {
      callOrder.push("sim.dispose");
    });

    // Create a mock MyoSimulation with bones and muscles
    const dummyVertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const dummyIndices = new Uint32Array([0, 1, 2]);
    const dummyTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    const mockSim = {
      loadTimeMs: 120,
      applyForwardBendPose: vi.fn(),
      applyDefaultPose: vi.fn(),
      setPose: vi.fn(),
      getSkeletonMeshes: vi.fn().mockReturnValue([
        {
          geomName: "bone1",
          vertices: dummyVertices,
          indices: dummyIndices,
          transform: dummyTransform,
        },
        {
          geomName: "bone2",
          vertices: dummyVertices,
          indices: dummyIndices,
          transform: dummyTransform,
        },
      ]),
      getBaseActuatorLengths: vi.fn().mockReturnValue(new Map([["bflh_r", 0.3]])),
      getCurrentActuatorLengths: vi.fn().mockReturnValue(new Map([["bflh_r", 0.36]])),
      getMuscleTendonPaths: vi.fn().mockReturnValue([
        {
          actuatorName: "bflh_r",
          points: [
            [0, 0, 0],
            [0, 0, 0.2],
          ],
          stretchRatio: 1.2,
        },
      ]),
      dispose: mockSimDispose,
    } as unknown as stretchModule.MyoSimulation;

    vi.spyOn(stretchModule, "loadMyoSimulationFromFetch").mockResolvedValue(mockSim);

    // Track geometry and material dispose calls
    const originalBufferGeomDispose = THREE.BufferGeometry.prototype.dispose;
    const originalMaterialDispose = THREE.Material.prototype.dispose;

    const disposedGeometries = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    let materialDisposeCallCount = 0;

    const geomDisposeSpy = vi
      .spyOn(THREE.BufferGeometry.prototype, "dispose")
      .mockImplementation(function (this: THREE.BufferGeometry) {
        disposedGeometries.add(this);
        callOrder.push("geometry.dispose");
        originalBufferGeomDispose.call(this);
      });

    const matDisposeSpy = vi
      .spyOn(THREE.Material.prototype, "dispose")
      .mockImplementation(function (this: THREE.Material) {
        disposedMaterials.add(this);
        materialDisposeCallCount++;
        callOrder.push("material.dispose");
        originalMaterialDispose.call(this);
      });

    const { unmount, container } = render(<MuscleViewer />);

    // Wait until simulation is loaded and model information is rendered
    await waitFor(() => {
      expect(screen.queryByText(/モデルデータを読み込み中/)).not.toBeInTheDocument();
    });

    const canvasInDomBeforeUnmount = container.querySelector("canvas");
    expect(canvasInDomBeforeUnmount).toBeInTheDocument();

    // Trigger unmount cleanup
    unmount();

    // 1. controls.dispose was called
    expect(mockControlsDispose).toHaveBeenCalledTimes(1);

    // 2. geometries and materials were disposed
    expect(geomDisposeSpy).toHaveBeenCalled();
    expect(matDisposeSpy).toHaveBeenCalled();

    // Verify geometries (GridHelper, bone1, bone2, muscle tube) are included
    expect(disposedGeometries.size).toBeGreaterThanOrEqual(4);

    // Verify materials are disposed without duplicates:
    // Even though there are 2 bone meshes sharing one boneMat, dispose should only be called once for that material
    expect(disposedMaterials.size).toBe(materialDisposeCallCount);

    // 3. Canvas was removed from container DOM
    expect(container.querySelector("canvas")).toBeNull();

    // 4. Renderer was disposed
    expect(mockRendererDispose).toHaveBeenCalledTimes(1);

    // 5. Simulation was disposed
    expect(mockSimDispose).toHaveBeenCalledTimes(1);

    // 6. Verify order: controls.dispose called BEFORE renderer.dispose
    const controlsIndex = callOrder.indexOf("controls.dispose");
    const rendererIndex = callOrder.indexOf("renderer.dispose");
    expect(controlsIndex).toBeGreaterThanOrEqual(0);
    expect(rendererIndex).toBeGreaterThanOrEqual(0);
    expect(controlsIndex).toBeLessThan(rendererIndex);
  });

  it("cleans up controls and initial geometries/materials if unmounted before loading completes", () => {
    // Return a promise that never resolves during the test to simulate mid-load unmount
    vi.spyOn(stretchModule, "loadMyoSimulationFromFetch").mockReturnValue(
      new Promise(() => {})
    );

    const geomDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const matDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose");

    const { unmount } = render(<MuscleViewer />);

    unmount();

    expect(mockControlsDispose).toHaveBeenCalledTimes(1);
    expect(mockRendererDispose).toHaveBeenCalledTimes(1);
    // GridHelper geometry and material in initial scene must be disposed
    expect(geomDisposeSpy).toHaveBeenCalled();
    expect(matDisposeSpy).toHaveBeenCalled();
  });

  it("handles unsupported WebGL environment gracefully without initializing Three.js", () => {
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
      undefined;
    HTMLCanvasElement.prototype.getContext = vi
      .fn()
      .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { unmount } = render(<MuscleViewer />);

    expect(
      screen.getByText(
        /このブラウザまたは環境では WebGL がサポートされていないか無効になっています/
      )
    ).toBeInTheDocument();

    // controls and renderer should not be initialized
    unmount();
    expect(mockControlsDispose).not.toHaveBeenCalled();
    expect(mockRendererDispose).not.toHaveBeenCalled();
  });
});

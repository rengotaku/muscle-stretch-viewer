import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  calculateStretchRatios,
  getStretchColorHex,
  loadMyoSimulationFromFetch,
  MyoSimulation,
} from "./stretch";

interface LoadingStatus {
  loaded: number;
  total: number;
  message: string;
}

interface MuscleInfo {
  name: string;
  label: string;
  ratio: number;
  color: string;
}

function isWebGLSupported(): boolean {
  if (typeof window === "undefined" || !window.WebGLRenderingContext) {
    return false;
  }
  try {
    const testCanvas = document.createElement("canvas");
    return !!(
      testCanvas.getContext("webgl2") ||
      testCanvas.getContext("webgl") ||
      testCanvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

export const MuscleViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<MyoSimulation | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const muscleGroupRef = useRef<THREE.Group | null>(null);

  const [supported] = useState(() => isWebGLSupported());
  const [loading, setLoading] = useState(supported);
  const [loadError, setLoadError] = useState<string | null>(
    supported
      ? null
      : "このブラウザまたは環境では WebGL がサポートされていないか無効になっています。"
  );
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>({
    loaded: 0,
    total: 71,
    message: "Initializing...",
  });
  const [currentPose, setCurrentPose] = useState<"forward_bend" | "default">(
    "forward_bend"
  );
  const [selectedMuscles, setSelectedMuscles] = useState<MuscleInfo[]>([]);

  // Build muscle geometries and materials inside Three.js group
  const updateMuscleMeshes = useCallback((sim: MyoSimulation) => {
    if (!muscleGroupRef.current) return;

    // Clear existing muscle objects
    while (muscleGroupRef.current.children.length > 0) {
      const child = muscleGroupRef.current.children[0];
      muscleGroupRef.current.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    const baseLengths = sim.getBaseActuatorLengths();
    const currentLengths = sim.getCurrentActuatorLengths();
    const ratios = calculateStretchRatios(baseLengths, currentLengths);
    const paths = sim.getMuscleTendonPaths(ratios);

    const keyMuscles = [
      { name: "bflh_r", label: "大腿二頭筋 長頭 (ハムストリングス)" },
      { name: "semimem_r", label: "半膜様筋 (ハムストリングス)" },
      { name: "semiten_r", label: "半腱様筋 (ハムストリングス)" },
      { name: "bfsh_r", label: "大腿二頭筋 短頭 (膝単関節筋)" },
      { name: "recfem_r", label: "大腿直筋 (大腿四頭筋)" },
    ];

    const muscleInfos: MuscleInfo[] = [];

    for (const path of paths) {
      if (path.points.length < 2) continue;

      const colorHex = getStretchColorHex(path.stretchRatio);
      const color = new THREE.Color(colorHex);

      const curvePath = new THREE.CurvePath<THREE.Vector3>();
      for (let p = 0; p < path.points.length - 1; p++) {
        const p1 = new THREE.Vector3(...path.points[p]);
        const p2 = new THREE.Vector3(...path.points[p + 1]);
        curvePath.add(new THREE.LineCurve3(p1, p2));
      }

      // 3mm radius tube for muscle path
      const tubeGeom = new THREE.TubeGeometry(
        curvePath,
        (path.points.length - 1) * 3,
        0.0035,
        6,
        false
      );
      const tubeMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.1,
      });

      const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
      tubeMesh.name = path.actuatorName;
      muscleGroupRef.current.add(tubeMesh);

      // Check key muscles for info display
      const keyInfo = keyMuscles.find((km) => km.name === path.actuatorName);
      if (keyInfo) {
        muscleInfos.push({
          name: keyInfo.name,
          label: keyInfo.label,
          ratio: path.stretchRatio,
          color: colorHex,
        });
      }
    }

    setSelectedMuscles(muscleInfos);
  }, []);

  // Switch poses
  const handlePoseChange = useCallback(
    (pose: "forward_bend" | "default") => {
      const sim = simRef.current;
      if (!sim) return;

      if (pose === "forward_bend") {
        sim.applyForwardBendPose();
      } else {
        sim.resetToDefaultPose();
      }

      // Update bone meshes
      if (sceneRef.current) {
        const boneGroup = sceneRef.current.getObjectByName("boneGroup");
        if (boneGroup) {
          const skeletonMeshes = sim.getSkeletonMeshes();
          skeletonMeshes.forEach((meshData, idx) => {
            const meshObj = boneGroup.children[idx];
            if (meshObj instanceof THREE.Mesh) {
              const m = new THREE.Matrix4();
              m.set(
                meshData.transform[0],
                meshData.transform[1],
                meshData.transform[2],
                meshData.transform[3],
                meshData.transform[4],
                meshData.transform[5],
                meshData.transform[6],
                meshData.transform[7],
                meshData.transform[8],
                meshData.transform[9],
                meshData.transform[10],
                meshData.transform[11],
                meshData.transform[12],
                meshData.transform[13],
                meshData.transform[14],
                meshData.transform[15]
              );
              meshObj.matrix.copy(m);
            }
          });
        }
      }

      updateMuscleMeshes(sim);
      setCurrentPose(pose);
    },
    [updateMuscleMeshes]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDisposed = false;
    let animFrameId: number;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    if (!supported) return;

    // Three.js Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // Slate 900
    sceneRef.current = scene;

    // Camera: MuJoCo uses Z-up
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -2.4, 0.9);
    camera.lookAt(0, 0, 0.85);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.85);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(2, -3, 3);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.5);
    dirLight2.position.set(-2, 3, 1);
    scene.add(dirLight2);

    // Subtle ground grid on XY plane at z=0
    const grid = new THREE.GridHelper(3, 30, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2; // Orient grid to XY plane in Z-up
    grid.position.set(0, 0, 0);
    scene.add(grid);

    // Muscle group
    const muscleGroup = new THREE.Group();
    muscleGroup.name = "muscleGroup";
    scene.add(muscleGroup);
    muscleGroupRef.current = muscleGroup;

    // Render loop
    const animate = () => {
      if (isDisposed) return;
      animFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Load model from public/models/myo via fetch
    loadMyoSimulationFromFetch("/models/myo", (loaded, total, message) => {
      if (!isDisposed) {
        setLoadingStatus({ loaded, total, message });
      }
    })
      .then((sim) => {
        if (isDisposed) {
          sim.dispose();
          return;
        }

        simRef.current = sim;

        // Apply forward bend pose as default view
        sim.applyForwardBendPose();

        // Build bone meshes
        const boneGroup = new THREE.Group();
        boneGroup.name = "boneGroup";
        const skeletonMeshes = sim.getSkeletonMeshes();

        const boneMat = new THREE.MeshStandardMaterial({
          color: 0xd1d5db,
          roughness: 0.6,
          metalness: 0.1,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
        });

        for (const meshData of skeletonMeshes) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(meshData.vertices, 3));
          geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
          geom.computeVertexNormals();

          const mesh = new THREE.Mesh(geom, boneMat);
          mesh.name = meshData.geomName;
          mesh.matrixAutoUpdate = false;

          const m = new THREE.Matrix4();
          m.set(
            meshData.transform[0],
            meshData.transform[1],
            meshData.transform[2],
            meshData.transform[3],
            meshData.transform[4],
            meshData.transform[5],
            meshData.transform[6],
            meshData.transform[7],
            meshData.transform[8],
            meshData.transform[9],
            meshData.transform[10],
            meshData.transform[11],
            meshData.transform[12],
            meshData.transform[13],
            meshData.transform[14],
            meshData.transform[15]
          );
          mesh.matrix.copy(m);

          boneGroup.add(mesh);
        }

        scene.add(boneGroup);

        // Build muscles
        updateMuscleMeshes(sim);

        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load MyoFullBody model:", err);
        if (!isDisposed) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    // Handle resize
    const handleResize = () => {
      if (!container || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);

      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();

      if (simRef.current) {
        simRef.current.dispose();
        simRef.current = null;
      }
    };
  }, [updateMuscleMeshes]);

  return (
    <div className="relative flex flex-col w-full h-[700px] bg-slate-950 rounded-xl overflow-hidden shadow-2xl border border-slate-800">
      {/* 3D Viewport container */}
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-sm">
          <div className="size-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-200 font-medium text-lg mb-2">
            MyoFullBody 筋骨格モデルを読み込み中...
          </p>
          <p className="text-slate-400 text-sm mb-4">{loadingStatus.message}</p>
          <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{
                width: `${Math.round((loadingStatus.loaded / (loadingStatus.total || 1)) * 100)}%`,
              }}
            />
          </div>
          <span className="text-xs text-slate-500 mt-2">
            {loadingStatus.loaded} / {loadingStatus.total} files
          </span>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
          <div className="text-red-400 font-bold text-lg mb-2">モデル読み込みエラー</div>
          <p className="text-slate-400 text-sm max-w-md">{loadError}</p>
        </div>
      )}

      {/* Control bar (Top left) */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap gap-2 items-center bg-slate-900/80 backdrop-blur-md p-2 rounded-lg border border-slate-800">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2">
          ポーズ:
        </span>
        <button
          type="button"
          onClick={() => handlePoseChange("forward_bend")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            currentPose === "forward_bend"
              ? "bg-primary text-primary-foreground shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          前屈ポーズ (股関節 90° 屈曲)
        </button>
        <button
          type="button"
          onClick={() => handlePoseChange("default")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            currentPose === "default"
              ? "bg-primary text-primary-foreground shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          基準姿勢 (立位 qpos0)
        </button>
      </div>

      {/* Color Legend (Top right) */}
      <div className="absolute top-4 right-4 z-20 bg-slate-900/85 backdrop-blur-md p-3.5 rounded-lg border border-slate-800 text-slate-200 text-xs shadow-lg max-w-xs">
        <div className="font-semibold text-slate-100 mb-2 flex items-center justify-between">
          <span>伸び率の凡例 (Color Legend)</span>
        </div>
        <div className="w-full h-3 rounded-full mb-1.5 bg-gradient-to-r from-[#1e3a8a] via-[#38bdf8] via-[#f0f0f0] via-[#facc15] to-[#ef4444]" />
        <div className="flex justify-between text-[10px] text-slate-400 mb-2 font-mono">
          <span>≤ 0.8</span>
          <span>0.9</span>
          <span>1.0</span>
          <span>1.1</span>
          <span>≥ 1.2</span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[11px] pt-1 border-t border-slate-800 text-center">
          <div className="text-sky-400 font-medium">縮小 (寒色)</div>
          <div className="text-slate-300 font-medium">中立 (白)</div>
          <div className="text-rose-400 font-medium">伸張 (暖色)</div>
        </div>
      </div>

      {/* Muscle stretch details panel (Bottom left) */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/85 backdrop-blur-md p-3 rounded-lg border border-slate-800 text-xs shadow-lg max-w-sm">
        <div className="font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-rose-500 animate-pulse" />
          <span>代表筋肉の実測伸び率</span>
        </div>
        <div className="space-y-1.5">
          {selectedMuscles.map((m) => (
            <div key={m.name} className="flex items-center justify-between gap-4 py-0.5">
              <span className="text-slate-300 truncate">{m.label}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className="size-2.5 rounded-full inline-block"
                  style={{ backgroundColor: m.color }}
                />
                <span className="font-mono font-medium text-slate-100">
                  {m.ratio.toFixed(3)}x
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
          ※ 太もも裏のハムストリングス（bflh_r 等）が赤く伸張（&gt; 1.1x）
        </div>
      </div>

      {/* Navigation hint (Bottom right) */}
      <div className="absolute bottom-4 right-4 z-20 text-[11px] text-slate-500 bg-slate-900/70 px-2.5 py-1 rounded backdrop-blur-sm">
        ドラッグ: 回転 | 右ドラッグ: 平行移動 | ホイール: ズーム
      </div>
    </div>
  );
};

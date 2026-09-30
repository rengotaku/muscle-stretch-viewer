# Architecture

ポーズを取ったときにどの筋肉がどれだけ伸ばされるかを、ブラウザ上の 3D で見せる。サーバも GPU も使わず、筋骨格モデルの計算はすべてブラウザ内の MuJoCo（WebAssembly）で行う。

## 構成

| 層 | 中身 | 場所 |
|---|---|---|
| 筋骨格モデル | MyoFullBody（MyoHub/myo_sim、Apache-2.0）。123 関節・416 筋。生成済み XML とメッシュを取り込んで配信する | `public/models/myo/` |
| 計算 | MuJoCo の読み込み、関節角度の設定、連動関節の計算、筋長と伸び率 | `src/features/muscle/stretch.ts` |
| プリセット | ポーズの保存・読み込み・削除（localStorage） | `src/features/muscle/presets.ts` |
| 画面 | Three.js での骨格と筋肉の描画、関節スライダー、プリセット欄、凡例、代表筋の一覧、計測値 | `src/features/muscle/MuscleViewer.tsx` |

## データの流れ

1. `loadMyoSimulationFromFetch()` が `public/models/myo/` の XML とメッシュを fetch し、MuJoCo の仮想ファイルシステムに書き込んでモデルを作る（手元の開発サーバで約 1.2〜1.9 秒）
2. `MyoSimulation` の生成時に基準姿勢を作り、そのときの 416 筋の長さ（`actuator_length`）を基準長として保存する
3. スライダーを動かすと `setJointAngle(name, rad)` が呼ばれる
   - 可動域（`jnt_range`）でクランプする
   - 連動する 51 関節を equality 制約の多項式で計算し直す（`updateDependentJoints`）
   - `mj_forward` で位置と筋長を更新する
4. 伸び率 = 今の筋長 ÷ 基準長（`calculateStretchRatios`）。1 回の計算は 100 回平均で約 1 ms
5. 伸び率を色に変える（`getStretchColorHex`。0.8 以下が濃い青、1.0 が白、1.2 以上が赤）。筋肉は MuJoCo の tendon の経路点（巻き付き込み）を線で描く

## 関節の扱い

- 123 関節の内訳は、ルートの free joint 1、独立に動かせる関節 71、ほかの関節に連動する関節 51
- スライダーにするのは独立関節の 71 個だけ。部位ごと（体幹 3・左右の脚 7・左右の腕 7・左右の手指 20）にまとめる
- 連動関節は `q_dep = qpos0_dep + Σ c_i · (q_src − qpos0_src)^i`（i = 0..4、係数は `eq_data` の先頭 5 個）で計算する。相手の無い制約は `qpos0_dep + c0` に固定する
- **基準姿勢は `qpos0` そのものではなく、`qpos0` に連動関節の計算を当てた姿勢**。`qpos0` は equality 制約を 6 本満たしておらず、そのまま使うと大腿直筋の基準長が 0.178 m 長く出る（ADR 0002）

## どこを触れば何が変わるか

| 変えたいこと | 触る場所 |
|---|---|
| 色の段階（どの伸び率を何色にするか） | `getStretchColorHex`。凡例のグラデーション（`MuscleViewer.tsx`）の停止点も合わせる |
| 代表筋の一覧に出す筋 | `MuscleViewer.tsx` の代表筋の定義 |
| スライダーの部位の分け方 | `BODY_PART_GROUPS` と `getJointBodyGroup` |
| 固定ポーズのボタン | `MyoSimulation.applyForwardBendPose` と画面のポーズボタン |
| プリセットの保存形式 | `presets.ts`。キーは `muscle-stretch-viewer.presets.v1`。形式を変えるならキーの版も上げる |
| モデルの更新 | README の「筋骨格モデルの出典」の手順で XML を生成し直す。連鎖した equality 制約（連動元がそれ自体連動関節）が無いことを確認する（#6） |

## テスト

- `stretch.test.ts` と `presets.test.ts` は、実際の MyoFullBody を読み込んで筋長を計算する。筋長を mock にしない
- 画面のテスト（`MuscleViewer*.test.tsx`）は、Three.js のレンダラーと MuJoCo を簡易 mock にして、後始末・スライダー・プリセット欄の動きを確かめる
- テスト用の共通準備（`src/test/setup.ts`）は localStorage を Storage を継承しない代用品に置き換えている。`Storage.prototype` に例外を仕込むテストは、そのファイルの中で jsdom の本物の Storage に差し替えてから行う

## 既知の限界

- 確認したブラウザは Chromium のみ
- 見送った改善は enhancement issue にある（#3 キーボード操作、#4 読み込みの中断、#5 WebGL2 非対応環境、#6 入力検証、#7 狭い画面、#13 複数タブ）

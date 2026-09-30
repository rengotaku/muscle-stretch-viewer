# ADR 索引

<!-- generate-adr-index.zsh による自動生成。手で編集しない -->

| ADR | タイトル | status | date | 要旨 |
|---|---|---|---|---|
| [0001](0001-myofullbody-mujoco-wasm.md) | 筋の伸び率をブラウザ内の MuJoCo と MyoFullBody で計算する | accepted | 2026-09-30 | 写真からの 3D 復元をやめ、MyoFullBody（416 筋）をブラウザ内の MuJoCo WASM で動かして、関節角度から筋の伸び率を直接計算する |
| [0002](0002-reference-pose-and-coupled-joints.md) | 伸び率の基準姿勢は qpos0 に連動関節の計算を当てた姿勢にする | accepted | 2026-09-30 | qpos0 は equality 制約を 6 本満たさず大腿直筋の基準長が 0.178m 長く出るため、連動関節を多項式で計算した姿勢を基準にする。スライダーは独立 71 関節だけ |
| [0003](0003-presets-in-localstorage.md) | ポーズのプリセットは localStorage に独立関節の角度だけを保存する | accepted | 2026-09-30 | プリセットは localStorage のキー muscle-stretch-viewer.presets.v1 に独立 71 関節の角度だけを保存し、読めないときは上書きしない |

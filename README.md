# muscle-stretch-viewer

ポーズを取ったとき、どの筋肉がどれだけ伸ばされるかをブラウザ上の 3D で見せる。筋骨格モデルの計算はブラウザ内の MuJoCo（WebAssembly）で行い、サーバや GPU は使わない。

Scaffolded from [my-boilerplate/react-spa](https://github.com/rengotaku/my-boilerplate/tree/main/boilerplates/react-spa).

## 筋骨格モデルの出典

`public/models/myo/` のファイルは [MyoHub/myo_sim](https://github.com/MyoHub/myo_sim) のコミット `93b0ca8f4ec90c9899ee7f05fee561e9911da91b` から取り込んだ。

- `myofullbody.xml` は同リポジトリで `python -m myo_sim.build.compose --generate` を実行して生成したもの（MyoFullBody: 123 自由度・416 筋）
- メッシュ等のアセットは、`myofullbody.xml` が参照するものだけを元のディレクトリ構成のまま置いている
- ライセンスは Apache License 2.0。全文は `public/models/myo/LICENSE`

モデルを更新するときは、上の手順で XML を生成し直し、参照しているアセットを同じ構成でコピーする。

## Getting Started

See the Makefile for available commands:

```bash
make help
```

## CI

CI workflow is at `.github/workflows/ci.yml`.

```bash
make ci
```

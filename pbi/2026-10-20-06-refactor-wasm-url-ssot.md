# PBI 06: WASM URL リテラルの SSOT 化（7 箇所）

## ユーザーストーリー
メンテナーとして、WASM アセット URL が 1 定数に集約された状態がほしい、なぜなら URL が 7 箇所に散在すると、クレート名変更やビルド出力変更のときに 1 箇所だけ更新漏れが起き、wrong asset ロードが実行時まで発見できないから。

## 変更点の概要
WASM アセット URL リテラルを 1 つの定数モジュールへ集約し、7 箇所の直書きを置き換える。値は不変。

## 現状と問題
- src/offscreen/opfsWorker.ts:99（opfs_engine_bg.wasm）
- ハンドラ側 5〜6 箇所: opfsWorker 配下の各ハンドラファイル（crates の TS ラッパー経由で同一 URL を直書き）
- 呼び出し元: offscreen 初期化経路（chrome.runtime.getURL を介して fetch）
- テスト: なし（URL 形式を pin するテストなし）

## 変更の理由
[DRY] アセット名はビルド配線（wasm-pack 出力）と連動する。7 箇所の複製は wrong asset ロード（CSP 違反や実行時失敗）の温床で、1 定数の変更に集約できる。

## 提案コード（骨子）
// src/offscreen/wasmAssets.ts（新規）
export const WASM_ASSET_URLS = { tagCooccur: '...', piiSanitizer: '...', ... } as const;
各呼び出し箇所は WASM_ASSET_URLS を参照する

## BDD受け入れシナリオ
Scenario: URL 統一後も同じアセットがロードされる
  Given 統合前の各 URL リテラルを記録する
  When 7 箇所を SSOT 参照へ置き換える
  Then 各呼び出し箇所が取得する URL は変更前と同一である

Scenario: クレート名変更の波及
  Given WASM_ASSET_URLS の 1 キーを変更する
  When ビルド出力のクレート名が変わる
  Then 7 箇所すべてが 1 箇所の変更で追従する

## 見積もり
1 pt（RICE: 42 = Reach 7 × Impact 3 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [ ] 7 箇所のリテラルが消え、1 定数モジュール経由になる
- [ ] npm run build 通過（web_accessible_resources の整合確認）
- [ ] npm run validate 通過

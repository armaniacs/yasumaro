# PBI: Protocol version の単一ソース化

## ユーザーストーリー
開発者として、プロトコルバージョンが1箇所で管理されてほしい、なぜなら loader.ts のハードコードコピーが v2 への上げ忘れを確実に起こすから

## ビジネス価値
プロトコルバージョンの不一致は content script と service worker 間の通信破綻を引き起こす。CHECK_DOMAIN メッセージが silent fail し、extractor が injection されなくなる。リリース時の手動同期はヒューマンエラーが確定的。

## 優先度
- 順位: 1 / 7
- RICEスコア: 600（Reach=3 / Impact=2 / Confidence=100% / Effort=0.1pw）
- 根拠: 最小工数・依存なし・即座にバグ防止効果。全候補の中で最高コスパ。

## BDD受け入れシナリオ

```gherkin
Scenario: プロトコルバージョンがビルド時に1箇所から注入される
  Given messaging/protocol.ts で CURRENT_PROTOCOL_VERSION = 1 が定義されている
  When  ビルドが実行される
  Then  content-extractor.js 内の CURRENT_PROTOCOL_VERSION は 1 になる
  And   service-worker 側の CURRENT_PROTOCOL_VERSION も 1 になる

Scenario: バージョンを上げたときにビルドが自動検知する
  Given messaging/protocol.ts の CURRENT_PROTOCOL_VERSION を 2 に変更した
  When  npm run type-check を実行する
  Then  loader.ts のハードコード値との不一致がコンパイルエラーになる
  または CI テストでアサーション失敗する
```

## 受け入れ基準
- [x] `wxt.config.ts` に `define: { __PROTOCOL_VERSION__: ... }` を追加し、ビルド時に注入
- [x] `src/content/loader.ts` の `const CURRENT_PROTOCOL_VERSION = 1` を `__PROTOCOL_VERSION__` 参照に置換
- [x] `src/messaging/protocol.ts` を唯一の SSOT として維持
- [x] `src/messaging/__tests__/protocol-sync.test.ts` を追加し、loader.ts の値と protocol.ts の値が一致することを CI で検証
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: プレイ ワークフロー（content script injection → domain check → recording）でプロトコル不一致が起きないこと
- 統合: `protocol.ts` の値と `loader.ts` にビルドされた値が一致することのアサーション
- 単体: `protocol-sync.test.ts` でソースファイルの文字列検索による整合性チェック

## 見積もり
1pt（0.1人週）

## 技術的考慮事項
- 依存関係: なし（リーフモジュール）
- テスタビリティ: Vite `define` はテスト環境でも有効。`vi.mock` 不要
- 非機能要件: ビルド時間への影響なし

## 実装者向け注記

### 現状コードの確認
```bash
# CURRENT_PROTOCOL_VERSION の定義箇所を確認
grep -rn "CURRENT_PROTOCOL_VERSION" src/ entrypoints/
# loader.ts のハードコードを確認
grep -n "const CURRENT_PROTOCOL_VERSION" src/content/loader.ts
```

### 実装手順
1. `wxt.config.ts` に `define: { __PROTOCOL_VERSION__: JSON.stringify(1) }` を追加
2. `src/content/loader.ts:21` の `const CURRENT_PROTOCOL_VERSION = 1` を `declare const __PROTOCOL_VERSION__: number; const CURRENT_PROTOCOL_VERSION = __PROTOCOL_VERSION__` に変更
3. `src/messaging/__tests__/protocol-sync.test.ts` を作成し、`protocol.ts` のエクスポート値と loader.ts 内の `__PROTOCOL_VERSION__` 値が一致することをアサート
4. `npm run validate` で全テストパスを確認

### 落とし穴
- Content script は ESM import 不可（IIFE）。`import { CURRENT_PROTOCOL_VERSION } from '../messaging/protocol.js'` は使えない。Vite `define` が唯一の正解
- manifest.json にカスタムフィールドを追加する代替案は Chrome Web Store レビューで追加審査の可能性。ビルド時 define が安全

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（AGENTS.md の TypeScript ESM 注記に define を追記）

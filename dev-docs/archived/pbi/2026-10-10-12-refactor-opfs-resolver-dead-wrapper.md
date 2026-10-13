# PBI: detectOpfsCapabilitiesForResolver 死蔵ラッパーを削除する

- 種別: refactor
- RICE: 3.0（R3 × I0.5 × C1.0 / E0.5）
- 依存: なし
- バッチ: W3

## ユーザーストーリー

保守担当者として、backendResolver の interface が実利用だけを語っていてほしい。なぜなら本番未使用の 1 行委譲ラッパーが coverage ゲート通すためだけに生存し、stale なコメントが存在しない接続（diagnostics panel との共有）を主張しているから。

## 背景（現状）

- `src/offscreen/backendResolver.ts:45-47` — `detectOpfsCapabilitiesForResolver()` は `detectLiveVfsStrategy().caps` の 1 行委譲のみ。本番参照 0 件（rg で定義+テストのみ確認済み）
- `src/offscreen/__tests__/backendResolver-coverage.test.ts:64,95-106` — coverage ゲートを通すための describe
- ヘッダーコメントが「diagnostics panel と lifecycle が共有する」接続を主張 — 実際には両者は `opfsCapabilities` を直接使う（stale）

coverage ゲート通すためだけに生存する dead seam。

## BDD 受け入れシナリオ

```gherkin
Scenario: backendResolver の interface が実利用だけを語る
  Given 死蔵ラッパーが削除されている
  When backendResolver.ts を検査する
  Then detectOpfsCapabilitiesForResolver は存在しない
  And production 呼び出しに影響しない（opfsCapabilities 経路は不変）
```

## 受け入れ基準

- [x] `detectOpfsCapabilitiesForResolver` を削除する
- [x] coverage テストの当該 describe を削除する（委譲先 `detectLiveVfsStrategy` は既存テストでカバー）
- [x] stale コメントの主張を削除する
- [x] production 呼び出しに影響なし（既存テスト green）

## テスト戦略

- unit: `src/offscreen/__tests__/backendResolver-coverage.test.ts` の当該 describe 削除、残り green
- 挙動不変: `resolveBackend` / `detectLiveVfsStrategy` の動作は不変

## 見積もり

0.5 SP

## 技術的考慮事項

- 削除一発。coverage ゲートは `detectLiveVfsStrategy` 側で維持
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `backendResolver.ts` の関数 + stale コメント削除
2. coverage テストの当該 describe 削除
3. `rg -n "detectOpfsCapabilitiesForResolver" src/` で 0 件確認
4. `npx vitest run src/offscreen` で検証

### 落とし穴

- coverage ゲートの % が関数削除で下がる場合は委譲先のテストで補完済みか確認（`detectLiveVfsStrategy` は既存 describe でカバー）

## Definition of Done

- [x] 死蔵ラッパー削除（参照 0 件）
- [x] `npx vitest run src/offscreen` が green
- [x] stale コメント消滅
- [x] ロールバック不要（削除のみ）

# PBI: 死んだパイロット tabCacheFactory を削除する

## ユーザーストーリー

Service Worker の保守担当者として、参照されないパイロットモジュールと hidden singleton がリポジトリに残っていてほしくない。DI 移行で代替済みの module-level mutable singleton を再導入する死コードだから。

## 優先度

- 順位: 8/17
- RICE: 4.0（R2 / I1 / C1.0 / E0.5）
- 根拠: deletion test が完全パス（削除しても複雑さが再出現しない）。SW-stateless 設計約束と矛盾する global state 路径の除去
- 依存: なし

## 背景（file:line 現状）

- `src/background/tabCacheFactory.ts:1-24` — 自己記述のパイロット（「Once this pattern proves out…」）。`let instance: TabCache | null` の module-level singleton
- 唯一の参照は自分のテスト: `src/background/__tests__/tabCacheFactory.test.ts:2`（リポジトリ全体 grep で他参照なし）
- 代替済み: TabCache は `container.resolve<TabCache>('tabCache')`（`src/background/createBackgroundServices.ts:107`）経由で DI（ServiceContainer / compositionManifest）

## BDD受け入れシナリオ

```gherkin
Scenario: 死コードがリポジトリから消える
  Given tabCacheFactory.ts とそのテストが実在する
  When 両ファイルを削除する
  Then type-check / lint / test がすべて green のまま通る
```

## 受け入れ基準

- [ ] `src/background/tabCacheFactory.ts` を削除
- [ ] `src/background/__tests__/tabCacheFactory.test.ts` を削除
- [ ] リポジトリ全体で tabCacheFactory / getTabCacheInstance / resetTabCacheInstanceForTesting の参照が 0 になる
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- type-check + lint + test で削除の安全性を確認。新規テストは不要（削除のみ）

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する

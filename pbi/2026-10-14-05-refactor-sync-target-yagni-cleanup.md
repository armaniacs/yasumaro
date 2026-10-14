# PBI: N=1先行抽象の整理（SyncTarget・catalog view・dead alias）

## ユーザーストーリー
拡張機能の新規参入者として、使う側が1つしかない抽象と死んだエイリアスを整理してほしい、なぜなら2つ目の保存先が来たときの判断コストになり、参照先の迷いが生まれるから

## 優先度
- 順位: 05 / 5
- RICEスコア: 2.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: provider追加・保存先追加時のみ発火（R2）で効果はノイズ削減（I0.5）。実読で確定（C1.0）。Quick Win枠。依存なし。

## 背景（holistic-code-review テーマ5・拡張性サブエージェント報告）
`SyncTarget.ts:6-8` と `SyncBatchRunner.ts:7-9` は単一実装（Gistのみ）を自認し、本命のObsidianは別経路（`saveToObsidianStep.ts:17-23`）。カタログのview混入は意図的選択（`providerCatalog.ts:5-10`）だが差分ノイズになる。deprecated 2件は本番importゼロのまま残る。

## BDD受け入れシナリオ
Scenario: SyncTargetの位置づけが明確になる
  Given 新しい保存先を検討する
  When `SyncTarget.ts` を読む
  Then experimentalであることとObsidianが別経路であることが分かる

Scenario: view変更がドメイン差分に紛れない
  Given プロバイダの表示だけを変える
  When 差分を見る
  Then ドメインデータの差分と区別できる

Scenario: 死んだ参照先がなくなる
  Given 新規コードを書く
  When providerの型やクラスをimportする
  Then deprecated aliasへの誘導がなく、`check-deprecated-aliases` が緑のままになる

## 受け入れ基準
- [x] `SyncTarget.ts`／`SyncBatchRunner.ts` にexperimental明記が入り、Obsidianを乗せるかは別途判断事項として分離される（挙動不変）
- [x] カタログview（`cssClass／defaultOpen／extraFields`）が `providerId` を鍵にする派生map（`PROVIDER_VIEW_METADATA`、`Object.fromEntries(catalog keys)` 導出）へ分離される（Entry側3字段は@deprecated互換化、ランタイム値同一。キー同期テスト追加）
- [x] `ProviderStrategy.ts` のdeprecated aliasと `OpenAIProvider.ts` の薄サブクラスが削除され、codemodされる（削除前に本番importゼロをgrep実測。`providers/index.ts` の1行輸出修正＋関連テスト8件codemod。`check-deprecated-aliases` 緑維持）
- [x] `providerCatalog.ts` の `unregisterProviderFactory` は公開継続（テスト専用seam）と決定記録
- [x] `SyncTarget.sync` と `appendToDailyNote` のシグネチャ不整合の扱いがコメント記録される（将来のObsidian乗せ可否の判断材料。検証: `tsc` 0 errors、`src/background/ai` 28 files / 387 tests passed、関連4件46 tests passed）

## テスト戦略
- E2E: プロバイダ表示とGist同期の振る舞いが変わらないこと
- 統合: カタログ派生mapのキー同期テスト
- 単体: deprecated削除後のlint監視テスト

## 見積もり
0.5（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

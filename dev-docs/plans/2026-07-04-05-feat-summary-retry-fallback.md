# PBI: 要約リトライ / 品質フォールバック

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: B. 記録品質・自動化
- type: feat / 優先度: 中

## ユーザーストーリー

Yasumaro 利用者として、要約が失敗したり短すぎたりしたときに別プロバイダーで自動リトライしてほしい。なぜなら、単一プロバイダーの一時障害や品質ブレで記録が欠けたり質が落ちたりするのを避けたいから。

## ビジネス価値

要約成功率と品質の安定化。測定: 要約失敗率の低下 / フォールバック発動回数。

## BDD受け入れシナリオ

```gherkin
Scenario: 一次プロバイダー失敗時にフォールバックする
  Given 一次AIプロバイダーと二次プロバイダーが設定されている
  When  一次プロバイダーの要約がエラーを返す
  Then  二次プロバイダーで要約が再実行される
  And   成功した要約が記録される

Scenario: 短すぎる要約でフォールバックする
  Given 要約の最小長しきい値が設定されている
  When  一次プロバイダーがしきい値未満の要約を返す
  Then  二次プロバイダーで再実行される

Scenario: 全プロバイダー失敗時は pending に回す
  Given すべてのプロバイダーが失敗する
  When  要約リトライが尽きる
  Then  ページは pending として保持される
  And   後で再試行できる
```

## 受け入れ基準

- [ ] 一次失敗時に二次プロバイダーへフォールバックする
- [ ] 要約最小長しきい値でのフォールバック判定
- [ ] リトライ回数の上限を持つ
- [ ] 全失敗時は pending 保持

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 一次失敗 → 二次成功で記録される

### 統合テスト
- `aiClient` プロバイダー切替コントラクト
- `retryHelper` のリトライ挙動

### 単体テスト
- 短すぎ判定の境界値
- リトライ上限到達時の pending 分岐

## 実装アプローチ

Outside-In / Red-Green-Refactor。プロバイダーはモックで注入。

## 見積もり

5pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし（feature-06 の pending と親和）
- 再利用: `src/utils/retryHelper.ts`、`src/background/aiClient.ts`、`src/background/ai/providers/`

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "retry\|fallback\|フォールバック" src/utils/retryHelper.ts src/background/aiClient.ts
grep -rn "registerProvider" src/background/aiClient.ts
```

### 落とし穴

- クラウド/ローカルでタイムアウトが異なる（クラウド30秒 / ローカル120秒）。リトライ全体の時間予算を設計する。
- API使用量・レート制限（`aiUsageTracker`）を考慮し無限リトライを避ける。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新

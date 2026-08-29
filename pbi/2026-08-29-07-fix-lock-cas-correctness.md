# PBI: ロック/CAS 運用の正しさ — try/finally と current マージ（VULN-028/029, CWE-667/362）

## ユーザーストーリー
開発者として、Tranco 更新の失敗が後続の更新を永久にブロックせず、trust DB への同時書き込みが片方の差分を静かに捨てないようにしたい、なぜならロック解除が例外経路で到達不能（try/finally 未使用）で、CAS コールバックが現在状態を無視して stale スナップショットを返しているから

## ビジネス価値
- VULN-028: 1 回の更新失敗で `updateInProgress` が true のまま残り、コンテキスト再読込まで Tranco 更新が恒久ロックアウト（実証: 2 回目以降 "already in progress"）
- VULN-029: 同時書き込みで片方の差分が静黙に失われる（CAS が LWW に退化、実証済み）
- 測定方法: 更新を例外で中断してもフラグが false に戻ること、2 writer の差分が共に反映されること

## 優先度
- 順位: 7 / 14
- RICEスコア: 1125（Reach=500 / Impact=0.25 / Confidence=90% / Effort=0.1人月）
  - Reach 500: Tranco 更新（全利用者の trust DB 品質）＋trust DB 同時書き込み（設定 UI・更新・migration）
  - Impact 0.25: 恒久ロックアウトは手動復旧が必要、LWW は信頼データの静黙欠落
  - Confidence 90%: スイープで 8 CAS サイト中 7 が正しい current 消費と確認済み — 誤用は 1 箇所のみ
  - Effort 0.1: finally 追加＋updateFn 修正＋契約テスト
- 根拠: ロック API の誤用パターンに対する契約テストを追加することで、将来の誤用も検出可能にする

## BDD受け入れシナリオ

```gherkin
Scenario: 更新の例外でもロックフラグは解除される
  Given Tranco 更新中にネットワーク例外が発生する
  When updateTrancoList が完了する
  Then updateInProgress は false に戻り、次回の更新が実行できる

Scenario: 同時書き込みでも双方の差分が残る
  Given trust DB に 2 つの writer が同時に delta を適用する
  When 両方が withOptimisticLock を完了する
  Then updateFn が current を受け取りマージし、両差分が反映される

Scenario: コンフリクト時はリトライで解決する
  Given writer B が writer A の読み取り後に書き込む
  When B の updateFn が実行される
  Then コンフリクト検出後、B は current を再取得してリトライする

Scenario: ロック契約の誤用はテストで検出される
  Given 新規の lock 呼び出しが current を無視して stale 値を返す
  When 契約テスト（current 消費検証）を実行する
  Then テストが失敗し、誤用が CI で捕捉される
```

## 受け入れ基準
- [ ] `src/utils/trustDb/trancoUpdater.ts:50-119` の更新ループが try/finally で `this.updateInProgress = false` を保証し、到達不能な post-loop reset を削除している
- [ ] `src/utils/trustDb/trustDb.ts:316-319` の `updateFn` が `_currentDb` を受け取り、意図した差分を current 上にマージして返す（コンフリクト時リトライ）
- [ ] ロック API 契約テスト（finally カバレッジ・current 消費検証）が追加されている
- [ ] 既存 trustDb 系 221 テストが全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: lockout PoC・LWW PoC が失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし

### 統合テスト
- `trancoUpdater` × fetch モック: 成功/失敗/例外の 3 経路でフラグ解除を検証
- `trustDb` × 2 writer モック: 同時適用の merge 結果

### 単体テスト
- 新規: `src/utils/trustDb/__tests__/lockContract.test.ts`
  - ビジネスロジック: updateFn の merge 動作
  - 境界値: 空差分、同一キー同時適用、コンフリクト連鎖
  - 例外: updateFn throw 時のロック解放

## 実装アプローチ
- **Outside-In**: lockout PoC を RED → try/finally で GREEN → LWW PoC を RED → merge 実装で GREEN
- **Red-Green-Refactor**: 契約テストは既存 7 正解サイトに対しても実行し、回帰がないことを確認

## 見積もり
1pt（要チームでの見積もり — finally 1 箇所＋merge 1 箇所＋契約テスト）

## 技術的考慮事項
- 依存関係: PBI 04（optimisticLock の Mutex 直列化）と相互作用 — 04 先着手を推奨（Wave 2）
- テスタビリティ: `_currentDb` はテスト注入可能
- 非機能要件: リトライ上限は既存 `withOptimisticLock` の挙動を踏襲
- 注意: `contextMenuHandlers.ts:38-100` は正解実装（スイープ済み）— 触れない

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '45,120p' src/utils/trustDb/trancoUpdater.ts
sed -n '310,325p' src/utils/trustDb/trustDb.ts
rg -n "withOptimisticLock" src/utils/trustDb --type ts
```

### 実装手順
1. trancoUpdater のループを try/finally 化
2. trustDb.updateFn を `(current) => merged` 型に書き換え
3. 契約テスト追加、`npm run validate`

### 落とし穴
- finally 内でさらに例外を投げないこと（元の例外を握り潰す）
- merge 実装で `_currentDb` をミューテートしないこと（新オブジェクトを返す — CAS の前提）
- 例外経路のフラグ解除は既存 `Mutex.ts` の正解パターン（release が常に走る）と揃える

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-028/029 が解消されること

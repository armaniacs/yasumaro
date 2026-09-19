# PBI: headerDetector の非同期失敗を検知可能にする

## ユーザーストーリー
拡張機能利用者として、プライバシーヘッダ判定の失敗が見逃されず正しく記録可否が判断されてほしい、なぜなら判定欠落による誤記録はプライバシー侵害につながるから

## 優先度
- 順位: 02 / 13
- RICEスコア: 60（Reach=100 / Impact=1 / Confidence=80% / Effort=1.33）
- 根拠: 4観点が指摘した最多重複箇所。プライバシー判定に直結し工数が小さい

## ビジネス価値
storage.session.set 失敗の握りつぶしをなくし、プライバシー判定の信頼性を上げる。失敗ログの有無で改善を測定できる

## BDD受け入れシナリオ

```gherkin
Scenario: ストレージ書き込み失敗時はログとフォールバック判定になる
  Given chrome.storage.session.set が失敗する
  When ヘッダー判定を実行する
  Then 失敗がログに記録される
  And フォールバック判定で安全側に倒れる

Scenario: 正常時は従来通り判定が保存される
  Given ストレージが正常
  When ヘッダー判定を実行する
  Then 判定結果が保存される
```

## 受け入れ基準
- [x] headerDetector.ts の session 保存が async/await＋try-catch になっている
- [x] set 失敗時に logDebug で診断記録しインメモリ継続する（フォールバック判定）
- [x] 意図的なキュー連鎖（storageTransaction・persistentRetryQueue・aiUsageTracker）に意図コメントが付いている（aiUsageTracker は既存 VULN-010 コメントあり）
- [x] type-check が通る

## DoD 補足（アーカイブ時）
- BDDシナリオ「ストレージ書き込み失敗時」のテストを追加済み（headerDetector.test.ts「falls back to in-memory cache when the session write fails」— logDebug 記録＋インメモリ継続を検証、21 passed）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ストレージ quota 超過時の記録フローが安全側に倒れる

### 統合テスト
- chrome.storage.session.set 失敗モック時の headerDetector の挙動

### 単体テスト
- フォールバック判定ロジックの分岐網羅

## 実装アプローチ
- **Outside-In**: 失敗シナリオの統合テストから開始
- **Red-Green-Refactor**: TDDサイクルで置換する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: chrome API のモックで検証可能
- 非機能要件: プロジェクト規約 async/await のみへの適合

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "\.then(" src/background/headerDetector.ts src/background/compositionManifest.ts src/utils/storage/storageTransaction.ts
```

### 実装手順
1. 失敗時の統合テストを先に書く
2. headerDetector を async/await＋try-catch に置換する
3. 意図的な .then 連鎖にコメントを付ける
4. 他の単なる残存は置換する（本PBIでは headerDetector を必須、他は余力があれば）

### 落とし穴
- storageTransaction・persistentRetryQueue・aiUsageTracker の counterLock パターンは意図的なキュー直列化であり、安易に置換しないこと。コメント付与に留める

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

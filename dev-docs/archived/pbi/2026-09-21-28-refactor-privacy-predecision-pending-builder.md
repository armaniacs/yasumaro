# PBI: privacy step の bypass 判定を pre-decision 化し pending 組み立てを pendingStorage に抽出する

## ユーザーストーリー
開発者として、privacy step の bypass 判定を fetch 前の pre-decision に一本化し pending 組み立てを pendingStorage に抽出したい、なぜなら手書き bypass の二重化は規則変更時の乖離を招き直書きの pending 組み立ては Date.now 直呼びでテスト不能だから

## 優先度
- 順位: 3
- RICEスコア: 10（Reach=5 / Impact=1 / Confidence=1.0 / Effort=0.5週）
- 根拠: R4 トリガー発火の再評価・実残判定。bypass 規則の変更が step と seam の2箇所編集になり乖離する実残リスクを解消する

## ビジネス価値
bypass 規則の変更箇所が一か所になり乖離による誤記録・記録漏れを防げる。pending 組み立てが clock 注入でテスト可能になり許可リストと TTL の単一所有が強化される。fetch 前の allow 確定で getPrivacyInfoWithCache の不要な I/O を削減できる

## BDD受け入れシナリオ

```gherkin
Scenario: force と whitelist は fetch 前に allow が確定する
  Given force または whitelisted が真の RecordingContext
  When privacy step が fetch 前に decidePrivacy を呼ぶ
  Then verdict は allow に確定し getPrivacyInfoWithCache を呼ばず context を返す

Scenario: pending 組み立てが純粋関数としてテストできる
  Given buildPendingPage と注入した clock
  When url と title と reason と headerValue を渡す
  Then 許可リスト正規化・redact・1024 文字切詰め・timestamp と expiry が clock 基準で組み立てられる
```

## 受け入れ基準
- [x] fetch 前に decidePrivacy({force, whitelisted, isPrivate: false, autoSaveBehavior, requireConfirmation}) を呼び allow なら getPrivacyInfoWithCache をスキップする
- [x] fetch 後の呼び出しが isPrivate マトリクスのみを担う
- [x] pending 組み立てが pendingStorage.ts の純粋 buildPendingPage(input, clock) に抽出されている
- [x] buildPendingPage が許可リストと TTL の既存 SSOT を参照する
- [x] step が I/O のみを担い組み立てロジックを持たない
- [x] ログ文言と return context 形状が変更前と byte 等価である
- [x] deniedBy マトリクスに変更がない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- force と whitelist での記録フローが従来通りであり fetch 前スキップ時も挙動が変わらない

### 統合テスト
- pre-decision と fetch 後判定の組み合わせで verdict が従来と byte 等価である
- step の I/O 経路と buildPendingPage の組み立て経路の結合が従来通りである

### 単体テスト
- decidePrivacy の pre-decision 入力（isPrivate: false 固定）と isPrivate マトリクス入力の境界値テスト
- buildPendingPage の clock 注入テスト（timestamp と expiry が clock 基準・許可外 reason の正規化・1024 文字切詰め・redact 適用）

## 実装アプローチ
- **Outside-In**: pre-decision の byte 等価テストと buildPendingPage の clock 注入テストから開始
- **Red-Green-Refactor**: 振る舞いを変えずに bypass 一本化と組み立て抽出を行う

## 見積もり
1ストーリーポイント

## 技術的考慮事項
- 種別: refactor
- 依存関係: deniedBy マトリクス修正（2026-09-21 完了）に依存するが同マトリクス自体は触らない
- テスタビリティ: buildPendingPage の clock 注入が鍵。fetch 前は isPrivate 未確定だが force と whitelisted は確定済みのため verdict は allow に確定する
- 非機能要件: 挙動は byte 等価（ログ文言・return context 形状）。I/O 最適化のみで判定意味の変更はしない

## 実装者向け注記

### 現状コードの確認
- `src/background/pipeline/steps/checkPrivacyHeadersStep.ts:33` 付近 `if (force) { ... return context; }` — 手書き bypass その1
- `src/background/pipeline/steps/checkPrivacyHeadersStep.ts:54` 付近 `if (shouldSkipPrivacyCheck) { return context; }` — 手書き bypass その2
- `src/background/pipeline/recordingDecision.ts:91` 付近 decidePrivacy 内の同規則 — step が先に return するためこの経路では到達不能で二重エンコード
- `src/background/pipeline/steps/checkPrivacyHeadersStep.ts:125` 付近 savePendingPage — validReasons 配列・redactHeaderValue・substring(0,1024)・{url,title,timestamp:Date.now(),...,expiry:Date.now()+24h} を直書き
- `src/utils/pendingStorage.ts:13` PrivacyPendingReason 型・`src/utils/pendingStorage.ts:24` 付近 PRIVACY_PENDING_REASONS set・`src/utils/pendingStorage.ts:57` 付近 PendingPage interface・`src/utils/pendingStorage.ts:91` PENDING_MAX_TTL_MS=24h が既に単一所有

### 実装手順
1. fetch 前後の decidePrivacy 呼び分けの byte 等価テストを書く（変更前の振る舞い固定）
2. fetch 前に decidePrivacy({force, whitelisted, isPrivate: false, autoSaveBehavior, requireConfirmation}) を呼び allow なら getPrivacyInfoWithCache をスキップする
3. pending 組み立てを pendingStorage.ts の純粋 buildPendingPage(input, clock) に抽出し許可リストと TTL の既存 SSOT を参照させる
4. step を I/O のみに痩せさせる

### 落とし穴
- deniedBy マトリクス修正（2026-09-21 完了）は触らないこと。本PBIは bypass 一本化と組み立て抽出のみ
- 挙動は byte 等価を保つこと（ログ文言・return context 形状の変更はしない）
- pending 組み立てに Date.now を直呼びで残さないこと（clock 注入に統一する）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] 統合検証 green

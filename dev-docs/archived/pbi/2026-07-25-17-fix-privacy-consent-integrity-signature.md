# PBI: プライバシー同意状態の改ざん検知のためHMAC署名を付与する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（ストレージ形式変更のため、既存の未署名データとの後方互換処理が必要）

---

## 背景

Checking Team レビュー（2026-07-25）の Compliance & Privacy Guard からの指摘。`src/popup/privacyConsent.ts` のプライバシー同意状態（`hasConsented`, `consentDate` 等）が `chrome.storage.local` に平文で保存されている。ストレージにアクセスできる攻撃者（同一プロファイル上の悪意あるスクリプト等）がユーザーのプライバシー選択を改ざんできる可能性がある。

`src/utils/crypto.ts:454` に `generateHmacSignature`、`:472` に `verifyHmacSignature` が既に実装されており、`src/background/headerDetector.ts` 等で通知の署名に利用されている前例がある。これを同意状態にも適用する。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "generateHmacSignature\|verifyHmacSignature\|getNotificationHmacKey" src/utils/crypto.ts
grep -n "PRIVACY_CONSENT" src/popup/privacyConsent.ts src/utils/storage.ts
```

既存の `getNotificationHmacKey()` を流用できるか、同意専用の鍵を別途用意すべきかを確認する（鍵の使い回しは影響範囲を広げるため、専用鍵を推奨）。

## 受け入れ基準（BDD）

```gherkin
Scenario: 同意状態にHMAC署名が付与される
  Given ユーザーがプライバシーポリシーに同意する
  When setPrivacyConsent() が呼ばれる
  Then chrome.storage.local に保存される値にHMAC署名が含まれる

Scenario: 署名が改ざんされた場合は検知される
  Given chrome.storage.local 内の同意状態データが直接書き換えられている（署名不一致）
  When getPrivacyConsent() が呼ばれる
  Then 改ざんが検知され、hasConsented=false（未同意扱い）として扱われる

Scenario: 既存の未署名データが後方互換で扱われる
  Given マイグレーション前の署名なし同意データが存在する
  When getPrivacyConsent() が呼ばれる
  Then 署名なしデータとして正常に読み込まれ、次回保存時に署名が付与される
```

## 受け入れ基準
- [ ] 同意状態の保存時（`setPrivacyConsent` 等）にHMAC署名を計算し、データと共に保存する
- [ ] 読み込み時（`getPrivacyConsent`）に署名を検証し、不一致の場合は未同意として扱いログに警告を出す
- [ ] 署名なしの既存データ（マイグレーション前）は後方互換として読み込み、次回保存時に署名を付与する
- [ ] 既存の `privacyConsent.ts` テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 正常系: 同意 → 保存 → 読み込みで署名検証が通ることを確認
- 異常系: ストレージ内のデータを直接改ざんした状態で読み込むと未同意扱いになることを確認
- 後方互換: 署名フィールドがない既存データが正常に読み込めることを確認

### 統合テスト
- popup UIでの同意フロー全体（同意→保存→再起動後の状態復元）が回帰しないことを確認

## 実装アプローチ

1. `crypto.ts` の `generateHmacSignature`/`verifyHmacSignature` を利用し、同意状態専用のHMAC鍵取得関数を追加（または既存の通知用鍵を流用するか検討）
2. `privacyConsent.ts` の保存処理に署名付与を追加
3. 読み込み処理に署名検証を追加、不一致時は `hasConsented: false` を返しログ記録
4. 既存データ（署名なし）の後方互換パスを実装

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/crypto.ts` のHMAC機能
- テスタビリティ: `chrome.storage.local` のモックで署名改ざんケースを再現可能
- 非機能要件: セキュリティ（データ整合性）

## Definition of Done
- [ ] HMAC署名の付与・検証が実装されている
- [ ] 改ざん検知時に未同意として扱われる
- [ ] 既存の未署名データが後方互換で扱われる
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Compliance & Privacy Guard指摘）
- 対象コード: `src/popup/privacyConsent.ts`, `src/utils/crypto.ts:454-486`

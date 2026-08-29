# PBI: 暗号・認証ポリシーの単一情報源化（VULN-010/037/038/039/040/052, CWE-312/916/307/362/521）

## ユーザーストーリー
利用者として、マスターパスワードと API キー保護が単一の強いポリシーで運用されるようにしたい、なぜなら硬化版実装（600k iterations、strict ポリシー、deriveHmacWrappingKey）が死蔵コードで、弱い平行実装が本番に配線され続けているから

## ビジネス価値
- VULN-010: HMAC KEK が wrapped keys の隣に平文保存（実証済み）→ session-only＋deriveHmacWrappingKey 配線
- VULN-037/052: PBKDF2 100k（標準 600k）で 5.8 倍速いオフライン攻撃（実証）→ iterations SSOT
- VULN-038: レート制限カウンタが storage.session でリセット可能（実証: 4000 guesses）→ local 永続化
- VULN-039: crypto get-or-create の未排他（実証: 分岐トークン）→ encryptionKeyMutex パターン適用
- VULN-040: パスワードポリシー length≥8 のみ（実証: rockyou 4/4 通過）→ strict ポリシー一本化
- 測定方法: 暗号パラメータが 1 箇所で定義され、3 KDF 経路が同一 iterations を使うこと

## 優先度
- 順位: 12 / 14
- RICEスコア: 453（Reach=400 / Impact=0.4 / Confidence=85% / Effort=0.3人月）
  - Reach 400: マスターパスワード設定者（API キー保護の実質）
  - Impact 0.4: KEK 平文・弱 KDF・ロックアウト迂回の複合
  - Confidence 85%: 硬化版が既存だが、暗号変更は回帰リスクが高い（unlock UX・既存データ互換）
  - Effort 0.3: SSOT 化＋KEK 配線＋RateLimit 永続化＋init mutex＋平行実装削除
- 根拠: 6 指摘の根が「平行実装のドリフト」であり、SSOT 化 1 回で class を消す。ただし暗号系のため慎重なリリースが必要

## BDD受け入れシナリオ

```gherkin
Scenario: KEK は storage.local に存在しない
  Given HMAC ラップキーが保存されている
  When storage.local を検査する
  Then KEK の平文（base64）は存在せず、ラップされたキーのみが存在する

Scenario: 全 KDF 経路が同一 iterations を使う
  Given settings export / password change / envelope のいずれかが実行される
  When deriveKey が呼ばれる
  Then 3 経路とも SSOT の iterations（600k）を使い、format に iterations が保存される

Scenario: レート制限カウンタは再起動後も有効である
  Given 失敗カウンタが storage.local に永続化されている
  When 攻撃者が session を clear して再試行する
  Then カウンタは継続し、5 失敗で LOCKED_UNTIL が設定される

Scenario: 並行 get-or-create は単一の鍵を生成する
  Given 2 コンテキストが同時に getOrCreateWrappedHmacKey を呼ぶ
  When 両方が完了する
  Then 生成される鍵/トークンは 1 つであり、双方が同一の値を得る

Scenario: 弱いパスワードは production 経路で拒否される
  Given rockyou 上位のパスワードを入力する
  When マスターパスワードを設定する
  Then strict ポリシー（強度スコア/文字種）で拒否される
```

## 受け入れ基準
- [ ] `src/utils/crypto/hmacKeyStore.ts:132-138` の storage.local への KEK 書き込みが削除され、`:65-87` の `deriveHmacWrappingKey`（master password 経由）が再起動リカバリ経路として配線されている
- [ ] 暗号パラメータ SSOT（iterations/ポリシー）が 1 モジュールに集約され、`settingsExportImport.ts:110,168`、`masterPassword.ts:213,218`、envelope 経路がすべて参照する
- [ ] `src/utils/RateLimitService.ts` の FAILED_ATTEMPTS/FIRST_ATTEMPT_TIME が storage.local に永続化され、成功時のみリセットされる
- [ ] `encryptionSession.ts:431-473`、`hmacKeyStore.ts:215-254`、`confirmTokenManager.ts:25-70` が `encryptionKeyMutex` パターン（generate+persist+cache を 1 locked section）に統一されている
- [ ] `src/utils/masterPassword.ts:78-86` が strict ポリシー（`encryptionSession.ts:262-274` から抽出した共有 validator）に一本化され、弱い平行実装が削除されている
- [ ] 既存暗号データの後方互換（旧 iterations 形式の読み込み）がテストされている
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: 6 PoC が全て失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- マスターパスワード設定→アンロック→API キー再暗号化の一連の流れを Playwright または popup/dashboard 統合で確認

### 統合テスト
- `masterPassword` 変更フロー×deriveKey モック: iterations 600k 使用の検証
- `RateLimitService` × storage モック: session clear 耐性
- `hmacKeyStore` × 2 コンテキスト: 単一生成の統合検証

### 単体テスト
- 新規: `src/utils/crypto/__tests__/cryptoParamsSSOT.test.ts`（SSOT 参照の網羅・旧形式互換）
- 新規: `src/utils/__tests__/rateLimitPersistence.test.ts`
- 更新: 既存 `hmacKeyStore`/`encryptionSession` テストの期待値更新

## 実装アプローチ
- **Outside-In**: 統合テスト（Red）→ SSOT モジュール抽出 → 3 経路の付け替え → 弱い平行実装削除
- **Red-Green-Refactor**: KEK 配線は unlock UX（master password 未設定時）のフォールバック設計を先に決める

## 見積もり
3pt（要チームでの見積もり — SSOT 抽出、KEK リカバリ設計、5 モジュール変更、互換移行）

## 技術的考慮事項
- 依存関係: Wave 3（単独着手推奨）。既存暗号データを持つユーザー環境での移行検証が必須
- テスタビリティ: crypto は Web Crypto polyfill（@peculiar/webcrypto）で既存テストあり
- 非機能要件: アンロック性能劣化なし（600k は現行 envelope と同等）。deriveHmacWrappingKey 配線時の初回 unlock に KDF コストが乗る点を UX 評価すること
- 注意: settings export 形式の iterations フィールド追加は「任意読み込み・既定 600k 書き込み」で後方互換

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '125,145p' src/utils/crypto/hmacKeyStore.ts
sed -n '60,90p' src/utils/crypto/hmacKeyStore.ts
sed -n '14,30p' src/utils/crypto/primitives.ts
sed -n '75,90p' src/utils/masterPassword.ts
sed -n '205,235p' src/utils/masterPassword.ts
sed -n '30,98p' src/utils/RateLimitService.ts
```

### 実装手順
1. `cryptoParams.ts`（仮称）に SSOT（ITERATIONS、ポリシー validator）を新設
2. 3 KDF 経路を付け替え（settings export → password change → envelope）
3. KEK の session-only 化＋deriveHmacWrappingKey リカバリ配線（未設定時フォールバック設計）
4. RateLimit 永続化
5. 3 get-or-create 流路の mutex 適用
6. 弱い平行実装（utils/masterPassword の弱ポリシー）削除
7. 移行テスト（旧 100k 形式読み込み）＋ `npm run validate`

### 落とし穴
- KEK を session-only にすると Chrome 再起動後に HMAC 検証ができない期間が出る — deriveHmacWrappingKey の配線と「master password 未設定ユーザー」のフォールバック（平文キー運用の明示化）を必ず設計すること
- iterations の旧形式読み込み漏れは既存ユーザーのエクスポートを壊す — 読み込み側は 100k 互換を維持
- RateLimit の local 永続化はストレージ障害時に fail-open にならないよう（成功時のみリセット）をテストで固定

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-010/037/038/039/040/052 が解消されること

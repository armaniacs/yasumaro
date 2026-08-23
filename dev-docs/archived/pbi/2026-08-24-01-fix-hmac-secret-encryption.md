# PBI: 設定インポート署名鍵（hmac_secret）を暗号化保存する

## 完了報告（2026-08-24）

### 実装内容

- `src/utils/crypto/hmacKeyStore.ts` に汎用の文字列暗号化ヘルパー `wrapSecretString` / `unwrapSecretString` / `isWrappedSecretString` を追加。既存の `getOrCreateHmacWrappingKey()`（KEK）を再利用し、AES-GCMで任意の文字列を `{ wrapped, iv }` envelope化する。
- `getOrCreateHmacWrappingKey()` の3箇所の `importKey` usages を `['wrapKey', 'unwrapKey']` から `['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']` に拡張（同一KEKで `wrapKey`/`encrypt` 両方の用途に使うため）。
- `src/utils/storage/encryptionSession.ts` の `getOrCreateHmacSecret()` を書き換え、`chrome.storage.local` には wrapped envelope形式のみ保存するように変更。旧形式（平文base64）は初回読み取り時に透過的にマイグレーション。
- `clearEncryptionKeyCache()` に `cachedHmacSecret` のクリアを追加（テスト用、既存の意味を自然に拡張）。
- `settingsExportImport.ts` 側の呼び出し4箇所は無変更（`getOrCreateHmacSecret()` の返り値は引き続き平文文字列）。

### KEK共有方式の設計判断

`hmac_secret` は専用KEKを設けず、既存の通知/同意HMAC鍵と同じ `HMAC_WRAPPING_KEY_SESSION` を共有する方式を採用した。理由:
- 鍵管理の複雑化を避けられる（KEKが1種類のまま）
- 脅威モデル上、`hmac_secret` も通知/同意HMAC鍵も同じ「storage.localを読める攻撃者」に対する防御であり、鍵を分ける動機が薄い

### KEKのlocal storageフォールバックに関する結論

**現状維持と判断。** `getOrCreateHmacWrappingKey()` はKEKを `chrome.storage.session` だけでなく `chrome.storage.local` にもフォールバック保存しているため、「storage.local単独読み取りに対する完全な防御」にはなっていない。これは意図的なトレードオフとして受け入れる:

- fallbackを撤去すると、ブラウザ再起動でセッションKEKが消えた際に `hmac_secret` を含む全ての wrapped 鍵が復号不能になり、設定インポート機能そのものが壊れる（既存ユーザーへの実害）
- 本PBIの脅威モデルは「storage.local単独読み取りへの完全な防御」ではなく「偶発的漏洩（誤った信頼境界からのアクセス）に対する多層防御」として再定義するのが正確
- 真の防御（storage.local読み取りだけでは鍵を復元できない状態）を実現するには、PBI-03で「今後の拡張ポイント」として明記されているマスターパスワード由来の安定KEK（`deriveHmacWrappingKey`）との統合が必要。これは別スコープとし、本PBIでは対応しない

### 検証結果

- `npx vitest run`: 8385 passed / 19 skipped（全件成功、既存テストへの回帰なし）
- `npm run type-check`: エラーなし
- `npm run build`: 成功

### コミット
（未コミット。ユーザーの指示があればコミットする）


## ユーザーストーリー
Yasumaro利用者として、`chrome.storage.local` が漏洩しても設定インポート機能の署名が偽造されないようにしてほしい。なぜなら、平文の署名鍵が漏れると偽の設定を「正規のインポート」として拡張機能に注入されてしまうから。

## ビジネス価値
`chrome.storage.local` を読み取れる攻撃者（同一プロファイル上の悪意あるスクリプト・マルウェア等）に対する耐性向上。PBI-03（`.superpowers/sdd/pbi-03-report.md`）で通知/同意用HMAC鍵は暗号化済みだが、設定インポート署名鍵だけがスコープ外として平文のまま残っている非対称性を解消する。

## 背景・現状分析

- `getOrCreateHmacSecret()`（[src/utils/storage/encryptionSession.ts:429](../src/utils/storage/encryptionSession.ts#L429)）は `chrome.storage.local` に `StorageKeys.HMAC_SECRET` として**平文base64**で保存している。
- 同じファイル内で使われる `getConsentHmacKey()` / `getNotificationHmacKey()`（[src/utils/crypto/hmacKeyStore.ts](../src/utils/crypto/hmacKeyStore.ts)）は既に `{ wrapped, iv }` 形式でAES-GCM（KEK）ラップ済み。
- `hmac_secret` の利用箇所: [src/utils/settingsExportImport.ts](../src/utils/settingsExportImport.ts) の4箇所（L116, L177, L256, L389）。署名検証自体は `constantTimeCompare` 済みで正しいが、鍵が平文で漏れれば検証ロジックの安全性は無意味になる。
- **重要な追加調査結果**: `getOrCreateHmacWrappingKey()`（[hmacKeyStore.ts:96](../src/utils/crypto/hmacKeyStore.ts#L96)）は現在、KEKを `chrome.storage.session` だけでなく `chrome.storage.local` にもフォールバック保存している（L114, L137）。PBI-03時点の脅威モデルは「KEKはsession限定でブラウザ終了時に消える」前提だったが、現状はKEKもlocal storageに残るため、**storage.localを読める攻撃者はKEKとwrapped envelopeの両方を取得でき、既存の通知/同意HMAC鍵の暗号化も実質的に無効化されている可能性がある**。

## BDD受け入れシナリオ

```gherkin
Scenario: 設定インポート署名鍵が暗号化されて保存される
  Given 拡張機能が初回起動し、hmac_secret がまだ存在しない
  When 設定インポート機能が hmac_secret を要求する
  Then chrome.storage.local に保存される値は wrapped envelope（{wrapped, iv}）形式であり、平文base64ではない

Scenario: 旧形式（平文base64）の hmac_secret が透過的にマイグレーションされる
  Given chrome.storage.local に平文base64の hmac_secret が既に存在する
  When 設定インポート機能が hmac_secret を要求する
  Then 既存の鍵素材を維持したまま wrapped envelope 形式に書き換えられ、以後の署名検証は継続して機能する

Scenario: KEKのlocal storageフォールバックがある場合の脅威モデルを明記する
  Given getOrCreateHmacWrappingKey() が KEK を storage.session と storage.local の両方に保存する現状がある
  When 本PBIの調査タスクでこの構成を確認する
  Then 「storage.local単独読み取りに対する防御」ではなく「実装ミス・誤った信頼境界からの偶発的漏洩に対する多層防御」として脅威モデルを再定義するか、KEKのlocal保存自体を見直すかを設計判断として記録する
```

## 受け入れ基準
- [ ] `hmac_secret` が `chrome.storage.local` に平文base64で保存されないこと（wrapped envelope形式であること）
- [ ] 既存の平文 `hmac_secret` を持つユーザーが、設定インポート機能を使い続けられること（マイグレーション）
- [ ] `getOrCreateHmacWrappingKey()` のKEK local storageフォールバックの妥当性を検証し、設計判断（現状維持 or 見直し）をPBI完了報告に明記すること
- [ ] `settingsExportImport.ts` の4箇所の呼び出しが変更なしで動作すること（インターフェース互換）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- （バックグラウンド処理のため対象外。統合テストで代替）

### 統合テスト
- 設定エクスポート→インポートの往復が、鍵形式変更後も成功すること（`src/dashboard/__tests__/encryptedBackupService.test.ts` 相当の既存テストに準拠）
- 偽造署名を持つインポートデータが拒否されること

### 単体テスト
- `getOrCreateHmacSecret()` が初回呼び出し時に wrapped envelope を生成すること
- 平文形式の既存データが検出され、wrapped envelope へマイグレーションされること
- マイグレーション後も同一の鍵素材（署名結果）が得られること（後方互換性）
- 壊れた/不正な wrapped envelope データの場合、新規鍵を生成してフォールバックすること（`getOrCreateWrappedHmacKey` の既存パターンに準拠）

## 実装アプローチ
- **Outside-In**: 統合テスト（設定インポート往復）から開始し、失敗を確認してから実装
- **Red-Green-Refactor**: 各タスクでTDDサイクルを適用
- 既存の `getOrCreateWrappedHmacKey()`（[hmacKeyStore.ts:215](../src/utils/crypto/hmacKeyStore.ts#L215)）と同じマイグレーションパターンを流用する

## 見積もり
3pt（既存パターンの横展開だが、KEK共有方式の設計判断とマイグレーションテストが必要なため中規模）

## 技術的考慮事項
- 依存関係: `src/utils/crypto/hmacKeyStore.ts` の `getOrCreateHmacWrappingKey()` を再利用するか、`hmac_secret` 専用の別KEKにするかは設計判断が必要（同一KEKを使う場合、鍵の巻き添え漏洩リスクとローテーション影響範囲を考慮）
- テスタビリティ: `chrome.storage.local` / `chrome.storage.session` のモックが必要（既存 `hmacKeyStore.test.ts` のモックパターンに準拠）
- 非機能要件: 移行は既存ユーザーの設定インポート機能を壊さないこと（後方互換必須）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "hmac_secret\|getOrCreateHmacSecret\|HMAC_SECRET" src/utils/storage/encryptionSession.ts src/utils/settingsExportImport.ts
grep -n "isWrappedHmacKey\|getOrCreateWrappedHmacKey\|getOrCreateHmacWrappingKey" src/utils/crypto/hmacKeyStore.ts
```

2026-08-24時点で `getOrCreateHmacSecret()` は平文保存のまま、`getOrCreateHmacWrappingKey()` はKEKをlocal storageにもフォールバック保存する構成になっていることを確認済み。着手時に構造が変わっていないか再確認すること。

### 実装手順（Outside-In順）
1. 設定インポート往復の統合テストを先に書き、現状（平文）でも通ることを確認（Green基準の確立）
2. `getOrCreateHmacSecret()` に対する単体テスト（wrapped envelope形式で保存されること）を先に書き、Red確認
3. `getOrCreateHmacSecret()` を `getOrCreateWrappedHmacKey()` パターンに合わせて書き換え、Green化
4. 平文からのマイグレーションテストを追加し、既存ユーザーのデータが壊れないことを保証
5. KEK共有方式について、`hmacKeyStore.ts` の既存KEK（`HMAC_WRAPPING_KEY_SESSION`）を再利用するか専用KEKを設けるか判断し、コメントで根拠を明記
6. `getOrCreateHmacWrappingKey()` のlocal storageフォールバック（L114, L137）について、意図的なトレードオフなのか見直すべきかを調査し、結論をコミットメッセージまたはPBI完了報告に記録

### 落とし穴
- `hmac_secret` はキャッシュ変数 `cachedHmacSecret`（`encryptionSession.ts:29`）を持つ。テストでこのキャッシュをリセットしないと前のテストの状態が残り誤ったGreenになる（`clearEncryptionKeyCache()` 相当のリセット関数が必要か確認）
- `settingsExportImport.ts` の4箇所は `hmacSecret: string` を期待している。`getOrCreateHmacSecret()` の返り値の型（文字列）を変えないこと。暗号化はストレージ層のみで完結させ、呼び出し元のインターフェースは変更しない
- KEKを `getOrCreateHmacWrappingKey()` と共有する場合、通知/同意HMAC鍵のローテーションと `hmac_secret` のローテーションが連動してしまう影響を検討すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npx vitest run` 全件成功
- [ ] `npm run type-check` エラーなし
- [ ] `npm run build` 成功
- [ ] コードレビュー完了
- [ ] KEK local storageフォールバックに関する設計判断がPBI完了報告に明記されている

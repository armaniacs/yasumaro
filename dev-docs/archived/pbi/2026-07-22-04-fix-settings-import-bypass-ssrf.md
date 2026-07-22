# PBI: 設定インポート署名検証バイパスの解消とループバックSSRFの防止

## ユーザーストーリー
拡張機能の利用者として、設定のバックアップファイルをインポートする際に、署名検証に失敗したファイルが「続行しますか？」の確認ダイアログ経由で無条件に取り込まれることがなく、また自分のObsidian APIキーや閲覧履歴が意図しない外部ホストへ送信されないことを望む。なぜなら、攻撃者が細工した設定ファイルを開かせるだけで、自分の資格情報を盗まれたり、拡張機能が意図しないローカルポートへリクエストを送る踏み台にされたりするのは重大な被害につながるためである。

## ビジネス価値
- **セキュリティ**: VulnHunter監査で確認されたHigh severity（VULN-009: 署名バイパス→SSRF+資格情報窃取）を含む3件を解消する
- **信頼境界の一貫性**: 「HMAC署名で保護されている」という設定エクスポート/インポート機能の設計上の約束を、実装のバグ（`confirm()`による強制続行）で裏切らないようにする

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-010 | CWE-347/306 | Medium | `src/utils/settingsExportImport.ts` の `importEncryptedSettings()`（178-195行目）が、HMAC不一致時に `confirm()` ダイアログで「強制インポート」を許し、以降のフィールド検証は形状チェックのみ | `poc/VULN-010_encrypted_settings_import_bypass.md` | `exploit_tests/test_vuln_010_encrypted_settings_import_bypass.test.ts` |
| VULN-009 | CWE-347 | **High** | 同ファイルの `importSettings()`（402-419行目）が同じバイパスパターンを持ち、`apiKeyExcluded: true` を悪用することで攻撃者が知らないはずの利用者の実APIキーを自動マージさせ、`obsidian_host`等を攻撃者ホストへ差し替えられる。`ObsidianClient`が`skipCspValidation:true, allowedUrls:null`でCSP/allowlistを無効化しているため、資格情報が攻撃者サーバーへ送信される | `poc/VULN-009_settings_import_signature_bypass_ssrf_exfil.md` | `exploit_tests/test_vuln_009_settings_import_bypass.test.ts` |
| VULN-013 | CWE-918/346 | Medium | `src/utils/cspValidator.ts:252-253` と `src/utils/fetch.ts:297-309` の両方が、127.0.0.1のポートを一切区別せず全て信頼し、かつIPv4正規表現が非アンカーのため `127.attacker.example` のようなホスト名も通過しうる | `poc/VULN-013_loopback_any_port_ssrf.md` | `exploit_tests/test_vuln_013_loopback_any_port_ssrf.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: 署名不一致の設定ファイルは確認ダイアログを経ても取り込まれない（VULN-009/010）
  Given 攻撃者が正しいHMAC秘密鍵を知らずに偽の signature フィールドを持つ設定エクスポートJSONを作成した
  And そのJSONの settings に obsidian_host が攻撃者制御のホストへ差し替えられている
  When 利用者がこのファイルをダッシュボード/ポップアップの「設定インポート」機能で読み込む
  Then HMAC検証が失敗した時点で、確認ダイアログの選択にかかわらずインポートは無条件で拒否される（return null と同等の結果）
  And 利用者の既存の obsidian_host / obsidian_api_key は変更されない

Scenario: APIキー除外フラグを悪用した資格情報の自動マージが発生しない（VULN-009）
  Given 攻撃者が apiKeyExcluded: true を指定した不正インポートファイルを作成した
  When 署名検証バイパスが修正された状態でこのファイルがインポートされようとする
  Then 前段の署名検証拒否により、mergeWithExistingApiKeys() が呼ばれる前に処理が停止する
  And 利用者の実APIキーが攻撃者制御のホストへ送信される経路が存在しない

Scenario: ループバックの信頼はhost_permissionsが定める特定ポートのみに限定される（VULN-013）
  Given AIプロバイダのbase URLが "http://127.0.0.1:9999/v1"（host_permissionsが宣言する4ポート: 27123, 27124, 11434, 1234 のいずれでもない）に設定されている
  When 拡張機能がこのURLへリクエストを送信しようとする
  Then CSPValidator.isUrlAllowed() および isLocalhostAddress() の両方がこのポートを信頼済みと判定しない
  And リクエストは許可された4ポート以外のループバック宛では拒否される

Scenario: 正当な設定インポート・正当なローカルAIプロバイダ接続は引き続き成功する（回帰防止）
  Given 利用者が自分自身でエクスポートした正しい署名の設定ファイルをインポートする
  Or 利用者が host_permissions に含まれるポート（例: 11434, Ollama用）でローカルAIプロバイダに接続する
  When それぞれの操作を実行する
  Then インポート・接続のどちらも正常に成功する
```

## 受け入れ基準
- [ ] `importSettings()`（`settingsExportImport.ts:402-419`）で、署名不一致時に `confirm()` を呼ばず無条件で `return null` する（「signatureが無い場合」と同じ扱いに統一）
- [ ] `importEncryptedSettings()`（同ファイル178-195行目）でも同様に、`confirm()` による強制続行分岐を削除する
- [ ] （defense-in-depth・推奨）`validateExportData()` に `obsidian_host`/`obsidian_protocol`/`obsidian_port`/`*_base_url` 等セキュリティ上重要なフィールドの値検証（形状チェックだけでなく妥当性チェック）を追加する
- [ ] `src/background/obsidianClient.ts` の外部fetch呼び出しが `skipCspValidation:true, allowedUrls:null` を渡さないよう変更する（`OpenAIProvider.ts`のパターンに合わせる）
- [ ] `src/utils/cspValidator.ts` の `isUrlAllowed()` が、127.0.0.1系ホストに対してポート番号を `host_permissions` が宣言する4ポート（27123, 27124, 11434, 1234）のallowlistでチェックする
- [ ] `src/utils/fetch.ts` の `isLocalhostAddress()` が同様のポートチェックを持ち、かつIPv4判定の正規表現が完全アンカー化（`^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$`相当）される
- [ ] **5 Whys対策**: `obsidianClient.ts` の `skipCspValidation: true, allowedUrls: null` は削除せず、`allowedUrls` に明示的なlocalhost allowlistを渡す形に変更する（WSL2/LAN サポートを維持）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意）Playwrightで偽署名の設定ファイルをダッシュボードからインポート → 設定が変更されないことを確認するシナリオ

### 統合テスト
- [ ] `settingsExportImport.ts` の `importSettings`/`importEncryptedSettings` を通した統合テストで、HMAC不一致時に設定が一切変更されないことを確認
- [ ] `cspValidator.ts`/`fetch.ts` を通した統合テストで、許可4ポート以外へのループバックリクエストが拒否されることを確認

### 単体テスト
- [ ] `src/utils/__tests__/settingsExportImport.test.ts`（既存があれば追記、無ければ新規）に、VULN-009/010のPoCペイロードに基づく署名バイパス防止テストを追加
- [ ] `src/utils/__tests__/cspValidator.test.ts` / `fetch.test.ts` に、ポート境界値テスト（許可ポート・非許可ポート・`127.attacker.example`ホスト名）を追加

## 実装アプローチ
- **Outside-In**: `importEncryptedSettings`（VULN-010）→ `importSettings`（VULN-009、同じ修正パターンを2つ目の関数に適用）→ `cspValidator`/`fetch`（VULN-013、独立した修正）の順
- **Red-Green-Refactor**: VULN-009とVULN-010は同一の修正パターン（`confirm()`分岐の削除）だが、コードパスが異なる別関数のため、それぞれ個別のテスト・コミットとして扱う

## 見積もり
5pt（3ファイル、うち2件は同一パターンの適用だが、defense-in-depth項目（`validateExportData`拡張、`obsidianClient.ts`のCSP整合）を含めると中規模）

## 技術的考慮事項
- HMAC秘密鍵のローテーションという正当なユースケース（ドキュメント化されたシナリオ）を `confirm()` バイパスで支えている場合、今回の修正でそのユースケースがサポートされなくなる。ローテーションが必要な場合は「現在のデバイス/インスタンスから再エクスポートする」または明示的な「このデバイスの新しい秘密鍵を信頼する」という別の復旧フローの検討が必要（本PBIのスコープ外、要別途議論）
- VULN-013の修正はWSL2/LANのObsidianインスタンスサポートという既存の設計意図（`_validateHost()`のコメント参照）を壊さないよう、ループバック自体の許可は維持しつつポート範囲のみ絞る

## 実装者向け注記

### graphify依存関係分析（2026-07-22）
```
ObsidianClient [community=36] → fetch.ts [community=125]
fetchWithTimeout → skipCspValidation: true, allowedUrls: null（本PBIの核心）
OpenAIProvider.ts → 同様の allowedUrls 検証パターン（リファレンス実装）
cspValidator.ts [community=10] → isLocalhostAddress() の検証不足
```
**重要な発見**: 
- `ObsidianClient` と `OpenAIProvider` は同じ `fetchWithTimeout` ラッパーを使用。`OpenAIProvider` は `allowedUrls` を適切に検証しているが、`ObsidianClient` は `skipCspValidation: true, allowedUrls: null` でバイパスしている。VULN-009 の核心はこの検証漏れ。
- 「Security Architecture (CSP + API Keys + Notifications + Permissions)」ハイパーエッジが検出。CSPレイヤーの設計意図を尊重しつつ修正する必要がある。

### なぜなぜ分析（2026-07-22）
**仮定**: 「`skipCspValidation: true` は Obsidian の WSL2/LAN サポートに必要」
- Why 1: なぜスキップが必要か → Obsidian が localhost の自己署名証明書で動作するため
- Why 2: なぜ証明書が問題か → Chrome 拡張の CSP が self-signed を許可しないため
- Why 3: なぜ CSP が厳しいか → 拡張機能のセキュリティモデルが「許可リスト方式」を採用しているため
- Why 4: なぜ許可リスト方式か → Manifest V3 の host_permissions が静的に宣言されるため、動的なローカルホスト検証が難しい
- Why 5: なぜ動的検証が難しいか → 設計当初「localhost は安全」という単純化がされ、ポート境界の検証が後回しにされたため
- **根本原因**: ローカルホストの信任範囲を「host:port レベル」で検証する設計が初期段階で行われなかった
- **対策**: VULN-013 の修正でポートallowlistを追加し、`skipCspValidation` は削除せず `allowedUrls` でlocalhostを明示的に許可する形に変更

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下が該当することを確認済み）
```bash
grep -n "forceImport\|hmacVerificationFailedConfirm" src/utils/settingsExportImport.ts
grep -n "127.0.0.1\|isLocalhostAddress" src/utils/cspValidator.ts src/utils/fetch.ts
grep -n "skipCspValidation\|allowedUrls" src/background/obsidianClient.ts src/background/ai/providers/OpenAIProvider.ts
```

### 実装手順
1. `settingsExportImport.ts:178-195`（`importEncryptedSettings`）と `:402-419`（`importSettings`）の両方で、`confirm(...)` 呼び出しとその後の続行分岐を削除し、シグネチャ不一致を「シグネチャ無し」と同じ `return null` 経路に統合する
2. `validateExportData()` に、`obsidian_host` 等のフィールドに対する値レベルの検証（例: 既知の危険な値のブロック、形式チェック）を追加する
3. `obsidianClient.ts` の fetch呼び出しから `skipCspValidation: true, allowedUrls: null` を削除し、`OpenAIProvider.ts` と同様に `allowedUrls` を渡す
4. `cspValidator.ts` と `fetch.ts` に、`host_permissions` の4ポートを定数として共有し、両方の検証関数から参照するポートallowlistを追加する。IPv4正規表現を `^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$` のように完全アンカー化する

### 落とし穴
- `confirm()`分岐を削除する際、「HMAC秘密鍵が無い（初回起動等）」ケースと「HMAC不一致（改竄またはローテーション）」ケースを混同しないこと。前者は別の正当な経路である可能性がある
- ポートallowlistを`cspValidator.ts`と`fetch.ts`の2箇所に別々にハードコードすると再度ドリフトする。共通定数化すること
- `obsidianClient.ts`の`skipCspValidation`除去は、WSL2環境等で正当に使われている場合に接続を壊す可能性がある。変更後は手動でのObsidian接続テストを推奨

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `exploit_tests/test_vuln_009_settings_import_bypass.test.ts`, `test_vuln_010_encrypted_settings_import_bypass.test.ts`, `test_vuln_013_loopback_any_port_ssrf.test.ts` の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する

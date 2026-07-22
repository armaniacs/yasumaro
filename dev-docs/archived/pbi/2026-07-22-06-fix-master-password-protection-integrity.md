# PBI: マスターパスワード保護の完全性（無認証での解除・失効漏れ・KDF強度）の修正

## ユーザーストーリー
拡張機能の利用者として、一度マスターパスワードで保護を有効にした暗号化データが、パスワードを知らない第三者によって黙って無効化されたり、自動ロック後も裏側で有効な鍵が残り続けたり、盗まれたハッシュに対するオフライン総当たり攻撃が実用的なコストで成功したりしないことを望む。なぜなら、マスターパスワード機能はAPIキー等の機密情報を守るための最終防衛線であり、その防衛線自体に「保護を外すのに認証不要」「ロックしたつもりが実は鍵が生きている」「パスワードのハッシュ化強度が古い基準のまま」という3種類の穴が同時に存在するのは看過できないためである。

## ビジネス価値
- **セキュリティ**: マスターパスワード機能という「機密情報保護の根幹」に対する信頼を、実装の一貫性（保護解除にも保護設定と同じ認証を要求する）と鍵ライフサイクルの正確性（ロック状態とキャッシュされた復号鍵の同期）で担保する
- **将来性**: 既にコードベースに存在するより強力なKDFパラメータ（`ENVELOPE_ITERATIONS`）をマスターパスワード経路にも適用し、車輪の再発明をせずセキュリティ基準を統一する

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-015 | CWE-306 | Medium | `src/dashboard/masterPassword.ts:199-211` の「マスターパスワード無効化」チェックボックスのOFF操作が、`showPasswordAuthModal`を一切呼ばず `chrome.storage.local.remove()` を無条件実行する。同ファイル内の「パスワード変更」分岐やポップアップ側の対応する実装は正しく認証を要求している | `poc/VULN-015_master_password_disable_no_auth.md` | `exploit_tests/test_vuln_015_master_password_disable_no_auth.test.ts` |
| VULN-017 | CWE-613 | Medium | `src/utils/storage/encryptionSession.ts:87-90` の `getOrCreateEncryptionKey()` がキャッシュヒット時に `IS_LOCKED` を再チェックしない。かつ `src/background/sessionAlarmsManager.ts:125-136` のロック通知がfire-and-forgetで送達失敗を無視するため、自動ロック後も復号鍵がメモリ上で使用可能なまま残りうる | `poc/VULN-017_stale_encryption_key_cache_vs_lock.md` | `exploit_tests/test_vuln_017_stale_encryption_key_cache.test.ts` |
| VULN-019 | CWE-916 | Low | `src/utils/crypto.ts:13` の `PBKDF2_ITERATIONS = 100000` が人間の選ぶマスターパスワードの導出/検証に使われている一方、同ファイル516行目には未使用のより強力な `ENVELOPE_ITERATIONS = 600_000` が既に存在する | `poc/VULN-019_pbkdf2_insufficient_iterations.md` | `exploit_tests/test_vuln_019_pbkdf2_insufficient_iterations.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: マスターパスワード保護の無効化には現在のパスワードによる再認証が必須（VULN-015）
  Given 利用者がマスターパスワード保護を有効にしている
  And 何らかの経路（共有端末での操作、または拡張機能ページ内で実行されるスクリプト）でダッシュボードの「マスターパスワードを有効にする」チェックボックスがOFFにされようとしている
  When このOFF操作が実行される
  Then パスワード認証モーダルが表示され、正しい現在のマスターパスワードが入力されるまで保護は解除されない
  And 誤ったパスワードでは保護は解除されない（PBI E で導入した試行回数制限も適用される）

Scenario: 自動ロック後はキャッシュされた復号鍵が使用不可能になる（VULN-017）
  Given 利用者のセッションが自動ロックのタイムアウトに達した
  And ロック通知メッセージの送達が何らかの理由（メッセージング層の一時的な問題等）で失敗した
  When ロック後に getOrCreateEncryptionKey() が呼ばれる
  Then メモリにキャッシュされた鍵が存在していても、IS_LOCKED状態が確認され、ロック中であれば鍵は返却されない

Scenario: マスターパスワードのハッシュ化強度が最新基準を満たす（VULN-019）
  Given 利用者が新しいマスターパスワードを設定する、またはアンロック時にパスワードを検証する
  When PBKDF2による鍵導出/検証が実行される
  Then 反復回数が ENVELOPE_ITERATIONS（600,000）またはそれ以上で実行される
  And 既存の100,000回で保存されたハッシュを持つ利用者は、次回の正常なアンロック時に透過的に新しい反復回数で再ハッシュされる（マイグレーション）

Scenario: 正しいパスワードでの通常操作は引き続き成功する（回帰防止）
  Given 利用者が正しいマスターパスワードを知っている
  When マスターパスワードの無効化・変更・アンロックのいずれかを実行する
  Then 反復回数の変更やロック状態チェックの追加によって処理時間が体感できるほど悪化せず、操作は正常に成功する
```

## 受け入れ基準
- [ ] `src/dashboard/masterPassword.ts` の「無効化」分岐（`isChecked === false`）が、`showPasswordAuthModal('export', async () => { ... })` 等、同ファイルの「パスワード変更」分岐と同じ認証ゲートを通ってから `chrome.storage.local.remove()` を実行する
- [ ] `src/utils/storage/encryptionSession.ts` の `getOrCreateEncryptionKey()` のキャッシュヒット分岐（`if (cachedEncryptionKey) return cachedEncryptionKey;`）が、返却前に `IS_LOCKED` フラグを確認し、ロック中であればキャッシュをクリアして鍵を返さない
- [ ] `src/background/sessionAlarmsManager.ts` のロック通知が、送達失敗時にリトライするか、同期的にロック状態を確定させる仕組みに変更される（fire-and-forgetの `.catch(() => {})` のみで終わらせない）
- [ ] `src/utils/crypto.ts` のマスターパスワード導出/検証経路（`deriveKeyFromPassword`, `hashPasswordWithPBKDF2`, `verifyPasswordWithPBKDF2` 等）が `PBKDF2_ITERATIONS`（100,000）ではなく `ENVELOPE_ITERATIONS`（600,000）を使用する
- [ ] 既存の100,000回で保存されたハッシュに対して、バージョンタグ付き移行（保存済み反復回数フィールドの導入、または次回成功アンロック時の再ハッシュ）が実装され、既存利用者がロックアウトされない
- [ ] **5 Whys対策**: 移行テストが「旧100Kハッシュでアンロック成功 → 新600Kハッシュで再保存」の完全フローをカバーしていること。レガシーフォールバック検証のテストが単体テストに含まれる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意）Playwrightでマスターパスワード無効化チェックボックスをOFFにし、認証モーダルが表示されることを確認

### 統合テスト
- [ ] `src/dashboard/__tests__/masterPassword.test.ts`（既存、324-343行目付近に「認証なしでキー削除」を検証する既存テストがあるため要確認・更新）に、無効化操作が認証を要求することを確認する統合テストを追加
- [ ] `encryptionSession.ts` の自動ロック→鍵アクセス試行の統合テスト（VULN-017）

### 単体テスト
- [ ] `getOrCreateEncryptionKey()` のキャッシュヒット時のIS_LOCKEDチェックの単体テスト
- [ ] `crypto.ts` のPBKDF2反復回数を検証する単体テスト（`PBKDF2_ITERATIONS`使用箇所が無くなっていることの確認を含む）
- [ ] 既存100,000回ハッシュからの移行ロジックの単体テスト（旧ハッシュでもアンロックでき、かつ以降は新反復回数で保存される）

## 実装アプローチ
- **Outside-In**: VULN-015（UI層の認証ゲート追加）→ VULN-017（鍵ライフサイクル）→ VULN-019（KDF強度・独立した変更）の順
- **Red-Green-Refactor**: 各VULNは異なる関心事（認可・セッション管理・暗号強度）のため、個別にRED→GREENサイクルを回す
- **重要**: `src/dashboard/__tests__/masterPassword.test.ts:324-343`付近の既存テストが「認証なしでの削除」を正常系として検証している場合、これは脆弱な挙動をテストでロックしている状態（REQ-GRA-018相当）。修正時に `# Updated for VULN-015` 等のコメント付きで意図的に更新すること

## 見積もり
6pt（3件それぞれが異なるサブシステム — UI認可・セッション/鍵管理・暗号パラメータ — にまたがり、特にVULN-019は既存ハッシュのマイグレーション設計が必要なため中〜大規模）

## 技術的考慮事項
- VULN-019のマイグレーションは、保存されたハッシュに反復回数を記録するフィールドが無い場合、「常に600,000回で検証を試み、失敗したら100,000回でフォールバック検証し、成功したら600,000回で再保存」という透過的移行が実装しやすい
- VULN-017の修正でIS_LOCKEDチェックを毎回行うようにすると、`chrome.storage.local.get`の追加呼び出しが発生する。頻繁に呼ばれる関数であればパフォーマンスへの影響を確認する

## 実装者向け注記

### graphify依存関係分析（2026-07-22）
```
crypto.ts [L124] → deriveKey()
    ↳ encryptionSession.ts [L47] → deriveKeyFromPassword()
        ↳ unlockWithPassword() [L236]
        ↳ setMasterPassword() [L191]

crypto.ts [L319] → hashPasswordWithPBKDF2() ← masterPassword.ts [verifyMasterPassword]
crypto.ts [L13] → PBKDF2_ITERATIONS = 100,000
crypto.ts [L516] → ENVELOPE_ITERATIONS = 600,000（未使用）

encryptionSession.ts [L87] → getOrCreateEncryptionKey() ← キャッシュヒット時にIS_LOCKED未確認
masterPassword.ts [dashboard] [community=48]
masterPasswordUi.ts [popup] [community=38]
```
**重要な発見**: 
- `deriveKey()` と `hashPasswordWithPBKDF2()` は `crypto.ts` 内の別関数。`deriveKeyFromPassword()` は storage から iteration を読み込む単一の入り口。
- `ENVELOPE_ITERATIONS = 600,000` が既に `crypto.ts` に存在するが、マスターパスワード経路では未使用。`PBKDF2_ITERATIONS = 100,000` が使われている。
- `getOrCreateEncryptionKey()` は `IS_LOCKED` を確認せずにキャッシュを返却する — VULN-017 の核心的欠陥。

### なぜなぜ分析（2026-07-22）
**仮定**: 「`PBKDF2_ITERATIONS = 100,000` を `ENVELOPE_ITERATIONS = 600,000` に上げるだけで移行は完了する」
- Why 1: なぜ移行が必要か → 既存ユーザーが 100,000 回で保存したハッシュでログインしているため
- Why 2: なぜ既存ハッシュが問題か → 600,000 回で検証すると既存ハッシュは常に失敗するため
- Why 3: なぜフォールバック検証が必要か → 既存ユーザーをロックアウトせずに新規ハッシュに移行するため
- Why 4: なぜロックアウトが問題か → ユーザーがマスターパスワードを忘れた場合の復旧フローが複雑になるため
- Why 5: なぜ複雑な復旧フローが問題か → サポートコスト増加とユーザー信頼低下に直結するため
- **根本原因**: 暗号パラメータの変更が「透過的移行」を要求するが、その移行ロジックの設計がPBIに含まれていない
- **対策**: 受け入れ基準に「既存 100K ハッシュからの移行テスト」を明記し、レガシーフォールバック検証の実装を必須とする

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下が該当することを確認済み）
```bash
grep -n "isChecked\|masterPasswordEnabled.addEventListener\|storage.local.remove" src/dashboard/masterPassword.ts
grep -n "cachedEncryptionKey\|getOrCreateEncryptionKey" src/utils/storage/encryptionSession.ts
grep -n "PBKDF2_ITERATIONS\s*=\|ENVELOPE_ITERATIONS\s*=" src/utils/crypto.ts
grep -rn "should remove storage keys" src/dashboard/__tests__/masterPassword.test.ts
```

### 実装手順
1. `masterPassword.ts:201-211`の`change`イベントリスナー内、`isChecked === false`分岐を`showPasswordAuthModal('export', async () => { await chrome.storage.local.remove([...]); ... })`でラップする
2. `encryptionSession.ts:87-90`の`if (cachedEncryptionKey) return cachedEncryptionKey;`の前に`chrome.storage.local.get(StorageKeys.IS_LOCKED)`を確認するロジックを追加。ロック中なら`cachedEncryptionKey = null`にしてから処理を続行する
3. `sessionAlarmsManager.ts:130-132`の`.catch(() => {})`を、リトライロジックまたは同一コンテキストでの同期的ロック処理に置き換える
4. `crypto.ts`のマスターパスワード関連呼び出し箇所（`encryptionSession.ts:44-72`等）で、`PBKDF2_ITERATIONS`を`ENVELOPE_ITERATIONS`に切り替える。既存ハッシュとの互換性のため、反復回数をハッシュと一緒に保存するフィールドを追加するか、フォールバック検証ロジックを実装する

### 落とし穴
- `masterPassword.test.ts`の既存テスト「should remove storage keys ... when checkbox is unchecked」は、修正後は「認証モーダルを経てから削除される」という新しい正常系に書き換える必要がある。単純に削除せず、`# Updated for VULN-015`とコメントして意図を残すこと
- IS_LOCKEDチェックを`getOrCreateEncryptionKey()`に追加する際、ロック機構自体（`sessionAlarmsManager.ts`）とのタイミング競合（ロック処理中に読み取りが割り込む等）に注意する
- PBKDF2反復回数の変更は、既存利用者の次回アンロック時のみ発生する処理時間増加（600,000回は100,000回の約6倍）を許容範囲内に収める必要がある。UIに一時的なローディング表示を追加することも検討

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `exploit_tests/test_vuln_015_master_password_disable_no_auth.test.ts`, `test_vuln_017_stale_encryption_key_cache.test.ts`, `test_vuln_019_pbkdf2_insufficient_iterations.test.ts` の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] 既存の `masterPassword.test.ts` の該当テストが新しい正常系（認証必須）に更新されている
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する

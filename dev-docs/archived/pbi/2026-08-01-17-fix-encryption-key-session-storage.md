# PBI: マスターパスワード未設定時の暗号化キーをsession storageへ移行する

**作成日**: 2026-08-01
**優先度**: 次のメジャーリリース後に実装かしないかを決定する。
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（暗号化キーの保存先変更。ブラウザ再起動時にAPIキー再入力またはマスターパスワード再入力が必要になるユーザー体験変更を伴う）

**実装計画**: 本PBIは規模が大きいため、着手前に `dev-docs/plans/` への実装計画分割を推奨する（Task→Step分解）

---

## 背景

Checking Team レビュー（`plans/2026-08-01-1903-review-yasumaro.md`）の Blue Team からの High指摘「マスターパスワード未設定時のAPIキー暗号化が実質『難読化』」。事実確認の結果、**技術的事実（平文保存、復号可能性）は正確**だが、**「ドキュメントとの乖離」という主張は誤り**と判明した。

### 事実確認で判明したこと

- マスターパスワード未設定時、`ENCRYPTION_SECRET` / `ENCRYPTION_SALT` が暗号化されず `chrome.storage.local` に平文保存される（`src/utils/storage/encryptionSession.ts:151-154`）。
- 鍵導出（PBKDF2→AES-GCM、`deriveKey()`）は `src/utils/crypto/index.ts:118-149` に実在し、`encryptionSession.ts:164` から呼ばれる。ストレージを読める主体はこれを再現して復号可能。
- マスターパスワード機能自体は実在する（`encryptionSession.ts:93-166`）。設定すればパスワードはメモリキャッシュのみで永続化されず、この問題は解消する。**本問題はマスターパスワード「未設定」というデフォルト構成に限定される。**
- **重要**: `docs/PRIVACY.md` / `public/PRIVACY.md`（両ファイル内容一致、126行付近）に、この限界（マスターパスワード未設定時は鍵自体が平文保存され「外部からの読み取り防止」の意味しか持たない旨）が**既に開発者自身によって明記・開示済み**。レビューの「暗号化保存という主張と実態が乖離している」という結論は誤り。

とはいえ、開示済みであっても**デフォルト構成での保護レベルが低い**こと自体は実在するリスクであり、改善の価値はある。本PBIはこの改善をスコープとする。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "ENCRYPTION_SECRET\|ENCRYPTION_SALT" src/utils/storage/encryptionSession.ts src/utils/storage/types.ts
grep -n "deriveKey" src/utils/crypto/index.ts
grep -n "chrome.storage.session" src/utils/storage/*.ts src/background/*.ts
grep -n "マスターパスワード未設定" docs/PRIVACY.md public/PRIVACY.md
```

`chrome.storage.session` が既にプロジェクト内で使われている箇所（`SessionStore`等）があるか確認し、既存パターンを流用できるか判断してから着手する。PRIVACY.mdの現行記述内容を確認し、変更後にドキュメント更新が必要かどうかも合わせて確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: マスターパスワード未設定時、暗号化キーがsession storageに保持される
  Given マスターパスワードが未設定の状態でAPIキーを保存する
  When 暗号化処理が実行される
  Then 非抽出のCryptoKeyがchrome.storage.sessionにのみ保持され、chrome.storage.localには保存されない

Scenario: ブラウザ再起動後は暗号化キーが再生成される
  Given マスターパスワード未設定でAPIキーが暗号化保存されている状態でブラウザを再起動する
  When 拡張機能が再起動後に初めてAPIキーへアクセスしようとする
  Then chrome.storage.sessionのキーは失われており、ユーザーに再設定（またはマスターパスワード設定）を促すフローが表示される

Scenario: マスターパスワード設定時は従来通り動作する
  Given マスターパスワードが設定されている状態
  When APIキーの暗号化・復号が行われる
  Then 従来通りパスワード由来の鍵導出でメモリキャッシュのみを使い、ストレージへの鍵保存は発生しない（回帰なし）

Scenario: 既存の暗号化関連テストが回帰しない
  Given 変更後のencryptionSession/crypto実装
  When 既存の暗号化関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] マスターパスワード未設定時の暗号化キー（`ENCRYPTION_SECRET`/`ENCRYPTION_SALT`由来の導出鍵、または非抽出`CryptoKey`）を `chrome.storage.local` ではなく `chrome.storage.session` にのみ保持する
- [ ] ブラウザ/Service Worker再起動時にsession storageの内容が失われることを前提に、ユーザーへの再設定導線（通知・UI）を用意する
- [ ] マスターパスワード設定時の既存フロー（メモリキャッシュのみ、永続化なし）は変更しない
- [ ] `docs/PRIVACY.md` / `public/PRIVACY.md` の該当記述を新しい挙動に合わせて更新する（両ファイル同期必須）
- [ ] 既存の暗号化関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- マスターパスワード未設定でAPIキーを保存 → 拡張機能を再読み込み（Service Worker再起動相当）→ APIキーへのアクセス時に再設定導線が表示されることを手動確認（Chrome実機必須、AGENTS.mdの制約による）

### 統合テスト
- 暗号化→保存→取得のフルフローで、鍵が `chrome.storage.local` に一切書き込まれないことを確認
- マスターパスワード設定時のフローが回帰しないことを確認

### 単体テスト
- `deriveKey()` / `encryptionSession.ts` の鍵保存先が `chrome.storage.session` であることをモックで確認
- `chrome.storage.local` への書き込み呼び出しに `ENCRYPTION_SECRET`/`ENCRYPTION_SALT` が含まれないことを確認

## 実装アプローチ
- **Outside-In**: 統合テスト（鍵がlocalに保存されないこと）から開始し失敗を確認 → 単体テスト（session storage利用）→ 実装
- **Red-Green-Refactor**: 各レイヤーでTDDサイクルを適用
- 既存の `chrome.storage.session` 利用パターン（`SessionStore`等、プロジェクト内に既存実装があれば）を可能な限り再利用する

## 見積もり

3pt以上（暗号化キー保存先の変更 + 再起動時のユーザー導線設計・実装 + PRIVACY.md更新 + 回帰テスト。UXへの影響が大きいため慎重な検証が必要）

## 技術的考慮事項
- 依存関係: `src/utils/storage/encryptionSession.ts:138-165`, `src/utils/crypto/index.ts:118-149`, `src/utils/storage/types.ts:75-76`
- テスタビリティ: `chrome.storage.session` のモックで検証可能
- 非機能要件: セキュリティ強化とユーザー体験のトレードオフ（再起動ごとの再設定は利便性を下げる）。この設計判断はADRとして記録することを推奨
- 代替案（マスターパスワード必須化）とのどちらを採るか、または両方を選択可能にするかはプロダクト判断が必要。本PBIはsession storage方式を採用する前提で書いているが、実装着手前にプロダクトオーナーと方針を再確認すること

## 落とし穴
- Service Workerは頻繁に終了・再起動するため、`chrome.storage.session` に保存した鍵も想定より高頻度で失われる可能性がある。ユーザー体験への影響（頻繁な再設定要求）を実機で検証すること。
- 「ドキュメントとの乖離はない」ため、本PBIは緊急のドキュメント修正ではなく、セキュリティ強化の機能改善として扱う。優先度High表記は影響度の大きさによるものであり、リリース判定をブロックする緊急修正ではない点に注意。

## Definition of Done
- [ ] マスターパスワード未設定時の暗号化キーが `chrome.storage.session` にのみ保持される
- [ ] 再起動時のユーザー導線が実装されている
- [ ] PRIVACY.md（docs/public両方）が更新されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-08-01-1903-review-yasumaro.md`（Blue Team指摘、High #1）
- 対象コード: `src/utils/storage/encryptionSession.ts:138-165`, `src/utils/crypto/index.ts:118-149`, `src/utils/storage/types.ts:75-76`
- 事実確認: 技術的事実（平文保存、復号可能性）は正確。「実質難読化」という表現と「ドキュメント乖離」という結論は誇張・誤り（`docs/PRIVACY.md:126`に既に開示済み）

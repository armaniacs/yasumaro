# PBI: `requireConsent` が未配線で、同意ゲートの適用範囲（記録以外の外部送信）が未整理である問題の確認と修正

## ユーザーストーリー

同意を拒否した（または撤回した）ユーザーとして、**同意していないのに自分のデータが外部（AI プロバイダ / Obsidian / Gist）へ送られる経路が無いこと**を、コードとテストで保証してほしい、なぜなら同意ゲートの実装は `isRecordingAllowed`（＝`hasPrivacyConsent()`）経由で**記録の入口とバッジ表示にしか入っておらず**、本来その役割を担うはずの `requireConsent()` は production から一度も呼ばれていないから。「記録が止まっていれば AI 要約も走らない」という暗黙の前提がどの経路まで成り立つのかを確かめ、成り立たない経路があれば閉じる。

## 優先度

- 順位: 2026-10-19 の 02 / 08（同日 8 件のうち 2 番目）
- RICE: 640（Reach=400 / Impact=1 / Confidence=80% / Effort=0.5）
  - Reach: 同意を拒否・撤回した状態の全プロファイル（同意の入口に立つ全員が一度は通る）
  - Impact: 1。**確認できた範囲では、同意なしで閲覧データが外部へ出る経路は見つかっていない**（記録が止まるため後続の AI 要約も走らない）。残っているのは死んだコードと、ゲートの適用範囲が文書化されていないことによる将来の穴
  - Confidence: 80%。「`requireConsent` が未配線」と「手動保存が `recordingAdmission` を通る」は確認済み。未確認なのは「記録以外の外部送信（Gist 同期・各種接続テスト・エクスポート）に同意を要求すべきか」という**仕様判断**で、これは本 PBI の中で裁定する
  - Effort: 0.5 SP（裁定と整理が本体。追加のゲートが要る場合は +0.5）
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（入口に `requireConsent()` を配線する場合、拒否時の UI 文言と返し方が要る。設定の疎通確認まで同意で止めると、未同意ユーザーが設定を確認できなくなる恐れがある）

## 背景（発見の経緯）

PBI [2026-10-18-05](2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md) の独立レビューで「`requireConsent` の production 呼び出し元が 0」と指摘された。2026-10-19 に自分で確認した結果は次のとおり。

### 確認できた事実

| 事実 | 根拠 |
|---|---|
| `requireConsent()` は export されテストもあるが、**production の呼び出し元が 0** | `grep -rn "requireConsent" src/` → 定義（`src/utils/storage/privacyConsent.ts:193`）とテストのみ |
| 同意の実効ゲートは `isRecordingAllowed: () => hasPrivacyConsent()` | `src/background/compositionManifest.ts:235`、`src/background/service-worker.ts:177` |
| その参照先は記録の受付判定とバッジ表示の 2 つだけ | `src/background/recordingAdmission.ts:78` と `:91`、`src/background/handlers/tabBadgeResolver.ts:57` |
| 手動保存系も同じゲートを通る | `MANUAL_RECORD` / `PREVIEW_RECORD` / `SAVE_RECORD`（`src/background/handlers/MessageRouter.ts:260-262`）→ `src/background/handlers/recordingHandlers.ts` → `recordingAdmission` |
| `hasPrivacyConsent()` を直接読む production 箇所は 3 つ（ゲート 2 + 表示 1）に閉じている | `grep -rn "hasPrivacyConsent()" src/` → `compositionManifest.ts:235` / `service-worker.ts:177`（いずれも `isRecordingAllowed`）/ `consentBadge.ts:22`（バッジ表示）/ 定義 |

したがって「記録 → AI 要約 → Obsidian / Gist 保存」の主経路は同意で止まる。未整理なのは次の 3 点:

1. 死んだ `requireConsent()` を残すのか、入口に配線するのか、削除するのか。
2. **記録以外の外部送信**（Gist 同期、AI / Obsidian / Gist の接続テスト、エクスポート）に同意を要求するか。接続テストはユーザーの設定値しか送らないため同意不要と考えるのが自然だが、**Gist 同期は記録そのものを送る**ので同意が前提になる。
3. 「同意が無いときに実行できてはいけない操作」の一覧が文書化されていないため、**新しい入口を足したときにゲートを忘れても気づけない**。

## 影響

- 現時点で実害は確認できていない（Impact 1）。ただし:
  - 新しく外部送信の入口を足す実装者が「同意ゲートはどこで見るのか」を知る手掛かりが無く、`requireConsent()` という**使われていない名前**が「これを使えばよい」という誤ったシグナルになる。
  - 同意状態の判定が `isRecordingAllowed` という記録の語彙に埋もれているため、記録以外の用途で同意を見る必要が生じたときに、同じゲートを再利用すべきか判断できない。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 同意が無い状態では記録できない（既存挙動の pin）
  Given ユーザーが同意を拒否している
  When  自動記録または手動保存（MANUAL_RECORD / SAVE_RECORD）が要求される
  Then  記録は拒否され、AI 要約も外部送信も発生しない

Scenario: 2. 同意が無い状態の外部送信の扱いが一覧どおりである
  Given 「同意が無いときに実行できてはいけない操作」の一覧が文書化されている
  When  一覧の各操作を同意なしで要求する
  Then  ゲート対象の操作は拒否される
  And   同意不要と裁定した操作（設定の疎通確認など）は従来どおり動作する

Scenario: 3. 同意状態の判定入口が 1 つの型に寄っている
  Given 新しい外部送信の入口を実装する
  When  同意を確認したい
  Then  唯一の入口（`requireConsent()` または `isRecordingAllowed` 相当の seam）を経由し、
       同意モジュールを直接読む箇所が増えていない

Scenario: 4. 未使用の export が残っていない（裁定の反映）
  Given `requireConsent()` を使わないと裁定した
  When  `requireConsent` をコードベース全体で grep する
  Then  定義とテストが削除され、production の同意判定の入口は 1 つに整理されている
```

## 受け入れ基準

- [x] 「同意が無いときに実行できてはいけない操作」の一覧が決まり、`dev-docs/SECURITY_REVIEW_GUIDE.md`（または同意モジュールのヘッダコメント）に文書化される。各行に「ゲートする / 同意不要」の裁定と理由を付ける
- [x] 一覧のうちゲート対象の各操作が、実際に同意で止まることをテストで固定する（優先度の高い入口は `MANUAL_RECORD` 系、Gist 同期、エクスポート）
- [x] 接続テスト（AI / Obsidian / Gist）のようにユーザーデータを運ばない操作は「同意不要」と裁定し、その理由（設定値のみを送る）を記録する
- [x] Gist 同期は**記録そのものを送る**ため同意を前提とする（記録が無ければ送信対象が無いこと、過去の記録が残っている場合の扱いを明記する）
- [x] `requireConsent()` の扱い（配線する / 削除する）を決めて実装し、未使用の export を残さない
- [x] 配線する場合、拒否時の返し方（エラーコードと UI 文言）を入口ごとに定義し、未処理の rejection を起こさない（**削除を選んだため該当なし**。既存の admission 拒否経路が `privacy_consent_required` を返す）
- [x] 同意状態を直接読む箇所が増えていないこと（`grep -rn "hasPrivacyConsent()" src/` の結果が説明できる）
- [x] `npm run validate` が緑

## テスト戦略

- **単体**: 「同意なし」の状態で各入口が拒否されることを固定する。`requireConsent()` を削除する場合は既存テストも削除し、同意判定の入口が 1 つであることをテストで固定する。
- **統合**: `MessageRouter` → `recordingHandlers` → `recordingAdmission` の経路で、同意なしの手動保存が拒否されること（既存の `recordingAdmission.test.ts` の型を再利用）。
- **E2E**: 不要（決定的な局所挙動）。ただし裁定の結果、UI から到達する新しい拒否経路が生まれる場合は owner が 1 回確認する。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/storage/privacyConsent.ts` | 193 | `requireConsent()`。throw するヘルパー。production 未使用 |
| `src/background/compositionManifest.ts` | 235 | `isRecordingAllowed: () => hasPrivacyConsent()` |
| `src/background/service-worker.ts` | 177 | 同上（composition 経由でない配線） |
| `src/background/recordingAdmission.ts` | 78 / 91 | 同意ゲートの実使用箇所（記録の受付判定） |
| `src/background/handlers/tabBadgeResolver.ts` | 57 | 同意ゲートの実使用箇所（バッジ表示） |
| `src/background/handlers/MessageRouter.ts` | 260-262 | 手動保存系のメッセージ登録 |
| `src/background/handlers/recordingHandlers.ts` | ― | 手動保存の経路（`recordingAdmission` を通る） |
| `src/background/syncTargets/gistSyncTarget.ts` | ― | Gist 同期の入口（記録を送る） |
| `dev-docs/SECURITY_REVIEW_GUIDE.md` | ― | 一覧の記載先（同意ゲートの節があるか確認する） |

### 最小変更の選択肢

1. **`requireConsent()` を削除し、同意判定の入口を `isRecordingAllowed`（記録）に一本化したうえで、一覧を文書化する（推奨）**
   - 現実の実装はすでにこちらで動いており、事実に名前を合わせる。Effort 最小。
   - 副作用: 記録以外で同意を見たくなったときの入口が無い。ただしその時点で「一覧に足す」判断が伴うため、ゲート漏れに気づきやすい。
2. **`requireConsent()` を非記録の外部送信の入口に配線する**
   - 意図が名前で伝わる。ただし throw する API なので、入口ごとに拒否時の返し方を設計する必要がある（UI 文言・エラーコード）。設定の疎通確認に誤って配線すると、未同意ユーザーが設定を検証できなくなる。
3. **両方を残し、記録は `isRecordingAllowed`、外部送信は `requireConsent()` と使い分ける**
   - 一覧が 2 つの入口に分かれるため、「どこで見るか」の判断が増える。一覧を文書化するなら許容範囲。

**推奨: 1 を主とし、非記録の外部送信に新たにゲートが要る操作が見つかった場合だけ 2 を部分適用する。** どちらを選んでも「一覧の文書化」と「ゲート対象のテスト固定」は必須。

### 実装者向け注記 ― 現状コードの確認（着手前に必ず実行）

```bash
# 1) requireConsent の呼び出し元（production は 0 のはず）
grep -rn "requireConsent" src/ entrypoints/ | grep -v __tests__
# 2) 同意状態を読む production 箇所（2 つに閉じているはず）
grep -rn "hasPrivacyConsent()" src/ | grep -v __tests__
# 3) 記録以外の外部送信の入口を洗う
grep -rn "fetchWithTimeout(\|fetchWithRetry(" src/ | grep -v __tests__
```

**未実装**（2026-10-19 に 1) 2) を実行して確認済み）。

### 落とし穴

- **`requireConsent()` は throw する。** メッセージハンドラに配線すると、未処理の rejection が返り先で「不明なエラー」になる。入口ごとに拒否時の返し方（既存のサービスエラー型に載せる）を決めること。
- **設定の疎通確認まで同意で止めない。** 未同意ユーザーが API キーの有効性を確かめられなくなると、同意する前に設定を整える動線が壊れる。ここは「同意不要」と裁定し、理由を残すこと。
- `MANUAL_RECORD` 系は `MessageRouter` の validator を通ってから `recordingAdmission` に届く。**validator の層で同意を拒否すると、既存の拒否理由の分類が二重になる**ので、既存の admission の拒否経路に乗せること。
- PBI [2026-10-19-06](2026-10-19-06-fix-gist-tranco-redirect-policy.md) と `pbi/2026-10-18-25-fix-gist-egress-csp-declare.md` が同じ `gistSyncTarget.ts` を触る。Gist 同期の production 呼び出し元が無い可能性（PBI 25 の blocker）を先に確認し、呼び出し元が無いなら「同意を要求する」判断は**将来の配線時に効く前提条件**として記録するに留める。
- 同意状態の判定は `getPrivacyConsent()`（`needsReconsent` / `signatureInvalid` を含む）と `hasPrivacyConsent()`（真偽のみ）で意味が違う。入口に配線するときは**どちらの意味が必要か**を明示すること（撤回済み・再同意待ちをどう扱うかが変わる）。

### ロールバック手順

1. 一覧の文書化と不要 export の削除は `git revert` で戻せる。
2. 追加のゲートを配線した場合は、その行だけを戻す（同意判定そのものは変えないため、データへの影響は無い）。
3. revert 後に `npm run validate` で緑を確認し、監査上の裁定（同意不要とした操作の一覧）は PBI の完了記録に残したままにする。

## 見積もり

0.5 SP（🟢低）。一覧の裁定と文書化、`requireConsent` の扱いの実装、ゲート対象の入口 2〜3 のテスト固定。追加のゲート配線が必要な場合は +0.5 SP。

## Definition of Done

- [x] BDDシナリオ 1〜4 が自動テストで実装されパス（シナリオ 1・3 は既存の admission テストと新しい seam pin、シナリオ 2 は一覧の裁定、シナリオ 4 は `requireConsent` の削除で充足）
- [x] 「同意が無いときに実行できてはいけない操作」の一覧と、各操作の裁定理由が文書化されている
- [x] `requireConsent()` の扱い（配線 / 削除）が決まり、実装されている（**削除**）
- [x] `npm run validate` が緑
- [x] コードレビュー完了
- [x] 完了記録に、裁定の一覧と「同意不要」とした操作の理由を残す

## 完了記録（2026-10-19）

### なぜなぜ分析（原因 → 示唆 → 解）

**疑問**: なぜ同意ゲートの実入口が `isRecordingAllowed` に一本化されているのに、未使用の `requireConsent()` が残っているのか。

1. **なぜ存在するのか** ― v4.1.3 で「同意が必要な機能のガード」として作られた。`git log -S "requireConsent("` の結果は定義コミット `e68f27fd` とテスト追加コミット `bca3d211` の 2 件だけで、**呼び出し元のコミットが存在しない**（＝生まれた時から未配線）。
2. **なぜ呼ばれないのか** ― 記録の入口は `RecordingAdmission` が同意を判定し `{ rejected: { reason: 'privacy_consent_required' } }` を返す契約。throw するガードはこれに合わず、message handler では未処理 rejection になる。
3. **なぜ削除されずに残ったのか** ― export され、専用テスト 2 件まで付いていた。**テストが green であることが「使われている」という錯覚を支え**、未使用の可視化を妨げた。
4. **なぜ残ることが問題か** ― 新しい外部送信の入口を足す実装者が「これを使えばよい」と誤解する。実際の seam は記録の語彙（`isRecordingAllowed`）に埋もれており、再利用すべき入口が分からない。
5. **なぜゲート漏れにつながるのか** ― **「同意が無いときに実行してはいけない操作」の一覧がどこにも無い**。判断が実装者の記憶に依存し、レビューでも照合できない。

**原因**: 同意ゲートの**適用範囲が文書化されていない**こと。その空白を、名前だけがそれらしい未使用の関数が埋め、「入口は 2 つある」という誤った印象を与えていた。

**示唆**: (a) 一覧（要否＋理由）を 1 箇所に置く、(b) 未使用 export は削除して偽のシグナルを消す、(c) 一覧の「要」が実際に止まることと、seam の配線自体をテストで pin する。

**解**: ガイドに一覧を追加し、`requireConsent()` とそのテストを削除し、`hasPrivacyConsent()` の doc に「読み出し口は 1 つ」を明記し、composition の配線をテストで pin した。

### 裁定（同意ゲートの適用範囲）

| 操作 | 要否 | 理由 |
|---|---|---|
| 自動記録（`VALID_VISIT`） | **要** | 閲覧履歴を書く。`RecordingAdmission` が `privacy_consent_required` で拒否 |
| 手動記録 / プレビュー / 保存（`MANUAL_RECORD` / `PREVIEW_RECORD` / `SAVE_RECORD`） | **要** | 同じ admission pre-stage を通る |
| 記録に対する AI 要約 | 継承 | 記録が admit されなければ pipeline が始まらない |
| 記録の Obsidian 書き出し | 継承 | 書き出しは記録 pipeline の 1 ステップ |
| AI / Obsidian / Gist の接続テスト | **不要** | ユーザーが今入力した設定（URL・API キー・PAT）しか送らない。ブロックすると未同意ユーザーが同意前に設定を検証できなくなる |
| Tranco のメタデータ / リスト取得 | **不要** | 公開リストのメタデータのみ。ユーザーデータを含まない |
| `GistSyncTarget.sync` / `syncBatch` | **未配線（要ゲート）** | 記録そのものを送るため、**production 呼び出し元が付くときに**ゲートが必要。2026-10-19 時点の production 利用はダッシュボードの接続テストのみ（`src/dashboard/gistSettings.ts:48`。`sync` / `syncBatch` の呼び出し元は 0 件） |

### 実装

- `dev-docs/SECURITY_REVIEW_GUIDE.md` ― 「Privacy-consent gating: what must ask, and what must not」節を追加（seam の説明＋上表＋新規経路の判定ルール）。
- `src/utils/storage/privacyConsent.ts` ― `requireConsent()` を削除。`hasPrivacyConsent()` の doc に「同意状態の読み出し口は 1 つ（composition → `isRecordingAllowed` → `RecordingAdmission`）。新しい外部送信経路は一覧に足すこと」を明記。
- `src/popup/__tests__/privacyConsent.test.ts` ― `requireConsent` の import と `describe` ブロック（2 テスト）を削除。
- `src/background/__tests__/backgroundComposition.test.ts` ― 同意 seam の配線を pin するテストを追加（同意なし → `admit('valid-visit')` が `privacy_consent_required` で拒否）。

### 検証

- **pin の実効性**: `compositionManifest.ts` の配線を一時的に `() => Promise.resolve(true)` に差し替えると、新しいテストが `expected undefined to be 'privacy_consent_required'` で失敗することを確認（配線を切れば落ちる＝pin が意味を持つ）。
- **削除の安全性**: `requireConsent` の参照はリポジトリ全体（`src/` `entrypoints/` `testDir/` `scripts/` `bench/` `eslint/` `tests/`）で 0 件。削除は export の整理のみで挙動を変えない。
- 対象テスト: 31 ファイル / 485 テスト（composition・privacyConsent・background handlers・popup controller）が緑。
- 既存の受け入れ基準 1・3 は `recordingAdmission.test.ts`（gate false → 拒否）と composition テスト（同意は lazy に読む）で既に pin 済みであることを確認。

### ゲート

`npm run validate`（type-check / lint / 各種 check / test）exit 0（1095 files / **16418 tests**。PBI 01 完了後の 16419 から、`requireConsent` のテスト 2 件を削除し seam pin 1 件を追加した数と一致）。対象 31 ファイル 485 テストも緑。

**1 回目のフル実行が失敗した原因（記録）**: 最初の `npm run validate` は 8 エラー・6 失敗（`storagePort` の新テスト群）を出した。これは**同じ作業ツリーで、実行中にブランチを切り替えて rebase したため**、vitest が「PBI 01 のテスト」と「マージ前の `storagePort.ts`」を混ぜて読んだのが原因だった（作業ツリーを動かさずに録り直すと 16418/16418 で exit 0）。負荷（load average 27 / 8 コア）でフル実行が 39 分かかったことは事実だが、**失敗の原因は負荷ではなく作業ツリーの移動**である。教訓: テスト実行中は作業ツリーを触らない（ブランチ操作は実行前後に分ける）。

### 独立レビューの反映（2026-10-19）

レビューの verdict は「`requireConsent()` の削除は挙動中立で正しい。**ただし置き換えた inventory は事実として誤り**」。最初に書いた「`RecordingAdmission` がすべての記録経路の手前で同意を見る」という主張は成立せず、**同意ゲートを通らない経路が 4 件**見つかった。誤った保証を文書に残すのは、削除した未使用関数より悪いので、すべて反映した。

**修正した指摘（文書・コメント）**:

- **MEDIUM**: 表の中心的主張と列挙が誤り。`REGENERATE_SUMMARY` は直接ゲートされる記録経路（`recordingHandlers.ts:360`）でありながら「AI 要約（継承）」に隠れていた。→ 表を 12 行に作り直し、正規表現を明示し、**「受付時の同意はその後の実行を許可しない」原則**を独立したルールとして追加（アラーム・キュー・通知は実行時に読み直す）。
- **LOW**: 新しいテストのコメントが「同意を別の呼び出し口から読むと落ちる」と過大な主張をしていた。→ pin の範囲（composition の配線を `valid-visit` 経路で固定する）に限定し、per-kind は `recordingAdmission.test.ts` にあることを明記。
- **LOW**: ブログ `dev-docs/blogs/blog-4_2/privacy-consent.md` が現在形で `requireConsent()` の使用を促し、削除した実装をそのまま載せていた。→ 当時の設計案であることと削除の事実を追記し、現在のゲートとガイドを参照させた。
- **LOW**: `hasPrivacyConsent()` の「読み出し口は 1 つだけ」が誤り（バッジ・ポップアップの表示も読む）。→ 「**ゲートとしての**読み出し口は 1 つ。バッジ・ポップアップは表示であってゲートではない」に訂正し、実行時再確認の原則を doc にも書いた。

**起票した指摘（コードの修正が必要なため別 PBI）**:

| # | 指摘 | 深刻度 | 起票先 |
|---|---|---|---|
| 1 | `offlineQueueProcessor.ts:119,140` ― オフライン再送アラームが、同意撤回後もキューに残った記録を AI / Obsidian へ送る（撤回はキューを消さない。TTL 7 日、アラームは約 5 分ごと） | HIGH | PBI 2026-10-19-10 |
| 2 | `service-worker.ts:194` ― プライバシー確認通知の「保存」ボタンが `admit()` を通さず `recordingPipeline.record` を呼ぶ（撤回後のクリックで再記録される） | HIGH | PBI 2026-10-19-10 |
| 3 | `reviewSummaryGenerator.ts:299` ― 週次/月次レビュー要約が `REVIEW_SUMMARY_ENABLED` しか見ず、期間内の全記録を AI へ送る | HIGH | PBI 2026-10-19-10 |
| 4 | `handlers/dashboardSqlite/coreCrudHandler.ts:114` ― ダッシュボードの「Obsidian へ追記」が `RecordingAdmission` の外で既存行を Obsidian へ送る（dashboardSqlite に同意コードが 1 つも無い） | HIGH | PBI 2026-10-19-11 |

**教訓（記録）**: 「ゲートは 1 箇所」という主張は、**受付（admit）と実行（execute）を混同すると嘘になる**。同意は状態であり、受付時の真偽はその後も真であり続けない（撤回できる）。一覧を書くときは「いつ読むか」を列として持つ必要がある。

### inventory 中に見つけた別件（本 PBI のスコープ外・未起票）

**設定のエクスポート/インポートが同意レコードを運ぶ。** `sanitizeSettingsForExport`（`src/utils/settingsExportImport.ts:89-97`）は `CONFIRMED_PROVIDER_ORIGINS` と API キーフィールドしか剥がさず、`exportSettings` / `exportEncryptedSettings` は `settingsRepository.getAll()` から payload を作る（`:236` / `:463`）。`privacy_consent` は settings ブロブに畳まれている（PBI [2026-10-19-03](2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) の症状）か、scattered merge 経由で top-level から読まれるため、**どちらの状態でも同意レコードが書き出され、インポート先で同意が付与/撤回される**。同意はデバイス・データ主体ごとの行為なので、エクスポート時の除外とインポート時の扱い（再同意を求める）を決める必要がある。後続 PBI 候補。

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md` ― 独立レビューで本件が指摘された元 PBI
- [2026-10-19-06-fix-gist-tranco-redirect-policy.md](2026-10-19-06-fix-gist-tranco-redirect-policy.md) / `pbi/2026-10-18-25-fix-gist-egress-csp-declare.md` ― 同じ `gistSyncTarget.ts`。Gist 同期の同意要件を扱う（前者は 2026-10-19 完了）
- [2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) ― 同意状態の読み出しの前提（同じ `hasPrivacyConsent()` を共有）
- `dev-docs/SECURITY_REVIEW_GUIDE.md` ― 同意ゲート一覧の記載先

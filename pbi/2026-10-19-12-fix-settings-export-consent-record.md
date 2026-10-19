# PBI 2026-10-19-12: 設定のエクスポート/インポートが同意レコードを運ぶ

## ユーザーストーリー

**ユーザーとして**、設定をエクスポートして別の端末やプロファイルへインポートしたとき、**自分の同意判断がインポート先へ勝手に持ち込まれてほしくない**（同意はその端末で自分が行った行為であって、ファイルに同梱されるデータではない）。インポート先では改めて同意を求められたい。

## 優先度

| 項目 | 値 | 根拠 |
|---|---:|---|
| Reach | 125 | 設定のエクスポート/インポートを使うユーザー（移行・バックアップ目的）。年 4 回程度と推定 |
| Impact | 3 | 同意の正確性（GDPR 的な「自由な同意」）に関わる。記録の停止・再開の意味が端末をまたいで反転しうる |
| Confidence | 80% | 機構はコードで確認済み（下記「再現手順」）。実際に漏れるのは利用者がエクスポート→インポートした時だけなので 100% ではない |
| Effort | 1.0 SP | 除外 1 箇所＋インポート時の扱い 1 箇所＋テスト 2〜3 件 |
| **RICE** | **300** | 125 × 3 × 0.8 / 1.0 |

## 背景（発見の経緯）

PBI [2026-10-19-02](../dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md) の同意ゲート inventory を作る過程で発見した。同 PBI の独立レビュー（同意ゲートの穴 4 件）とは別の経路で、**エクスポートの中身**を見て気づいた。

- `sanitizeSettingsForExport`（`src/utils/settingsExportImport.ts:89-97`）が剥がすのは `CONFIRMED_PROVIDER_ORIGINS` と API キーフィールドだけ。
- `exportSettings`（同 `:463`）と `exportEncryptedSettings`（同 `:236`）は `settingsRepository.getAll()` から payload を作る。
- `getAll()` は settings ブロブが権威的ならブロブを返し、そうでなければ scattered（トップレベル）のキーをマージする。`privacy_consent` は**どちらの経路でも入りうる**: settings 移行の対象キーなので移行後はブロブに入り（症状は PBI [2026-10-19-03](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md)）、移行前・部分移行状態ではトップレベルの `StorageKeys.PRIVACY_CONSENT` として読まれる。
- 追加の増幅経路: `migrateLegacyPrivacyConsent`（`src/utils/storage/privacyConsent.ts:202-212`）は `PRIVACY_CONSENT` が無くても `PRIVACY_MODE` / `PII_CONFIRMATION_UI`（等）が存在すれば「以前プライバシー機能を使っていた」と判断して**自動で同意済みにする**。つまりエクスポートに `PRIVACY_MODE: true` が入っていれば、インポート先の新規プロファイルで同意が自動付与されうる。

## 再現手順

1. プロファイル A でプライバシーポリシーに同意する（`privacy_consent` が保存される）。
2. A で設定をエクスポートする（`exportSettings()` または `exportEncryptedSettings()`）。
3. エクスポートされた JSON を開くと、`settings.privacy_consent`（またはトップレベルの `privacy_consent`）と、環境によっては `privacy_mode` / `pii_confirmation_ui` が含まれている。
4. 別のプロファイル B（未同意）でそのファイルをインポートする。
5. B で同意モーダルが出ずに記録が始められる、または A の撤回状態が B へ持ち込まれる。
6. 逆向きも同様: A が撤回済みのファイルを B へインポートすると、B の有効な同意が撤回されうる。

## 影響

- **同意が端末をまたいで移動する**。同意はデータ主体がその端末で行う行為であり、ファイルに同梱して運べるものではない。GDPR の「自由な同意」の観点で説明が難しくなる。
- 監査上は「同意を得ずに記録が始まる経路」に見える（実体は設定ファイル経由なので、攻撃者が関与しなくても起きる）。
- PBI [2026-10-19-02](../dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md) が確立した「同意は状態であり、受付時の真偽は後も真とは限らない」と同じ族。ここでは「同意状態は端末をまたがない」を確立する。

## BDD受け入れシナリオ

### シナリオ 1: エクスポートに同意状態が入らない

```gherkin
Given プロファイル A でプライバシーポリシーに同意済みである
And A の settings ブロブに privacy_consent が畳まれている
When A が設定をエクスポートする
Then エクスポートされた payload に privacy_consent は含まれない
And privacy_consent_version / privacy_consent_denied_count / privacy_consent_last_denial_time も含まれない
And 同意とは無関係な設定（例: obsidian_host, gemini_model）は従来どおり含まれる
```

### シナリオ 2: インポートは同意を付与しない

```gherkin
Given プロファイル B は未同意である
And 同意レコードを含む旧形式の設定ファイル（privacy_consent が入っている）がある
When B がそのファイルをインポートする
Then インポート後も hasPrivacyConsent() は false である
And B では同意モーダルが表示される
And インポートで上書きされないキー（API キー等）の扱いは従来どおりである
```

### シナリオ 3: レガシー移行の自動同意をインポートで誘発しない

```gherkin
Given プロファイル B は未同意である
And エクスポート payload に privacy_mode（または pii_confirmation_ui）が含まれている
When B がそのファイルをインポートする
Then インポートを契機に migrateLegacyPrivacyConsent が同意を付与しない
And B の同意状態はインポート前のままである
```

### シナリオ 4: 撤回済みプロファイルのエクスポートも同意を運ばない

```gherkin
Given プロファイル A で同意を撤回済みである
When A が設定をエクスポートし、別プロファイル B（同意済み）がインポートする
Then B の同意状態はインポート前のままである（撤回が伝播しない）
```

## 受け入れ基準

- [ ] `sanitizeSettingsForExport`（または export 経路）が同意系キー（`privacy_consent` / `privacy_consent_version` / `privacy_consent_denied_count` / `privacy_consent_last_denial_time`）を除外する
- [ ] インポート経路が、payload に含まれる同意系キーを**無視**する（例外を投げず、黙って捨てる）
- [ ] インポート先の既存の同意状態を、ファイルの内容で上書きしない（端末の判断を保持する）
- [ ] `migrateLegacyPrivacyConsent` が、インポートで入った `privacy_mode` / `pii_confirmation_ui` を根拠に同意を付与しないことをテストで固定する
- [ ] シナリオ 1〜4 が自動テストでパス
- [ ] エクスポート内容を説明しているドキュメント（`grep -rl "エクスポート" dev-docs/` と設定画面の説明文）に、同意状態が含まれないことを追記する
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` の「Privacy-consent gating」節の関連として本件（同意状態は端末をまたがない）を参照する
- [ ] `npm run validate` が緑（エクスポート/インポートの既存テストが非退行）
- [ ] コードレビュー完了
- [ ] 完了記録に、なぜなぜ分析（原因 → 示唆 → 解）と、除外対象をどう決めたか（同意系 4 キー＋レガシー移行の根拠キーの扱い）を残す

## テスト戦略

- **単体（エクスポート）**: 同意済み・撤回済みの 2 状態で `sanitizeSettingsForExport` を通し、同意系キーが消え、無関係なキーが残ることを固定する。settings ブロブ経由と scattered 経由の両方で確認する（PBI [2026-10-19-03](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) の状態差を踏むため）。
- **単体（インポート）**: 同意レコード入りの payload を `importSettings` に渡し、`hasPrivacyConsent()` が false のままであることを固定する。`importEncryptedSettings` の側も同様に。
- **統合**: エクスポート → インポートの往復を、別プロファイル相当のストア 2 つで実行し、同意が移動しないことを固定する（`InMemoryStoragePort` を使う。PBI [2026-10-19-01](../dev-docs/archived/pbi/2026-10-19-01-fix-inmemory-port-version-key-fidelity.md) の修正で、文字列値の `privacy_consent_version` もこの double で観測できる）。
- **レガシー移行**: `migrateLegacyPrivacyConsent` の入力に、インポートで入りうるキーだけを与えて同意が付与されないことを固定する（既存テストの前提を壊さないよう、本物の移行条件は維持する）。
- Red は「現行実装でエクスポートに同意が入る」ことを先に観測してから直す。

## 実装メモ（設計判断と対象ファイル）

- 除外は `sanitizeSettingsForExport` に集約する（export 経路が 2 つあり、片方だけ直すと漏れるため）。既存の `stripDeviceLocalSecurityState` と同じ層。
- インポート側は「無視」を選ぶ（payload を reject すると、正当なバックアップが古い形式というだけで使えなくなる）。無視した事実はログに残さない（同意状態を扱うログは増やさない）。
- レガシー移行の根拠キー（`PRIVACY_MODE` / `PII_CONFIRMATION_UI`）を**エクスポートから除外するか**は設計判断。除外すると「プライバシー機能を使っていた」判定が別端末で再現しなくなるが、そもそもその判定は端末ローカルの履歴に基づくべきなので、除外が自然。除外しきれない経路（旧形式ファイル）に備えて、インポート時の防御も入れる。
- 対象ファイル: `src/utils/settingsExportImport.ts`（本体）、`src/utils/storage/privacyConsent.ts`（移行条件の確認）、`src/utils/storage/types.ts`（同意系キーの一覧）、既存テスト（`settingsExportImport*.test.ts`）。
- 注意: インポート後に「同意が消えた」ように見えるのは**正しい挙動**。UI が同意モーダルを出せることを確認する。

## 見積もり

1.0 SP（🟢低〜🟡中）。除外 1 箇所、インポート時の無視 1 箇所、レガシー移行の防御、往復テスト。ストレージキーの構造そのものは変えない（high-risk 領域に踏み込まない）。

## Definition of Done

- [ ] シナリオ 1〜4 が自動テストでパス（Red を観測してから実装）
- [ ] エクスポート payload に同意系キーが含まれないことをテストで固定
- [ ] インポートで同意が付与・撤回されないことをテストで固定
- [ ] レガシー移行の自動同意がインポートで誘発されないことをテストで固定
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] 完了記録になぜなぜ分析と除外キーの裁定を残す

## 落とし穴

- **`getAll()` の 2 経路**: ブロブ経由と scattered merge 経由の両方で同意キーが入りうる。片方だけ確認して終わらないこと（PBI [2026-10-19-03](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) が直れば前者は消えるが、後者は残る）。
- **`privacy_consent_version` は文字列（または `null`）**。`*_version` という名前で数値の版数カウンタと誤認しないこと（PBI [2026-10-19-01](../dev-docs/archived/pbi/2026-10-19-01-fix-inmemory-port-version-key-fidelity.md) の根因そのもの）。
- **暗号化エクスポート**（`exportEncryptedSettings`）も同じ `sanitizeSettingsForExport` を通るか確認する。通っていない場合は両方に適用する。
- インポートで同意を消すと、**設定の復元をしただけで同意モーダルが出る**。これは意図した挙動だが、リリースノート／ドキュメントで説明できるようにしておく。
- 同意の拒否カウンタ（`privacy_consent_denied_count`）を除外すると、インポート先で再び「拒否が続いている」判定に使える。除外が同意の再質問を妨げないことを確認する。

## 関連

- `pbi/00-INDEX.md`
- [2026-10-19-02-fix-consent-gate-wiring-coverage.md](../dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md) — 発見の現場（同意ゲートの inventory）。同 PBI の独立レビュー由来の穴は 10・11 として起票済み
- [2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) — 同意キーが settings ブロブへ畳まれる問題。本 PBI の「ブロブ経由」の前提
- [2026-10-19-10-fix-consent-recheck-scheduled-jobs.md](../dev-docs/archived/pbi/2026-10-19-10-fix-consent-recheck-scheduled-jobs.md) / [2026-10-19-11-fix-dashboard-obsidian-export-consent.md](2026-10-19-11-fix-dashboard-obsidian-export-consent.md) — 同じ「同意は状態であり、移動・遅延して使われうる」族
- `dev-docs/SECURITY_REVIEW_GUIDE.md` — 「Privacy-consent gating」節
- `pbi/2026-10-18-00-backlog-security-audit-run2.md` — 発見の記録

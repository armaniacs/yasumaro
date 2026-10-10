# PBI: i18n の未定義キー・キー流用を正し、ロケール判定を 1 系統に統一する

- 種別: fix
- RICE: 6.7（R5 × I2 × C1.0 / E1.5）
- 依存: なし（`public/_locales/*/messages.json` を触る唯一の PBI。他 PBI とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）i18n Expert Medium 2件 + UI Expert Medium 1件 + Legacy Bridge Low 1件

## ユーザーストーリー

日本語 UI のユーザーとして、per-site override のエラーや削除結果が日本語で正しく表示されてほしい。なぜなら現状は `domainRequired` キーが存在せず英語が出るうえ、削除成功時に「プロンプトを削除しました」という無関係な文言が出るから。あわせて、開発者としてロケール判定の正典が 1 つであってほしい。

## 背景（現状・証拠）

### 未定義キー参照（英語フォールバック）

- `src/dashboard/settings/perSiteOverrides.ts:148`, `:178` — `getMessageOr('domainRequired', 'Domain is required')`。
- `domainRequired` は `public/_locales/ja/messages.json` にも `public/_locales/en/messages.json` にも存在しない（両ロケール確認済み）。常に英語フォールバックが出る。
- 本ブランチの追加行で未定義キーを参照しているのはこの 1 件のみ。キー総数は ja 1566 = en 1566、プレースホルダ名不一致 0、新規 42 キーは全て使用済み。

### 無関係キーの流用（意味が反転）

- `src/dashboard/settings/perSiteOverrides.ts:184` — 削除成功時に `getMessageOr('promptDeleted', 'Deleted')`。ja の実値は「プロンプトを削除しました」（プロンプト管理用キー）。per-site override 削除時にこの文言が出る。
- `src/dashboard/settings/perSiteOverrides.ts:196` — 「入力ドメインに override が無い」場合に `noPerSiteOverrides` を再利用。ja の実値は「サイト別の上書き設定はありません。」＝**一覧全体が空**の意味。ユーザーが目の前に一覧を見ているのに「設定はありません」と言われる。
- 旧実装は `'Deleted'` / `'No override for domain'` の直書きで、少なくとも意味は正しかった。

### ロケール判定の三系統分裂

- 新規 `getUiLocale()`: `src/dashboard/settings/customPromptManager.ts:62-65` — `navigator.language.startsWith('ja') ? 'ja' : 'en'`（既定 `'en'`）。4 つの inline コピーを集約したと称しつつ**公開関数として export** されたため、以後この基準が正典化する。
- `getUserLocale()`: `src/utils/localeUtils.ts:16-27` — `chrome.i18n.getUILanguage()` 基準。`docs/i18n-guide.md:49` が正典として案内。
- `getBrowserLocale()`: `src/utils/customPromptUtils.ts:81-86` — `navigator.language` 基準・既定 `'ja'`。既定値も `getUiLocale` と逆。
- Chrome の UI 言語が日本語で `navigator.language` が `en-US` の環境では、プロンプト名・既定システムプロンプト（`customPromptUtils.ts:57`）だけ英語になり、周囲のラベルは日本語になる。

## BDD 受け入れシナリオ

```gherkin
Scenario: ドメイン未入力エラーが日本語で出る
  Given UI ロケールが ja である
  And per-site override のドメインが未入力である
  When 追加を実行する
  Then "ドメインを入力してください" が表示され、英語フォールバックは出ない

Scenario: override 削除の結果が正しい意味で表示される
  Given UI ロケールが ja である
  And あるドメインの override が存在する
  When 削除を実行する
  Then "サイト別の上書きを削除しました" が表示され、「プロンプトを削除しました」は出ない

Scenario: override 不在の説明が一覧全体の不在と混同されない
  Given UI ロケールが ja である
  And 一覧には他ドメインの override がある
  And 入力ドメインには override が無い
  When 追加を実行する
  Then 「このドメインの上書き設定はありません」が表示される

Scenario: ロケール判定が chrome.i18n 基準で一致する
  Given chrome.i18n.getUILanguage() が "ja" で navigator.language が "en-US" である
  When プロンプト名と既定システムプロンプトを生成する
  Then どちらも日本語の文言が選ばれる
```

## 受け入れ基準

- [ ] `domainRequired` を ja/en 両方に追加する（ja: 「ドメインを入力してください」/ en: "Domain is required"）
- [ ] `perSiteOverrideDeleted` と `perSiteOverrideNotFound` を ja/en 両方に新設し、`promptDeleted` / `noPerSiteOverrides` の流用をやめる
- [ ] `getUiLocale()` の実装を `getUserLocale()` / `chrome.i18n.getUILanguage()` 基準に寄せ、`startsWith('ja')` の正規化を 1 箇所に置く。既定値の不一致（`'ja'` vs `'en'`）を解消する
- [ ] プロンプト本文の言語を意図的にコンテンツ言語へ合わせたい場合は、関数名（例 `getContentLocale()`）と JSDoc で UI ロケールと分離する
- [ ] `docs/i18n-guide.md` の「ロケール判定」節に正典を 1 行追記する
- [ ] ja/en のキー数が一致し、追加キーが全てコードから参照されている（未使用キー 0）
- [ ] `getMessage*('key')` の第 1 引数が `messages.json` に存在することを検証する軽量ゲートを追加する（`scripts/` 配下、`lint:layers-docs` と同型の静的チェック。CI か `validate` に組み込む）
- [ ] `npm run validate` が green

## テスト戦略

- unit: `perSiteOverrides` の 3 経路（未入力・削除成功・override 不在）が新キーを引くこと
- unit: `getUiLocale` / `getUserLocale` / `getBrowserLocale` が同じ入力（`getUILanguage=ja`, `navigator.language=en-US`）で同じ結果を返すこと
- unit: 新ゲートのスクリプト自体のテスト（未定義キー参照を検出する / 既存コードベースでは 0 件）
- 回帰: 既存の i18n キー整合テスト（ja/en 1566=1566）が green のまま
- 手動: ja/en 両ロケールで per-site override パネルの表示確認

## 見積もり

1.5 SP（キー追加・差し替え 0.5 + ロケール統一 0.5 + ゲート 0.5）

## 技術的考慮事項

- キー追加は ja/en 同時に行う（片側だけだと逆側で英語/日本語フォールバックが出る）
- 既存キーの削除・改名はしない（後方互換の破壊になる）
- `getBrowserLocale` を消すか残すかは、プロンプト言語の意図（UI 言語かコンテンツ言語か）を決めてから。決められない場合は両方残し、名前と JSDoc で役割を分離する
- 新しい静的ゲートは既存コードで 0 件になることを確認してから CI に入れる（既存の未定義参照が他にあれば別途対応）

## 実装者向け注記

### 実装手順

1. `grep -rn "getMessageOr(\|getMessage(" src/ | grep -v messages.json` で参照キーを洗い、`domainRequired` 以外に未定義が無いことを確認
2. 失敗するテストを先に書く（ja ロケールで英語が出ることを pin する Red）
3. キー追加 → 差し替え → ロケール統一
4. 未定義キー検出ゲートを追加し、`npm run validate` に組み込む
5. `docs/i18n-guide.md` 更新 → `npm run validate`

### 落とし穴

- `messages.json` はキー名を保持して値のみ編集する。`sed` 等での一括置換は使わない
- ロケール統一でプロンプトの既定言語が変わる可能性がある。既存テストの期待値変更は「意図した統一」か個別に確認する
- テストで実時間待ちを入れない

## Definition of Done

- [ ] 3 経路の文言テストが green
- [ ] ロケール判定が 1 系統に統一され、テストで固定されている
- [ ] 未定義キー検出ゲートが `validate` に組み込まれ green
- [ ] ja/en キー数一致・未使用キー 0
- [ ] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

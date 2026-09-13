# PBI 03: popup pending pages 経路の実バグ群を修正（dead message・whitelist blob 非対応・N+1）

## ユーザーストーリー

プライベートページの記録確認に pending pages を使う利用者として、「Save selected / Save with whitelist」を選んだときに実際にページが記録され、whitelist 追加が次回から効いてほしい。なぜなら現状は①送信メッセージが未処理タイプで黙って捨てられページだけが消え、②whitelist 追加が読まれないキーに書かれるから。

## 優先度

- 順位: 03 / 9
- RICE スコア: 36.0（Reach=3 / Impact=3 / Confidence=80% / Effort=0.2 人週）
- 根拠（2026-09-11 実検証）:
  - `src/popup/pendingPages.ts:96-104` が `{type:'record', data:…}` を送るが、`src/background/handlers/MessageRouter.ts` は `'record'` を処理しない（VALID タイプ: VALID_VISIT / MANUAL_RECORD / …）。→ Save しても記録されず `:108` で pending から削除される
  - `pendingPages.ts:65-79` がトップレベル散在キー `domain_whitelist`（`StorageKeys.DOMAIN_WHITELIST`）に直接書くが、マイグレーション後の `SettingsRepository.getAll()`（`SettingsRepository.ts:129-150`）は単一 `settings` blob のみを読む → whitelist 追加は恒久的に無効（楽観ロック・検証・キャッシュ無効化も経ない）
  - `pendingPages.ts:92-94` がループ内で URL 毎に `getPendingPages()` を呼ぶ N+1 storage 読み

## BDD 受け入れシナリオ

```gherkin
Scenario: Save selected が実際に記録する
  Given popup の pending 一覧に 2 件のページがある
  When  1 件を選んで「保存」を押す
  Then  background に MANUAL_RECORD envelope が送られ recordingPipeline.record が実行される
  And   記録後そのページだけが pending 一覧から消える

Scenario: Save with whitelist が repository 経由で whitelist を更新する
  Given pending に https://example.com/page のページがある
  When  「ドメインを許可して保存」を押す
  Then  settings blob 内の domain_whitelist が SettingsRepository 経由で更新される
  And   以後 example.com は DomainFilter で許可される

Scenario: 複数選択保存で storage 読みが 1 回になる
  Given pending に 5 件のページがある
  When  全選択して保存する
  Then  getPendingPages の呼び出しはループ外 1 回のみで、5 件すべてが記録される
```

## 受け入れ基準

- [x] `saveSelectedPages` が `MANUAL_RECORD` envelope（`{type:'MANUAL_RECORD', payload:{title,url,content,force:true}}`）を送る。validator 契約（`src/messaging/validators.ts` ManualRecordValidator: title/url/content 必須・http(s) スキーム）を満たす
- [x] whitelist 追加を `SettingsRepository.set(StorageKeys.DOMAIN_WHITELIST, …)` に統合し、散在キー直書きを削除
- [x] `getPendingPages()` をループ外 1 回に
- [x] popup 関連テスト新設/更新 green（MANUAL_RECORD 送信形状・repository 呼び出し・N+1 解消）
- [x] 旧 `type:'record'` 送信がテストで pin されていないことを確認（あれば更新）

## テスト戦略

- 単体: pendingPages の送信形状を fake runtime で検証。MANUAL_RECORD validator で validate が通ること
- 単体: whitelist 追加が SettingsRepository.set を呼ぶこと（vi.spy）
- 回帰: 複数選択保存の storage 読み回数

## 見積もり

S（0.2 人週）。副作用: 🟡（MANUAL_RECORD 経路では isSecureUrl / rate limit が適用される — pending は既に https 前提で許容）。種別: fix。

## 実装アプローチ

1. `pendingPages.ts` の送信を MANUAL_RECORD envelope に修正（`content: ''` + `force: true` — 既存意図を維持。background が content fetch を行う）
2. whitelist 部分を SettingsRepository に置換（import 追加。popup から repository 利用は `statusPanel.ts` と同一パターン）
3. N+1 解消（ループ前に 1 回取得）
4. テスト更新

## 実装メモ（2026-09-11）

- 送信を `{type:'MANUAL_RECORD', payload:{title,url,content:'',force:true}}` に修正（ManualRecordValidator 契約どおり）。
- whitelist 追加を `settingsRepository.setAll` + `updateDomainFilterCache` 経由に統合（statusPanel と同一パターン）。重複エントリは skip。
- `getPendingPages` をループ外 1 回に（テスト: 3 URL 保存で 2 回 = batch + reload、旧実装は 4 回）。
- pendingPages.test.ts を新契約に更新（旧テストは壊れた挙動を pin していた）。

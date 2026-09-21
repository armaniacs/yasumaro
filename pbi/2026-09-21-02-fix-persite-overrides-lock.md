# PBI: ダッシュボード per-site overrides の二重書き込みと失敗握り潰しを解消する

## ユーザーストーリー
ダッシュボード利用者として、per-site overrides の保存と削除の結果を正しく知りたい、なぜなら保存成功と表示された内容が並行書き込みや quota 失敗で黙って失われると、どのドメインにどの上書きが効いているか信用できなくなるから

## 優先度
- 種別: fix
- 順位: 1
- RICEスコア: 19.2（Reach=4 / Impact=3 / Confidence=0.8 / Effort=0.5週）
- 根拠: 保存済み表示の直後に設定が失われるのはデータロストであり、影響は設定の信頼性全体に及ぶ。到達範囲は per-site overrides 利用者に限定されるため Reach は 4 とするが、修正は単一 writer への集約と失敗可視化に収まり Effort は 0.5週のため順位1

## ビジネス価値
per-site overrides の保存結果と実存储内容の乖離がなくなる。並行書き込みによる相互上書きと、失敗時の沈黙による設定ロストが消え、ドメイン別 cleansing 設定を安心して運用できる

## BDD受け入れシナリオ

```gherkin
Scenario: 保存書き込みが単一 writer 経由で行われる
  Given per-site overrides の保存操作を行う
  When upsert した次の配列を永続化する
  Then SettingsRepository の lock 経由の delta 書き込みのみが実行され、chrome.storage.local への直接フル値書き込みは行われない

Scenario: 保存失敗は Saved ではなくエラーとして表示される
  Given 保存書き込みが quota 等で失敗する
  When 保存ボタンを押下する
  Then Saved は表示されず、setStatus にエラー表示と構造化ログが出力される

Scenario: 削除書き込みが単一 writer 経由で行われ、失敗が可視化される
  Given 対象ドメインの override が存在する
  When 削除ボタンを押下し、書き込みが失敗する
  Then Deleted は表示されず、setStatus にエラー表示と構造化ログが出力され、直接フル値書き込みは行われない
```

## 受け入れ基準
- [ ] upsert 経路と delete 経路のどちらも `chrome.storage.local.set` の直接呼び出しを行わない
- [ ] per-site overrides の書き込みは SettingsRepository の lock 経由の単一 writer に統一される
- [ ] 空の `catch {}` が存在せず、書き込み失敗は `setStatus` のエラー表示で利用者に伝わる
- [ ] 書き込み失敗は構造化ログに出力され、沈黙によるロストが起きない
- [ ] contentKernel の即時読み取りが `DOMAIN_CLEANSING_OVERRIDES` キーを直接読む経路は維持される
- [ ] 既存の保存・削除・一覧表示の正常系動作が変わらない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(ダッシュボード単体パネルの書き込み経路修正)

### 統合テスト
- 保存経路で `chrome.storage.local.set` の直接呼び出しが発生しないこと
- 削除経路で `chrome.storage.local.set` の直接呼び出しが発生しないこと
- 書き込み失敗時にエラー表示と構造化ログが出力され、成功表示が出ないこと

### 単体テスト
- `catch {}` の廃止(失敗が握り潰されないこと)
- 成功時は `Saved` または `Deleted` が表示されること
- 失敗時は `isError=true` の表示になること

## 実装アプローチ
- **Outside-In**: 保存と削除の書き込み経路に対する失敗可視化テストを先に書き、Red で直接書き込みを除去する
- 書き込みは `saveOverrides` と SettingsRepository の lock 経由に集約し、二重書き込みを単一 writer にする
- `catch {}` を廃止し、失敗は `setStatus` のエラー表示と構造化ログに変える

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 他 PBI とは独立。SettingsRepository の delta と withLock 規律を変更しない
- 遵守すべき方針: 書き込みは repository と lock を経由する。raw の `chrome.storage.local.set` によるフル値書き込みを追加しない
- 非機能要件: contentKernel の即時読み取り経路を壊さない。読み取り側のキー直読は維持し、書き込み側のみを統一する

## 実装者向け注記

### 現状の証拠
- upsert 経路の二重書き込み: `src/dashboard/settings/perSiteOverrides.ts:176-184` — `loadOverrides` と `upsertDomainOverride` で `next` を作り `saveOverrides(next)` した後に `setStatus('Saved')` を表示し、その後で raw の `await chrome.storage.local.set({ [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: next })` を実行して `catch {}` で握り潰す
- delete 経路の二重書き込み: `src/dashboard/settings/perSiteOverrides.ts:190-199` — `saveOverrides(next)` 後に `setStatus('Deleted')` を表示し、その後で raw の `await chrome.storage.local.set({ [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: next })` を実行して `catch {}` で握り潰す
- repository 経由の正規書き込み: `src/dashboard/settings/perSiteOverrides.ts:70-76` — `saveOverrides` は `settingsRepository.setAll` による delta 書き込み
- lock 規律: `src/utils/storage/SettingsRepository.ts:199-228` — `writeSettings` が `StorageTransaction` の `withLock('settings', ...)` 経由で保存する。raw set はこの規律を迂回するロック無しフル値書き込み
- lock 無しの RMW: `src/dashboard/settings/perSiteOverrides.ts:63-68` — `loadOverrides` は `settingsRepository.getAll` の読み取りであり、`loadOverrides` から `upsert` を経て `saveOverrides` に至る RMW 自体は optimistic lock を使わない
- 失敗像: dashboard 複数タブや別フローとの並行書き込みで、raw set が lock 経由の delta 書き込みと相互に上書きする(last-writer-wins)。quota 等で raw set が throw しても利用者には既に `Saved` が表示済みで黙ってロストする

## Definition of Done
- [ ] 全BDDシナリオ実装+パス
- [ ] コードレビュー完了
- [ ] 統合検証 green(type-check・lint・test・build)

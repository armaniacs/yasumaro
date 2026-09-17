# PBI: SettingsRepository の書き込みを delta 契約にし、stale スナップショットが write lock を無効化する経路を閉じる

優先度: 順位 1 / 3（RICE: 7.0 = Reach 7 / Impact 2 / Confidence 1.0 / Effort 2 pt）
backlog: [2026-09-17-00-backlog-archloop-0917.md](2026-09-17-00-backlog-archloop-0917.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能のユーザーとして、dashboard の設定パネルと popup を同時に使っても、片方で保存した設定がもう片方の古いスナップショットで黙って元に戻ってほしくない。なぜなら、settings の書き込みが「呼び出し側が保持する full スナップショット」をそのまま書き戻す形になっており、並行する書き手の変更を上書き消去する経路が構造的に開いているから。

## 背景（現状と課題）

- `SettingsRepository.setAll()` は `withLock('settings', (fresh) => ({ ...fresh, ...toSave }))` で書き込む（`storageTransaction.ts:113-148` の CAS + version + post-write verification は正常に働く）。
- しかし `toSave` が**呼び出し側の full スナップショット**の場合、merge で full スナップショットが fresh base に勝つため、lock は「blob 単位の同時書き込み」しか防げず、**スナップショット取得時点に巻き戻す論理 lost update が残る**。
- full スナップショットを渡す書き手が実在する:
  - `src/dashboard/settings/customPromptManager.ts:316-317, 385-386, 450-451` — panel load 時の `currentSettings` を保持し、書き込み時に full blob を `setAll()` に渡す
  - `src/dashboard/markdownTemplateManager.ts:190-191, 210-214, 380-381` — 同型
  - `src/dashboard/settings/domainFilter.ts:374` — `(async (s)=>{ await setAll(s); await updateDomainFilterCache(await getAll()); })(newSettings)` で full snapshot を渡す
  - `src/popup/trancoNotification.ts:84, 106` — 同一 IIFE のコピー
- repo 内部も同じ形: `set()` が `getAll()`（repo 自身の cache を含む）の full snapshot を `toSave` に組み立てるため、cache が stale な場合に無関係キーを巻き戻し得る。
- dashboard settings 面は `getMessage(key) || 'fallback'` を含む full snapshot 保持パターンで、表示中に他 context が書いた設定（consent、whitelist、テンプレ等）が保存操作のたびに危険に晒される。
- `StorageTransaction.withLock` という深い module は既に存在し、呼び出し側が delta だけ渡せば正しく守る。seam を新設しない、interface の形だけの修正で効力を回復できる。

## BDD受け入れシナリオ

```gherkin
Scenario: stale スナップショットは lock の fresh base を壊さない
  Given ストレージに settings が保存され、ある writer がスナップショットを取得済み
  When 別の writer が key X を更新した後、最初の writer が set(KEY, value) する
  Then key X の値はスナップショット取得時の値に巻き戻らず、key KEY のみ更新される

Scenario: setAll は渡された partial だけを delta として扱う
  Given ストレージに settings が保存されている
  When 呼び出し側が 2 キーの partial で setAll する
  Then 他のキーはストレージの現行値が維持される

Scenario: full 置換が必要な import は明示的な契約で書ける
  Given 現行 format のエクスポート payload を import する
  When setAll に payload の全キーが渡される
  Then 渡されたキーは上書きされ、未収載キーは現行値のままマージされる
```

## 受け入れ基準

- [x] `set(key, value)` は delta（`{ [key]: value }`）のみを write 経路に渡し、`getAll()` の結果を payload に展開しない
- [x] `setAll(partial)` は partial を delta として扱う契約を JSDoc に明記する
- [x] full スナップショット書き込み 4 ファイル（customPromptManager / markdownTemplateManager / domainFilter / trancoNotification）を delta 書き込みに移行する
- [x] `(async (s)=>{ await setAll(s); await updateDomainFilterCache(await getAll()); })(s)` のコピー 3 箇所を共有 seam に集約する
- [x] 交差書き込み（stale snapshot vs delta write）の回帰テストを InMemory adapter 上で新設する（savedUrlStore-cas.test.ts の CAS パターンに準拠）
- [x] 既存の settings 関連テストが無修正でパスする（通常パスの挙動不変）

## テスト戦略

- 単体: `SettingsRepository` に交差書き込みテスト（writer A が snapshot 取得 → writer B が別キー更新 → writer A が set/setAll）を追加し、B の更新が生存することを pin
- 単体: 移行した 4 呼び出し側について、stale snapshot を渡しても無関係キーを壊さないことを検証
- 回帰: dashboard/popup の既存 settings テストが引き続きパスすること

## 見積もり

2 pt（🟡中）— repo 側の write 経路修正 + 呼び出し側 4 ファイルの機械的移行 + 交差書き込みテスト。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `setAll` の delta 契約が JSDoc で文書化されている
- [x] IIFE コピー 3 箇所が共有 seam に集約されている
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS §5.1 の書き込み契約に 1 行追記）

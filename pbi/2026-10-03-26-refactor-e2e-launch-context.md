# PBI: E2E 拡張起動コンテキストの launchExtensionContext() 統合

## ユーザーストーリー

E2E テストの保守者として、拡張機能の起動手順が 8 ファイル / 3 バリアントに分散している状態を解消したい。単一の `launchExtensionContext()` に統合し、シードポリシーを明示的なパラメータとして渡せるようにすることで、SW race 対策や headless skip の適用漏れを起動側で構造的に防ぎたい。

## 優先度

順位: 11 / 20
RICEスコア: 6.0（Reach=5 / Impact=2 / Confidence=0.9 / Effort=1.5 SP）
根拠: 起動コンテキストが 8 ファイル / 3 バリアントに分裂し、SW race ガードと headless skip の欠落が robustness drift として既に顕在化。seed drift（`ai_provider_priority_list`）は実害の可能性あり。
依存: なし（先行 PBI 不要求）。

## 背景

- 正: `testDir/e2e/fixtures/extension.fixture.ts:26-81` — SW race 対策 + headless fixme + `serviceWorkers: 'allow'` + host-resolver-rules を保持する唯一の正装版
- 再実装: `testDir/e2e/fixtures/cleansing-preview.fixture.ts:29-60` — 同一起動手順を再実装
- 欠落: `popup.fixture.ts:30-40` / `dashboard.fixture.ts:17-27` / `popup-pbi27.fixture.ts:23-33` / `dashboard-issue-report.fixture.ts:28` / `dashboard-locale.fixture.ts:25-37` — SW race ガード + headless skip なし
- `waitForEvent('serviceworker')` が無上限タイムアウト（`popup.fixture.ts:45`）
- `EXTENSION_PATH` + `__dirname` ボイラープレートが 8 か所
- Seed drift: `dashboard.fixture.ts:50-58` は `ai_provider_priority_list: []` を seed しないよう WHY コメントで警告するが、`dashboard-locale.fixture.ts:57` はまさにそれを seed している

## BDD受け入れシナリオ

```gherkin
Scenario: 全 E2E テストが単一の起動関数を経由する
  Given 拡張起動手順が 8 ファイルに分散している
  When 各 E2E テストが拡張コンテキストを起動する
  Then 起動は launchExtensionContext() に統一される
  And SW race ガードと headless skip は起動側で常に適用される

Scenario: シードポリシーが明示パラメータとして渡る
  Given dashboard.fixture.ts は ai_provider_priority_list の seed を禁止している
  When dashboard-locale E2E が拡張コンテキストを起動する
  Then シード内容は seed-policy パラメータで明示的に指定される
  And 禁止された seed が暗黙に混入しない

Scenario: serviceworker 待ちが上限付きになる
  Given waitForEvent('serviceworker') にタイムアウト上限がない
  When serviceworker の起動が滞留する
  Then 待ちは上限タイムアウトで失敗する
  And テストが無限待機で固まることはない
```

## 受け入れ基準

- [ ] `launchExtensionContext()` を 1 つ追加し、8 ファイルの起動手順をすべて置き換える
- [ ] seed-policy パラメータを明示的に受け取り、`ai_provider_priority_list` の seed drift を解消する
- [ ] `EXTENSION_PATH` + `__dirname` ボイラープレートを 1 か所に集約する
- [ ] `waitForEvent('serviceworker')` に上限タイムアウトを設ける
- [ ] 既存 8 ファイル / 3 バリアント分の起動挙動を維持する（挙動差は seed-policy だけに集約）
- [ ] 起動ヘルパー単体のテストを追加する
- [ ] 全 E2E テストが新ヘルパー経由で成功する

## テスト戦略

- まず seed drift（`dashboard-locale.fixture.ts:57`）を失敗テストとして固定する
- `launchExtensionContext()` の単体テスト: seed-policy の適用、SW race ガード、headless skip、タイムアウト上限を検証
- 既存 E2E を新ヘルパーへ段階的に移行し、parity 確認後に旧 fixture を削除
- E2E は `--repeat-each` で複数回実行し flake がないことを確認（AGENTS.md の Definition of done に準拠）

## 見積もり

- 1.5 SP（8 ファイル置換、seed-policy 設計、parity 確認を含む）

## DoD

- [ ] `launchExtensionContext()` が単一起動経路として実装され、全 E2E が移行済み
- [ ] seed drift が解消され、回帰テストが追加されている
- [ ] `waitForEvent('serviceworker')` のタイムアウト上限が実装されている
- [ ] 旧 fixture ファイルが削除されている
- [ ] `npm run validate` と全 E2E が成功している
- [ ] リピート実行（`--repeat-each` 複数回）で flake がないことが確認されている

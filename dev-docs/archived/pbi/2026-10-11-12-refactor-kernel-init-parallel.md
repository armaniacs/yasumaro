# PBI: kernel init の設定読みとプローブフラグ読みを並列化する

- 種別: refactor
- RICE: 4.8（R6 × I0.5 × C0.8 / E0.5）
- 依存: なし（W1 で NN11 / NN13 と並列可。NN14 と同ファイル別ハンクのため実装は NN12 先行）
- バッチ: review-followup
- 台帳: `pbi/2026-10-11-00-backlog-review-followup.md`
- 出所: code-review レビュー指摘 #1（2026-10-11）

## ユーザーストーリー

利用者として、content-script 初期化を少しでも速くしてほしい。なぜなら `init()` に session 読みの1往復が直列で増えており、全ページ読み込みのホットパスだから。

## 優先度

- 順位: 2 / 5
- RICEスコア: 4.8（Reach=6 / Impact=0.5 / Confidence=0.8 / Effort=0.5）
- 根拠: Reach は最大級（全ページの初期化）だが削減は sub-ms（Impact 0.5）。並列化の安全性に一手間かかる（C 0.8）。

## 背景（現状・証拠）

- `src/content/contentKernel.ts:285-295` — `init()` は `await this.loadSettings()` の完了後に `await isE2EProbeEnabled()` を直列実行する。
- 両者は依存関係がない（設定スナップショット読みと session フラグ読み）。`session.get` はメモリ読みで高速だが、await が2直列になる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 並列化してもプローブ判定が変わらない
  Given session フラグが on / off の両状態
  When kernel.init() を実行する
  Then 従来と同一の armed / disarmed になり、設定も同一に読まれる

Scenario: どちらかが失敗しても初期化が壊れない
  Given session 読みが reject する
  When kernel.init() を実行する
  Then プローブは disarmed として初期化が完走する（従来の fail-safe を維持）
```

## 受け入れ基準

- [x] `loadSettings()` と `isE2EProbeEnabled()` が並列に走る（`Promise.all` 等。`init()` 内を組替え）
- [x] フラグ on/off・session reject の既存テストが無変更で green（fail-safe 維持の証拠。隔離3＋golden3＋extractor系187＝193件 green）
- [x] `npm run validate` が green（1057 files / 15962 tests passed。最終フル検証で確認）

## テスト戦略

- unit: 既存の `contentKernel.e2eProbeIsolation.test.ts`（3件）＋ `contentKernel.e2eState.golden.test.ts` が無変更で green — 並列化の等価性の証拠。
- unit（追加・任意）: `loadSettings` と session 読みの完了順を入れ替えても結果が同一になるテスト（片方を遅延させる）。小さいため既存テストの green で代替可なら省略してよい。
- 回帰: extractor 系テストが green のまま。

## 見積もり

0.5 SP（`init()` の2行組替え＋既存テスト green 確認）

## 技術的考慮事項

- `loadSettings()` の例外挙動を変えないこと（現状の throw 伝播を維持。`Promise.all` は最初の reject で失敗するため、session 側の reject は `isE2EProbeEnabled` 内部で既に false 化されている＝fail-safe を壊さないことを確認する）。
- `e2eSessionResolveNeeded === false`（注入あり）の経路は session 読み自体が発生しないため対象外。

## 実装者向け注記

### 実装手順

1. `init()` の2 await を `Promise.all` 化する
2. 既存の隔離・golden・extractor テストで green を確認する
3. `npm run validate`

### 落とし穴

- テストで実時間待ちを入れない（遅延注入は即時 resolve の Promise 差替えで行う）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 autonomous-task-closer）

- 隔離3＋golden3＋extractor系187＝193件 green（無変更・等価性の証拠）
- `npx tsc --noEmit` exit 0、`npx eslint src/content/contentKernel.ts` exit 0

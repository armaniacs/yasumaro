# PBI 16: settingsMigration の型整備（boolean 合同の core 化・as never 排除）

## ユーザーストーリー
メンテナーとして、migration のオーバーロード層が型検査で保護された状態がほしい、なぜなら boolean 合同を `as ApplyMigrationsOptions` で 4 箇所もキャストする層は、オプション追加時に型検査を素通しさせるから。

## 変更点の概要
settingsMigration.ts の boolean 合同オーバーロード（as キャスト ×4）を 1 つの core シグネチャへ統合し、`as never` キャスト ×2 を排除する。

## 現状と問題
- src/utils/storage/settingsMigration.ts:517 / :535 / :600 / :608（boolean 合同を as ApplyMigrationsOptions にキャスト ×4）
- :452 / :475（as never キャスト ×2）
- 呼び出し元: pipeline 各ステップ（processPrivacyPipelineStep ほか）＋ settingsExportImport.ts
- テスト: settingsMigration 系テストが boolean 合同の挙動を検証

## 変更の理由
[型安全性] キャスト群はオプション追加・キー追加時に型検査を素通しさせる。core シグネチャへ統合すると、呼び出し側の boolean 合同は薄いオーバーロードだけで型整合が保たれる。

## 提案コード（骨子）
export async function applyMigrationsCore(options: ApplyMigrationsOptions, recordCompletion: boolean): Promise<ApplyMigrationsResult>
boolean 合同オーバーロードは core を呼ぶだけ（as キャストなし）

## BDD受け入れシナリオ
Scenario: boolean 合同の挙動は不変
  Given 既存の 4 つの boolean 合同呼び出し
  When core シグネチャへ統合する
  Then 各呼び出しの戻り値・移行対象キー集合は変更前と同一である

Scenario: オプション追加の型保護
  Given ApplyMigrationsOptions に新しいオプションを追加する
  When core を呼ぶ呼び出し側を更新する
  Then 型検査が未更新の呼び出しを検出する（キャストでの素通しがない）

## 見積もり
2 pt（RICE: 18 = Reach 6 × Impact 3 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] as キャスト ×4 と as never ×2 が消える
- [ ] settingsMigration 系の既存テスト全通過
- [ ] npm run validate 通過

# PBI: AI処理時間（aiDuration）計測ロジックの修正

## ユーザーストーリー
拡張機能を使うユーザーとして、記録完了メッセージの「AI: Xms/秒」がクラウドAI要約の実処理時間を正しく反映してほしい、なぜなら現状「AI: 3ms」のようにAPI呼び出しではあり得ない値が表示されており、パフォーマンス表示への信頼性を損なっているから。また同じ誤った値がSQLiteの`ai_duration_ms`にも保存されるため、履歴パネルでのパフォーマンス可視化やデータ分析の正確性にも影響しているから。

## ビジネス価値
- ユーザー向け表示の正確性回復（信頼性の問題を解消）
- SQLite保存データ（`ai_duration_ms`）の品質改善により、履歴パネル・将来のパフォーマンス分析機能が正しいデータに基づけるようになる
- 測定方法: 修正後、Masked Cloudモードで記録した際の「AI: X」表示が体感時間（数百ms〜数秒オーダー）と一致することを目視確認

## 既実装確認（フェーズ0）

**確認済み — バグ修正タスクであり、既存の計測ロジックの欠陥修正である。新規実装ではない。**

- `grep -rn "aiDuration" src --include="*.ts"` により全参照箇所を洗い出し済み（テスト以外で計17ファイル）
- graphify調査により、`aiDuration`が下流で消費される箇所（SQLite保存・履歴パネル表示・データ移行）も特定済み
- 詳細な原因分析・修正方針は設計書 [docs/superpowers/specs/2026-07-19-ai-duration-measurement-fix-design.md](../docs/superpowers/specs/2026-07-19-ai-duration-measurement-fix-design.md) を参照

## 根本原因（要約）

`PREVIEW_RECORD`処理時、`PrivacyPipeline.process()`は`previewOnly=true`の場合、クラウドAI要約を呼ぶ**前**（PIIマスキング完了直後）に早期returnする。しかし`aiDuration`の計測区間（`src/background/pipeline/steps/processPrivacyPipelineStep.ts`の`aiStartTime`〜`aiEndTime`）は`process()`呼び出し全体を囲んでいるため、実際にはローカルAI＋PIIマスキングのみの時間（数ms）を計測してしまう。

この誤った値が`previewResponse.aiDuration`としてpopupに返り、`SAVE_RECORD`送信時にそのままpayloadへ乗せて伝播される（`src/popup/recordCurrentPage.ts:329`）。`SAVE_RECORD`の実処理（`alreadyProcessed=true`）では実際にクラウドAI要約が呼ばれるが（`useCloudAi`が`alreadyProcessed`を見ないため）、`processPrivacyPipelineStep.ts`は`alreadyProcessed=true`時に実測をスキップし、伝播してきた誤った値を使い回す設計になっていた。結果、実際のクラウドAI要約の所要時間はどこにも正しく計測されていない。

## BDD受け入れシナリオ

```gherkin
Scenario: Masked Cloudモードでページを記録するとAI処理時間が正しく表示される
  Given AIプロバイダーがクラウドAI要約を使用する設定（masked_cloud または full_pipeline モード）である
  When  ユーザーが「今すぐ記録」でページを記録する
  Then  記録完了メッセージの「AI: X」は、クラウドAI要約APIの実際の呼び出し時間（数百ms〜数秒オーダー）と一致する
  And   SQLiteに保存された当該レコードの ai_duration_ms も同じ実測値である

Scenario: プレビュー段階ではクラウドAI要約が未実行のためAI処理時間が計測されない
  Given PII確認プレビューUIが有効な設定である
  When  ユーザーが「今すぐ記録」を押しプレビュー画面が表示される
  Then  この時点ではクラウドAI要約はまだ呼び出されていない
  And   プレビュー完了メッセージに誤った短いAI処理時間（例: 数ms）が表示されない

Scenario: local_onlyモードではAI処理時間欄の扱いが従来通り
  Given AIプロバイダーがlocal_onlyモード（クラウドAI要約を使用しない）設定である
  When  ユーザーがページを記録する
  Then  記録完了メッセージでは、クラウドAI呼び出し時間が存在しないため、従来通りAI処理時間欄が表示されないかAI要約失敗相当の扱いになる（既存挙動を変更しない）
```

## 受け入れ基準
- [x] `PrivacyPipeline.process()`が、クラウドAI要約呼び出し（`aiService.generateSummary()`のL3呼び出し）の直前直後を`performance.now()`で計測し、`PrivacyPipelineResult.aiCallDurationMs`として返す
- [x] `previewOnly=true`の場合、クラウドAI要約が呼ばれないため`aiCallDurationMs`は含まれない（`undefined`）
- [x] `processPrivacyPipelineStep.ts`が`pipelineResult.aiCallDurationMs`をそのまま`aiDuration`として使用し、`aiStartTime`/`aiEndTime`によるstep側の計測、および`alreadyProcessed`分岐での値の使い回しロジックを削除している
- [x] popup（`recordCurrentPage.ts`）から`SAVE_RECORD`payloadへの`aiDuration`伝播が削除されている
- [x] `messageHandlers.ts`の`SAVE_RECORD`ハンドラ、`RecordingPipeline.execute()`の初期context伝播から`aiDuration`受け渡しが削除されている
- [x] 不要になった型定義（`RecordingData.aiDuration`、`SaveRecordMessage.payload.aiDuration`、`PreviewResponse.aiDuration`）が削除されている
- [ ] Masked Cloud / Full Pipelineモードで実際に記録し、popup成功メッセージの「AI: X」がクラウドAI要約APIの体感所要時間と一致することを手動確認済み
- [ ] SQLite保存の`ai_duration_ms`、履歴パネル表示（`historyEntryRow.ts`）にも正しい実測値が反映されることを確認済み
- [x] 既存テストスイート（`npm validate`）が全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Chrome拡張の制約上、AI要約API呼び出しを含むE2Eは手動テストで代替。詳細はAGENTS.mdの「For Testing Agents」参照）

### 統合テスト
- `src/background/pipeline/steps/__tests__/processPrivacyPipelineStep.test.ts`（既存）: `pipeline.process()`のモック戻り値に`aiCallDurationMs`を含め、`context.aiDuration`へ正しく反映されることを確認するテストへ更新
- `src/background/__tests__/`配下の`RecordingPipeline`関連統合テスト: `SAVE_RECORD`相当のフロー（`alreadyProcessed: true`）実行時に、`aiDuration`がpayload経由ではなく実測値になっていることを確認するテストへ更新

### 単体テスト
- `src/background/privacyPipeline.ts`の単体テスト（新規または既存拡張）:
  - `useCloudAi=true`時、`aiService.generateSummary()`呼び出し前後の時間が`aiCallDurationMs`として返ることを確認（`aiService`をモックし、`generateSummary`に人為的な遅延を仕込んで計測値がその遅延と近似することを検証）
  - `previewOnly=true`時（早期return）、`aiCallDurationMs`が結果に含まれない（`undefined`）ことを確認
  - `useCloudAi=false`（local_onlyモード）時、`aiCallDurationMs`が含まれないことを確認
- `processPrivacyPipelineStep.ts`の既存テストのうち、`alreadyProcessed`分岐や`aiStartTime`/`aiEndTime`挙動に依存しているケースを更新
- `src/popup/__tests__/recordCurrentPage.test.ts`: `SAVE_RECORD`送信payloadに`aiDuration`フィールドが含まれないことを確認する回帰テストを追加

## 実装アプローチ
- **Outside-In**: `processPrivacyPipelineStep.test.ts`（統合レベル）の期待値を先に「実測値ベース」に書き換えて失敗させ、次に`privacyPipeline.ts`の単体テストを追加・失敗させてから実装する
- **Red-Green-Refactor**: 各変更ステップ（設計書のChanges #1〜#6）ごとにテスト→実装→グリーンのサイクルを回す
- **リファクタリング**: 全ステップがグリーンになった時点で、不要になった型定義・コメントの残骸がないか最終チェック

## 見積もり
2pt（🟡中）— 変更ファイル数は多いが（6ファイル＋型定義3箇所）、各変更は機械的な削除・付け替えが中心。設計書で変更内容が明確に確定しているため実装難度は低い。テスト更新・手動確認込みで2pt。

## 技術的考慮事項
- 依存関係: なし（単独で完結する修正）
- テスタビリティ: `AIService.generateSummary()`はモック可能なインターフェースのため、遅延を仕込んだ計測テストが書きやすい
- 非機能要件: パフォーマンスへの影響なし（計測処理自体は`performance.now()`の呼び出し位置を変えるのみ）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること。ただし既に本PBI作成時点で洗い出し済み）
```bash
grep -rn "aiDuration" src --include="*.ts" | grep -v __tests__
```
上記の結果、影響範囲は以下の6ファイル＋3型定義に限定されることを確認済み:
- `src/background/privacyPipeline.ts`
- `src/background/pipeline/steps/processPrivacyPipelineStep.ts`
- `src/popup/recordCurrentPage.ts`
- `src/background/handlers/messageHandlers.ts`
- `src/background/pipeline/RecordingPipeline.ts`
- `src/messaging/types.ts` / `src/background/messageTypes.ts` / `src/popup/mainTypes.ts`（型定義）

下流消費先（変更不要、確認済み）:
- `src/background/pipeline/mappers/BrowsingLogRecordMapper.ts`
- `src/background/pipeline/steps/saveMetadataStep.ts`
- `src/dashboard/historyEntryRow.ts`
- `src/background/migrationService.ts`

### 実装手順
詳細は設計書 [2026-07-19-ai-duration-measurement-fix-design.md](../docs/superpowers/specs/2026-07-19-ai-duration-measurement-fix-design.md) のChanges #1〜#6を参照。要約:

1. `privacyPipeline.ts`のL3クラウド呼び出し（136-142行目付近）を`performance.now()`で挟み、`_processCloudResult()`に`aiCallDurationMs`を渡して`PrivacyPipelineResult`に含める
2. `processPrivacyPipelineStep.ts`の`aiStartTime`/`aiEndTime`/`alreadyProcessed`分岐を削除し、`pipelineResult.aiCallDurationMs`を直接使う
3. `recordCurrentPage.ts`のSAVE_RECORD送信payloadから`aiDuration: previewResponse.aiDuration`を削除
4. `messageHandlers.ts`の`createSaveRecordHandler`から`aiDuration: message.payload.aiDuration`を削除
5. `RecordingPipeline.ts`の`execute()`初期contextから`aiDuration: data.aiDuration`を削除
6. 型定義3箇所から不要になった`aiDuration`フィールドを削除

### 落とし穴
- `_buildSanitizedSettings()`の`useCloudAi`は`alreadyProcessed`を見ない設計（意図的、`SAVE_RECORD`時に実際のクラウド呼び出しが必要なため）。この挙動自体は変更しないこと — 変更するとクラウドAI要約が呼ばれなくなり別の重大な機能退行を招く
- `previewOnly=true`の早期return（`privacyPipeline.ts:122-133`）より**後**にクラウド呼び出し計測コードを追加すること。早期returnの前に計測を仕込むと再びプレビュー時の値が誤って計測されてしまう
- `local_onlyモード`では`aiCallDurationMs`が常に`undefined`になる。`formatSuccessMessage`の`aiSucceeded`判定（`aiDuration !== undefined && aiDuration > 0`）はこれを「AI要約失敗」相当として扱う既存仕様であり、意図的な挙動なので変更しないこと
- テスト更新時、`aiStartTime`/`aiEndTime`をモックしていた既存テストがあれば、`performance.now()`呼び出し回数・タイミングの前提が変わるため注意深く書き直すこと

## Definition of Done
- [x] 全BDDシナリオが自動テスト（統合・単体）として実装されパスする
- [x] `npm validate`（型チェック＋テスト）が全てパスする
- [ ] Masked Cloudモードでの手動記録テストで、表示されるAI処理時間が体感時間と一致することを確認
- [ ] コードレビュー完了
- [x] リファクタリング完了（グリーン後、不要な型定義・コメントの残骸がないか最終確認）
- [ ] 本PBIファイルを`.plan/archived/`（または`pbi/archive/`）へ移動し、`00-INDEX.md`を更新

# PBI: MANUAL_RECORD/SAVE_RECORDのMutex直列化経路を検証する

## 結論（2026-08-24 検証完了）

**対応不要。PBI-08レポートの懸念は現行アーキテクチャで解消済み。**

`RecordingPipeline.execute()`（[RecordingPipeline.ts:130-132](../src/background/pipeline/RecordingPipeline.ts#L130)）は入口で一律 `mutexMap.runExclusive(data.url, ...)` を通す構造になっており、`skipDuplicateCheck: true` を渡す MANUAL_RECORD/SAVE_RECORD 経路も含めて全呼び出しが同一URL単位で直列化されることを統合テストで確認した。

検証テスト: `src/background/__tests__/recordingPipeline-full.test.ts`「同一URLへの並行 record() の直列化」ブロックに `skipDuplicateCheck: true（MANUAL_RECORD/SAVE_RECORD相当）で execute() を直接呼んでも直列化される` を追加。一発でGreen（実装修正不要）。

`retryObsidianWriteOnly`（オフラインリトライ経路）も既存テスト`waits for the same-URL mutex before writing to Obsidian`で同一Mutex経由の直列化を確認済み。

## ユーザーストーリー
開発チームとして、過去のPBI-08レポートに記載された「Mutex直列化の懸念」が現行コードでも有効かを確認したい。なぜなら、大規模リファクタ（RecordingLogic→RecordingPipeline統合）を経てレポートの前提が古くなっている可能性があり、技術的負債の正確な棚卸しに必要だから。

## ビジネス価値
ドキュメントとコードの整合性回復。実害があれば早期に是正し、実害がなければ調査コスト（数時間）で不要な実装を防ぐ。

## 背景・現状分析

PBI-08レポート（`.superpowers/sdd/pbi-08-report.md`）の懸念3「直列化の担い手移動」には以下の記載がある:

> パイプライン直叩きのパス（`messageHandlers.ts` の MANUAL_RECORD / SAVE_RECORD）は `skipDuplicateCheck: true` のため TOCTOU 窓が存在せず、Mutex 不要と判断した。

2026-08-24時点の調査で、以下を確認済み:

- `src/background/handlers/recordingHandlers.ts` の `createManualRecordHandler`（L276）・`createSaveRecordHandler`（L335）は `pipeline.execute()` を呼び出し、いずれも `skipDuplicateCheck: true` を渡している。
- `RecordingPipeline.execute()`（[src/background/pipeline/RecordingPipeline.ts:130-132](../src/background/pipeline/RecordingPipeline.ts#L130)）は **入口で一律 `this.mutexMap.runExclusive(data.url, ...)` を通す**構造になっている。
- Mutex実装は `PerUrlMutexMap`（[src/background/pipeline/perUrlMutex.ts](../src/background/pipeline/perUrlMutex.ts)）に集約され、PBI-08のアイドル削除条件（`!isLocked() && getQueueSize() === 0`）も維持されている。

つまり、PBI-08レポート記載時点（`recordingLogic.ts` が個別に存在し、`RecordingPipeline` 側にMutexがなかった構成）とは異なり、**現在は `execute()` の入口で全経路が一律Mutex保護される構造に変わっている**。レポートの懸念はアーキテクチャ変更により解消されている可能性が高いが、正式な検証テストと結論の記録がないため本PBIで確認する。

## BDD受け入れシナリオ

```gherkin
Scenario: MANUAL_RECORD/SAVE_RECORDが既存Mutex経路を通ることを検証する
  Given RecordingPipeline.execute() が mutexMap.runExclusive でラップされている
  When MANUAL_RECORD または SAVE_RECORD ハンドラが同一URLに対して並行呼び出しされる
  Then 記録処理が直列化され、同時書き込みによる競合が発生しない

Scenario: 調査の結果、対応不要と判明した場合
  Given 現行コードで Mutex 保護が既に MANUAL_RECORD/SAVE_RECORD を含む全経路をカバーしている
  When 検証テストを追加実行する
  Then PBI-08レポートの懸念は解消済みと結論づけ、実装変更なしでクローズする
```

## 受け入れ基準
- [ ] `MANUAL_RECORD`/`SAVE_RECORD`/`VALID_VISIT`（自動記録）が同一URLに対して並行呼び出しされた場合の直列化を検証するテストが存在する
- [ ] `retryObsidianWriteOnly`（オフラインリトライ経路）も同一Mutexで直列化されることを検証する
- [ ] 調査結果（対応不要 or 実装修正）をPBI完了報告に明記する
- [ ] 対応不要と判明した場合、PBI-08レポートまたは本PBIファイルに「解消済み」の注記を残し、将来同じ懸念が再調査されないようにする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- （バックグラウンド処理の内部整合性検証のため対象外）

### 統合テスト
- `RecordingPipeline.execute()` を経由する3経路（MANUAL_RECORD/SAVE_RECORD/自動記録）が同一URLで並行実行された際、Mutexで直列化されること（`RecordingPipeline.test.ts` 相当の既存統合テストに追加）

### 単体テスト
- `PerUrlMutexMap.runExclusive` が同一URLの並行呼び出しを直列化すること（既存テストの有無を確認し、なければ追加）
- ロック解放後、待機者がいない場合はMapからエントリが削除されること（アイドル削除、既存カバレッジ確認）

## 実装アプローチ
- **Outside-In**: 統合テストから開始し、並行呼び出しでの直列化を先に検証（既にGreenになる可能性が高いが、それ自体が調査結果）
- 本PBIは実装追加ではなく検証が主目的のため、Red-Green-Refactorサイクルよりも「既存動作の証明」に重点を置く

## 見積もり
1pt（調査・検証テスト追加が中心。実装修正が必要と判明した場合は追加見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存の `Mutex` クラスのテストパターン（`src/utils/Mutex.ts` 関連）を流用可能
- 非機能要件: なし（調査タスク）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "skipDuplicateCheck" src/background/handlers/recordingHandlers.ts
grep -n "mutexMap.runExclusive\|async execute" src/background/pipeline/RecordingPipeline.ts
cat src/background/pipeline/perUrlMutex.ts
```

2026-08-24時点で `RecordingPipeline.execute()` が入口で一律Mutexを通すことを確認済み。着手時にこの構造が変わっていないか（別のリファクタでMutexが再度分離されていないか）再確認すること。

### 実装手順（Outside-In順）
1. 同一URLに対する `MANUAL_RECORD`/`SAVE_RECORD`/自動記録の並行呼び出しをシミュレートする統合テストを書く
2. テストが（既存構造により）Greenになることを確認する。もしRedになった場合は実装バグが見つかったことになるため、原因を特定し是正する
3. `retryObsidianWriteOnly` も同様に検証する
4. 全て期待通りであれば、PBI-08レポートに「2026-08-24 再検証: 解消済み」の追記を行い、本PBIをクローズする

### 落とし穴
- テストで「直列化されている」ことを検証する際、単に結果が正しいことだけでなく、実行順序（開始タイムスタンプの重なりがないこと）を確認しないと、たまたま速く終わって競合が顕在化しなかっただけの偽陽性になりやすい
- `PerUrlMutexMap` はモジュールレベルの静的Mapを使うため、テスト間で状態が漏れないよう各テストでURLをユニークにするか、明示的にクリアすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npx vitest run` 全件成功
- [ ] `npm run type-check` エラーなし
- [ ] 調査結論（対応不要 or 実装修正）がPBI完了報告として記録されている
- [ ] コードレビュー完了（調査のみの場合は結論のセルフレビューで可）

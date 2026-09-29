# 記録許可ゲート順序の正本: orchestrator の手書き配列

## Status

- **Proposed**: 2026-09-28
- **Approved**: 2026-09-28
- **Implemented**: 2026-09-28 (PBI `pbi/2026-09-28-27-refactor-gate-order-ssot-unification.md`)

## Context

ゲート順序の正本が二重化している。`src/background/pipeline/RecordingOrchestrator.ts:91` のコメントは順序 SSOT を `src/utils/recordingGateTable.ts` と宣言しながら、`:92-102` で 9 段の `preSaveSteps` を手書き列挙している。一方 `src/background/pipeline/steps/index.ts:34-61` の `ADMISSION_GATE_ORDER` / `createAdmissionGateSteps` は table 駆動の導出を提供するが、本番からの参照はゼロである。

## Decision

orchestrator の手書き配列を正本とする。手書き側だけが各段の `errorStrategy` / `maxRetries` / `offlineRetry` / `previewBreakpoint` を持ち、名前だけの table からは実行順序を復元できないためである。未使用の導出（`ADMISSION_GATE_ORDER`、`createAdmissionGateSteps` とそのテスト）を削除し、orchestrator のコメントを「手書き配列が正本」に修正する。`RECORDING_GATE_TABLE` はゲート名のレジストリとして残し、`decideGate` 呼び出し側と `evaluateGates` の参照先とする。

## Consequences

### Positive

- 順序変更の編集箇所が1つになる。table 更新が pipeline に届かない事故が起きない。
- 本番未使用の導出コードとそのテストが消え、grep の正本特定が正確になる。

### Negative

- 将来 table 駆動に戻す場合は、段ごとの実行ポリシーを table に載せる設計が別途要る。

### Residual risks

- 手書き配列の順序と table の行順の乖離は機械的に検出されない。順序変更時は両方を読む運用が残る。

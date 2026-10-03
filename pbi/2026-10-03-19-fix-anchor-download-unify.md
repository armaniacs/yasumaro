# PBI: anchor-click ダウンロードの 3 重実装（sync immediate revoke が長いダウンロードを殺す・統一未定）

## ユーザーストーリー

大きなエクスポートファイルをダウンロードしたいユーザーとして、どの画面からダウンロードしても長時間の保存が途切れないでほしい。現状は encryptedBackupPanel / ublockImport の sync revoke が Chromium の保存開始直後に object URL を無効化し、大きなファイルが壊れる。

## 優先度

- 順位: 04/20
- RICE: 16.0（R4 / I2 / C1.0 / E0.5）
- 根拠: 実検証済みの 3 重実装 1 件。exportLogsService の downloadBlob（60s bounded revoke + WHY コメント + exported）が SSOT 候補として既に存在する一方、2 箇所が sync immediate revoke。大きなバックアップでデータ消失という実害あり。既存ヘルパーへの置換のみで対処可能
- 依存: なし（`src/dashboard/encryptedBackupPanel.ts`・`src/dashboard/settings/ublockImport/index.ts`・`src/dashboard/exportLogsService.ts`）

## 背景（file:line 現状）

- 実装 A（SSOT 候補）: `src/dashboard/exportLogsService.ts:154-163` — `downloadBlob` は append + click + 60s bounded revoke。WHY コメント付きで exported。`DOWNLOAD_REVOKE_DELAY_MS`（:152）も export 済み
- 実装 B（sync immediate revoke — 害あり）: `src/dashboard/encryptedBackupPanel.ts:36-47` — append + click + **即時** `URL.revokeObjectURL` → 長いダウンロードが切れる
- 実装 C（sync revoke・append なし）: `src/dashboard/settings/ublockImport/index.ts:159-164` — append せず click して即時 revoke
- 根拠ドキュメント: `src/dashboard/markdownExport.ts:286-293` — bounded-delay の rationale（revoke は後続 fetch のみをブロックする、timer は早すぎる/リークする）を文書化
- 統一しない場合の代替: markdownExport.ts の settle-driven 経路（chrome.downwards.download の完了シグナルを await）は anchor-click と事情が異なり変更不要

## BDD受け入れシナリオ

```gherkin
Scenario: 暗号化バックアップの長いダウンロードが途切れない
  Given 大きな envelope blob のダウンロードが開始される
  When Chromium が保存を完了する
  Then revoke は 60s bounded delay のため保存開始後も URL が生きており、ファイルが壊れない

Scenario: revoke が確実に走りリークしない
  Given ダウンロードが完了した
  When 60s 経過する
  Then object URL が revoke され、ページライフタイムのリークが起きない

Scenario: domain-list エクスポートも同一ヘルパーを使う
  Given ublockImport のエクスポートを実行する
  When ファイルが保存される
  Then downloadBlob と同一の revoke タイミングが適用される
```

## 受け入れ基準

- [ ] `src/dashboard/encryptedBackupPanel.ts:36-47` の sync immediate revoke が `exportLogsService.downloadBlob` への置換に変わる
- [ ] `src/dashboard/settings/ublockImport/index.ts:159-164` も `downloadBlob` に統一される（append なし差異の解消）
- [ ] `src/dashboard/exportLogsService.ts` が引き続き唯一の anchor-click 実装となる（重複実装の撲滅）
- [ ] 統一で壊れる事情が判明した場合は統一せず、per-site rationale をコードコメントと実装記録に文書化する（裁定と理由が 1 行残る）
- [ ] `src/dashboard/markdownExport.ts` の settle-driven 経路は変更対象外である旨が明記される
- [ ] 置換後、sync immediate revoke の残骸が該当ファイルの grep で残らない
- [ ] 単体テストが追加・更新される（fake timers 使用可・実時間待ちなし）

## テスト戦略

- 単体: fake timers（useTimerClock 相当）で 60s bounded revoke の発火を pin。実時間待ちは使わない
- 単体: 置換先の downloadBlob が append→click→delayed revoke の順序で動くことを pin
- 既存テスト green 維持 + `npm run validate` 通過

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

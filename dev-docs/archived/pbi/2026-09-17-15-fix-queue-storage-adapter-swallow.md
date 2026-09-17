# PBI: PersistentRetryQueue のストレージ保存失敗が呼び出し元へ伝わらない

優先度: 順位 1 / 2（RICE: 6.4 = Reach 4 / Impact 1 / Confidence 0.8 / Effort 0.5 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917c.md](2026-09-17-00-backlog-arch-review-0917c.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能のユーザーとして、閲覧記録のメタデータ更新が保存に失敗したときは、その失敗が黙って消えてほしくない。なぜなら現状は一次保存の失敗を退避させるための「最後の砦」であるキューへの保存自体が失敗しても、`console.error` に出るだけで呼び出し元には成功として返り、気づかれないままメタデータが失われるから。

## 背景（現状と課題）

- `ChromeStorageAdapter.load()`/`save()`（`src/background/queueStorageAdapter.ts:20-39`）は `chrome.storage.local` の例外を catch して `console.error` するだけで、呼び出し元には常に成功として返る（`load` は空配列、`save` は `void`）。コメント（同ファイル17-18行）に「best-effort。save失敗は呼び出し元の元の失敗をマスクしないためにthrowしない」と明記されており、意図的な設計判断だが、その結果「保存できたと誤認して先に進む」状態を防ぐ手立てがない。
- `PersistentRetryQueue`（`src/background/persistentRetryQueue.ts`）の `enqueue`/`flush`/`mutate` はいずれもこの adapter を経由して `load`→`save` する。save が実際に失敗しても、キュー側はメモリ上の状態（`remaining` 配列など）を成功したものとして更新し続ける。
- `pendingChromeStorageQueue.ts` のコメントより、この `PersistentRetryQueue` は「chrome.storage.local への書き込みが失敗した（quota超過や一時的なストレージエラーなど）ときに、そのデータをロストさせず再試行するための退避キュー」として使われている。つまり本来の保存が失敗 → このキューに退避 → Service Worker起動時やオフライン復帰時に再試行、という「最後の砦」的なフォールバック機構そのものである。
- そのキュー自体の永続化（`ChromeStorageAdapter.save()`）が失敗した場合、現状は `console.error` だけで握りつぶされる。`PersistentRetryQueue.enqueueUnlocked()` は save 呼び出し後に例外が飛ばない限り正常終了したとみなし、呼び出し元の `enqueuePendingWrite()` も成功として返る。結果として、最後の退避先であるはずのキューへの書き込みそのものが失敗すると、元のメタデータパッチ（URLの保存日時・タグ・要約などのメタデータ更新内容）が完全にロストし、しかもエラーは `console.error` にしか出ないため Service Worker のコンソールを見ていない限り気づけない。
- 同様に `flush()` 内の「remaining/untouched を save して永続化する」ステップも同じ adapter を使っており、flush中の save 失敗で「再試行待ちの未処理アイテム」がストレージ上から消え、メモリ上の戻り値としては返るが次回 Service Worker 再起動時には失われる。
- 実発生条件: `chrome.storage.local` の既定 quota（`unlimitedStorage` permission がない場合10MB）超過、または拡張プロセス⇔ブラウザプロセス間のI/Oエラー。`pendingChromeStorageQueue.ts` に `MAX_PATCH_PAYLOAD_BYTES`/`MAX_PENDING_WRITES` という定数が既にあることから、容量制約を意識した設計にはなっている。

## BDD受け入れシナリオ

```gherkin
Scenario: キューへの保存が失敗したことが呼び出し元に伝わる
  Given chrome.storage.local.set が失敗する状況（quota超過等）
  When enqueuePendingWrite() がその保存を試みる
  Then 戻り値または例外で失敗が呼び出し元に伝わる（黙って成功扱いにしない）

Scenario: flush中の保存失敗でも未処理アイテムが失われたことが分かる
  Given flush() が remaining の保存を試みて失敗する
  When flush() が呼ばれる
  Then 失敗がログに記録され、その回の flush が「完了した」という誤った状態にならない

Scenario: 既存の「呼び出し元の元の失敗をマスクしない」という設計意図は維持される
  Given 一次保存の失敗をこのキューに退避しようとしている
  When キュー自体の保存も失敗する
  Then 一次保存の失敗を表すエラーが、二次的なキュー保存失敗によって上書き・隠蔽されない
```

## 受け入れ基準

- [x] `ChromeStorageAdapter.save()`/`load()` の失敗が、戻り値（boolean/Result）または例外のいずれかの形で呼び出し元（`PersistentRetryQueue`）に伝わる
- [x] `PersistentRetryQueue` 側で、保存失敗時に構造化ログ（`addLog` 等の既存の仕組み）で記録する。`console.error` のみで終わらせない
- [x] 「呼び出し元の元の失敗をマスクしない」という既存コメントの設計意図（`queueStorageAdapter.ts:17-18`）を壊さない — 一次保存失敗のエラーが、キュー保存失敗によって上書きされないことをテストで確認する
- [x] `InMemoryAdapter` を使った既存テストを拡張し、save 失敗をシミュレートするケースを追加する
- [x] 全テスト green

## テスト戦略

- 単体: `ChromeStorageAdapter`/`InMemoryAdapter` で save/load 失敗時の戻り値・例外を検証
- 単体: `PersistentRetryQueue.enqueue`/`flush` で、adapter の save 失敗時にキュー側が「成功した」と誤認しないことを検証
- 統合: `pendingChromeStorageQueue.ts` 経由で、一次保存失敗 → 退避キューへのenqueue失敗、という二重障害シナリオでエラーが伝わることを確認

## 見積もり

0.5 pt（🟢小）— `save()`/`load()` の戻り値を成否を示す形に変更し、呼び出し元でログを強化する程度の変更。ただし「呼び出し元の元の失敗をマスクしないため throw しない」という既存の設計意図を壊さないよう、失敗伝播の設計（例外 vs 戻り値、どこまで rethrow するか）は慎重に検討すること。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`queueStorageAdapter.ts` の設計意図コメントを、新しい失敗伝播の形に合わせて更新）

## 備考（調査で残った疑問）

- Reach の具体的な発生頻度（quota超過が実際にこのリポジトリで発生した実績）は本調査では確認できなかった。`unlimitedStorage` permission の有無も manifest 未確認。着手時に manifest を確認し、Reach の妥当性を再検証すること。

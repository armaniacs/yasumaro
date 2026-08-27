# PBI: optimisticLock TOCTOU 確認無効

## ユーザーストーリー
開発者として、`withOptimisticLock` の書き込み後検証がデフォルトで有効になってほしい、なぜなら現行は `_postWriteVerificationEnabled=false` で検証が無効であり、検証読み取りと書き込みの間の TOCTOU（Time-of-Check-Time-of-Use）ウィンドウで他コンテキストによる上書きが検出されず、データ不整合が黙って永続化されるから。

## ビジネス価値
- `chrome.storage.local` の並行更新（Service Worker の並行イベント、複数タブ、offscreen 競合）でのデータ損失を防止する
- `savedUrls` / `denied_domains` / `trustDb` 等の重要データの楽観的ロックの実効性を担保する
- 測定: 並行更新テストで `_postWriteVerification` 有効時に `ConflictError` が検出され、無効時には黙って上書きされることの差分がテストで証明される

## 優先度
- 順位: 7 / 17
- RICEスコア: 225（Reach=30 / Impact=2 / Confidence=75% / Effort=0.2）
- 根拠: `withOptimisticLock` を利用する全ストレージ更新に影響 (Reach=30)。データ不整合は中影響だが頻度は低い (Impact=2)。TOCTOUの理論的ウィンドウは存在するがManifest V3単一スレッドで実発現は稀のため Confidence=75%。デフォルト値変更は1行だが文書化とテストで Effort 0.2。

## なぜなぜ分析
- なぜ検証が無効か: `src/utils/optimisticLock.ts:180` で `let _postWriteVerificationEnabled = false` と初期化され、`performCasUpdate:161` の `if (_postWriteVerificationEnabled)` 分岐によりデフォルトで書き込み後検証がスキップされる。`withOptimisticLock` のCASは検証読み取り（`performCasUpdate:127`）と書き込み（`chrome.storage.local.set:156`）の間にTOCTOUウィンドウを持つが、検証無効時はそのウィンドウでの競合を検出できない
- なぜデフォルト無効にしたか: コメント `optimisticLock.ts:147-155` に「Service Worker は単一スレッドのため、書き込み後の再検証は通常不要。テスト環境で再検証が必要な場合は `enablePostWriteVerification()` を事前に呼ぶ」とあり、性能（余分な `get` 1回）と単一スレッド性を理由にデフォルト無効を選択した
- なぜ問題か: Service Worker は単一スレッドだがイベント駆動で `await` 間に他イベントが割り込む。`performCasUpdate` の `verify read (127) → await set (156)` 間にも `await` による中断点があり、並行する `withOptimisticLock` 呼び出しが割り込む余地がある。単一スレッドでも論理的な並行性は存在する
- なぜ気づかなかったか: 既存テスト `src/utils/__tests__/optimisticLock.test.ts` が `enablePostWriteVerification()` を呼ばずにパスしており、検証無効でもテストが成功するため問題が顕在化しなかった
- 解: (案A) `_postWriteVerificationEnabled` のデフォルトを `true` に変更し常に検証する。 (案B) デフォルトは `false` のままリスクを `optimisticLock.ts:147-155` のコメントと README/ADR に明文化し、並行更新が想定される呼び出し元では明示的に `enablePostWriteVerification()` を呼ぶことを必須化する。いずれかを選択し一貫させる

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — 単一更新は検証有効でも成功する
  Given `chrome.storage.local` に `key="savedUrls"` が `{ version: 0, value: ["a.com"] }` で存在する
  And `_postWriteVerificationEnabled` が true（修正後デフォルト）
  When `withOptimisticLock("savedUrls", v => [...v, "b.com"])` を呼ぶ
  Then 書き込みは成功し `chrome.storage.local.get("savedUrls")` が `["a.com","b.com"]` を返す
  And `ConflictError` はスローされない

Scenario: 攻撃/競合 — TOCTOUウィンドウでの並行上書きが検出される
  Given `chrome.storage.local` に `key="test"` が `{ value: "v1", _version: 1 }` で存在する
  And 2つの並行 `withOptimisticLock("test", ...)` 呼び出し A と B が同時に開始される
  And A が `verify read (version=1)` を完了し `set({ value: "A", _version: 2 })` を実行する直前に B が割り込み `set({ value: "B", _version: 2 })` を完了させる（TOCTOUウィンドウの競合をテストで再現: chrome.storage.local.set をモックし割り込みを注入）
  When A の `set` が完了し post-write verification が実行される
  Then 修正前（検証無効）: A の書き込みが黙って B を上書きし不整合が残る（バグの再現）
  And 修正後（検証有効）: `postWriteVersion !== newVersion` または `value mismatch` により `ConflictError` がスローされ、リトライまたは失敗として検出される
```

## 受け入れ基準
- [x] `src/utils/optimisticLock.ts:180` の `_postWriteVerificationEnabled` のデフォルト値の方針が決定され実装される（案A: `true` に変更、案B: `false` のまま文書化）
- [x] 案Aの場合: デフォルトで `performCasUpdate:161-172` の post-write verification が実行され、TOCTOU競合が `ConflictError` として検出される
- [x] 案Bの場合: `optimisticLock.ts:147-155` のコメントに加え、`dev-docs/ADR/` または `src/utils/optimisticLock.ts` の JSDoc に「デフォルト無効の理由と `enablePostWriteVerification()` を呼ぶべき条件」が明文化される
- [x] 既存テスト `src/utils/__tests__/optimisticLock.test.ts` / `optimisticLock-security.test.ts` / `optimisticLock-stress.test.ts` がパスする（案Aでは `enablePostWriteVerification` 呼び出しの有無に関わらずパスすること）
- [x] 並行更新の競合検出テスト（上記BDDのTOCTOU再現）が追加され、検証有効時に `ConflictError` が発生することを証明する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（ストレージ内部ロジック）

### 統合テスト
- `withOptimisticLock` を2並行で呼び出す統合テスト — `chrome.storage.local` をモックし、一方の `set` を遅延させ他方を割り込ませることでTOCTOUを再現
- `permissionManager.ts:60` / `trustDb.ts:17` / `savedUrlRepository.ts:16` 等の実利用箇所で `enablePostWriteVerification` 有効時の回帰がないこと

### 単体テスト
- `_postWriteVerificationEnabled` のデフォルト値が期待通りであることのテスト（`import { _postWriteVerificationEnabled }` は非公開のため、モックの `get` 呼び出し回数で検証: 有効時は `set` 後に `get` が1回多く呼ばれる）
- `performCasUpdate` の post-write 検証で `versionMatches=false` / `valueMatches=false` のそれぞれで `ConflictError` がスローされること
- `maxRetries` 超過時に `ConflictError` が最終的にスローされること（既存テストの維持）

## 実装アプローチ
- **Outside-In**: まずTOCTOU再現テスト（RED）を `optimisticLock-security.test.ts` に追加し、現行デフォルト（検証無効）では競合が検出されないことを証明 → デフォルト変更 or 文書化 → GREEN
- **Red-Green-Refactor**: 変更は1行（`let _postWriteVerificationEnabled = true`）だが、影響範囲（全 `withOptimisticLock` 利用箇所）の性能テスト（余分な `get` 1回のコスト）を計測し、必要なら選択的に有効化する案Bへピボットする判断を残す
- **ADR**: 案A/Bの選択理由を `dev-docs/ADR/2026-08-27-optimistic-lock-post-write-verification.md` に記録する

## 見積もり
0.2pt（デフォルト値変更1行 + テスト追加 + 文書化、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `optimisticLock.ts` は `chrome.storage.local` のみに依存するユーティリティ。呼び出し元は `permissionManager.ts`, `trustDb/trustDb.ts`, `storage/savedUrlRepository.ts`, `storage/settingsMigration.ts`, `SettingsRepository.ts`, `retryPendingWrites.ts` の6箇所
- テスタビリティ: `_postWriteVerificationEnabled` はモジュール内 `let` で外部から直接読み取れないため、テストでは `enablePostWriteVerification()` の有無で `chrome.storage.local.get` の呼び出し回数をカウントして間接的に検証する。またはテスト用に `isPostWriteVerificationEnabled()` ゲッターを追加することを検討
- 非機能要件: post-write verification 有効時は `set` ごとに `get` が1回増える（`performCasUpdate:162`）。`withOptimisticLock` の呼び出し頻度は低い（ユーザー操作時のみ）ため性能影響は軽微だが、高頻度呼び出しが将来増える場合は案B（選択的有効化）が適切
- Manifest V3特性: Service Worker は単一スレッドだが `await` による協調的マルチタスクで論理的並行性は存在する。`chrome.storage.local` はプロセス間で共有されるため、offscreen document や複数 Service Worker 再起動間の競合も考慮が必要
- 後方互換性: デフォルトを `true` に変更しても既存の正常系テストはパスするはず（検証が追加されるだけで成功パスは変わらない）。失敗パスでは `ConflictError` の検出が厳格になるため、既存の競合テストで `maxRetries` 調整が必要になる可能性あり

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "postWriteVerification\|_postWriteVerificationEnabled\|performCasUpdate" src/utils/optimisticLock.ts
# 該当: src/utils/optimisticLock.ts:146-181
cat src/utils/__tests__/optimisticLock*.test.ts | grep -n "enablePostWriteVerification"
# 現行テストで enablePostWriteVerification が呼ばれているか確認
```

### 実装手順
1. `src/utils/optimisticLock.ts:146-181` を読む — `performCasUpdate` の TOCTOU ウィンドウと `_postWriteVerificationEnabled=false` のデフォルトを確認
2. 方針を決定:
   - **案A (推奨・安全性優先)**: `src/utils/optimisticLock.ts:180` を `let _postWriteVerificationEnabled = true;` に変更する。1行修正で全呼び出し元で検証が有効になる
   - **案B (性能優先)**: `false` のまま `optimisticLock.ts:50-55` の JSDoc に `@remarks` として「デフォルト無効の理由と並行更新が想定される場合は `enablePostWriteVerification()` を呼ぶこと」を追記し、`dev-docs/ADR/` にADRを作成する
3. TOCTOU再現テストを追加 — `chrome.storage.local.get/set` をモックし、`performCasUpdate` の `verify read` と `set` の間に割り込み `set` を注入する:
   ```ts
   // モック例: get は version=1 を返し、set 呼び出し時に別コンテキストが version=2 に更新済みとする
   vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ key: "v1", key_version: 1 }); // initial read
   vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ key: "v1", key_version: 1 }); // verify read
   // 割り込み: 他コンテキストが set で version=2 に更新
   // A の set 後の post-write get で version=2 が返り ConflictError を期待
   ```
4. `npm run type-check && npx vitest run src/utils/__tests__/optimisticLock` で検証
5. 案Aの場合、全 `withOptimisticLock` 利用箇所の統合テストで `get` 呼び出し回数が1回増えることによるタイムアウトがないか確認

### 落とし穴
- `_postWriteVerificationEnabled` はグローバル `let` でありテスト間で共有される — テスト後に `false` にリセットするか、各テストで `enablePostWriteVerification()` の呼び出しを明示すること
- `JSON.stringify` による `valueMatches` 比較（`optimisticLock.ts:167`）はキー順序に依存する — `newValue` と `postWriteValue` のキー順序が異なる場合に誤検出する可能性があるため、将来的には `deepEqual` に置換を検討
- `enablePostWriteVerification()` は一度 `true` にすると `false` に戻す API がない — テスト隔離のために `disablePostWriteVerification()` または `resetPostWriteVerification()` の追加を検討すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `_postWriteVerificationEnabled` のデフォルト値方針が実装または文書化されている
- [x] TOCTOU競合が検証有効時に `ConflictError` として検出されることがテストで証明されている
- [x] コードレビュー完了
- [x] ADR または JSDoc で方針と理由が記録されている

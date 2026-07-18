# Checking Team レビュー指摘 — 副作用調査結果

> 親レポート: [2026-07-18-0522-review-findings-detail.md](2026-07-18-0522-review-findings-detail.md)
> 調査実施: 2026-07-18 | 対象: High未解決2件・Medium33件・Low16件（H3〜H5は修正済みのため対象外）
> 調査方法: サブエージェント2並列によるコードベース精査（呼び出し元・依存関係の実地確認）+ M31/M32は追加深掘り

---

## 凡例

```
🔴 副作用あり  — 実施すると既存機能・既存ユーザーに実害が出る可能性がある
🟡 副作用軽微  — コスト増や要検証点はあるが致命的ではない
🟢 副作用なし  — 安全に対処可能
```

---

## 🔴 副作用「あり」— 慎重な検討が必要（21件）

| ID | 指摘 | 副作用の内容 |
|---|---|---|
| H1 | APIキー暗号化の実質的無効化 | マスターパスワード必須化は既存ユーザー全員に強制設定を要求。未対応だとAPIキー復号不能に。cachedSettings即時クリアは既存キャッシュ機構と競合しレイテンシ増 |
| H2 | レガシー二重書き込み | フラグをfalseにするとレガシー履歴パネル（`historyPanel.ts`等）が更新検知できなくなる |
| M3 | web_accessible_resources過剰公開 | 動的importパス（ハッシュ付きチャンク名）を正確に把握せず絞ると「Failed to fetch dynamically imported module」エラー（既知の障害パターン） |
| M5 | OPFS復旧フラグ削除順序 | 現在の順序は「SW中断時も復旧可能」という設計意図が明記済み。逆にするとフラグとデータの不整合が起きうる |
| M7 | STORAGE_QUOTA_BYTES乖離 | `unlimitedStorage`権限があるため実質無害だが、値変更時はメモリ/パフォーマンス面の別制約に注意 |
| M8 | Offscreenログ消失 | SW未起動時の送信失敗フォールバックが必要。ログ順序変更の可能性 |
| M9 | SessionStoreがlocal使用 | `chrome.storage.session`の容量制限、offscreenからのアクセス設定、旧データ移行が必要 |
| M10 | pendingSqliteQueue個別INSERT | バッチ化で「一部成功」ハンドリングができなくなり、1件のエラーで全滅する挙動に変化 |
| M11 | SQLite単一Mutex直列化 | Mutex分離で読み取り中に書き込みが割り込む可能性（dirty read, SQLITE_BUSY） |
| M13 | wa-sqlite本番依存残存 | 旧wa-sqlite製DBからの自動移行機能が現役。除外すると移行未完了ユーザーがデータ消失/読込不能 |
| M16 | トークン使用量報告の非一貫性 | プロバイダごとにundefined/0/nullの扱いが違い、FinOps集計値に影響 |
| M17 | audit logごとのINSERT | バッチ化はSW終了時のログ消失リスクとのトレードオフ（現状の即時INSERTはSW終了耐性のため） |
| M18 | 単一Offscreen文書でSQLite+AI | Offscreenライフサイクル管理の二重化が必要な大規模設計変更 |
| M25 | データ保持期間デフォルト無制限 | 既存ユーザーが次回`getSettings()`時に「無制限→有限」に切替わり、**古い履歴が意図せず自動削除される** |
| M26 | レガシー同意バージョン欠落 | 強制再同意で、移行未実行の既存ユーザーに同意モーダルが再表示されUX中断 |
| M27 | デフォルトprivacy modeがcloud AI | 既存ユーザーが突然local_only必須になり要約生成が止まる可能性（M25と同種の破壊的変更） |
| M30 | OpenAIProvider分岐の複雑さ | StorageKeysの動的キー生成ロジックと密結合。5種のproviderName全てで解決結果一致を保証する必要 |
| M33 | 二重ログAPI混在 | 153箇所の呼び出し、シグネチャが異なり機械的置換不可。中〜大規模 |
| M34 | InsertableRecord/InsertRecordFields重複 | 用途（optional vs 非optional前提）が異なり、統合は型設計の再整理が必要 |
| M35 | tsconfig testsを型チェック除外 | 実測: 13106件のエラー（うち84%はvitestグローバル未解決の設定不備、残り2000件超は実質的な型エラー）。**即座にvalidateへ含めるとビルド破綻** |

---

## 🟡 副作用「軽微」（5件）

| ID | 指摘 | 内容 |
|---|---|---|
| M6 | optimisticLock CAS競合窓 | 既に二重チェック実装済み。追加検証はI/O呼び出し1回増でレイテンシ微増程度 |
| M14 | トレースID不在 | 型追加自体は非破壊的（オプショナルフィールド）。ただし全箇所伝播はリファクタ規模大 |
| M15 | スキーマバージョン番号なし | 既存の移行フラグとは別レイヤーで衝突しない。追加のみで対応可 |
| M20 | i18n.ts重複 | 3箇所に実質差分あり（型シグネチャ、フォールバック挙動）。統合時は挙動差の検証が必要だが影響範囲は限定的 |
| M29 | wa-sqlite caret range | package-lock.jsonが既に事実上固定。npm ci運用なら実害小 |

---

## 🟢 副作用「なし」（26件）

| ID | 指摘 | 根拠 |
|---|---|---|
| M1 | sender.id未検証 | 送信元はpopupのみ（grepで確認済み）。他ハンドラと同じガードパターンを追加するだけ |
| M2 | Math.random()フォールバック | ID形式に依存する他コードなし。二次的フォールバックパスのみ |
| M4 | IDB VFSバックアップ12カラム | 緊急時のみ実行される処理。パフォーマンス影響は軽微、後方互換もデフォルト値適用で対応可 |
| M19 | Dashboard lang属性空文字 | JS実行後に必ず`setHtmlLangAndDir`で上書きされる。初期HTMLの一瞬のみの影響 |
| M21 | サイドバー/パネルtablist不完全 | クリックハンドラは`data-panel`属性ベースで、role/aria追加はCSS/JSに影響しない |
| M22 | Permissionsページ日本語ハードコード | 他entrypointと同一の確立されたi18nパターンへの追従 |
| M23 | ACCESSIBILITY.mdパス | 実際に確認したところ現状のパスは正しかった（誤指摘の可能性）。ドキュメントのみで無害 |
| M24 | タブ切替後フォーカス移動なし | 既存の属性操作ロジックとは独立した追加処理 |
| M28 | THIRD_PARTY_NOTICES未網羅 | ドキュメント・CI変更のみ、実行コードに影響なし |
| M31 | sqliteHistoryPanel重複 | 深掘り済み（下記詳細参照）。重複ではなくデッドコード削除。実行時影響なし |
| M32 | saveSqliteStepの楽観的ロックno-op | 深掘り済み（下記詳細参照）。UNIQUE制約は既に有効に機能中。ロックは本当に無意味だった |
| L1〜L4, L6, L8〜L16 | CSS幅、README、locale、バンドルサイズ、ログ保持、uuid override、プロトコルバージョニング等 | いずれもドキュメント/CSS/定数の独立した追加・調整で、既存ロジックへの結合が薄い |
| L5 | Offscreen Mutex 200上限 | モバイル用に値を50に変更するだけ（`sqliteClient.ts:78`の`maxQueueSize`パラメータ調整） |
| L7 | 毎回Pipeline新規生成 | ファクトリ抽出は既存の`record()`呼び出し元に影響しない範囲で対応可能 |

---

## 深掘り詳細: M31

**当初の疑問**: `src/dashboard/sqliteHistoryPanel.ts` と `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` の間で7ユーティリティ関数が重複しているとの指摘。統合時に壊れる差分がないか要確認とされていた。

**調査結果**: 重複ではなく、片方が完全なデッドコードだった。

- `src/dashboard/main.ts:8,32` — `createSqliteHistoryPanel()` を `./panels/asyncData/sqliteHistoryPanel.js` からimportし、`DashboardBootstrapper.registerPanels()` に登録。**これが実際にダッシュボードへ描画される現行アクティブなパネル**。
- `src/dashboard/sqliteHistoryPanel.ts`（トップレベル、1149行）は `main.ts` から一切参照されていない。
- この旧ファイルの唯一のexport利用先は `src/dashboard/historyPanel.ts`（`searchForTagInSqliteHistory` をimport、10行目・177行目）。
- しかし `src/dashboard/historyPanel.ts` 自体もどこからもimportされていない。`main.ts:7` は代わりに `./panels/asyncData/historyPanel.js` を使用している。

**結論**: 旧 `sqliteHistoryPanel.ts`（1149行）+ 旧 `historyPanel.ts`（トップレベル）は合わせて約1900行の完全なデッドコード。テストファイル4本（`__tests__/sqliteHistoryPanel*.test.ts`）だけが旧ファイルの `_test` エクスポートを参照している。**対処は「統合」ではなく「削除」**。テストも合わせて削除すれば実行時のダッシュボード動作には一切影響しない。

---

## 深掘り詳細: M32

**当初の疑問**: `saveSqliteStep.ts` の `withOptimisticLock` がREADのみでWRITEの分岐に使われておらず実質no-opとの指摘。削除した場合に重複防止機能が本当に失われないか（Offscreen側のUNIQUE制約の有無）が未確認だった。

**調査結果**: コールチェーンを実装まで追跡。

- `saveSqliteStep.ts:18-22` — `withOptimisticLock` の戻り値は完全に破棄されており、後続の `params.sqliteClient.insert(params.record)`（24行目）には一切渡されていない。指摘通り本当に無意味。
- `sqliteClient.insert()` → offscreen `SQLITE_INSERT` メッセージ → `recordsRepo.ts: insert()` → `IdbVfsBackend.ts:28-36` を実装まで確認。
- `IdbVfsBackend.ts:32` — 単体 `insert()` は **`INSERT_SQL`（`INSERT OR IGNORE` ではない）** を使用。
- `INSERT_IGNORE_SQL` を使うのは `insertBatch`（48行目）のみ。
- `schema.ts:43` — `UNIQUE(url, created_at)` 制約はテーブル定義でDBレベルに常時存在。

**結論**: UNIQUE制約はDBレベルで常に有効なため、楽観的ロックの有無に関わらず重複行がDBに2件入ることはない。ただし単体insert経路は `INSERT OR IGNORE` ではないため、重複挿入の試行は「静かにスキップ」ではなく「例外throw」という挙動になる（`saveSqliteStep.ts:35-40` でログ記録後re-throw）。この挙動はロックの有無と無関係に既に発生している。**ロック単純削除の副作用はなし**。ただし対処のついでに `insert()` 側を `INSERT_IGNORE_SQL` に変更する場合は、呼び出し元の `if (!insertResult)` 分岐や後続の `update()` 呼び出しの挙動が変わるため、その変更は別途検証が必要。

---

## サマリ

| 分類 | 件数 |
|---|---|
| 🔴 あり | 21 |
| 🟡 軽微 | 5 |
| 🟢 なし | 26 |
| 修正済み(H3-H5、対象外) | 3 |
| **合計** | 55 |

### 対処優先度の所見

- **着手しやすい候補**: M31（デッドコード削除、実行時影響なし）、M1（sender.id検証追加）
- **最重要な検討事項**: M25・M27（デフォルト値の破壊的変更、既存ユーザーの動作が静かに変わる） — 実施するなら移行期間・アナウンスを伴う設計が必須
- **要追加確認**: なし（M31・M32は本調査で確定）

---

*Generated from 2026-07-18-0522-review-findings-detail.md — 51件の指摘に対する副作用調査（2並列サブエージェント + 深掘り2件）*

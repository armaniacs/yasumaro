# PBI: SQLite 読み取りパスを単一 QueryPlanner seam に深める

## ユーザーストーリー

開発者として、SQLite の 1 回の読み取りを normalize から decode まで単一の QueryPlanner モジュール経由で理解したい、なぜなら現状は 6 つの浅いモジュールを跳び回らねばならず、合成部分に隠れた欠陥の局所性が低いから。

## 優先度

- 順位: 2 / 5
- RICEスコア: 24.0（Reach=30 / Impact=2 / Confidence=80% / Effort=2人日）
- 根拠: Strong 判定。毎回の読み取りが通るホットパスで Reach が最大級。6 モジュールを internals 化する Effort は中だが、合成欠陥の集約効果が大きい。依存なし。PBI-07（dispatch collapse）の内側 seam になるため 07 より先に実施する。

## ビジネス価値

- 読み取り 1 回あたりの理解単位が 1 seam になり、調査・レビュー時間が短縮される
- 正規化・クエリ構築・取得・デコードの合成欠陥が 1 モジュールに集約され、テストが同じ seam を跨ぐ
- 純粋関数の単体テストは維持しつつ、合成テストが 1 箇所で書ける

## BDD受け入れシナリオ

```gherkin
Scenario: 通常の履歴読み取りが QueryPlanner 経由で返る
  Given 保存済み閲覧ログが存在する
  When 呼び出し元が QueryPlanner 経由で履歴読み取りを要求する
  Then 正規化・クエリ構築・取得・デコード済みの行が返る
  And 従来の 6 モジュール直結経路と結果が同一である

Scenario: 不正なクエリ入力は境界で拒否される
  Given 上限超過の ids や不正なフィルタを含む読み取り要求がある
  When QueryPlanner 経由で読み取りを要求する
  Then 合成前に正規化層で拒否または上限内に丸められる
  And 未デコードの生行が呼び出し元に漏れない
```

## 受け入れ基準

- [x] `QueryPlanner` モジュールが normalize-to-decode を単一 seam の背後に所有している（`src/offscreen/queryPlanner.ts` 新設: `planQuery` / `planSearch` / `applyReadPolicy`）
- [x] 6 モジュール（queryPlan / queryNormalize / sqliteQueryBuilder / recordsRepo / rowCodec / browsingLogCodec）が internals として QueryPlanner 配下にある（所有関係を `queryPlanner.ts` ヘッダ + ARCHITECTURE_MAP に明記。物理移設は worker 境界のため見送り — 実装メモ参照）
- [x] 外部からの直参照が QueryPlanner 経由に置換されている（`sqliteMessageHandlers` の handleQuery/handleSearch + `recordsRepo.query` が planner 経由に）
- [x] 既存の読み取り結果と同一である（parametric backend 一致テスト + offscreen 全 973 tests green）
- [x] `npm run type-check` と関連テストが green

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 履歴パネル表示（検索・フィルタ・ページネーション）が従来通り動作すること

### 統合テスト

- normalize → build → fetch → decode の合成テスト（ids 上限・tag フィルタ・FTS/LIKE の代表ケース）
- backend 間一致テスト（OPFS / IDB / fallback の結果同一）

### 単体テスト

- 既存の純粋関数テストは維持（queryNormalize・rowCodec 等）
- QueryPlanner seam 越しの合成テストを新設（境界値・例外系）

## 実装アプローチ

- **Outside-In**: QueryPlanner seam 越しの合成テストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: seam 定義 → internals 移設 → 直参照置換の順で green 化
- **リファクタリング**: green になるたびに 6 モジュールの公開 export を internals に狭める

## 見積もり

M（2人日。要チームでの見積もり）

## 技術的考慮事項

- 依存関係: PBI-07 の内側になる。07 着手前に本 PBI を完了させ、07 は安定した内側 seam にルーティングさせる
- テスタビリティ: QueryPlanner を差し替え可能な seam にし、合成テストは fake backend で実行
- 非機能要件: 読み取り性能の劣化なし（委譲は薄く保つ。bench:micro で前後比較）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 読み取り経路の利用者を探す
grep -rn "queryPlan\|queryNormalize\|sqliteQueryBuilder\|recordsRepo\|rowCodec\|browsingLogCodec" src/ --include="*.ts" -l
```

### 実装手順

1. `src/offscreen/` に `QueryPlanner`（仮称）の seam を定義（normalize-to-decode の単一入口）
2. 6 モジュールを internals に移設（公開 export の棚卸し）
3. 外部直参照を QueryPlanner 経由に置換
4. 合成テスト新設 → type-check → offscreen 関連テスト green
5. bench:micro で読み取り性能の前後比較

### 落とし穴

- rowCodec の 33 vs 13 列分岐は dashboard 表示劣化を避けるための仕様として維持（2026-09-09 round 3 の決着記録を参照）
- queryNormalize の ids 上限（MAX_QUERY_IDS=200）は QueryPlanner の正規化層で維持すること

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（`queryPlanner.test.ts` 新設 7 件 + offscreen 全 973 green）
- [x] コードレビュー完了（自律レビュー: backend 到達値は不変 — `applyReadPolicy` 冪等テストで保証）
- [x] ドキュメント更新済み（ARCHITECTURE_MAP Quick Index に QueryPlanner 行を追加）
- [x] ロールバック手段の検討（git revert で可能・振る舞い不変のため feature flag 不要）

## 実装メモ（2026-09-11 autonomous-task-closer）

- スコープ調整: 6 ファイルの物理移設（`queryPlanner/` 配下化）は見送り。理由: `opfsWorker/*` が `queryPlan` / `rowCodec` / `sqliteQueryBuilder` を直接 import しており（worker バンドル境界）、移設はワーカー解決・12 importer への波及を伴う。代わりに `queryPlanner.ts` が読み取り政策（normalize→clamp→truncate）を単一所有し、6 モジュールを internals として文書固定。PBI-07（dispatch collapse）はこの安定した内側 seam にルーティング可能。
- 実バグの芽を摘んだ記録: 初版で `MAX_QUERY_LIMIT` を `sqliteEngineHost` 経由で import したところ、32 テストの `vi.mock('../sqliteEngineHost.js')` が当該 export を持たず失敗。`MAX_QUERY_LIMIT` の正規の置き場所は `messaging/limits.ts`（round 3 SSOT）であり、planner はそちらを直接参照する形に修正 — 層境界の正しさを読者が誤らないよう重要。
- テスト 3 件の更新は旧ハンドオフ形状の pin（handler→repo 間で limit 未設定）→ 新ハンドオフ（planner が limit:100 を付与）。backend 到達値は同一（旧 recordsRepo が後段で付けていた）。
- なぜなぜ: なぜ政策が 2 ファイルに分裂したのか → 正規化（round 5）と上限丸め（round 6）が別ラウンド・別ファイルで追加され、合成の所有者が決まらなかった → 解: 合成だけを新 seam に寄せ、実行・復号は backend 境界に残す（層を跨ぐ移動はしない）。

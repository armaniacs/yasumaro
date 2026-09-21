# PBI: tagCooccurrenceHybrid の WASM プローブ negative cache を是正し一時的失敗で TS 経路に固定されないようにする

## ユーザーストーリー
ダッシュボード利用者として、初回表示時の一時的な WASM 読み込み失敗があっても次回以降は高速な WASM 経路に戻ってほしい、なぜなら一度の遅延 fetch でその生存期間の全呼び出しが低速な TS 経路に固定されると大規模タグ集合の描画が遅くなり続けるから

## 優先度
- 種別: fix
- 順位: 8
- RICEスコア: 6.0（Reach=3 / Impact=1 / Confidence=1.0 / Effort=0.5週）
- 根拠: 発生条件は初回プローブと一時的失敗の重なりに限られ Reach は 3 に留まるが、発生時は 10k×20 で実測 5.53x 劣化の TS 経路に全固定される。修正は hybrid 層のキャッシュ方針のみで Effort は 0.5週と小さい

## ビジネス価値
一時的失敗（遅延 fetch・CSP 競合・起動直後の競合）による性能劣化の固定化が消える。大規模 Vault でのタグクラスタ描画が次回呼び出しで WASM 性能に回復し、ダッシュボードの体感速度のばらつきが減る

## BDD受け入れシナリオ

```gherkin
Scenario: 初回プローブ失敗の次回呼び出しで再プローブする
  Given initTagCooccurWasm の初回呼び出しが一時的 fetch 失敗で例外になる
  When computeTagCooccurrenceHybrid を呼び出す
  Then 初回は TS リファレンスの結果を返す
  And 次回呼び出しでは再度 initTagCooccurWasm を試みる

Scenario: 回復後は WASM 経路に戻り成功はキャッシュ維持する
  Given 初回プローブ失敗後に fetch 障害が解消した
  When computeTagCooccurrenceHybrid を再度呼び出す
  Then WASM コアの結果を返す
  And 以降の呼び出しでは再プローブせず成功キャッシュを使う

Scenario: 失敗バースト中のログは1回に抑える
  Given WASM 初期化が連続して失敗する
  When 短期間に複数回 hybrid を呼び出す
  Then warn ログと addLog は失敗バースト毎に1回だけ記録される
  And 返却値は毎回 TS リファレンスと一致する
```

## 受け入れ基準
- [ ] プローブ失敗が永続キャッシュされず、bounded TTL の negative cache か次回呼び出しでの再プローブのいずれかで回復する
- [ ] プローブ成功は従来どおりキャッシュ維持し、毎回初期化を繰り返さない
- [ ] 失敗バースト中の warn ログと addLog は1回に制限される
- [ ] narrowEntriesToTopTagsHybrid と computeTagCooccurrenceHybrid の双方が同一プローブ方針を使う
- [ ] 全出力が byte 等価（既存 hybrid・parity テスト green）
- [ ] 進行中 PBI 2026-09-20-13 が吸収予定の probe 契約として、失敗時再プローブを doc comment に記録する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（プローブ層の内部キャッシュ方針変更）

### 統合テスト
- initTagCooccurWasm の失敗→成功シーケンスで hybrid が TS→WASM に回復すること
- compute 系と narrow 系の双方で回復パスを確認する

### 単体テスト
- 初回失敗→次回再プローブ、成功→キャッシュ維持、失敗バースト→ログ1回の境界
- TTL 採用時は期限前は再試行せず期限後に再プローブすること、再プローブ採用時は毎回再試行することのいずれか採用方針側のみ

## 実装アプローチ
- **Outside-In**: 失敗→再試行→回復の契約テストを先に書き、Red で isWasmAvailable を修正
- 失敗側は bounded TTL の negative cache か次回呼び出しでの再プローブのいずれか小さい方を選び、成功側キャッシュは変えない
- ログは最終失敗時刻つきのガードでバースト毎1回に絞る

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 進行中 PBI 2026-09-20-13（共有 hybrid runtime・closer 管理）が probe 契約を吸収する予定。本 PBI の契約（失敗時再プローブ・成功キャッシュ維持・バースト毎ログ1回）を runtime 側が維持すること
- 遵守すべき方針: 成功キャッシュ維持、失敗は再試行可能、ログはバースト毎1回
- 非機能要件: 出力 byte 等価を保つ。プローブ追加による通常時のオーバーヘッドを増やさない（成功時は追加 fetch なし）

## 実装者向け注記

### 現状の証拠
- 永続 negative cache: `src/dashboard/tagCooccurrenceHybrid.ts:46`（`let wasmAvailable: boolean | null = null`）と `src/dashboard/tagCooccurrenceHybrid.ts:53-69`（`isWasmAvailable` が catch で `false` を代入し次回以降 `wasmAvailable !== null` で早期復帰するため再プローブしない）
- 下層はリトライ可能: `src/wasm/initWasm.ts:61-68`（`initExtensionWasm` が失敗時に `initPromises.delete` で reset-on-failure するため下層単体では回復できる）
- 影響域: `src/dashboard/tagCooccurrenceHybrid.ts:95,123`（両 hybrid 入口が `isWasmAvailable` の false に固定されると全呼び出しが TS 経路に落ちる。10k×20 で実測 5.53x 劣化）
- ログ現状: `src/dashboard/tagCooccurrenceHybrid.ts:60-66`（失敗時に毎回ではなく初回のみ記録される構造だが、再プローブ化後はバースト毎1回のガードが必要）
- 連携: PBI `pbi/2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md` が probe 契約の吸収先。本 PBI で定める失敗時再プローブ契約を runtime の doc comment に引き継ぐこと

## Definition of Done
- [ ] 全BDDシナリオが実装されパスする
- [ ] コードレビューが完了する
- [ ] 統合検証が green（既存 hybrid・parity テストを含む）

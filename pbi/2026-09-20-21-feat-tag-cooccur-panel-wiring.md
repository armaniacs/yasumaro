# PBI: タグクラスタパネルを tag-cooccur ハイブリッドに切り替える（STAGED解除）

## ユーザーストーリー

ダッシュボード利用者として、タグクラスタパネルを履歴が1万件規模でも固まらずに開きたい、なぜなら WASM コア（本番経路 1.55〜5.53x実測）は完成済みだがパネルがまだ TS 直呼びのため、利用者に速度改善が届いていないから

## 優先度

- 順位: 1 / 2（本実装 iteration-2 の残作業）
- RICEスコア: **16.0**（Reach=5 / Impact=2 / Confidence=80% / Effort=0.5週）
- 根拠: 配線なしでは実装済み WASM の価値が0のまま。呼び出し側 `tagClusterPanel.load()` は既に async のため同期→非同期化の波及なし（実装時確認済み）。STAGED 前例（sentence-dedup）の手順が確立している
- 依存: なし（単独で着手可）。PBI-22（CIゲート）とは独立

## ビジネス価値

10k×20tags で TS 約256ms → WASM 約46ms（5.53x、bench実測・本番経路）。タグクラスタ表示のロングタスクを削減し、パネル操作の体感引っかかりを解消する。測定方法: `src/wasm/tag-cooccur/bench.ts` の max シナリオ + パネル実操作の体感確認

## BDD受け入れシナリオ

```gherkin
Scenario: 大規模履歴でパネルが WASM 経路で速く開く
  Given 10000 件の閲覧履歴（各 20 タグ）
  When タグクラスタパネルを開く
  Then 共起集計が WASM ハイブリッド経由で完了し、表示内容が従来（TS 直呼び）と同一である

Scenario: WASM が使えない環境でもパネルは壊れない
  Given WASM 初期化が失敗する環境（CSP ブロック等）
  When タグクラスタパネルを開く
  Then TS フォールバックで従来通りの表示になり、エラーで空白にならない

Scenario: 小規模履歴は TS のまま速い
  Given 32 エントリ未満の履歴
  When パネルを開く
  Then サイズルーティングにより TS パスが使われる
```

## 受け入れ基準

- [ ] `tagClusterPanel.ts` の `computeTagCooccurrence` / `narrowEntriesToTopTags` 呼び出しがハイブリッド版（await）に置換される
- [ ] `public/wasm/tag_cooccur_bg.wasm` がコミットされ、wxt の `build:publicAssets` で `dist/wasm/` に配布される（STAGED解除）
- [ ] `src/wasm/tag-cooccur/index.ts` の STAGED 注記が更新される
- [ ] パネル表示の nodes/edges が TS 直呼び時と同一（既存パネルテスト + 目視）
- [ ] `npm run validate` が green

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- タグクラスタパネルの既存表示テストが WASM 配布物込みでパスする

### 統合テスト

- ハイブリッド wasm-success スイート（大入力必須）が引き続きパスする
- WASM 欠落時（public コピー削除状態）でもパネルが TS フォールバックで表示する

### 単体テスト

- 既存パリティスイート（37件）が変更なしでパスする

## 実装アプローチ

- **Outside-In**: パネル表示テスト（失敗＝未配線）→ 配線 → グリーン → リファクタリング
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

0.5週（要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし（`tagCooccurrenceHybrid.ts` は実装済み・テスト済み）
- テスタビリティ: wasm-success テストは `vi.mock` でディスク読み込み済み
- 非機能要件: dist への約78KB バイナリ追加（`tag_cooccur_bg.wasm` 実測サイズ）。CSP トークン追加は不要（`wasm-unsafe-eval` 済み）
- ロールバック: 配線コミットを revert すれば TS 直呼びに戻る（ハイブリッド自体は残置可）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 機能に関連するキーワードでコードを探す
grep -rn "computeTagCooccurrence\|narrowEntriesToTopTags" src/ | grep -v __tests__ | grep -v Hybrid
grep -rn "sentence_dedup_bg.wasm" wxt.config.ts public/wasm/ src/wasm/sentence-dedup/index.ts
```

STAGED 状態（public コピーなし・publicAssets なし・パネル未配線）であることを確認してから実装に進むこと。sentence-dedup が同一 STAGED 状態の前例。

### 実装手順

1. `npm run build:wasm` で `public/wasm/tag_cooccur_bg.wasm` を生成・コミットする（build:wasm は tag-cooccur の public コピーを行わないため手動 `cp` が要る点に注意 — 配線時に build:wasm への public コピー追加も検討）
2. `wxt.config.ts` の `build:publicAssets` に dist 配布エントリを追加する（sentence-dedup 用の NOTE コメントが再開場所を示す）
3. `tagClusterPanel.ts` の2呼び出しをハイブリッド版に置換し `await` する（`load()` は async 済み）
4. `src/wasm/tag-cooccur/index.ts` の STAGED 注記を「配布中」に更新する
5. `npm run validate` + パネルの目視確認（Chrome 手動読み込みはユーザー側で実施）

### 落とし穴

- `new URL('./tag_cooccur_bg.wasm', import.meta.url)` への書き換えは厳禁（Vite が `data:` URI にインライン化し CSP で死ぬ — postprocess-wasm-glue.mjs が存在する理由）
- public コピーと src コピーの二重管理: CI の `cmp` ゲート（PBI-22 実施後は自動検出）が片側コミットを検出する
- `limitToTopNodes` は移植対象外（TS のまま残す）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（上記「技術的考慮事項」に記載済み）
- [ ] ドキュメント更新済み

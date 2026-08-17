# PBI: trustDb の CRUD を ManagedStringList パターンに抽出する

## ユーザーストーリー
開発者として、`trustDb.ts`（889行）の5系統のCRUDメソッド（add/remove × userTlds/jpAnchorTlds/sensitive/whitelist）がすべて indexOf＋splice＋save を重複し、Trancoバージョン追跡（~120行）が動的importでtrustDBクラスに結合している状態を解消したい。なぜなら、新しいリスト追加に2メソッド必要で、Tranco関心が信頼DBクラスを汚染しているから。

## 優先度
- 順位: 6 / 6
- RICEスコア: 0.50（Reach=3 / Impact=1 / Confidence=50% / Effort=3人日）
- 根拠: Worth exploring（確信50%）。PBI-27「trustDbゴッドモジュール分解」(13pt Epic)との強い重複。本PBIはその狭い具体策（ManagedStringList＋TrancoVersionTracker）。PBI-27に折り込むか、その先駆けとして小分け実施するか調整が必要。

## ビジネス価値
- CRUDが1クラスに集約（~230行→~30行）
- 新リスト追加＝1インスタンス（2メソッド→1インスタンス）
- Tranco結合が自クラスに分離
- 889→~680行

## BDD受け入れシナリオ

```gherkin
Scenario: CRUDが ManagedStringList に集約される
  Given ManagedStringList クラス（add/remove/getAll、optional validator）が導入されている
  When 4つのリスト（userTlds/jpAnchorTlds/sensitive/whitelist）をインスタンス化する
  Then 重複していた add/remove メソッド8個が解消され
  And 各リストが validator を通じて検証される

Scenario: validator付きリストと無しリストが正しく振る舞う
  Given sensitiveドメイン等は validator を持ち、whitelist 等は validator を持たない
  When add/remove を実行する
  Then validator付きリストは不正値を拒否し
  And validator無しリストは素通りする
```

## 受け入れ基準
- [ ] `ManagedStringList` クラス（`add(item, validator?)`/`remove(item)`/`getAll()`）が新設されている
- [ ] 4リストがインスタンス化され、重複した add/remove 8メソッドが解消されている
- [ ] `TrancoVersionTracker` が分離されている
- [ ] 既存の `trustDb.test.ts` / `trustDb-validation.test.ts` がパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 信頼判定・Trancoリスト更新が従来通り動作する

### 統合テスト
- ManagedStringList と settingsStore の永続化（save）連携
- TrancoVersionTracker の分離後もバージョン追跡が機能する

### 単体テスト
- ManagedStringList の重複追加・削除・validator拒否の境界
- TrancoVersionTracker の新旧バージョン検知

## 実装アプローチ
- **Outside-In**: 既存テストで信頼判定・CRUD挙動を固定してから抽出
- **Red-Green-Refactor**: リスト単位でインスタンス化し、グリーンを維持

## 見積もり
3pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: **PBI-27（trustDb分解, 13pt, 未着手）と強い重複**。本PBIはPBI-27のサブセット。二重作業を避けるため、PBI-27のスコープに折り込むか、本PBIをPBI-27の先駆け（小さい安全な一歩）と位置づけること
- 副作用: 信頼判定・Trancoリスト更新。挙動不変をテストで固定
- テスタビリティ: ManagedStringListは純粋なコレクション操作としてテスト容易

## 実装者向け注記

### 現状コードの確認
```bash
# 重複CRUDメソッドを確認
grep -n "async add\|async remove" src/utils/trustDb/trustDb.ts
# 動的import（settingsStore結合）を確認
grep -n "await import" src/utils/trustDb/trustDb.ts
```

### 現状（2026-08-17 確認済み）
- `trustDb.ts` 889行。重複CRUD: `addUserTld`/`removeUserTld`(575/582)、`addJpAnchorTld`/`removeJpAnchorTld`(645/652)、`addSensitiveDomain`/`removeSensitiveDomain`(679/707)、`addToWhitelist`/`removeFromWhitelist`(733/761)
- Trancoバージョン追跡は776-860行（`getCurrentTrancoVersion`/`getSavedTrancoVersion`/`updateTrancoVersion`/`checkTrancoUpdate`/`getSavedTrancoDomains`/`isTrancoDomain`）
- 注意: `checkTranco`（460行）は信頼判定の中核で、バージョン追跡とは別関心。`updateTranco`（508行）はリスト更新

### 実装手順
1. 既存テストで信頼判定・CRUD挙動を固定
2. `ManagedStringList` クラスを新設（add/remove/getAll、optional validator）
3. 4リストをインスタンス化し、重複CRUDメソッドを置換
4. `TrancoVersionTracker` を分離
5. 既存テストでグリーンを確認

### 落とし穴
- `checkTranco`（信頼判定）とバージョン追跡（776行〜）は分離対象が異なる。判定ロジックは動かさず、CRUDとバージョン追跡の抽出に限定
- `getSettingsStore` 等の動的importヘルパーは既存のまま（PBI-27の循環依存解消はスコープ外）
- validator（例: sensitiveドメインの形式検証）はリストごとに異なる。インスタンス化時にvalidatorを注入できる設計にする

## Definition of Done
- [ ] `ManagedStringList` クラスが新設されている
- [ ] 4リストがインスタンス化され、重複CRUDが解消されている
- [ ] `TrancoVersionTracker` が分離されている
- [ ] 既存のtrustDbテストがパスしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）

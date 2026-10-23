# PBI: popup tab照会の1 module化

## ユーザーストーリー

保守担当者として、tab取得の学びを1 moduleに縮めたい。なぜなら3連鎖の各interfaceがimplementationと同大で、deletion testで消える複雑さがゼロに近いから。

## 優先度

- 順位: 08 / 全8件
- RICE スコア: 4（Reach = 5 / Impact = 1 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: 主としてdrift防止のため最下位。Confidence 0.8 は畳み方（統合か方針付与か）の設計判断残り。

## ビジネス価値

tabなし・URLなしの扱いが1箇所に集まり、呼び側5箇所のdriftを防げる。

## BDD受け入れシナリオ

```gherkin
Scenario: tab取得が1 moduleで動く
  Given 各種のtab状態がある
  When 取得する
  Then 変更前と同一に返る

Scenario: degenerate扱いが1箇所に集まる
  Given tabなし・URLなしがある
  When 取得する
  Then 1箇所の扱いに従う
```

## 受け入れ基準

- [ ] 照会が1 module・interface 3点に固定される（またはstatusStoreに方針を持たせる）
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- popup表示フローテスト維持

### 単体テスト
- 照会のtable（tabあり・なし・URLなし）

## 実装アプローチ

- **Outside-In**: 照会の失敗テストを先に書き、赤を確認してから畳む

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 取得結果不変（fresh-look意味論を保つ）

## 変更点の概要

3 moduleを1つの照会moduleに畳む（または方針付与でdepthを持たせる）。

## 現状と問題（file:line 付き）

- `src/popup/tabUtils.ts:12-33` ― 取得3関数（全33行）
- `src/popup/recordCurrentPage/currentTabPage.ts:17-56` ― null包み直し＋gate委譲
- `src/popup/statusStore.ts:12-26` ― 結合のみ（全27行）
- 呼び側5箇所（statusPanel・recordSession）

## 変更の理由（depth）

deletion testで消える複雑さゼロのshallowさ。畳んで学びを縮める。

## 提案コード（骨子にもならない判断メモ）

```typescript
// 案A: 1 module・3 methodに畳む。案B: statusStoreに再取得方針を持たせる。
// fresh-look意味論（recordSession.ts:99）の置き場所で決める。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "getCurrentTab\|loadActiveTabStatus\|fetchCurrentTab" src/popup/ --include='*.ts' | grep -v __tests__ | head
```

### 落とし穴

- fresh-look意味論を落とさない（案選択の決め手にする）
- 取得結果を変えない

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み

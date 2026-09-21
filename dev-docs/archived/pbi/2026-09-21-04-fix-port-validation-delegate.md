# PBI: ダッシュボードのポート検証を validateObsidianPort に委譲し挙動不一致を解消する

## ユーザーストーリー
利用者として、ダッシュボードで無効なポート番号を入力したときにその場で拒否されたい、なぜなら保存後に接続テストで拒否される save-then-fail は原因の切り分けを難しくし、設定の手戻りを増やすから

## 優先度
- 順位: 3 / 5
- RICEスコア: 12.0（Reach=3 / Impact=2 / Confidence=100% / Effort=0.5週）
- 根拠: 発生頻度は限定的だが、検証の二重所有は範囲変更時に2箇所編集を強い、挙動の乖離を将来も再発させる。委譲は小規模で確実に不一致を消せるため優先度は中位

## ビジネス価値
ダッシュボードと Service Worker のポート判定が単一実装に収束し、無効値の保存後失敗が消える。範囲変更時の修正箇所が1箇所になり、検証仕様の保守コストが下がる

## BDD受け入れシナリオ

```gherkin
Scenario: 小数・後置文字列を含むポートはダッシュボードで拒否される
  Given ダッシュボードのポート入力欄
  When '80.5' または '80abc' を入力する
  Then validateObsidianPort と同じ判定で拒否され、ポートエラーが表示される

Scenario: 境界値は単一実装の判定に従う
  Given ダッシュボードのポート入力欄
  When '' / '0' / '65535' / '65536' を入力する
  Then '' は既定値扱いで許容され、'0' と '65536' は拒否され、'65535' は許容される

Scenario: Service Worker とダッシュボードの判定が一致する
  Given 同一のポート入力値
  When ダッシュボード検証と接続テスト側検証を実行する
  Then ダッシュボードで保存できた値が接続テストで拒否されることはない
```

## 受け入れ基準
- [x] validatePort が validateObsidianPort への委譲で実装される
- [x] validateObsidianPort の throw がポートエラー表示に変換される
- [x] '80.5' と '80abc' がダッシュボードで拒否される
- [x] 境界値 '' / 0 / 65535 / 65536 の判定が単一実装と一致する
- [x] 有効なポートで既存の保存フローが変わらず成功する
- [x] 新設の境界テストが追加され green である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(検証ロジックの集約であり画面遷移の変更なし)

### 統合テスト
- ダッシュボード保存から接続テストまでの経路で、無効ポートが保存前に止まること

### 単体テスト
- validatePort の境界テスト: '80.5' / '80abc' / '' / '0' / '65535' / '65536' の許容可否
- throw からエラー表示への変換: 拒否時にポートエラーが設定され false を返すこと

## 実装アプローチ
- **Outside-In**: 境界値の失敗テストを先に書き(Red)、validatePort を validateObsidianPort の try/catch 委譲に置き換えて Green にする
- throw の種別によらず一律でポートエラー表示に変換し、成功時は既存のエラー解除を維持する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。他の検証(プロトコル・ホスト)の委譲とは独立
- 遵守すべき ADR: なし(検証の単一所有への集約)
- 非機能要件: エラーメッセージの文言は変更しない。UI の表示経路は setFieldError を維持する

## 実装者向け注記

### 現状の証拠
- ダッシュボード側の緩い検査: `src/dashboard/settings/fieldValidation.ts:100-108` — `validatePort` が `parseInt(input.value.trim(), 10)` で 1-65535 のみ検査し、`parseInt('80.5')=80`・`parseInt('80abc')=80` を通過させる
- 正規実装の厳密な検査: `src/utils/obsidianConfigValidator.ts:129-154` — `validateObsidianPort` が `Number` と `Number.isInteger` と範囲 1-65535 で検査し、同じ入力を throw で拒否する
- SW 側は委譲済み: `src/background/obsidianClient.ts:124-126` — `_validatePort` が `validateObsidianPort` に委譲しており、dashboard UI だけが迂回している
- 故障形態: dashboard では保存できて SW 側接続テストで拒否される save-then-fail。範囲変更時に2箇所編集が必要
- 修正方向: `validatePort` を `validateObsidianPort` の try/catch 委譲にし、throw を `setFieldError(getMessage('errorPort'))` に変換する

## Definition of Done
- [x] 全BDDシナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である

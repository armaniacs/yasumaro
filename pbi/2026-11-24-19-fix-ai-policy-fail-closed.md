# PBI: ai_domain_policy の不明値を fail-closed に変える

## ユーザーストーリー
ドメイン別の AI 送信政策で「要約なし」や「マスク必須」を選んだ利用者として、設定値が壊れたときに送信側に倒れないようにしてほしい、なぜなら現状は不明値が `allowed`(制限なし送信)に正規化され、選んだはずの保護が無音で外れ得るから(owner が fail-closed 化を裁定した)。

## 優先度
- 順位: 06/12 の監査 run-3 の needs_validation NV-2 に対応(owner 裁定: 変える)
- RICE: 要チームでの見積もり
- 根拠と依存: なし。後続は 2026-11-24-08(実機スモーク)

## ビジネス価値
- 壊れた設定値が保護の無効化にならない
- 測定方法: 不明値・破損値が送信側に倒れないことが表駆動テストで緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: 不明な政策値は送信しない側に倒れる
  Given `ai_domain_policy` の値が `mask-required `(空白付き)や `NO-SUMMARY` などの想定外の形である
  When  送信政策を判定する
  Then  `allowed`(制限なし送信)にはならず、送信しないか最も強い保護のいずれかになる
  And   その扱いが文書とテストで一致している

Scenario: 正常値は従来どおり動く
  Given `allowed` / `no-summary` / `mask-required` の正常値である
  When  送信政策を判定する
  Then  従来どおりの判定になる
```

## 受け入れ基準
- [ ] 不明値・破損値が送信側に倒れない(倒れ先の定義は実装時に本 PBI に明記)
- [ ] 正常値の判定が変わらない
- [ ] availability 優先の旧コメントが新しい方針に書き換わっている
- [ ] import/restore 経路で不正値が入る場合の扱い(正規化の位置)が明記されている

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない(08 の実機スモークで政策の導通を確認)

### 統合テスト
- `buildPlan` との結合で、不明値の記録が送信されないこと

### 単体テスト
- 境界値(空白付き・大文字・null・破損 map)の表駆動テスト
- 発火デモ(現行で `allowed` になること)を先に書き、赤を確認してから直す

## 実装アプローチ
- **Outside-In**: 発火デモから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める

## 見積もり
2 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `normalizeAiDomainPolicy` の純関数性で表駆動できる
- 非機能要件: 倒れ先(送信しない/最も強い保護)は利用者への影響が小さい方を選び、PBI に明記する
- ロールバック手段: 正規化関数の差し戻しで現行動作に戻せる

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "normalizeAiDomainPolicy" src/utils/storage/aiDomainPolicy.ts
git -C /Users/yaar/Playground/yasumaro grep -rn "normalizeAiDomainPolicy" src/ --include="*.ts" | grep -v __tests__ | grep -v "aiDomainPolicy.ts"
```

確認結果(run-3 時点):
- `aiDomainPolicy.ts:25-41` が不明値を `allowed` にする。availability 優先のコメント付き

### 実装手順
1. 発火デモ(不明値が `allowed` になる)を先に書く
2. fail-closed に変え、コメントを書き換える
3. 呼び出し側と import/restore の扱いを確認する
4. `npm run validate` で全体を確認

### 落とし穴
- 正常値の判定を変えないこと
- `PRIVACY_MODE` の fail-closed との整合を文書に書くこと
- 倒れ先の定義を利用者向け文書に残すこと

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 未着手。run-3 の NV-2 に対応する修正 PBI(owner 裁定: fail-closed 化)。

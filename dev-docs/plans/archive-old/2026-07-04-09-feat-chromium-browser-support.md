# PBI: 他 Chromium ブラウザ（Edge / Brave）対応

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: C. 連携拡張
- type: feat / 優先度: 低

## ユーザーストーリー

Edge / Brave 利用者として、Yasumaro を自分のブラウザでも使いたい。なぜなら、Chrome 以外の Chromium ブラウザを常用しており、そこでも履歴を記録したいから。

## ビジネス価値

対応ブラウザを増やしてユーザー母数を拡大する。MV3 準拠のため技術差は小さい。測定: 各ブラウザでの導入数。

## BDD受け入れシナリオ

```gherkin
Scenario: Edge で拡張が動作する
  Given Edge に Yasumaro を読み込む
  When  記録条件を満たすページを閲覧する
  Then  Chrome と同様に履歴が記録される

Scenario: ブラウザ固有APIの非対応を安全に扱う
  Given ブラウザが特定のchrome.* APIをサポートしない
  When  そのAPIに依存する機能が呼ばれる
  Then  機能はフォールバックするかグレースフルに無効化される
  And   拡張全体はクラッシュしない
```

## 受け入れ基準

- [ ] Edge / Brave で主要フローが動作する
- [ ] 非対応 API をフィーチャ検出でガードする
- [ ] 各ストア配布用のパッケージ手順を整える

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Edge / Brave 実機での記録フロー（手動チェックリスト併用）

### 統合テスト
- フィーチャ検出による分岐

### 単体テスト
- API 可用性判定ロジック

## 実装アプローチ

Outside-In。差分は主にマニフェスト/ストア対応と API フィーチャ検出。

## 見積もり

5pt（要チーム見積もり。実機検証工数含む）

## 技術的考慮事項

- 依存: なし
- 再利用: `wxt.config.ts`（ビルドターゲット設定）、既存 `permissionManager.ts`
- 実機依存が強く Jest では検証不可。手動テスト前提。

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "edge\|brave\|firefox\|browser\b" wxt.config.ts src/
grep -rn "chrome\." src/background/ | head
```

### 落とし穴

- `window.ai`（Chrome内蔵Prompt API）は他ブラウザで未提供の可能性が高い。ローカルAI段のフォールバックを必ず確認する。

## Definition of Done

- [ ] 全BDDシナリオ（手動含む）が確認される
- [ ] フィーチャ検出のカバレッジを満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新

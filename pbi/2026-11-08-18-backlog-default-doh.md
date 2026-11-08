# PBI: 既定DoH解決器の配線とmanifest権限設計

## ユーザーストーリー
拡張機能利用者として、SSRFガードのDNS検証と実際の接続が同一の解決結果を使うようにしてほしい、なぜなら検査時と接続時で名前解決が変わるとDNS rebindingでloopbackや内部網へ到達されるから

## ビジネス価値
DNS rebinding経路の閉鎖。現状はリテラルloopbackの既定拒否とpinのseamで当面の到達経路を塞いでいるが、解決器未配線の経路では「攻撃者がDNSを支配するURLを指定させる」高度な経路が理論上残る。測定方法: 決定論的rebind模擬テストが拒否されること

## 現状(フェーズ0確認済み)
- 未実装ではない。seamは実装済み: `DnsResolveFn`・`DnsPinOptions`・`resolveAndGuardHostname`・`assertDnsPinStable`・`validateUrlForFilterImportAsync`(`src/utils/ssrfGuard.ts`)、fetch前解決+fetch後突き合わせ(`src/utils/fetch.ts`)、任意配線(`FetchUrlHandlerDeps.resolveHostname` in `src/background/handlers/systemHandlers.ts`)
- 未実装の部分: 本番の既定解決器(DoH)の選定・配線と、それに伴うmanifest `host_permissions` へのDoHホスト追加
- 本PBIは後半(既定解決器+権限設計)のみを扱う。前半の作り直しは不要

## BDD受け入れシナリオ

```gherkin
Scenario: 既定ビルドでDNS切替え攻撃が拒否される
  Given 攻撃者がDNSを支配するURLがフィルタソース等に指定されている
  When 検証時と接続時で解決IPがpublicからloopbackへ変わる
  Then 接続前に拒否され内部網へfetchされない

Scenario: 通常の公開ホストへのfetchは影響を受けない
  Given 正規のhttps公開ホストのURLが指定されている
  When 拡張機能がfetchする
  Then 従来通り成功し余計な遅延や失敗が増えない

Scenario: DoH到達不能時は安全側に倒れる
  Given DoHエンドポイントへ到達できない環境である
  When 検証付きfetchが要求される
  Then 無検証で素通しせず検出可能な失敗になる
```

## 受け入れ基準
- [ ] 既定ビルドで解決器が配線されrebind模擬テストが拒否される
- [ ] manifestの権限追加が最小(DoHホストのみ)でPRIVACY.mdの記述と整合する
- [ ] 通常fetchの成功率・遅延に回帰がない
- [ ] DoH不通時はfail-closedで検出可能になる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 通常ドメインのフィルタ取込が成功する

### 統合テスト
- 検証→接続の一連で同一解決IPが使われる
- DoH不通時の失敗が検出可能になる

### 単体テスト
- rebind模擬(検査時public・接続時loopback)が拒否される
- 解決空応答がfail-closedになる

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
M (要チームでの見積もり)

## 技術的考慮事項
- 依存関係: manifest権限設計の判断が前提。DoHホスト選定(Cloudflare・Google等のいずれか)が未定でスパイク分離の候補
- テスタビリティ: `DnsResolveFn` seamに決定論的モックを渡す形は既存(`ssrfDnsPinning.test.ts`参照)
- 非機能要件: DoH追加の遅延は検証1回分のみに抑える。プライバシー上DNS問合せ先が増える点をPRIVACY.mdへ反映する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 機能に関連するキーワードでコードを探す
grep -rn "resolveHostname\|DnsResolveFn\|assertDnsPinStable" src/
```

seamはPBI 2026-11-08-01で実装済みのため作り直さないこと。確認結果: 既定解決器の配線のみ未実装。

### 実装手順
1. DoHホストを選定する(権限最小・到達性・応答速度で比較しスパイクで記録する)
2. 既定の `DnsResolveFn` を実装しfetch経路の既定値に配線する
3. manifest `host_permissions` にDoHホストを追加しPRIVACY.mdを更新する
4. rebind模擬の回帰テストを追加する

### 落とし穴
- ブラウザfetchは接続先IPを返さないため接続後再検証はできない。検証は接続前の解決に寄せること
- `OW_E2E_PROBE` のようなビルド時defineではなく実行時解決器にすること(テストで差し替え可能にするため)
- DoHホスト自体の検証を忘れないこと(DoH先の固定化・証明書検証)

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み(PRIVACY.md含む)

## 着手条件(本PBI固有)
- **明示的な着手宣言があるまで実装しない。** manifest権限拡大は全利用者への恒久的な露出増のため、権限設計の判断と一体で着手する
- 経緯: PBI 2026-11-08-01でseam+opt-in配線まで実施し、既定DoHはblast radiusの観点から本PBIへ分離した

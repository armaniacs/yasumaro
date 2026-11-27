# PBI: uBlock parser キャッシュのキー衝突を解消する (CWE-349 Low)

## ユーザーストーリー
保守担当者として、uBlock parser キャッシュのキーを衝突耐性のある形にしたい、なぜなら現行の FNV-1a 32-bit + length キーは等価クラスを作り、攻撃者が same-session 内で victim テキストに先に parse させると、victim のテキストに対して攻撃者の解析済みルールセットが返される (VulnHunter VULN-003、CWE-349 family Low) から。PERF-019 コメントの衝突防止主張は 32-bit 非暗号ハッシュでは成立しない。

## ビジネス価値
- キャッシュの (hash, length) 等価クラスを解消し、録画フィルタに誤ったドメインルールが適用される経路を断つ
- 測定方法: exploit test 003 の衝突ペア (in-test で FNV-1a 衝突構築、169ms) が新キーでは別エントリになること

## BDD受け入れシナリオ

```gherkin
Scenario: 等長衝突テキストは別エントリになる
  Given 同一 FNV-1a ハッシュ + 同一長の 2 つのテキスト (攻撃者テキストが先に parse 済み)
  When victim テキストを parse する
  Then victim 専用の解析結果が返される (攻撃者ルールセットは返らない)
```

## 受け入れ基準
- [ ] キー生成 (generateCacheKey) が FNV-1a-32 + length から衝突耐性キー (フルテキスト、または SHA-256 digest + length) に変更されている
- [ ] exploit test 003 を新契約 pin に更新 (衝突ペアが別エントリになること)
- [ ] 既存キャッシュ試験 (LRU-50、5-min cleanup) が緑
- [ ] 3 呼び出し箇所 (rulesBuilder.ts:67、sourceManager.ts:103、151) の API は無変更
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- ublock import テスト群 (無変更で緑)

### 単体テスト
- キー生成の衝突試験 (等長衝突ペアが別エントリ)、LRU 動作

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-003 (CONFIRMED Low)、phase3_output.md fix strategy
- 外部挙動: 不変 (キャッシュヒット/ミスのタイミングのみ変化、出力は同一解析結果)
- 依存関係: なし (1 モジュール)
- 選択肢: (a) フルテキストキー (メモリ +8-20MB/エントリだが LRU-50 上限あり、最小差分)、(b) SHA-256 async 化 (cache get/set が sync のため呼び出し側の async 化が必要 — 波及)。実装は (a) を第一候補とし、(b) を選ぶ場合の波及を報告に記録

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '30,50p' src/utils/ublockParser/cache.ts
sed -n '90,105p' src/utils/ublockParser/cache.ts
grep -n "getFromCache\|setCache" src/utils/ublockParser/index.ts | head -4
```

### 実装手順
1. generateCacheKey をフルテキストキーに変更 (hash 依存の削除)
2. exploit test 003 を新契約 pin に更新
3. LRU / cleanup 試験の確認

### 落とし穴
- cache.ts:24-25, 90-93 の PERF-019 コメントは新キーで初めて真になる (コメント更新を忘れない)
- フルテキストキーのメモリ増は LRU-50 上限で bounded (LRU-50 × テキスト長)。過大にならないことをテストで確認
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: FNV-1a キーに戻す (1 コミット、ただし脆弱状態に戻る)
- [ ] ドキュメント更新の要否判定: 内部実装のため docs 更新は不要

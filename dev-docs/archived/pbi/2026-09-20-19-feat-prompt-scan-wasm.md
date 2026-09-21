# PBI: プロンプトインジェクションスキャンを Rust/WASM に移植する（非同期化の波及は分割）

## ユーザーストーリー

開発者として、AI リクエスト毎に走るプロンプトサニタイズに構造的な入力上限を持たせたい、なぜなら現状は 21 本の正規表現を無上限に近いページ本文へ毎回適用しており、速度（60KB で約0.6ms）よりも DoS 耐性と SW パイプラインの GC 負荷が課題だから

## 優先度

- 順位: 3 / 4（本計画の P3）
- RICEスコア: 2.4（Reach=8 / Impact=1 / Confidence=60% / Effort=2週）
- 根拠: 実測（初回発見時の実測プローブ。着手時に bench/probe で再計測）8KB 0.17ms / 32KB 0.39ms / 60KB 0.62ms は c8 PII-TS の約 1/4〜1/6 で、AI リクエスト全体（秒単位）への絶対削減は sub-ms。正直に Impact=1。Reach=8（全 AI 要約リクエストが経由）で支える。Confidence を低めにしたのは正規表現 21 本の JS セマンティクス再現が 4 候補中最大の難所だから。P4 と同点だが、毎回実行の SW ホットパス＋上限化の価値で上位に tie-break

## ビジネス価値

速度よりも (a) SW パイプラインの毎回実行コストの削減、(b) 複雑な正規表現集合への構造的 bound（上限化による DoS 耐性）。移植＋上限化で二重の価値がある案件

## BDD受け入れシナリオ

```gherkin
Scenario: インジェクションが検出される
  Given 英語・日本語のインジェクション文を含むページ本文
  When WASM パスでスキャンする
  Then 検出結果（sanitized/warnings/dangerLevel）が TS 実装と一致する

Scenario: 正常文は誤検知しない
  Given システム設定の説明等の正常文（ADR の誤検知率 0% コーパス）
  When スキャンする
  Then warnings が空で本文が無変換である

Scenario: 巨大入力は上限で打ち切られる
  Given 上限を超える巨大本文
  When スキャンする
  Then fail-open でコンテンツを落とさず、打ち切りが文書化された通りになる

Scenario: 呼び出し側は非同期で動く
  Given privacyPipeline・AI クライアント経由の呼び出し
  When ハイブリッドに置き換える
  Then 非同期化の波及が分割ステップで収まり、既存の呼び出しテストが green である
```

## 受け入れ基準

- [ ] 実装前に TS プローブで全 21 パターンのマッチ位置・`m`/`i`/`g` 挙動・日本語境界を固定し、Rust `regex` との方言差を洗い出す（先行ステップ、必須）
- [ ] 第1段階はスキャン本体のみ移植し、`isInsideHtmlTag` 等のヒューリスティクスは JS に残す2段階ロードマップ
- [ ] 同期→非同期化の波及（`checkPromptSafety`→privacyPipeline/AI クライアント）は本 PBI 内で完結させず、分割ステップとして報告する（無理に1コミットへ詰めない）
- [ ] ハイブリッド: サイズ閾値ルーティング（閾値はベンチ実測）＋例外時 TS フォールバック
- [ ] パリティテスト（Vitest）: TS vs WASM 等価性を誤検知コーパス込みで検証
- [ ] ベンチで TS vs WASM を実測し、不利なら正直に報告してサイズルーティングで回避する
- [ ] ビルド配線3箇所と CI 同等性ゲートへの追加、`npm run validate` green

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（privacyPipeline の既存テストが経路をカバー）

### 統合テスト

- 非同期化後の privacyPipeline・AI クライアント呼び出し（既存モックテストの更新含む）
- WASM 失敗時の TS フォールバック

### 単体テスト

- `cargo test`: パターン毎の検出・非検出、NFC・大文字小文字・行頭定義の境界
- TS パリティスイート（gate）

## 実装アプローチ

- **Outside-In TDD**: パイプライン結果の一致 → 非同期ハイブリッド → Rust スキャンコア
- まず正規表現プローブの固定（Red）。Green はパターン毎に段階的に

## 見積もり

2週（要チームでの見積もり。正規表現パリティが難所）

## 技術的考慮事項

- 依存関係: 同期→非同期化の波及（`src/utils/promptSafety.ts`、`src/background/privacyPipeline.ts`、`builtInAIClient.ts`、`ProviderStrategy.ts`）
- 遵守すべき事項: lessons-learned の「同期関数の波及は別ステップ」、`extractInternal` 同期問題の前例
- 非機能要件: 上限超過時は無条件保持（コンテンツを1文字も落とさない）

## 判断記録（2026-09-21 実施・結論: WASM移植は不採用、TS側ハードニングに方針転換）

STEP 0 プローブ（`bench/prompt-sanitize-transfer-probe.ts`、Node v26.7.0）の実測:

| シナリオ | TS | 転送floor（encode/decode） | 転送シェア |
|---|---|---|---|
| 8KB clean | 0.324ms | 0.005ms | 2% |
| 32KB clean | 1.210ms | 0.019ms | 2% |
| 60KB clean | 2.395ms | 0.032ms | 1% |
| 32KB injection-dense | 1.605ms | 0.016ms | 1% |
| 60KB injection-dense | 2.573ms | 0.027ms | 1% |

判定の理由:

1. **転送シェア 1〜2%** — 構造的には計算律速で、md-sanitize 型の転送律速除外には該当しない
2. しかし**絶対値が小さい**: 60KB 最悪ケースでも TS 2.4ms。移植で3.9x（pii 実績）が出ても削減は ~1.8ms/リクエスト。RICE の Impact=1 の見立てより成果は小さい
3. **パリティリスクが全候補中最大**: `sanitizePromptContent` は exec ループ内で `sanitized` を `replaceAll` により再代入しながら旧 `lastIndex` で次の exec を走める変異中イテレーション、`isInSafeContext` / `isMaliciousUsage` の文脈依存判定（JS 文字列操作に強く結合）が絡む。bit 等価移植の難所は PBI 立案時の見立てどおり
4. **本 PBI の主価値（上限化・DoS 耐性）は TS だけで実現可能**: マッチ件数上限・replaceAll の一括化（範囲集計→1パス適用）・制御文字ループの regex 化は、WASM 不要で実装できる

結論: **WASM 移植は不採用**。残す価値（上限化+ハードニング+潜在バグ検証）は PBI-24 に引き継ぐ。

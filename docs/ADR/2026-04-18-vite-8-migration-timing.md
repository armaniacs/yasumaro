# Vite 8 移行タイミングの判断基準

## Context

現在当プロジェクトは Vite 8.0.8 を使用しており、直近のマイグレーション（tsc+Jest → Vite+Vitest）で安定している。しかし Chrome 拡張機能のビルドシステムは Vite 6 ベースであり、この ADR は「いつ Vite 8 への移行を検討すべきか」という判断基準を定義する。

**前提知識:**

- Vite 8 は Rust ベースの新しいバンドラー Rolldown を採用（Vite 6 は Rollup ベース）
- Rolldown はバンドル速度が数倍〜10倍高速と報告されている
- Vitest は Vite のテストランナーであり、Vite のバージョンが上がると互換性问题が発生する可能性がある

**現在のパラメータ:**

- Vite: 8.0.8（最新安定版）
- Vitest: 4.1.4
- テスト数: ~3,500
- ビルド: Chrome 拡張機能（popup, dashboard, background, content scripts）

## Decision

### 移行判断の3条件

以下の**3条件がすべて揃った時**に Vite 8 への移行を検討する：

#### 条件1: Vitest のメジャーアップデートが安定

**理由:** Vitest は Vite のテストランナーであり、Vite のバージョンアップに伴い互換性問題が 발생할可能性がある。

- Vitest が「Vite 8 完全対応」をMajorバージョンで発表した時
- `vitest.config.ts` の `poolOptions` / `threads` 設定が Vite 8 で非推奨にならないことを確認
- 現時点で Vitest 4.x が Vite 8 をサポートしている報告はあるが、Majorバージョンアップで安定性が変わる可能性がある

**チェックポイント:**
```bash
# 現在のVitest対応状況を確認
npm info vitest peerDependencies

# Vite 8 正式対応バージョンのリリースノートを確認
npm view vitest versions --json | tail -5
```

#### 条件2: 主要プラグインの Vite 8/Rolldown 対応が完了

**理由:** 当プロジェクトで使用している主要プラグインが Vite 8 で動作するか確認が必要。

| プラグイン | 現状 | Vite 8 対応状況 |
|-----------|------|----------------|
| @rollup/plugin-commonjs | 使用中 | 要確認 |
| @rollup/plugin-node-resolve | 使用中 | 要確認 |
| @crxjs/vite-plugin | Chrome拡張用 | Vite 8 対応 масло |

**チェックポイント:**
```bash
# CRXJS Vite 8 対応確認
npm view @crxjs/vite-plugin peerDependencies

# Rollup プラグインの Vite 8 対応確認
npm view @rollup/plugin-commonjs peerDependencies
```

#### 条件3: ビルド時間の問題が顕在化した時

**理由:** Vite 6（Rollup）のビルド時間で困っていない今は移行不要。

- 開発環境での `--watch` モードが遅い
- 本番ビルド（`npm run build`）が数十秒を超える
- Hot Module Replacement（HMR）がストレスを感じるレベルで遅い

**現在のベースライン:**
```bash
# ビルド時間測定
time npm run build  # 現在: 約10-15秒（プロジェクトによる）
```

### 移行しない判断

以下の場合、当面 Vite 8 への移行を見送る：

1. **Vitest が Vite 8 に完全対応するMajorバージョンをまだリリースしていない**
2. **使用中の主要プラグインが Vite 8 未対応**
3. **現在のビルド時間に問題を感じていない**

### 移行準備として今できること

1. **package.json の依存関係を確認:**
   ```json
   "devDependencies": {
     "vite": "^8.0.8",
     "vitest": "^4.1.4"
   }
   ```

2. ** Vitest の `poolOptions` 設定を監視:**
   - Vite 8 で `threads` が非推奨になればその時に修正

3. **_plugin versions を定期チェック:**
   - 月1回程度 `npm outdated` で確認

## Consequences

### メリット（移行時）

- **ビルド速度向上:** Rolldown 採用により数倍〜10倍の高速化が期待
- **HMR改善:** 開発体験の向上
- **最新機能:** Vite 8 の新機能（enhanced CSS, lightning-fast deps optimizer 等）

### デメリット（移行時）

- **Plugin 対応リスク:** 一部プラグインが動作しない可能性
- **設定変更:** `vite.config.ts` の breaking changes 対応
- **Vitest 互換性:** テストフレームワークのバージョン追従が必要
- **調査工数:** 移行検証のためのテスト実行

### 現状維持の利益

- **安定性:** 現在 Vite 8 + Vitest 4.x で動作しており、不自由なし
- **known quantities:** 問題を把握しており対処方法が確立
- **Chrome 拡張特化:** CRXJS プラグインが動作している今の環境を崩す必要なし

## Implementation

### 移行判断のマイルストーン

1. **Vitest v5.x  Stable リリース**
   - Vite 8 を 完全サポート
   - 現在のテストがそのまま動作することを確認

2. **@crxjs/vite-plugin v2.5.x+ リリース**
   - Vite 8/Rolldown 対応を確認

3. **ベンチマーク測定**
   - 移行前後でビルド時間を比較し、効果があるか検証

### 移行手順（準備版）

```bash
# 1. 依存関係を更新
npm install vite@latest vitest@latest --save-dev

# 2. ビルドテスト
npm run build

# 3. テスト実行
npm test

# 4. TypeScript チェック
npm run type-check

# 5. 問題があれば vite.config.ts を調整
```

### 確認項目チェックリスト

- [ ] Vitest が Vite 8 を公式サポートしている
- [ ] @crxjs/vite-plugin が Vite 8 対応している
- [ ] ビルド時間が改善される（測定する）
- [ ] テストがすべてパスする
- [ ] 既存の vite.config.ts 設定が動く

## Status

- **提案日**: 2026-04-18
- **承認日**: 2026-04-18
- **実装状況**: 継続監視（ условия が揃ったらその時に検討）
- **次回レビュー**: 2026-Q3（Vitest major release 待ち）
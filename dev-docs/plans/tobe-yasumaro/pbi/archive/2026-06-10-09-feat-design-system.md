# PBI-09: Yasumaroデザインシステム確立（和モダン・精緻テーマ）

## ユーザーストーリー

**Yasumaroの開発者として**、ブランドとして記憶に残るデザイン言語を確立したい、なぜなら現状の「AIプロダクト紫 + system-ui」からの脱却によってChrome拡張ストアでの差別化を実現し、ユーザーが「これがYasumaroだ」と識別できる視覚的アイデンティティを持つ製品にしたいから。

## ビジネス価値

- Chrome Web Storeで競合拡張と視覚的に差別化できる（ストア掲載スクリーンショットの印象向上）
- 「和モダン・精緻」なブランドイメージにより、日本人ユーザーへの親和性が高まる
- `--ym-*` デザイントークンの一元管理により、今後のUI追加コストが下がる

---

## デザイン方針

### コンセプト：**研墨（けんぼく）**

「Yasumaro（安万侶）」——古事記を筆録した史官・太安万侶に着想を得た。  
知識を蓄え、記録し、伝承する道具としての美学。墨と紙と金——静謐で知的な日本の文具美。

### カラーパレット

```
--ym-color-ink-black:   #0e0e12   /* 漆黒（ダーク基本背景） */
--ym-color-ink-deep:    #1a1a24   /* 墨（ダークサイドバー背景） */
--ym-color-ink-mid:     #2a2a38   /* 硯（ボーダー・カード背景） */
--ym-color-gold:        #c9a84c   /* 金箔（プライマリアクセント） */
--ym-color-gold-light:  #e8c97a   /* 金箔ホバー */
--ym-color-gold-dim:    rgba(201, 168, 76, 0.15)  /* 金箔背景ティント */
--ym-color-paper:       #f5f0e8   /* 和紙（ライト基本背景） */
--ym-color-paper-warm:  #ede7d9   /* 和紙濃（ライトサイドバー背景） */
--ym-color-sumi-text:   #f0ece4   /* 白墨（ダークテキスト） */
--ym-color-sumi-muted:  #9a9080   /* 薄墨（セカンダリテキスト） */
```

### タイポグラフィ

Chrome拡張のCSP制約（外部フォント読み込み禁止）下でローカルフォントのみを使用する。

**方針**: 明朝体はアクセシビリティ上の好み差が大きく（読みにくいと感じるユーザーがいる）、UIのデフォルトはゴシック体に統一する。明朝体は将来の設定オプションとして変数定義のみ残す。

```css
/* 全UI要素のデフォルト。Noto Sans JP が利用可能な環境では均一で読みやすいゴシック体 */
--ym-font-ui: "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
              "Yu Gothic UI", "Meiryo", system-ui, sans-serif;

/* コード・URL・ID表示 */
--ym-font-mono: "SF Mono", "JetBrains Mono", "Cascadia Code", "Consolas", monospace;

/* 将来オプション（設定で選択可能にする場合のみ使用） */
--ym-font-serif: "Hiragino Mincho ProN", "Yu Mincho", "Times New Roman", Georgia, serif;
```

**タイポグラフィスケール:**

```css
--ym-text-xs:   11px;  /* letter-spacing: 0.04em  — ラベル・バッジ */
--ym-text-sm:   13px;  /* line-height: 1.6        — 補足・キャプション */
--ym-text-base: 14px;  /* line-height: 1.7        — 本文 */
--ym-text-md:   16px;  /* letter-spacing: -0.01em — セクション見出し */
--ym-text-lg:   20px;  /* letter-spacing: -0.02em — パネル見出し */
--ym-text-xl:   28px;  /* letter-spacing: -0.03em — ブランド名 */
```

### 質感・アトモスフィア

```css
/* 和紙の繊維を模した横ライン（ライトモード限定） */
--ym-paper-lines: repeating-linear-gradient(
  0deg, transparent, transparent 23px,
  rgba(0,0,0,0.03) 23px, rgba(0,0,0,0.03) 24px
);

/* 墨だまり的グロウ——金の2層フォーカスリング */
--ym-focus-ring: 0 0 0 2px var(--ym-color-ink-black),
                 0 0 0 4px var(--ym-color-gold);
```

ノイズテクスチャはCSP準拠のSVG data URIで実装（`feTurbulence` + `feColorMatrix`）。

### モーション

```css
--ym-ease-ink:    cubic-bezier(0.4, 0, 0.15, 1);  /* インクが滲む緩減速 */
--ym-ease-paper:  cubic-bezier(0.0, 0, 0.2, 1);   /* 紙をめくる加速 */
--ym-duration-sm: 120ms;
--ym-duration-md: 220ms;
--ym-duration-lg: 380ms;
```

---

## BDD受け入れシナリオ

```gherkin
Feature: PBI-09 Yasumaroデザインシステム

  # ---- トークン定義 ----

  Scenario: デザイントークンの一元定義
    Given dashboard.css を開く
    When CSS変数の定義セクションを確認する
    Then カラー・フォント・スペーシング・モーション変数がすべて --ym-* プレフィックスで定義されている
    And system-ui / BlinkMacSystemFont に直接依存する箇所が --ym-font-ui 変数経由のみである

  # ---- カラー・質感 ----

  Scenario: ライトモードの和紙質感
    Given ユーザーのOSがライトモード設定
    When ダッシュボードを開く
    Then メインコンテンツ背景が #f5f0e8（和紙色）になっている
    And サイドバー背景が #ede7d9（和紙濃）になっている
    And 和紙ラインテクスチャがうっすら見える

  Scenario: ダークモードの墨色とノイズ
    Given ユーザーのOSがダークモード設定
    When ダッシュボードを開く
    Then メインコンテンツ背景が #0e0e12（漆黒）になっている
    And サイドバー背景が #1a1a24（墨）になっている
    And 微細なノイズオーバーレイが重なっている

  Scenario: 金箔アクセントの適用
    Given ダッシュボードを開く
    When アクティブなサイドバーナビアイテムを確認する
    Then 左端に金色（#c9a84c）の2px縦ボーダーが表示される
    And ナビアイテムのテキストが金色になっている

  # ---- タイポグラフィ ----

  Scenario: ゴシック体の統一適用
    Given ダッシュボードを開く
    When サイドバーブランド名・見出し・本文テキストのfont-familyを確認する
    Then すべての要素に --ym-font-ui が適用されている
    And 明朝体（serif）がデフォルト適用されていない

  # ---- アクセシビリティ ----

  Scenario: フォーカスリングの視認性
    Given キーボードでタブ操作をする
    When フォーカスがボタンに当たる
    Then 金色の2層フォーカスリングが表示される
    And DevToolsでコントラスト比が WCAG 2.1 AA（3:1以上）を満たしている

  Scenario: ダッシュボードのテキストコントラスト比（WCAG AA）
    Given ダークモードのダッシュボード
    When 本文テキスト（#f0ece4）と背景（#0e0e12）のコントラスト比を計測する
    Then コントラスト比が 4.5:1 以上である

  Scenario: reduced-motion 対応
    Given OSで「視差効果を減らす」を有効にしている
    When ダッシュボードを開く
    Then アニメーションが再生されない（duration が 0.01ms 以下）

  # ---- モーション ----

  Scenario: ページロードのstagger animation
    Given ダッシュボードを新規タブで開く
    When ロード完了後0.5秒以内を観察する
    Then サイドバーナビアイテムが上から順番に（40ms刻み）フェードインしている
    And メインコンテンツエリアが下からスライドアップしてくる
```

---

## 受け入れ基準

- [ ] `--ym-*` プレフィックスのCSS変数が全カラー・フォント・スペーシング・モーションをカバーしている
- [ ] `grep -r "BlinkMacSystemFont" entrypoints/options/` が0件
- [ ] ライトモード / ダークモードの両方で和紙・墨色が正しく表示される
- [ ] アクティブナビアイテムに金箔ボーダーが表示される
- [ ] 全UI要素がゴシック体（--ym-font-ui）で統一されている
- [ ] ダークモードの本文テキストコントラスト比が 4.5:1 以上（WCAG AA）
- [ ] `prefers-reduced-motion` でアニメーションが無効になる
- [ ] stagger animation が60fps（DevTools Performance）で動作する

---

## テスト戦略（t_wadaスタイル）

このPBIは純粋なCSS変更であり、ロジックを持たない。そのため自動テストより**目視確認チェックリスト**を重視する。

### 目視確認（E2Eレベル）
- ライトモード / ダークモード切替での色確認
- キーボードナビゲーションでのフォーカスリング確認
- ページロードのstagger animation確認
- `prefers-reduced-motion` 有効時の動作確認

### 静的解析
- `grep -r "BlinkMacSystemFont" entrypoints/options/` → 0件
- `grep -r "BlinkMacSystemFont" entrypoints/popup/` → 0件（ポップアップは除外スコープだが確認）
- Chrome DevTools → Lighthouse → Accessibility スコア確認

### コントラスト比検証（DevTools）
| テキスト | 背景 | 必要比 | 計測方法 |
|----------|------|--------|----------|
| #f0ece4（白墨） | #0e0e12（漆黒） | 4.5:1以上 | DevTools Color Picker |
| #c9a84c（金箔） | #0e0e12（漆黒） | 3:1以上（大テキスト） | DevTools Color Picker |
| #1e1a14（本文ダーク） | #f5f0e8（和紙） | 4.5:1以上 | DevTools Color Picker |

---

## 実装スコープ

### Phase A: デザイントークン定義（dashboard.css のみ）

- [ ] `:root` に `--ym-*` プレフィックスでカラー・フォント・スペーシング・モーション変数を追加
- [ ] `@media (prefers-color-scheme: dark)` 内にダークモード対応値を追加
- [ ] `body { font-family }` を `var(--ym-font-ui)` に変更
- [ ] `BlinkMacSystemFont` を含む直接指定をすべて `var(--ym-font-ui)` 経由に変更
- [ ] `@media (prefers-reduced-motion: reduce)` ブロックを追加

### Phase B: サイドバーコンポーネント刷新

- [ ] `.sidebar` 背景色を `var(--ym-color-ink-deep)` / `var(--ym-color-paper-warm)` に変更
- [ ] ダークモードのサイドバーにノイズSVGオーバーレイを `::after` で適用
- [ ] `.sidebar-nav-btn.active` に金箔左ボーダー + テキスト金色を適用
- [ ] `.sidebar-nav-btn:hover` に `var(--ym-color-gold-dim)` ティント背景を適用
- [ ] ブランド名 `.sidebar-title` を `var(--ym-font-ui)` + `font-weight: 700` + `letter-spacing: -0.02em` に変更
- [ ] stagger animation: `.sidebar-nav-btn:nth-child(n)` に `animation-delay` を 40ms刻みで設定

### Phase C: メインコンテンツエリア刷新

- [ ] `#dashboardContent` 背景を `var(--ym-color-paper)` / `var(--ym-color-ink-black)` に変更
- [ ] ライトモードのbodyに和紙ラインテクスチャ（`var(--ym-paper-lines)`）を適用
- [ ] `h2`, `h3`, `h4` に `--ym-text-lg/md/sm` スケールを適用、`font-weight` で階層表現
- [ ] カード・セクション枠線を `var(--ym-color-ink-mid)` に変更
- [ ] `:focus-visible` に `var(--ym-focus-ring)` を適用（全インタラクティブ要素）
- [ ] パネル切替アニメーション: `opacity` + `transform: translateY(4px)` のクロスフェード

### Phase D: アトモスフィア要素

- [ ] ダークモードbodyにノイズSVGオーバーレイ適用（opacity: 0.04）
- [ ] スピナーを金色の弧アニメーションに変更（現状: 緑円）
- [ ] トースト通知の入退場に `var(--ym-ease-ink)` + `var(--ym-duration-md)` を適用

---

## 除外スコープ

- ポップアップ（`entrypoints/popup/styles.css`）: 別PBIで対応
- 権限ページ（`entrypoints/permissions/privacy.css`）: 別PBIで対応
- 外部Webフォントの導入: CSP制約により対象外
- HTMLおよびTypeScriptの変更: CSSのみ
- 既存ARIA属性・フォーカストラップロジックの変更: 対象外

---

## 技術メモ

### ノイズSVGパターン（CSP対応 data URI）

```css
/* feTurbulence + feColorMatrix で微細なグレインを生成。opacityは0.03〜0.05が適切 */
.sidebar::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  background-repeat: repeat;
}
```

### stagger animationパターン

```css
@keyframes ym-slide-in {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

.sidebar-nav-btn {
  animation: ym-slide-in var(--ym-duration-md) var(--ym-ease-ink) both;
}
.sidebar-nav-btn:nth-child(1) { animation-delay: 40ms; }
.sidebar-nav-btn:nth-child(2) { animation-delay: 80ms; }
.sidebar-nav-btn:nth-child(3) { animation-delay: 120ms; }
/* nth-child が増えたら追加する */
```

### `prefers-reduced-motion` 対応（必須）

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 実装者向け注記

### 着手前の確認

```bash
# デザイントークンが未実装であることを確認（0件であること）
grep -rn "ym-color\|ym-font\|ym-ease" entrypoints/

# 置換対象: BlinkMacSystemFont の残存箇所
grep -rn "BlinkMacSystemFont" entrypoints/
# 期待: dashboard.css 2箇所（:root と body）が該当
```

### 実装順序

1. Phase A（トークン定義）を完成させてから Phase B/C/D に進む
2. 各 Phase 完了後に Chrome で目視確認（ライト / ダーク両モード）
3. Phase D は最後——視覚的な仕上げであり、A〜C が安定してから適用

### 落とし穴

- **`--ym-*` 変数と既存 `--color-*` 変数の混在**: 段階移行中は両方が存在してよい。完全置換は別PBIで行う
- **`::after` のノイズオーバーレイ**: 親要素に `position: relative` がないと機能しない
- **stagger animation**: `animation-fill-mode: both` がないとFOUC（初期フラッシュ）が発生する
- **ダークモードのコントラスト**: `--ym-color-sumi-muted: #9a9080` は小テキストでの AA 基準（4.5:1）を満たさない場合がある。補足テキストのみに使用し、重要情報には使わないこと

---

## Definition of Done

- [ ] 全BDD受け入れシナリオを目視確認チェックリストで検証済み
- [ ] `grep -r "BlinkMacSystemFont" entrypoints/options/` が 0件
- [ ] Chrome DevTools で WCAG AA コントラスト比をライト / ダーク両モードで確認済み
- [ ] `prefers-reduced-motion` 有効時にアニメーションが停止することを確認済み
- [ ] stagger animation が DevTools Performance で 60fps を維持していることを確認済み
- [ ] コードレビュー完了

---

## ストーリーポイント: 8 SP

| フェーズ | SP | 備考 |
|----------|----|------|
| Phase A: トークン定義 | 2 | CSS変数の設計・定義が核心 |
| Phase B: サイドバー | 2 | stagger animationを含む |
| Phase C: メインコンテンツ | 2 | フォーカスリング全体適用が工数大 |
| Phase D: アトモスフィア | 2 | スピナー刷新・ノイズ調整 |

## 優先度: Must Have（Store公開前に実施推奨）

ブランドの第一印象はストア掲載スクリーンショットで決まる。  
デザインシステムの確立はStore公開（PBI-08）の前提として位置づける。

## 依存関係

- 依存先PBI: なし（独立して着手可能）
- 実施順: **PBI-09 → PBI-08**（決定済み）。Store公開前にデザインを完成させる
- ポップアップのデザインシステム適用（将来PBI）はこのPBIで定義したトークンを流用する

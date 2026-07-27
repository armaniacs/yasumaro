# Chrome Built-in AI OSS 調査・Prompt API 仕様検証レポート

> PBI: [pbi/2026-07-26-30-feat-chrome-built-in-ai-oss-research.md](../pbi/2026-07-26-30-feat-chrome-built-in-ai-oss-research.md)
> 調査日: 2026-07-27
> 調査方法: Chrome公式ドキュメント（developer.chrome.com）、Google公式 `chrome-extensions-samples` リポジトリ、OSS拡張機能3件のソースコード確認

## サマリー（最重要発見）

**既存の `localAiClient.ts` / `offscreen.ts` は、現行の Chrome Prompt API 仕様に対して世代遅れの実装になっている。**

| 項目 | 既存実装（Yasumaro） | 現行の公式仕様（Chrome 148時点） |
|---|---|---|
| グローバルオブジェクト | `window.ai.languageModel` | `LanguageModel`（グローバル直下）。`window.ai` は廃止 |
| availability の値 | `'readily' \| 'after-download' \| 'no'` | `'available' \| 'downloadable' \| 'downloading' \| 'unavailable'` |
| availability 呼び出し | `ai.languageModel.capabilities()` | `LanguageModel.availability()` |
| セッション作成 | `ai.languageModel.create({ systemPrompt })` | `LanguageModel.create({ initialPrompts: [{role:'system',...}], monitor, expectedInputs, signal })` |
| 呼び出し文脈 | Service Worker では不可 → 必ず Offscreen Document 経由 | **Service Worker から直接呼び出し可能**（Google公式サンプルで実証済み、後述） |
| ストリーミング | 未実装（`session.prompt()` のみ） | `session.promptStreaming()` あり |
| ダウンロード進捗 | 未対応 | `monitor(m => m.addEventListener('downloadprogress', ...))` |
| セッション上限管理 | 未対応 | `session.contextWindow` / `session.contextUsage` / `contextoverflow` イベント |

この差分はPBI受け入れ基準「既存実装の改善候補5件以上」の中核をなす。詳細は[改善候補](#既存実装-localaiclientts--offscreents-の改善候補)を参照。

---

## 1. Prompt API 公式仕様（Chrome 148時点、developer.chrome.com/docs/ai/prompt-api ほか）

### 1.1 グローバルオブジェクトの変遷

- `window.ai` 名前空間は**廃止（obsolete）**。現行は `LanguageModel` / `Summarizer` / `Translator` などがグローバル直下に生える方式。
- 可用性チェックは `'LanguageModel' in self` で行う（`self` は Service Worker でも Window でも共通のグローバル参照）。
- 既存コードの `window.ai || globalThis.ai || self.ai` というフォールバック探索（`offscreen.ts:103`）は旧仕様の名残であり、現行仕様には存在しない形。

### 1.2 `LanguageModel.availability()`

戻り値4種（既存の3種 `'readily'/'after-download'/'no'` から仕様変更されている）:

- `'unavailable'` — このデバイスでは利用不可
- `'downloadable'` — ダウンロード可能（未実施）
- `'downloading'` — ダウンロード中
- `'available'` — 即利用可能

`availability()` に渡すオプション（`expectedInputs` 等）は `create()` に渡すものと**同一にする必要がある**（モダリティ・言語サポートがオプションに依存するため）。

### 1.3 `LanguageModel.create()` の主なオプション

| オプション | 用途 |
|---|---|
| `initialPrompts` | system/user/assistant ロールで会話履歴を事前投入 |
| `monitor` | `downloadprogress` イベントでダウンロード進捗を取得 |
| `signal` | `AbortController` 経由でセッション破棄 |
| `expectedInputs` / `expectedOutputs` | 入出力モダリティ（text/image/audio）と言語の宣言 |
| `temperature` / `topK` | Extensions/Origin Trial 限定 |

### 1.4 プロンプト実行

- `session.prompt(text)` → `Promise<string>`（一括取得）
- `session.promptStreaming(text)` → `ReadableStream`（`for await` で逐次取得、長文向け）
- マルチモーダル入力: `{ role: 'user', content: [{type:'text',...},{type:'image',...}] }` 形式が可能（画像は `ImageBitmap` 等）
- 構造化出力: `session.prompt(text, { responseConstraint: jsonSchema })` でJSON Schema制約付き出力が可能

### 1.5 セッション管理・上限

- `session.contextWindow`（上限トークン数）/ `session.contextUsage`（消費済み）
- 上限超過時は古い会話ペアが自動的にドロップ（system prompt は保持）。`contextoverflow` イベントで検知可能
- 一括で収まらない場合は `QuotaExceededError`（`requested` / `contextWindow` プロパティ付き）
- `session.clone({signal})` でコンテキストを保ったままフォーク可能
- `session.destroy()` で即座にリソース解放。以降のプロンプトは失敗する

### 1.6 実行文脈の制約

- **Web Workers では利用不可**（パーミッションポリシーの複雑さが理由、と公式記載）
- iframe: 同一オリジンはデフォルト許可、クロスオリジンは `allow="language-model"` 属性が必要
- モバイル（Chrome Android/iOS、非Chromebook Plus ChromeOS）は未サポート
- **Service Worker（Extension文脈）からの直接呼び出しに関する公式ドキュメントの明言は見つからなかった**が、後述の通りGoogle公式サンプルコードが実例として存在する

### 1.7 ハードウェア要件

- ストレージ 22GB以上の空き（10GB未満でモデル自動削除）
- CPU: 16GB+ RAM、4コア以上／GPU: 4GB+ VRAM（音声入力にはGPU必須）
- OS: Windows 10/11、macOS 13+、Linux、ChromeOS（Chromebook Plus）
- 初回ダウンロードのみネットワーク必須（従量制回線は不可）

### 1.8 セキュリティ注意点

- 「モデル出力は信頼できない入力として扱い、マークアップとしてパースしてはならない」— `innerHTML` ではなく `textContent` を使うこと
- 既存 `offscreen.ts` はモデル出力（`session.prompt()` の戻り値）をそのまま `sendResponse` で返しているのみで、DOM挿入はしていないため直接のXSSリスクは低いが、呼び出し元（`aiSummaryCleaner.ts` 等）でのDOM挿入経路がある場合は要確認

---

## 2. OSS実装調査（3件）

### 2.1 [ainoya/chrome-extension-web-distiller-ai](https://github.com/ainoya/chrome-extension-web-distiller-ai)

- **アーキテクチャ**: Service Worker・Offscreen Documentを一切使わず、**Popup（`Popup.tsx` → `summarizer.ts`）から直接** `window.ai.assistant.create()` を呼び出す
- **manifest.json**: `permissions: ["activeTab", "scripting"]` のみ。`background` service worker宣言すらない
- **コンテンツ取得**: `chrome.scripting.executeScript` でアクティブタブの `outerHTML` を取得 → Readability + Turndown で本文抽出・Markdown化
- **入力制限**: Markdown化後、先頭40行のみに切り詰め（`markdownLines.splice(40)`）てAPI入力上限超過を回避
- **2段階セッション**: 要約用セッションと翻訳用セッションを別々に `create()` → それぞれ `destroy()`。1セッション使い回しではない
- **旧APIの使用**: `window.ai.assistant.create()` は既存Yasumaroと同様に旧世代の呼び出し方（現行は `LanguageModel.create()`）
- **示唆**: Popup文脈から直接呼べるという点は、Yasumaroの「Offscreen Document必須」という前提を緩和できる可能性を示す一例（ただしPopupは開いている間しか生存しないため、バックグラウンド自動要約には使えない制約は残る）

### 2.2 [marianocodes/ai-local-gemini-nano-and-summarize](https://github.com/marianocodes/ai-local-gemini-nano-and-summarize)（Angular、拡張機能ではないが最新API仕様の実例として有用）

- `declare const Summarizer: any; declare const LanguageModel: any;` — **グローバル直下**の宣言。`window.ai` 経由ではない（現行仕様に準拠）
- **Summarizer API と Prompt API の併用パターン**: まず `Summarizer.create({type:'key-points', length:'short', ...})` で要約 → その結果を `LanguageModel.create({initialPrompts:[{role:'system',...}]})` に渡し、`responseConstraint`（JSON Schema）で構造化データに変換
- 各セッションは使用後に必ず `destroy()` している
- **示唆**: 要約特化なら `Summarizer` API、汎用対話や構造化出力には `LanguageModel` という役割分担が公式の想定パターンと考えられる。Yasumaroは要約用途のみだが、`Summarizer` APIの方が `Prompt API` より適している可能性がある（現状は `Prompt API` のみ使用）

### 2.3 [GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples) — `functional-samples/ai.gemini-on-device-alt-texter`（Google公式）

- **最重要**: `background.js`（Service Worker）内で **`self.LanguageModel.create(...)` を直接呼び出している**。Offscreen Documentは一切使っていない
  ```js
  // background.js より抜粋
  const session = await self.LanguageModel.create({
    temperature: 0.0, topK: 1.0,
    expectedInputs: [{ type: 'image' }]
  });
  ```
- コメントに `// we're not checking availability here, but will simply fail with an exception` とあり、availability チェック省略も許容される設計（例外ハンドリングに委ねる）
- `chrome.contextMenus` から起動し、生成結果は `chrome.runtime.sendMessage` でPopupへ中継（Popup側は表示・`Translator.create()` による翻訳のみ担当）
- 同リポジトリの `ai.gemini-on-device-audio-scribe` は `bridge.js` というファイル名が存在し、Side PanelとService Worker間の橋渡し役と推測される（DOM操作が必要な音声処理のため、Offscreen的な役割分担がある可能性。今回は未深掘り、今後の詳細調査候補）

---

## 3. `LanguageModel` は Service Worker から直接呼べるのか（既存前提への疑義・実機検証済み）

- ADR (`dev-docs/ADR/2026-04-04-lm-studio-integration.md`) には直接の言及なし
- PBI-30本文の「落とし穴」には「`window.ai` は Service Worker では利用できないため、必ず Offscreen Document 経由となる」と明記されている
- 調査時点では、**Google公式サンプル `ai.gemini-on-device-alt-texter` が Service Worker から `self.LanguageModel.create()` を直接呼んでいる**ことをソースコード上で確認済みだった（[2.3](#23-googlechromechrome-extensions-samples--functional-samplesaigemini-on-device-alt-textergoogle公式)参照）

### 3.1 実機検証（2026-07-28実施）

Manifest V3 拡張機能の Service Worker 内から `self.LanguageModel` を直接呼び出す最小検証用拡張機能を作成し、Playwright (`chromium.launchPersistentContext`, `channel: 'chromium'`, `headless: false`) 経由で Chrome を起動して検証した。

**検証コード（Service Worker内、`background.js`）**:
```js
const hasSelfLanguageModel = 'LanguageModel' in self; // -> true
const availability = await self.LanguageModel.availability(); // -> 'unavailable'
const session = await self.LanguageModel.create(); // throws
```

**検証結果**:

| 項目 | 結果 |
|---|---|
| `'LanguageModel' in self`（Service Worker グローバルスコープ） | `true` — **オブジェクト自体は存在する** |
| `self.LanguageModel.availability()` | 例外を投げず `'unavailable'` を正常に返す |
| `self.LanguageModel.create()` | `NotSupportedError: "Unable to create a text session because the service is not running."` |

**解釈**: `create()` が投げた例外は `NotAllowedError` や権限拒否系のメッセージではなく、**「サービス（オンデバイスモデル配信基盤）が起動していない」という技術的な準備状態の問題**だった。もしService Worker文脈自体がAPIをブロックしているなら、`availability()`の時点で例外が発生するか、`unsupported`相当のエラーになるはずだが、実際には`LanguageModel`オブジェクトへのアクセスも`availability()`の呼び出しも正常に完了している。

これは「`window.ai`（旧API）はService Worker非対応だったが、現行の`LanguageModel`グローバルはService Workerから直接アクセス可能」という仮説を支持する一次データである。ただし今回の検証環境ではGemini Nanoのモデル配信サービス自体が有効化されていなかったため、`create()`が実際に成功しセッションが使えるところまでは確認できていない（後述の制約参照）。

### 3.2 検証環境の制約

- 検証は Playwright がバンドルする Chromium（`channel: 'chromium'`, v149）で実施。Google Chrome Canary（v150、正規ビルド）へ`--load-extension`で読み込ませる試みは、コマンドライン直接起動・Playwright経由のいずれでも拡張機能が一切ロードされないという問題に阻まれた（`chrome.developerPrivate.getExtensionsInfo()`で確認した実際のインストール済み拡張機能は常に空配列。原因は未特定、Canary固有の挙動の可能性がある）
- そのため今回の`available`/`downloadable`ではなく`unavailable`という結果は、Playwright実行環境（AI機能有効化に必要なコンポーネント配信サービスが動いていない、あるいはハードウェア要件[1.7](#17-ハードウェア要件)未達）に起因する可能性が高く、**「Yasumaroの製品版Chrome環境でも同様にunavailableになる」ことを意味しない**
- 結論の確度: 「Service Worker文脈で`LanguageModel`オブジェクトにアクセスでき、APIを呼び出せる（例外の種類が権限拒否ではなく`NotSupportedError`＝サービス未起動）」ことは実機で確認済み。「実際にモデルがダウンロード済みの環境でセッション生成・プロンプト実行まで成功する」ことは**未検証**（次PBIでの追加確認が必要）

この点はPBI本文の受け入れ基準「既存実装の改善候補5件以上」に直結する最重要の設計判断材料であり、次PBI（設計）で、モデルダウンロード済みの実ユーザー環境（Chrome安定版 or Canary、Gemini Nanoコンポーネント有効化済み）での再検証を行うべき最優先事項とする。

---

## 4. 既存実装（`localAiClient.ts` / `offscreen.ts`）の改善候補

受け入れ基準（5件以上）を満たす形で列挙する。

1. **API呼び出し方式の刷新**: `window.ai.languageModel.capabilities()` / `.create()` → `LanguageModel.availability()` / `LanguageModel.create()` への移行（[1.1](#11-グローバルオブジェクトの変遷), [1.2](#12-languagemodelavailability)参照）。availability の戻り値も4値に合わせて `browserSupport.ts` / `localAiClient.ts` の型・分岐を更新する必要がある
2. **Service Worker直接呼び出しへの移行検討**: 実機検証（[3.1](#31-実機検証2026-07-28実施)）で、Service Worker文脈から`self.LanguageModel`に直接アクセスでき、APIも権限拒否なく呼び出せることを確認した。Offscreen Document経由が必須という既存前提は再考の余地がある。直接呼び出しに移行できれば、`offscreen.ts` のSRP違反（Prompt APIとSQLiteの混在、PBI本文にも既知の課題として記載）を解消しやすくなる。ただし実際にモデルダウンロード済み環境でのセッション生成・プロンプト実行成功は未検証のため、次PBIでの追加確認が前提
3. **入力上限の不整合解消**: `aiLimits.ts` の16,384文字 vs `offscreen.ts:467` の10,000文字ハードコードの不一致を解消。加えて `contextWindow` / `contextUsage`（[1.5](#15-セッション管理上限)）を使った動的な上限管理に置き換えられないか検討
3. **ストリーミング未対応**: `session.promptStreaming()` が使えるにも関わらず `session.prompt()` の一括取得のみ。長文要約時のUX（進捗表示）改善余地
4. **ダウンロード進捗・状態通知の欠如**: `monitor` オプション（`downloadprogress` イベント）が未実装。PBI本文が課題視する「`after-download`状態でのユーザー体験」に直結する改善点
5. **セッションのライフサイクル管理の甘さ**: 現状は単一のモジュールスコープ変数 `session`（`offscreen.ts:89`）で使い回し、エラー時のみ `null` 化。`contextoverflow` / `QuotaExceededError` のハンドリングが皆無であり、長時間使用時に上限超過で失敗するリスクがある
6. **セキュリティ: モデル出力の扱い明文化**: 公式が明言する「出力は信頼できないため`innerHTML`不可」の原則が、既存実装・ADRに明文化されていない。呼び出し元での扱いを確認し、必要ならコメント/ドキュメント化する

---

## 5. `no` / `unsupported` / `after-download` 状態のUX設計知見

- 現行仕様では `'unavailable'`（旧`no`+`unsupported`相当）と `'downloadable'`（旧`after-download`相当）に整理されている
- ダウンロードは `create()` 呼び出し時にユーザージェスチャーが必要（`downloadable`状態から`create()`を呼ぶとダウンロードが開始される、が「ユーザーがページと意味のある interaction をした後でないと開始できない」という制約あり）
- `monitor` の `downloadprogress` イベントで進捗（0〜1の割合）を取得できるため、ダウンロード待ちUIを実装可能
- Google公式サンプル（alt-texter）は availability チェックを省略し例外ハンドリングのみで済ませる設計を採っており、「呼び出し前チェック」と「例外ベースのフォールバック」の両方が現実的な設計選択肢としてあり得る

---

## 6. 未解決・次PBIへの申し送り事項

- **最優先（実機検証で部分的に解消、残課題あり）**: `LanguageModel` の Service Worker 直接呼び出し可否を実機検証した（[3.1](#31-実機検証2026-07-28実施)）。Service Worker文脈で`LanguageModel`オブジェクトへのアクセス・`availability()`呼び出しは権限拒否なく成功することを確認済み。ただし検証環境ではGemini Nanoのモデル配信サービス自体が起動しておらず（`NotSupportedError: service is not running`）、**実際にセッション生成・プロンプト実行まで成功するかは未確認**。モデルダウンロード済みの実環境（Chrome安定版/Canaryでフラグ有効化・モデルダウンロード完了済み）での再検証が次PBIの最優先事項
- Extension向け `LanguageModel` が Origin Trial registration を要するか（`manifest.json` への `trial_tokens` 追加要否）を確認する
- `Summarizer` API（[2.2](#22-marianocodesai-local-gemini-nano-and-summarize角度、拡張機能ではないが最新API仕様の実例として有用)参照）が要約専用途としてPrompt APIより適さないか比較検討する
- `ai.gemini-on-device-audio-scribe` の `bridge.js` アーキテクチャ（DOM操作が必要な処理の橋渡しパターン）を深掘りし、SRP違反解消の参考にできないか確認する
- Chrome Canary（v150）へ`--load-extension`で拡張機能を読み込ませようとしたが、コマンドライン直接起動・Playwright経由のいずれでも失敗する現象を確認した（原因未特定）。Canaryでの実機検証を行う場合は、まずデベロッパーモードUIから手動で「パッケージ化されていない拡張機能を読み込む」操作が必要になる可能性がある

これらはPBI-31（設計, `pbi/2026-07-26-31-feat-built-in-ai-provider-integration-design.md`）に引き継ぐ。

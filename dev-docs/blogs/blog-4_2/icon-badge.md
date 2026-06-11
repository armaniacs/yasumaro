# ポップアップを開かなくてもわかるようになりました ── プライバシー検出バッジ

東洋経済オンラインの記事を読んでいるとき、こんな疑問が浮かびました。

「このページ、Obsidian Weave のポップアップには『Cache-Control: private 検出』と出ているけど、ポップアップを開かないと気づけない。」

ページを読んでいる最中にわざわざ拡張機能のアイコンをクリックするのは面倒です。プライベートページかどうかは、開く前にわかっていてほしい情報です。

v4.2 から、プライバシー検出があった場合はツールバーのアイコンに `!` バッジを表示するようにしました。

---

## どう見えるか

`Cache-Control: private`、`Set-Cookie + Vary: Cookie`、`Authorization` ヘッダーのいずれかが検出されると、拡張機能アイコンの右下にオレンジ色の `!` バッジが表示されます。ポップアップを開いて確認するまでもなく、「このページは自動記録が止まっている」とわかります。

バッジはポップアップを開くと消えます。「確認した」というアクションに合わせてクリアする設計です。

---

## `chrome.action.setBadgeText` の基本

Chrome 拡張機能には `chrome.action.setBadgeText()` という API があります。ツールバーアイコンの右下に最大4文字のテキストを表示できます。

```typescript
chrome.action.setBadgeText({ text: '!', tabId });
chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId });
```

`tabId` を指定することで、タブ単位でバッジを管理できます。別のタブでは別の状態を持てます。指定しなければ全タブに適用されます。

---

## バッジをどこでセットするか

既存の実装では、`HeaderDetector` がページ読み込み時に HTTP レスポンスヘッダーを受け取り、プライバシー判定をしてキャッシュに保存していました。このキャッシュへの書き込みのタイミングが、バッジをセットする自然な場所です。

`cachePrivacyInfo()` の末尾に追加しました。

```typescript
// プライベート検出時のみセット。非プライベートでは上書きしない
if (tabId !== undefined && tabId >= 0 && info.isPrivate) {
  chrome.action.setBadgeText({ text: '!', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId });
}
```

「非プライベートでは上書きしない」という条件が重要です。次の節で説明します。

---

## リダイレクトが厄介だった

最初の実装では、プライベートを検出したら `!` をセット、非プライベートなら `''` でクリア、としていました。動作させてみると、`!` が一瞬表示されてすぐ消えることがありました。

原因はリダイレクトです。

toyokeizai.net のようなサイトは、CDN やログインチェックを挟むため、ページ読み込み中に複数の HTTP リクエストが `main_frame` タイプで発火します。

```
1. https://example.com/article/123
   → Cache-Control: private  → ! をセット
2. CDN 経由のリダイレクト
   → Cache-Control: public   → '' でクリア ← ここで消えていた
3. 最終ページ表示
   → （onHeadersReceived 発火なし）
```

対処は2段階です。

**1つ目**: `cachePrivacyInfo()` ではプライベート検出時のみバッジをセットし、非プライベートでは何もしない。一度立った `!` をリダイレクト途中の別レスポンスで消さない。

**2つ目**: `chrome.tabs.onUpdated` でページロード完了（`status: 'complete'`）を待ってから、キャッシュを参照してバッジを確定させる。

```typescript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
    const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
    if (privacyInfo?.isPrivate) {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId });
    } else {
        chrome.action.setBadgeText({ text: '', tabId });
    }
});
```

ページが完全に読み込まれた時点でキャッシュを見れば、リダイレクトの途中経過に左右されません。`onHeadersReceived` が何回発火しても、最終的な状態はここで決まります。

---

## タブ切り替え時の処理

別のタブに切り替えたとき、新しいタブのプライバシー状態をバッジに反映する必要があります。`chrome.tabs.onActivated` で対応しました。

```typescript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url) {
        chrome.action.setBadgeText({ text: '' });
        return;
    }
    const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
    const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
    if (privacyInfo?.isPrivate) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#F97316' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
});
```

ここでは `tabId` を省略しています。`tabId` なしで `setBadgeText` を呼ぶと、現在アクティブなタブのバッジ（グローバル表示）を更新します。切り替え直後なので、アクティブタブが新しいタブに変わった瞬間に呼ばれます。

---

## Q. 新しいページに遷移しても前のページのバッジが残ることはないか

A. 残りません。

`chrome.tabs.onUpdated` は `status: 'complete'` でバッジを確定させます。新しいページのロードが完了した時点で、そのページのキャッシュ状態に基づいてバッジが上書きされます。前のページがプライベートだったとしても、新しいページがプライベートでなければ `''` でクリアされます。

---

## `normalizeUrl` を public に昇格させた理由

`HeaderDetector.normalizeUrl()` はもともと `private static` でした。`service-worker.ts` の `onActivated` / `onUpdated` ハンドラからキャッシュを参照する際、URLの正規化が必要です。キャッシュのキーとして使っているのと同じ正規化（末尾スラッシュ削除・フラグメント削除）を適用しないと、キャッシュの参照に失敗します。

同じ処理を別の場所に書くより、`public static` に昇格して再利用するほうが一貫性があります。

---

## まとめ

| タイミング | バッジの動作 |
|-----------|------------|
| プライベートヘッダー検出時 | `!`（オレンジ）をセット |
| ページロード完了時 | キャッシュを参照してバッジを確定 |
| タブ切り替え時 | 新しいタブのキャッシュを参照して更新 |
| ポップアップを開いたとき | クリア |

ポップアップを開かなくてもプライバシー状態がわかる。それだけのことですが、毎回アイコンをクリックして確認する手間がなくなります。

---

**GitHub**: [obsidian-weave](https://github.com/armaniacs/obsidian-weave)

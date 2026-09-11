# Arcaia Recent View history controls probe v1.0.0

Recent Viewで「さらに○件表示」「全部表示」が出ない原因を、現在の画面だけで確認する専用probeです。

## 実行手順

1. Arcaiaを再読み込み済みのChatGPTで、問題が発生している会話を開きます。
2. DevToolsのConsoleを開きます。
3. `recent_view_history_controls_probe.js` の内容をすべて貼り付けて実行します。
4. そのまま約10秒待ちます。
5. 次を実行します。

```js
await window.__ARCAIA_RECENT_VIEW_HISTORY_CONTROLS_PROBE__.scan()
window.__ARCAIA_RECENT_VIEW_HISTORY_CONTROLS_PROBE__.download()
```

ダウンロードされたJSONを添付してください。

## 確認内容

- Main WorldのRecent View設定を取得できているか
- `lastRewrite`と`summary.totalTurnCount`が存在するか
- 現在の会話とrewrite対象会話が一致するか
- 表示件数と残り件数
- 最初の可視ターンを取得できるか
- コントロールが現在存在するか
- コントロールが一度挿入されてから削除されたか
- full-load状態やhistory search状態で抑止されていないか

## 取得しない情報

- 会話本文
- 会話IDの実値
- URL
- Cookie
- localStorageの値
- sessionStorageの生値
- HTML全文

probeは1個のMutationObserverを10秒だけ使用し、`setInterval`や通信の横取りは行いません。

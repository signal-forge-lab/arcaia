# Arcaia Assistant Render Gap Watch Probe v1.0.0

ArcaiaのRecent View利用中に、tool / thinkingを伴うassistant回答の一部が一時的に画面から抜け、ページ再読み込みで復元する現象を待ち受ける独立Chrome拡張probeです。通常版Arcaiaと同時に有効化します。

## 取得する証拠

- ChatGPTの`/backend-api/conversation/` responseをページ側が読む瞬間に、mapping node数、selected path node数、user turn数、role別件数、tool-like / thinking-like node数、最終assistant本文の**文字数だけ**を記録します。
- ArcaiaがRecent View用に`new Response(...)`を生成した場合、同じ要約をrewrite後payloadについて記録します。
- Arcaiaの既存`lite_rewrite_success` eventからbefore/after byte数とturn数だけを記録します。
- DOMでは最新assistant turnだけを追跡し、assistant文字数、turn文字数、stream中か、Arcaia hidden属性、表示状態を記録します。
- generation完了後に同じ最新turnのassistant文字数が大きく縮んだ場合は`assistant_text_shrank_after_render`としてマークします。
- 同じタブを再読み込みし、同じuser turn数なのにassistant文字数が大幅に増えた場合は`reload_restored_assistant_content`としてマークします。

## privacy

会話本文、会話ID、URL全文、Cookie、Authorization、Storage生値、HTML全文は保存しません。本文はresponse要約の計算中だけ一時的にメモリ上で扱い、JSONへ残すのは文字数・件数・boolean・限定enumだけです。

記録はtabごとに直近80 event、incident 8件へ制限します。`setInterval`や常時ポーリングは使いません。DOM監視は`main#main` / conversation scroll rootへrebindし、初期root探索時だけ一時的にdocument全体を監視します。

## 使い方

1. `chrome://extensions`でデベロッパーモードを有効にし、このフォルダを「パッケージ化されていない拡張機能を読み込む」で指定します。
2. 通常版Arcaiaも有効にしたままChatGPTタブを再読み込みします。
3. 普段どおり利用します。異常候補を検出するとProbeのツールバーbadgeが`!`になります。
4. 現象を目視した場合は、可能ならそのままProbe popupの「現在を記録」を押してから、通常どおりページを再読み込みして表示を直してください。
5. 再読み込み後、Probe popupから「JSON保存」して共有してください。リロードで同じturnの文字数が復元した場合も自動でincidentになります。

「このページで停止」は現在のdocument上のobserverとResponse hookを完全cleanupします。次回ページ再読み込みでは通常どおり再開します。

# Arcaia Initial Render Probe v1.0.0

通常版Arcaiaと併用し、ChatGPTの`document_start`から15秒間だけ初期表示を記録する最小構成のChrome拡張probeです。

## 実行手順

1. ZIPを展開します。
2. 通常版Arcaiaは有効のままにします。
3. `chrome://extensions`を開き、デベロッパーモードを有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」で、展開したフォルダを選択します。
5. 既存のChatGPTタブを閉じるか、診断対象とは別に新しいChatGPTタブを開きます。
6. 診断したい会話を開いた状態で15秒待ちます。
7. probe拡張のアイコンを開き、「JSONを保存」を押します。
8. 保存されたJSONを添付します。

複数のChatGPTタブを同時に再読み込みすると、最後に開始したタブの記録で上書きされます。診断中は対象タブを1つにしてください。

## 記録内容

- `document_start`、`DOMContentLoaded`、`window.load`、指定時点の構造snapshot
- ChatGPTのheader、Composer、conversation section、native copy button、native Share buttonの出現
- ArcaiaのRecent View style／controls、ターンMarkdown、ヘッダーMarkdown、timestamp、model decoration、Pinned markerの出現
- Arcaia Main Worldから見える既存event type
- 読み取り専用の既存`GET_LITE_DISPLAY_CONFIG`応答のprivacy-safe summary
- UIが一度出現した後に消えた場合の時系列

## 取得しない情報

- 会話本文、プロンプト、回答内容
- conversation IDの実値
- URL全文
- Cookie、Authorization、認証情報
- ページのlocalStorage／sessionStorage値
- Arcaia本体の`chrome.storage.local`
- HTML全文

## 制約

このprobeはArcaiaとは別の拡張機能です。そのため、Arcaia Content Scriptのisolated world内にある変数、Arcaia固有Storage、Arcaia Content Script内だけで発生した例外は直接取得できません。

外部probeで初期表示時系列を確認しても原因を絞れない場合だけ、次段階としてArcaia本体へ範囲を限定した一時probeを追加します。

# Arcaia Model Selector Interaction Probe v1.1.0

モデルセレクターに関する次の3症状を、同じ時系列で切り分ける独立Chrome拡張です。

1. 長い入力文字とモデルセレクター装飾が重なる
2. Chatのモデルセレクター／詳細設定で選んだ値がArcaia表示へ反映されない
3. WorkでSol・Terra・Lunaを選択してもArcaia表示へ正しく反映されない

通常版Arcaiaと同時に有効化します。Arcaia本体のruntimeへprobeコードは追加しません。

## 取得する証拠

操作ごとに、次の5段階を同じ`captureId`で記録します。

```text
即時 → 次の描画フレーム → 80ms → 300ms → 900ms
```

v1.1.0では、Composerへの文字入力そのものでは自動captureしません。
長文入力でrecord上限を消費せず、モデルPicker、Chat/Work切替、Storage変化、
手動の「記録」操作を優先して残します。文字重なりは「重なりを記録」で取得します。

各段階で記録する内容:

- Composer、入力領域、モデルボタン、Pickerの座標
- 入力テキスト末尾rectとモデルボタンの重なり量
- `padding-inline-end`とArcaiaの追加予約幅
- GPT-5.6、sol / terra / luna、思考レベル表示の内部重なり
- Pickerで`checked`になったモデル種別・思考レベル
- Chat cookieおよびWork localStorageから得られる権威状態
  - 生値ではなく`sol / terra / luna`、既知effort、存在有無だけ
- Arcaiaの既存privacy-bounded内部snapshot
- 将来のスタイル切替確認用のstyle属性とcomputed style fingerprint

これにより、次のどこで反映が止まるかを分けられます。

```text
ユーザー操作
  → Pickerのchecked状態
  → Chat cookie / Work localStorage
  → Arcaia内部解決
  → 装飾DOM
```

## 導入

1. `chrome://extensions/`を開きます。
2. デベロッパーモードを有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を選びます。
4. 次のフォルダを指定します。

```text
tools/arcaia_model_selector_interaction_probe_extension
```

5. 通常版Arcaiaも有効のままにします。
6. ChatGPTをハードリロードします。
7. probeアイコンをChromeツールバーへ固定します。

## 再現手順

### A. 文字重なり

1. probe popupで「記録をリセット」。
2. Composerへ、問題が見える長さまで文字を入力します。
3. カーソルを重なりが見える位置へ置きます。
4. 約1秒待って「重なりを記録」。

### B. Chat選択反映

1. Chatへ切り替えます。
2. モデルセレクターを開きます。
3. 問題が出る選択値または詳細設定の思考レベルを選びます。
4. Pickerを閉じ、約1秒待ちます。
5. 表示が誤っている状態で「Chat選択を記録」。

ChatはSolのみのため、主に思考レベルの`checked → cookie → Arcaia表示`を確認します。

### C. WorkのSol / Terra / Luna

Workで次を順番に行います。

1. Solを選択 → 約1秒待つ → 「Work選択を記録」
2. Terraを選択 → 約1秒待つ → 「Work選択を記録」
3. Lunaを選択 → 約1秒待つ → 「Work選択を記録」

必要であれば各モデルで詳細設定の思考レベルも変更します。

### D. 将来のスタイル切替証明

オプション実装後、同じ画面状態で次を記録します。

1. 旧スタイルを選択して「Classicを記録」
2. Aurora Edgeを選択して「Auroraを記録」

style属性、背景、境界、shadow、サイズ、重なり量を比較できます。

## JSON保存

すべての再現後にpopupの「JSON保存」を押し、生成されたJSONを添付してください。

リロードするとそのページの記録は失われます。JSON保存まではリロードしないでください。

## Privacy

保存しません。

- 会話本文
- 入力文字列
- URL全文
- conversation ID
- Cookie生値
- localStorage生値
- Authorizationや認証情報
- HTML全文

入力文字について保存するのは、長さ、行rect数、座標だけです。

## 実装上の制限

- 20分または700 recordsで停止します。
- `setInterval`や常時ポーリングは使用しません。
- Composer発見時のみ最大30秒のbootstrap Observerを使います。
- 通常時はComposerと表示中Pickerだけを局所監視します。
- Composer本文の入力Mutationは自動captureせず、モデルtrigger周辺のMutationだけを対象にします。
- Storage hookは対象3 keyだけを記録し、元の処理を変更せずそのまま通します。

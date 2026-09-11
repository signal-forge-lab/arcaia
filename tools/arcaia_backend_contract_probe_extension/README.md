# Arcaia Backend Contract Probe v1.0.8

ChatGPT の backend API の責務を、request / response schema と UI 変化の時系列から証明するための専用 Probe です。

現在の主目的は、Recent View の「全文表示」で起きる取得失敗／別履歴表示について、Content側5秒timeout、backend conversation identity、flat `messages[]` のversion/branch構造を同じcaptureで切り分けることです。絶対Turn数の既存調査項目も引き続き保持します。

## v1.0.8 で修正した証拠境界

- conversation response summaryにもrequest/current/response conversation一致booleanを引き継ぐよう修正
- `backendIdentityMismatchObserved=false` がidentity未収集のために誤ってfalseになる経路を解消
- conversation/message ID実値は引き続き保存しない

## v1.0.7 で追加した証拠

Recent View の「全文表示」で、取得失敗または別履歴に見える内容が表示される問題を切り分けるため、以下を追加しました。

- `GET_READ_ONLY_CONVERSATION_MODEL` のrequest/resultを内部request IDだけで対応付け、**Main World result latency**を記録
- Arcaia Content側の現行待ち時間 `5000ms` を基準に、resultが5秒超で到着したか、5秒超pendingのままかをboolean/数値で記録
- backend requestのconversationと現在表示中conversationが一致したかをbooleanだけで記録
- backend responseにconversation ID fieldが存在する場合、request/current pageと一致したかをbooleanだけで記録
- `/messages?...&include_has_versions=true` を安全なbooleanとして記録
- flat `messages[]` の `metadata.parent_id` について、直前message参照、同一page内の過去/未来参照、page外参照、**同じparentを共有するsibling group数**をcountだけで記録
- `include_has_versions=true` と非線形parent関係が同時に観測された場合、`full_display:include_has_versions_with_non_linear_parent_relations` をdiagnosisへ追加
- backend conversation identity不一致を観測した場合、`full_display:backend_conversation_identity_mismatch` をdiagnosisへ追加

会話本文、conversation/message ID実値、cursor、URL全文は従来どおり保存しません。

**Model Decoration Watch、Assistant Render Gap Watch、Markdown ダウンロード問題は対象外です。**

## v1.0.6 で追加した証拠

- 初期 conversation detail と全文表示後 detail を別 phase として保持
- 同一 pathname でも query signature ごとに API 責務証拠を分離
- `initialPageInfo` は最初の detail response に固定し、後続の大型全文 response で上書きしない
- Request object の body は clone から schema のみ非同期観測し、本文は保存しない
- message metadata 内の count/turn/index 系数値は field ごとの count/min/max/少数distinct値だけ記録
- 絶対Turn候補は current conversation の detail/history/metadata endpoint に限定し、無関係な会話一覧・画像数等を除外

## v1.0.5 で追加した証拠

- `fetch` と `XMLHttpRequest` の両方について backend API request を記録
- request ごとに Probe 内だけの連番 `requestOrdinal` を付け、response と対応付け
- endpoint は conversation ID 等を匿名化した pathname pattern と query key のみ保存
- `num_turns` 等の count 系 query は安全な数値だけ記録し、cursor 値は保存しない
- JSON request body は本文を保存せず top-level key / type / count 系数値 /安全な enum だけ要約
- backend JSON response は本文を保存せず top-level key / type / array length / count・total・offset・page・turn・message 系の数値 field だけ要約
- count / range 系 response header は値そのものではなく数値列だけ記録
- 各 endpoint ごとに request/response shape、status、query key、count field 候補を `apiResponsibilityEvidence` へ集約
- 上スクロールとの因果確認用に bounded な `SCROLL_MARKER` を記録
- backend request / response の直後に DOM snapshot を記録し、UI変化との時系列比較を可能にする
- `absoluteTurnDiscovery` へ「全page取得なしで絶対Turn数を示し得る数値metadata候補」を列挙
- 候補名だけで責務を断定せず、`proofStatus: unresolved` のまま出力する
- Arcaia v0.1.345 の仕様に合わせ、timestamp subsystem の Turn 番号は診断対象から除外

## 既存の conversation 証拠

- 旧 `mapping` と新 `messages[]` transport を別形式として識別
- direct message の `metadata.parent_id` と page 外参照数
- `page_info.has_previous_page / has_next_page / has_more`
- `start_cursor / end_cursor / cursor` は値を保存せず存在だけ記録
- `/backend-api/conversations/<id>/messages` の pagination response
- 初期 response に `has_previous_page=true` がある場合、page 内 user count を絶対Turn数として扱わない
- backend → read-only model → renderer の全文表示経路

## 主な出力

- `network`: fetch / XHR / backend response の総数
- `apiResponsibilityEvidence[]`: endpoint 単位の request / response shape と近接操作
- `absoluteTurnDiscovery`: 絶対Turn数候補 field/header と証明状態
- `response`: 初期 conversation detail の詳細 schema summary
- `conversationFetchPhases`: 初期 detail と全文表示後 detail の分離証拠
- `pagination`: page_info と page-local user count
- `fullDisplay`: 全文表示要求・model・renderer
- `arcaia`: Recent View と timestamp index の状態
- `dom`: section / role / hidden / timestamp badge / read-only renderer の構造
- `events`: bounded な時系列

## 記録しないもの

会話本文、conversation ID、message ID、cursor 値、URL 全文、Cookie、Authorization、response body、request body本文、HTML、Storage 生値は保存しません。

保存する scalar 値は、count / total / page / offset / index / position / turn / message / size / length 系の数値・boolean、または `action/type/mode/event/operation/kind/status/source` の短い機械的 enum に限定します。

## 絶対Turn数の判定方針

`absoluteTurnDiscovery.absoluteTurnCountProvenWithoutPagination` は Probe 自身では安易に `true` にしません。

候補 field/header が見つかった場合でも、以下を別操作・別pageで照合して責務を証明してから仕様に採用します。

1. 初期 page の user 件数とは異なる値を返すか
2. 上スクロールで page が変わっても同じ総数を返すか
3. 新規 user turn 追加後に期待どおり増えるか
4. full-history 取得後に実測した全 user turn 数と一致するか

候補が無い場合は `no_numeric_total_or_position_metadata_observed` となり、少なくとも観測した response/header 内には全件数を直接示す数値metadataが無いことが分かります。

## API責務の証明方針

`apiResponsibilityEvidence[].proofStatus` は次のどちらかです。

- `request_and_response_shape_observed`: request と response schema の両方を観測
- `request_only_observed`: request は見えたが response schema は未取得

endpoint 名だけから「初期表示API」「過去ログAPI」等とは断定しません。`SCROLL_MARKER`、`FULL_DISPLAY_CLICK`、request、response、DOM snapshot の時系列が対応して初めて責務を確定します。

## 推奨採取手順

1. `chrome://extensions/` で Backend Contract Probe v1.0.8 を再読み込み
2. 通常版 Arcaia v0.1.345 は有効のままにする
3. 他の通信系 Probe は一時的に無効化
4. 長い会話を `Ctrl+Shift+R` して初期表示を待つ
5. そのまま数秒操作せず初期通信を記録
6. 上へスクロールして過去ログを1〜2回読み込む
7. 問題が出るRecent Viewで「全文表示」を1回実行し、成功・失敗どちらでもそのまま10秒ほど待つ
8. 180秒以内に Probe アイコンから `JSON保存`

通信 hook、scroll marker、DOM Observer は document start から180秒で自動停止します。Probe 自身は backend API を追加fetchせず、設定変更・自動retry・pollingも行いません。

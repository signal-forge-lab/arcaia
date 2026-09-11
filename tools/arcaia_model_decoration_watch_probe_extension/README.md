# Arcaia Model Decoration Watch Probe v1.0.28

## v1.0.28で追加したComposer model-trigger構造診断

- ChatGPT UI変更で、閉じたmodel triggerからmodel名 / performance文字列が消えたケースを診断します。
- Composer内buttonについて、本文や任意label文字列は保存せず、button/menu順、`aria-controls`有無、`aria-label`/`title`の固定語hint、data-testid分類/hint、直接子tag、親/祖父wrapperの既知GPT/performance signalだけを保存します。
- `data-testid`、`aria-label`、`title`の生値は保存しません。既存のprivacy境界を維持します。
- 目的は、複数の`button[aria-haspopup="menu"]`から新しいmodel triggerを一意に識別できる安定した構造signalを見つけることです。

## v1.0.27で修正したNew Chat送信後の取得不能

- Probeが接続済みでもbackground reportがまだ無い場合、`JSON保存`をdisabledにしません。既存の`manual_snapshot_only` export経路でその場の状態を取得できます。
- New Chatから最初の送信で`/c/...`へSPA遷移した場合、conversation model field captureを8秒だけ再armします。New Chat画面を長く開いてから送信しても、conversation responseを取り逃しません。
- capture再arm時は同じfetch wrapperを二重wrapしません。
- MAIN / Content bootstrap guardをversion-awareにし、Probe更新後の再注入が旧boolean guardだけで遮断されないようにしました。

## v1.0.26で追加したconversation model field precedence診断

- 通常conversationの初期ロードから8秒だけ、conversation detail JSON responseをone-shotで観測します。
- `resolved_model_slug` / `model_slug` / `default_model_slug`は生値を保存せず、それぞれ`explicit_gpt56` / `gpt5_thinking_alias` / `gpt5_generic` / `other`等の構造分類だけを保存します。
- Arcaia本体と同じ先勝ち順で最初に採用されるfield名と、「先頭fieldは曖昧だが後続fieldに明示GPT-5.6が存在するか」を`alternateExplicitGpt56FieldPresent`で記録します。
- これにより、conversation config自体は取得できているのに装飾されないケースで、backend aliasの誤判定なのかfield precedenceの問題なのかを分離できます。
- conversation ID、slug生値、thinking effort生値、本文は保存しません。8秒後はfield解析を停止し、Probe自身がtop-levelのままならwrapperも解除します。定期pollingや永続Observerは追加しません。

## v1.0.25で強化した表示状態診断

- このProbeは**モデル装飾だけ**を監視します。Assistant Render GapやMarkdownダウンロード問題は別Probe / 別課題です。
- 「装飾が必要なのに無い」と「装飾はあるがnative実設定とArcaia表示が違う」を分離します。
- snapshot / incidentへ`displayState.native`、`displayState.arcaia`、`displayState.decoration`、`displayState.comparison`を同時に保存します。
- 例: nativeが`高い`、Arcaia表示が`最大`なら`wrong_decoration_value` / `performance_mismatch`として記録します。
- Popupの操作は`JSON保存`だけです。保存時に`CAPTURE_NOW`を内部実行し、その時点のsanitized snapshotをJSONへ優先して含めます。
- 通常conversation / GPT surfaceのcold startも7秒の既存grace後に診断対象とし、Main World authority surveyとArcaia internal snapshotを自動要求します。
- 新しい定期pollingやページ全体の永続Observerは追加していません。

## v1.0.24で強化した通常conversation cold-start診断

- 「現在を記録」は通常conversationでもMAIN-world survey完了をboundedに待ってからsnapshotを返します。
- Composer内でperformance button以外のmenu buttonが一意なら、現在model button候補としてReact/history等の意味的signalを確認します。
- `cache/.../models` / `tpp-models`のモデル一覧はcurrent-selection authorityとして数えません。
- Storage key中のuser識別子・UUIDは`<redacted>`へ置換し、生値は保存しません。

## v1.0.23で追加した通常conversation cold-start authority診断

- `/c/...`を直接初期表示した時、conversation model-configがまだ供給されていないケースを追加診断します。
- 手動「現在を記録」またはlive status時だけ、現在Composer内のmenu buttonを最大6件に限定し、`GPT-5.6`または裸の`5.6`シグナル、既知performance / thinking effort、data-testidの分類だけを保存します。任意のbutton文字列は保存しません。
- localStorage / sessionStorageは既存のsemantic storage sanitizerを再利用し、`model` / `slug` / `thinking` / `effort`等に関係するキーだけを最大16件確認します。`oai/apps/tpp/model-view`等にGPT-5.6 / thinking authority候補があるかを派生boolean/enumとして保存し、Storage値やmodel slug実値は保存しません。
- これにより、通常conversationでNew Chat cookieを広域fallbackへ拡張する前に、現在ページ自身からより強いmodel authorityを取得できるか判断できます。
- 新しいObserver、polling、network hookは追加していません。

## v1.0.22で強化したnavigation reset診断

- Arcaia内部の直近4回のnavigation resetを`navigationResetHistory`として保持し、後続のreplacement診断で上書きされないようにします。
- 各resetはURLやconversation IDを保存せず、旧/新context種別、context keyが変わったか、reset直前/直後のstate有無、surface、各preserve条件、最終decision/reasonだけを保存します。
- `lastStateMutation`でGPT-5.6 stateが最後に`set` / `replace` / `clear`された場所を記録し、navigation resetで消えたのか、その後のresolutionで消えたのかを区別します。
- 会話本文、会話ID実値、URL全文、Cookie、Storage値そのものは引き続き収集しません。追加Observer、ポーリング、常時ログもありません。

## v1.0.21で強化した遷移原因診断

- baselineにURLや会話IDを保存せず、`routeKind`と`surfaceMode`だけを保持します。
- Arcaia internal snapshotはcontext種別、state/context一致、navigation resetの保持判定、conversation/composer/navigation carryの有無をboolean/enumで返します。
- route/composer replacement中のinternal snapshotを`lastTransitionInternalSnapshot`として1件だけ保持し、後から手動保存しても遷移時の判断材料が残ります。
- 会話本文、会話ID実値、URL全文、Cookie、Storage値そのものは引き続き収集しません。

## v1.0.20で強化した新規Chat / Chat↔Work遷移診断

- URLが変わらないChat↔Work切替を`surfaceGeneration`として独立追跡し、route遷移とsurface遷移を区別します。
- 新規Chatでもcold-start診断を行い、Arcaia内部で`resolved_state_applied`まで到達したのに装飾が無いケースを`new_chat_decoration_missing_after_applied`として記録します。
- background reportが作れない場合でも、isolated content script内に直近24件のprivacy-safe probe eventだけを保持し、手動snapshot-only JSONへ含めます。
- Arcaia internal snapshotは、既知enum/booleanに限定して`modelSource`、`thinkingEffort`、`performance`、`triggerApplied`、`currentTriggerInComposer`を返します。
- 追加Observer、ポーリング、常時タイマーは増やしていません。既存イベント・既存Observer・既存internal bridgeを利用します。

## v1.0.19で修正した手動記録のbackground依存

- v1.0.18では`CAPTURE_NOW`がbackgroundのreport保存完了を待っていたため、background側のevent queueが詰まると手動記録自体が返らない構造でした。
- v1.0.19ではsanitized snapshotをPopupへ即返し、backgroundへのreport保存は従来どおり非同期で続行します。
- Storage reportがまだ無くてもPopupは返されたsnapshotを一時保持するため、「現在を記録」直後からJSON保存できます。
- 固定待機、ポーリング、新しいObserverは追加していません。

## v1.0.18で修正した手動記録→JSON保存の競合

- Popupの「現在を記録」は、`manual_snapshot`がbackgroundへ届きStorageへ保存される前に完了扱いになっていました。
- v1.0.18では手動記録時だけbackgroundの`PROBE_EVENT`応答を待ち、report保存完了後にPopupへ`CAPTURE_NOW`成功を返します。
- これにより「接続済み / 記録待ち」から「現在を記録」した直後にreportが存在し、JSON保存を有効化できます。
- Storage reportが何らかの理由で作成されない場合も、`CAPTURE_NOW`が返したsanitized snapshotをPopup内だけで保持し、「手動記録済み」としてJSON保存できます。Storage reportが存在する場合は従来どおりそちらを優先します。
- 固定待機、ポーリング、新しいObserverは追加していません。

## v1.0.17で修正したPopupの接続状態判定

- `report`がまだStorageへ作成されていないだけの状態を「probe未起動」と誤表示しないようにしました。
- Popupは`PING_PROBE`と再注入後の`PING_PROBE`を現在接続状態の権威として扱い、接続済みで記録だけ未生成なら「接続済み / 記録待ち」と表示します。
- 再注入後もPINGできない場合だけ「未接続」と表示し、ChatGPTタブ再読み込みを案内します。
- 新しいObserver、常時ログ、ポーリングは追加していません。

## v1.0.16で追加した限定effort調査

- `data-animated-slider-trigger="true"` 配下だけを対象に、effort / thinking / reasoning / intelligence関連のDOM属性名とReact prop名を最大12件ずつ記録します。
- `data-max-effort` だけは値の型を記録し、boolean、絶対値1000以下の有限数値、32文字以下の安全なidentifier文字列だけを値として保持します。
- その他のeffort関連prop/属性は名前だけを保持し、任意の値は保存しません。

モデルセレクターのArcaia装飾が、再現手順不明のまま外れる問題を待ち受ける独立Chrome拡張です。通常版Arcaiaと同時に有効化します。

## v1.0.15で修正したReact descendant記録欠落

v1.0.14でMAIN worldへ追加した`data-animated-slider-trigger`配下のReact semantic surveyは実行されていましたが、isolated world側のprivacy sanitizerが`react.triggerDescendants`を出力へ引き継いでいませんでした。v1.0.15では、最大12 nodeという既存boundを維持したまま、count・semantic path・認識済みmodel/thinking signalだけをJSONへ残します。React生値、任意props、HTMLは保存しません。

## v1.0.14で追加したWork pre-Picker構造調査

- Work切替後のpre-Picker確認から180ms/700msの固定再チェックを削除し、既存Composer/triggerの局所MutationObserverで実際のDOM変化が起きた時だけ再採取します。
- ChatGPTネイティブの`data-animated-slider-trigger`と`*_SliderTriggerModelLabel` / `*_SliderTriggerEffortLabel`構造をモデルボタン配下だけで認識します。
- `5.6 Sol`のように`GPT`接頭辞がないWork表示でも、モデルラベルという限定された文脈からGPT-5.6 / familyを要約できます。
- 表示言語へ依存しないauthority候補を探すため、MAIN world surveyでは同じnative trigger配下のReact props/fiberを最大12 DOM nodeに限定してsemantic keyだけ走査します。生値、会話本文、HTMLは保存しません。
- 表示テキストからperformanceを認識した場合は`performanceSource: localized_display_text`と明示し、言語非依存の内部stateとは区別します。

## v1.0.13で修正したイベント記録競合

短時間に複数のprobeイベントが届いた場合、backgroundのStorage更新が競合して一部イベントが欠落する問題を修正しました。Storageを変更するbackground処理を直列化し、`surface_control_transition_observed`、`work_pre_picker_authority_observed`、MAIN-world surveyなどが同時刻付近に発火しても記録を失わないようにしています。

## v1.0.12で追加した未接続の自己復旧

- Popupを開いた時にisolated content scriptへ`PING_PROBE`し、静的content scriptが未注入なら自己復旧します。
- 復旧時は、ユーザーが拡張アイコンをクリックしたことで得られる`activeTab`権限と`chrome.scripting.executeScript`を使い、`main.js`をMAIN world、`content.js`をisolated worldへ再注入します。
- 両scriptは多重注入guardを持つため、静的注入済みの正常タブへ重複listenerを作りません。
- 通常の`document_start`静的注入は維持します。自己復旧はPopupで未接続を検出した場合だけ動作します。

v1.0.11で「未接続」のままになった環境では、v1.0.12を再読み込み後、対象ChatGPTタブでProbeアイコンを一度開いてください。静的注入が欠けていてもPopup側から接続を復旧できます。

## v1.0.11で追加した包括Work pre-picker authority survey

同じ再現を何度も要求しないため、Workへ切り替えてからmodel pickerを開く前の状態を、一度の切替で複数の境界からまとめて取得します。v1.0.14以降、固定ms再チェックは廃止し、局所Observerによるイベント駆動へ置き換えています。

- Work切替後は2 render frame後に初回captureし、その後はComposer/model triggerの関連Mutationが起きた時だけ再captureします。
- `world: "MAIN"`の専用`main.js`を追加し、isolated worldでは見えない可能性があるReact expandoを実ページ側から確認します。
- Work model buttonからComposerまで最大6 DOM祖先だけを対象に、React props / Fiber props / bounded hook stateのsemantic fieldを確認します。
- window globalはmodel / thinking / intelligence / effort / tier / reasoningに関係する名前だけを対象にし、認識済みsignalとsemantic pathだけを保存します。
- IndexedDBは最大4 database、合計12 object store、各8 recordまでのone-shot samplingを行い、model / thinking等のsemantic fieldと認識済み値だけを保存します。database名、store名、record key、record生値は保存しません。
- Performance Resource TimingはURLを保存せず、model / settings / conversation / tpp / work / backend-apiのcategory countだけ記録します。
- Work controlを押した直後2.5秒だけJSON `fetch` responseをcloneし、model / thinking等のsemantic fieldと認識済みsignalだけを抽出します。response本文、URL、任意field値は保存しません。capture window外ではresponse cloneを行いません。
- `history.state`、Navigation API state、`__remixContext`等の既知framework stateもbounded semantic scanの対象にします。
- 既存のDOM、閉じたpicker、localStorage、sessionStorage、Arcaia内部snapshot、native picker authority診断も同じreportに残ります。

通常時はComposer/triggerの局所Observerだけを使います。IndexedDB samplingは手動capture時のbounded one-shotです。

今回の調査では、Probeを再読み込みしてChatGPTをハードリロード後、**Chatで装飾を確認 → Workへ切替 → pickerを開かず表示が出たら「現在を記録」→「JSON保存」**してください。固定時間待つ必要はありません。

## v1.0.10で追加したWork pre-picker authority診断

ChatからWorkへ切り替えた直後、モデルpickerを開く前に正しいGPT-5.6 / thinking authorityがどこかへ既に存在するかを調べます。

- Workへのsurface切替が2 render frame後に確定し、native pickerがまだ開いていない場合だけ`work_pre_picker_authority_observed`を自動記録します。
- DOM描画が遅い場合を拾うため、180ms後に1回だけ同じ診断を再確認します。ポーリングはしません。
- 閉じた／hidden状態で残っているnative pickerとthinking sliderについて、個数と安全な数値`aria-valuenow`だけを記録します。
- 現在Composer、Composer直近親、Workモデルbuttonの局所範囲だけから、model / thinking / effortに関係する属性名と既知信号だけを記録します。任意のラベル文字列やHTMLは保存しません。
- Workモデルbutton自身にReact props / Fiber expandoが存在する場合、その**button 1個だけ**を最大2階層・semantic key限定で調べます。React tree、parent/child Fiber、ページ全体は走査しません。
- localStorage / sessionStorageはmodel / thinking / effort / intelligence / tierに関係するキーだけを最大16件調べ、キー名、JSON shape、semantic field path、既知GPT-5.6 / Work family / thinking effortの派生判定だけを記録します。Storage値そのものは保存しません。
- `modelSignalFound`と`thinkingSignalFound`が両方あれば`authoritySignalFound: true`になります。

今回の確認では、**Chatで正常装飾された状態からWorkへ切り替えたら、Workのモデルpickerは絶対に開かず**、0.5秒程度そのまま待ってpopupの「現在を記録」→「JSON保存」を実行してください。

`authoritySignalFound: false`で、`dormantPicker` / `domSignals` / `reactSignals` / `storageSignals`にも有効な信号がなければ、「現在観測できる安全なauthorityはpickerを開くまで存在しない」という判断材料になります。

## v1.0.9で追加したChat→Work surface切替／native picker authority診断

New Chat上でChatからWorkへ切り替えた瞬間だけ装飾が失われるケースを切り分けるため、次を追加しました。

- surface controlクリック前のsurface、クリック対象、2 render frame後に確定したsurfaceを`surface_control_transition_observed`として記録します。
- 各snapshotへ現在surfaceを`activeSurfaceMode`として記録します。
- モデルpickerが開いている場合だけ、`nativePickerAuthority`へ次の許可済み情報を記録します。
  - `nativePickerAuthority`自体の有無でpickerの出現を判定し、Composer内triggerと結び付いているか
  - checked itemの明示GPT versionと既知thinking label
  - Sol / Terra / Lunaの既知Work family候補
  - family候補の`aria-expanded` / `data-state` / submenu有無
  - thinking sliderの存在と数値`aria-valuenow`
- Composerのモデルbuttonをクリックした場合は2 render frame後にpicker authorityを自動記録し、picker描画が遅い場合だけ160ms後に1回だけ再確認します。

任意のpickerラベル、未知のモデル名、DOM ID、HTML、Storage値は保存しません。React/Fiber全走査、追加の広域Observer、ポーリングも追加していません。

今回のChat→Work失敗を採る場合は、装飾が外れたあと**Workのモデルpickerを一度開いて、そのままpopupの「現在を記録」→「JSON保存」**を実行してください。選択変更は不要です。

## v1.0.8で追加したWork authority storage shape診断

`new_work_local_storage`が`resolved_state_unavailable`になるケースで、Work authorityが本当に欠落しているのか、既知キー内のschema変更で読めなくなっているのかを区別するため、各snapshotへ次の安全な構造情報を追加しました。

- `settingsPresent` / `settingsJsonObject`
- 既知の`lastUsedModelSlug`系fieldが存在するか、GPT-5.6形式として認識できるか
- 既知のthinking-effort storageが空でないか
- 上記だけで既存Work authorityを構成できるか
- model / slug / thinking / effortに関係するJSON fieldの**パス名だけ**（最大12件、深さ2まで）
- `oai/apps/tpp/`配下のstorage **キー名だけ**（最大24件、高entropy segmentはredact）

Storage値そのものやmodel slug実値は保存しません。thinking effortはArcaia internal snapshotから受け取った既知enumだけ、performanceは既知表示ラベルだけを保存できます。追加Observer、polling、storage change listenerも追加していません。

## v1.0.7で追加したWork cold-start／replacement相関診断

- 初期surfaceがWorkのまま7秒間一度も装飾されない場合、既存のArcaia内部snapshot bridgeへ自動要求します。
- `new_work_local_storage`でGPT-5.6 stateの適用処理まで進んだのにtriggerへ適用できない場合は`work_cold_start_resolved_state_not_applied`として記録します。
- 適用済みと報告されたのにDOM装飾が存在しない場合は`work_cold_start_decoration_missing_after_applied`として記録します。
- 正常装飾済みtriggerが交換された場合も、replacement grace開始・終了・候補分類失敗の各境界で既存内部snapshotを自動要求します。
- React/Fiber全走査や追加の広域Observerは導入しません。v2.1.0 standalone probeで既に得られた構造証拠は重複収集せず、Arcaia自身の`resolvedContextKind` / `triggerFound` / `scanReason` / `scanOutcome`との時系列相関だけを追加します。

Cookie、Storage値、model slug、thinking effortの実値は保存しません。

## v1.0.6で追加したComposer／trigger構造診断

`potentialTriggerCount: 0`のときに、モデルボタン自体がまだ存在しないのか、存在するが分類条件から漏れているのか、新旧Composerが同時に残っているのかを区別するため、次の構造情報を追加しました。

- `composerCount`
- `observedComposerIsSelected`
- 各Composerの`rendered` / `buttonCount` / `menuButtonCount`
- 各Composerの`potentialTriggerCount` / `decoratedTriggerCount`
- 各Composerにつき最大6ボタンの安全なprofile
  - `ariaHaspopup`: `menu` / `listbox` / `dialog` / `tree` / `grid` / `none` / `other`
  - `ariaExpanded`: `true` / `false` / `null`
  - `dataState`: 既知状態または`other`
  - 明示モデルversionと既知thinking labelのみ
  - `data-testid`は実値ではなく`model` / `thinking` / `intelligence` / `none` / `other`へ分類
  - 装飾有無、子要素数、SVG有無

任意のボタン文字列、`data-testid`実値、DOM ID、HTMLは保存しません。監視範囲やObserver数も増やしていません。

## v1.0.5で追加したArcaia内部境界診断

Arcaia本体へ明示要求した場合だけ、次の安全な状態を取得します。

- `activeSurfaceModePresent` / `activeSurfaceMode`
- `newChatModelConfigPresent`
- `newChatStateCandidateFound`
- `resolvedContextKind`
- `triggerFound`
- `scanReason`
- `scanOutcome`

Cookie、Storage、model slug、thinking effortの実値は返しません。常時ログ、追加Observer、ポーリングはありません。

## 動作

- ページ上にはマークや常駐UIを表示しません。
- 一度正常に装飾された同じモデルボタンを基準として記録します。
- 同じボタンから装飾属性、装飾DOM、装飾styleが消えた場合に異常として記録します。
- ボタン自体が交換された場合は1.2秒だけArcaiaの再適用を待ち、GPT-5.6候補へ装飾が戻らない場合に記録します。
- Arcaia本体の`page_navigation`イベントを利用し、会話から新規チャットなどのSPA遷移後に装飾が戻らないケースも記録します。
- SPA遷移先で同じ性能表示の候補が残り、明示的な別モデル表示がない場合は`route_transition_not_redecorated`として記録します。
- GPT-5.5など別モデルへの明示変更は異常扱いしません。
- 異常時だけChromeツールバーのprobeアイコンへ赤い`!`バッジを表示します。
- probeアイコンをクリックすると、装飾状態、native実設定、Arcaia表示、検出回数を確認できます。
- popupのユーザー操作は`JSON保存`だけです。押した時点で現在snapshotを自動採取してから保存します。
- 目視で再現した場合も、そのまま`JSON保存`を押せば現在状態が含まれます。

## v1.0.4で追加したslug構造診断

初期表示で届くmodel slugの実値を保存せず、次の構造だけを記録します。

- `slugLength`
- `tokenCount`
- `separatorPattern`: `hyphen` / `underscore` / `dot` / `mixed` / `none`
- `gpt5Present`
- `version6Present`
- `thinkingAlias`
- `knownFamily`: 明示的なGPT-5.6、GPT-5 thinking alias、Sol／Luna／Terra aliasなどの許可済み分類

未知の語、model slug全文、会話ID、URLは保存しません。

## v1.0.3で追加した判定

- `isGpt56`: slugがGPT-5.6系か
- `shouldDecorate`: 現在会話と一致し、GPT-5.6系かつthinking effortが揃っているか

生のmodel slugは保存しません。`gpt-5-6-*`のように表示用`modelVersion`だけではGPT-5までしか判別できない表記でも、`isGpt56`で区別できます。

## v1.0.2で追加した状態供給診断

装飾が長時間戻らない場合に、次の経路を追加で記録します。

- `current_conversation_model_config`が外部probeまで到達した回数
- `SYNC_PAGE_CONVERSATION` request／responseの観測回数
- sync responseに`conversationModelConfig`が含まれたか
- configのconversationが現在routeと一致したか
- `modelSlug`と`thinkingEffort`が揃っていたか

request IDとconversation IDは比較のためメモリ内で一時使用しますが、JSONには保存しません。モデルslugとthinking effortの生値も保存せず、有無と正規化可能なモデルversionだけを記録します。

## 監視範囲

通常時のMutationObserverは次に限定します。

- `form[data-type="unified-composer"]`
- Composerの直近親とその親
- 現在の装飾済みモデルボタン
- `head`直下のArcaiaモデル装飾style

Composerがまだ存在しない場合だけ、最大30秒の一時bootstrap Observerを使用します。`setInterval`、常時ポーリング、ページ本文全体の永続Observerは使用しません。

## 導入

1. ZIPを展開します。
2. `chrome://extensions/`を開きます。
3. デベロッパーモードを有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」から、ZIP内の`arcaia-model-decoration-watch-probe`フォルダを選択します。
5. 通常版Arcaiaも有効のままにします。
6. ChatGPTページをハードリロードします。
7. probeアイコンをChromeツールバーへ固定して、そのまま再現を待ちます。

## 異常を検出したら

1. ChatGPTページをリロードせず、probeアイコンをクリックします。
2. `JSON保存`を押します。
3. 出力されたJSONを添付します。
4. 監視を止める場合はChrome拡張機能を無効化します。

## Privacy

収集しません。

- 会話本文
- conversation ID実値
- URL全文
- Cookie
- Authorization
- ChatGPT Storage値
- Arcaia Storage値
- HTML全文

外部拡張のisolated worldからは、Arcaia Content Script内部変数、Arcaiaの`chrome.storage.local`、Arcaia内部例外を直接取得できません。DOM上の装飾状態と局所的な交換時系列から原因候補を絞るprobeです。

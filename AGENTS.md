# Arcaia project instructions

## Tool History Compaction safety contract (v0.1.371)

- Before changing, simplifying, splitting, or deleting any Tool History Compaction logic, read `docs/tool_history_compaction_runtime_contract.md` in full. This is a canonical real-browser safety contract, not optional background documentation.
- Do not physically detach, empty, or replace children of ChatGPT/React-owned historical tool DOM for memory optimization. The real-browser investigation reproduced `Content failed to load / Try again` from that ownership violation, including failures that appeared only on a later tool-enabled send.
- Preserve the current two-layer design: Main World compacts known heavy historical tool payload fields before React consumes the response, while Content renders `ツール使用 × N` from a Main World summary index using Arcaia `data-*` attributes plus CSS `::before` rather than inserting/removing React children.
- Preserve the latest-two-user-turn safety window, Assistant-invocation counting semantics, graph/message identity, same-conversation pagination merge, cross-conversation isolation, reversible OFF cleanup, and mandatory real-browser multi-send validation described in the contract.

## Turn anchor cache supersession (v0.1.359)

- The older rule that absolute Turn numbers never perform a history fetch is superseded. Reuse a bounded persistent per-conversation User-message anchor cache first; when the current initial conversation response contains a cached anchor, derive absolute Turn numbers from the verified offset with zero additional backend fetches. Only when no cached anchor matches, or matching anchors disagree, may Main World perform one explicit sequential full-history rebuild using the existing read-only conversation pagination path. Persist refreshed anchors after success; do not add polling or automatic retry loops.

<!-- ponytail-workflow: v1 -->
## Ponytail workflow

- Apply the available `ponytail` Skill to every coding, design, refactor, fix,
  dependency-selection, and code-review task. Read its `SKILL.md` before making
  a non-trivial implementation decision.
- Use `ponytail-review` for an over-engineering review of a diff,
  `ponytail-audit` for a repository-wide report, and `ponytail-debt` only when
  collecting explicit `ponytail:` deferrals.
- First understand the requested behavior and trace the real code path. Then
  prefer, in order: no implementation, existing code, standard library,
  native platform behavior, an installed dependency, and finally the minimum
  new code that works.
- Fix shared root causes rather than one reported symptom. Do not add
  unrequested abstractions, generalized frameworks, dependencies, fallback
  layers, configuration, or speculative future support.
- Leave one smallest runnable regression check for non-trivial logic. Browser-
  dependent behavior still requires the repository's probe and real-browser
  evidence rules.
- Priority is: user-approved requirements and completion criteria; Arcaia's
  event-driven, evidence, and safety rules; repository-specific decisions;
  then Ponytail minimization.

このファイルは、Arcaiaの調査・設計・実装・レビューで優先する恒久ルールをまとめたものとする。
過去の議論で確定した方針を、単なる履歴ではなく今後の判断基準として扱うこと。

## 1. 基本方針

- Arcaiaは個人利用・個人開発規模のChrome拡張であり、企業向けシステム相当の過剰設計を持ち込まない。
- 最小の変更で目的を達成し、将来使うかもしれない仕組みを先回りして追加しない。
- コード上の非対称や不整合を見つけたことと、実際の不具合原因を証明したことを区別する。
- 実ブラウザ依存の問題は、静的テストだけで修正済みと判断しない。
- 原因未証明の段階では、恒久修正より先に専用probeで事実を取得する。
- 未証明の処理を追加し、効果が確認できなかった場合は、必要性が証明されるまで残さずrevertする。
- 廃止・却下・保留された方式を、過去の理由を確認せず復活させない。
- 汎用Debug、常時ログ、診断ZIP、広域Observerを「念のため」で通常runtimeへ戻さない。

## 2. 責務境界

### Main World

- ChatGPTページ自身の`fetch`、`History`、ページ内状態など、isolated worldから直接扱えない境界を担当する。
- Recent Viewは、既存conversation responseをその場で書き換える。Content側から同じconversationを追加fetchしない。
- Contentへ返す状態はconversation ID、request ID、event typeで対応関係を確認し、別会話や古い応答を採用しない。
- protocol名、Storage key、公開状態の形を機能追加のついでに変更しない。

### Content Script

- ChatGPT DOMへのUI追加、局所Observer、SPA後の再適用、表示状態調整を担当する。
- `content.js`は起動・状態同期・機能間オーケストレーションを担当し、分割済みhelperへ依存を明示して渡す。
- 現行のcontent script読み込み順を不用意に変更しない。

```text
content_toolbar.js
content_markdown.js
content_filename.js
content_model_selector.js
content.js
```

### Popup / Background / Offscreen

- Popupは設定UIと明示操作の入口に限定する。同一fingerprintの設定はno-opとする。
- 設定変更は直列化し、失敗時はStorage、Popup表示、Tab適用状態を可能な範囲でロールバックする。
- 通知音はoffscreen経路を維持し、ページDOMへ音声再生責務を戻さない。
- Backgroundへ通常ページのDOM判断や継続監視を持ち込まない。

## 3. イベント駆動設計

### 3.1 最も近い意味イベントを使う

- 状態変化の原因に最も近い既存イベントを優先する。
- SPA遷移は`History`／`page_navigation`、回答生成はstream属性・生成DOM遷移、Picker確定はPicker自身の変更、ヘッダーUIはheader/actions containerの変更を使う。
- DOM変化から推測するより、既存の意味イベントが利用できる場合はそちらを使う。
- ただしイベントが存在するだけで必要性を断定しない。発火、到達、状態変化への寄与をprobeで確認する。

### 3.2 Observerは局所化する

- 永続的な`documentElement`全体Observerを標準手段にしない。
- Composer、header、actions container、conversation content root、Pinned section、表示中Pickerなど、対象機能に最も近い安定rootを選ぶ。
- 初期表示で対象rootがない場合だけ一段広いrootを一時監視し、対象発見後は狭いrootへrebindする。
- 一時Observerは、目的達成、route離脱、機能停止、bounded timeoutで必ずdisconnectする。
- 同じDOM領域を複数機能が監視する場合は、可能な限り既存の共有Observerを利用し、各機能は関連Mutationだけを分類する。
- Mutation callbackで毎回ページ全体を再scanしない。追加・削除node、対象属性、最寄りsection、DOM identityから必要性を判定する。
- Recent Viewの再編成は、turn、role、message-id、roleless sectionのempty/non-emptyなど、probeで確認済みの構造変化だけを対象にする。

### 3.3 ポーリングを既定にしない

- `setInterval`、常時ポーリング、常時scroll listenerを通常runtimeの第一案にしない。
- 固定待機だけでDOM完成を仮定しない。
- `setTimeout`はbounded timeout、debounce、一時通知終了、1 render opportunity待機など、終了が保証された補助手段に限定する。
- timeoutはイベント待機の代替ではなく、イベントが来ない場合に処理を閉じる安全境界として使う。
- scroll位置に依存するUIでも、DOM上の適切な位置へ挿入すれば自然に現れるならscroll listenerを追加しない。

### 3.4 SPA遷移は共通再同期経路へ集約する

- route変更ごとに各機能が独自の広域監視や独自timerを持たない。
- routeとDOM identityに紐づくpending syncを一つだけ保持する。
- 置換後のheaderとComposerが準備できた時点でヘッダー／Composer依存UIを再同期し、会話content rootが後から現れる場合は同じpending syncのままもう一度再同期する。
- DOM交換gapを埋める必要がある場合だけ、一時的なchild-list Observerを使う。
- 一時Observerはheader／Composer交換、header局所変更、最初のconversation section／content root出現だけに反応し、既存会話本文の無関係Mutationを無視する。
- header／Composer準備とconversation content root準備を別段階として扱い、前者の完了だけでpending observerを早期終了しない。
- Composer readinessとmodel trigger readinessを結合しない。遅延表示されるmodel triggerはmodel-selector固有Observerへ任せる。
- 同じroute・同じDOM identityへの重複再適用を避ける。

### 3.5 状態は対象単位で束縛する

- 会話由来状態はconversation IDへ束縛し、別会話へ流用しない。
- Chat、New Chat、Workなどsurface固有状態を混同しない。
- 非同期応答の採用前に、現在のroute、conversation、surfaceと一致するか再確認する。
- session scoped overrideは対象会話だけへ適用し、Popupで設定したbase値を書き換えない。
- cacheはboundedにし、関連イベントで無効化する。時間経過だけを理由に全状態を再取得し続けない。

### 3.6 UI生成は冪等にする

- UI追加関数は何度呼ばれても重複生成しない。
- 既存要素が正しいrootへ接続されている場合は再利用し、古いrootへ残った要素は除去または移設する。
- ChatGPT標準DOMを不要に移動・削除しない。Arcaia自身が作った要素・属性だけをcleanup対象にする。
- UIを追加できない場合、どの前提条件でreturnしたかprobeで区別できる設計を優先する。
- 成功時の通常通知は増やさず、失敗時だけ必要最小限の案内を表示する。

### 3.7 機能初期化を相互に巻き込ませない

- 1機能の初期化例外によって、無関係な後続機能がすべて起動不能にならない設計を目指す。
- startup orchestratorを変更する場合は、各subsystemの開始・停止境界を明確にし、失敗をそのsubsystemへ閉じ込める。
- ただし原因未証明の段階で包括的なtry/catchや汎用監視基盤を追加しない。必要性をprobeで確認してから最小実装する。
- 例外を握りつぶすだけにせず、専用probeで開始・完了・失敗したsubsystemを確認できるようにする。

## 4. 機能別の確定方針

### Recent View

- backend rewriteを通常経路とし、Content側からconversation内部APIを追加fetchしない。
- conversation detail responseは旧`mapping`形式と新`messages`配列形式の両方を受け入れる。新形式はMain Worldでresponse配列順を内部の連続表示pathとして正規化し、`current_node`をactive leafとして扱う。`metadata.parent_id`は同一response内に参照先が存在しない例が実測されているためgraph接続のauthorityにはせず、transport metadataとして保持する。Recent View rewrite時はChatGPTへ新`messages`形式のまま返す。
- 新`messages` transportではRecent Viewのbackend rewriteを設定ターン数ちょうどへ縮約する。旧`mapping` transportの描画アンカー2ターンは旧consumer互換のため維持し、新transportへは持ち込まない。
- 短い会話はno-opとし、何も隠す必要がない場合はDOMへ余計な変更を行わない。
- 古いconversation sectionはhard deleteせず、原則としてArcaia属性とCSSで非表示にする。
- 過去履歴の明示操作は「全文表示」のみとし、最初の可視turn直前へ配置する。段階的な「さらにN件表示」は使わない。
- 画像表示ONでは、assistant有無にかかわらず保持対象の各user開始ターンから次のuser開始までにある画像node経路を保持する。user-onlyターンだけへ限定しない。
- ChatGPT標準のPromptジャンプリストをArcaia側で非表示・削除しない。
- 全文表示へ切り替える際は、Recent Viewで表示されていた最初のturnをviewport anchorとしてスクロール位置を復元する。
- 新規チャット→元会話のSPA往復がconversation responseを再取得せず、既存payloadを再利用することはprobeで確認済みであるため、この方式を安易に復活させない。
- v0.1.278〜v0.1.280で検証した同一会話document reload方式は履歴上の旧方式であり、現行の全文表示へ復活させない。
- v2専用probeで、document reloadとconversation再取得は正常だが、reload後のstartup設定同期が`replaceExisting`でsession scoped override／`fullLoadOnce`を消していたことを確認済みである。
- ChatGPT自身が成功した現在conversation Requestをcloneして`200`で再実行しても、conversation DOM、React状態、section数は変化しないことを確認済みである。単純な同一conversation再fetchをdocument reloadの代替として再提案しない。
- 明示的な「全文表示」では、read-only conversation modelがcache missまたは`page_info.has_previous_page=true`の不完全cacheなら、Main Worldの`originalFetch`で現在conversationを取得し、flat `messages` transportは`start_cursor` / `/conversations/<id>/messages?before=...`を`has_previous_page=false`まで順次取得して全履歴modelを再構築してよい。通常表示、完全cache hit、Content Scriptからの追加fetch、自動retry／pollingには拡張しない。
- `React Router revalidate()`、限定React Query `refetch()`、同一サイドバーリンク再クリック、同一URLへの`popstate`はconversation再取得・UI更新を起こさないことを確認済みである。
- Recent View有効中は、現在conversationに対するChatGPT標準の過去履歴pagination `GET /backend-api/conversations/<id>/messages?before=...` をMain Worldのfetch hookで通信前に終端し、上端スクロールによる自動部分ロードを発生させない。Arcaia自身の明示的な全文表示・Turn anchor再構築は`originalFetch`経路を使い、この抑止対象に含めない。
- startup時のRecent View設定同期は、Popupのbase turn countや画像設定を既存Main World設定へmergeする。設定全体のreplaceは、明示的な無効化など状態を破棄する必要がある操作に限定する。
- 現行の「全文表示」はread-only custom DOMで行い、Main Worldの`fullLoadOnce`やdocument reloadを使わない。
- 初期DOM待ちのpending Observerはbounded timeoutを持ち、header／Composerとconversation content rootの二段階同期でMain World状態を重複取得しない。
- 原因確定後は内部probe listener、trace、診断timer、内部probe前提の外部probe一式を通常treeへ残さない。
- Content側追加fetch、常時ポーリング、旧SPA往復の再導入は、probeで必要性が証明されない限り行わない。
- 失敗時は設定をロールバックし、可能なら元の会話へ復帰する。成功時には通知を出さない。

### Markdown出力

- ターンMarkdownボタンはnative copy toolbarの先頭側へ配置する。
- ヘッダー全履歴Markdownボタンはnative Shareボタンの直前へ配置する。
- ヘッダー初期表示は、一時的にheaderを監視し、Shareが現れたらdirect actions containerへObserverを狭める。
- SPA遷移後の復元は共通page-state／conversation sync経路を使い、機能専用の永続ポーリングを追加しない。
- Markdown生成のデータ抽出と、ボタン・ダウンロードUIの責務を分離する。

### モデルセレクター

- 将来のリファクタ、selector変更、authority変更、Observer削減を行う前に、canonical contractである`docs/model_selector_runtime_contract.md`と`docs/model_selector_refactor_checklist.md`を読む。現在コードの各branchを「一見冗長」に見えることだけを理由に削除しない。
- model selectorのauthority順序、selector意味、Observer範囲、navigation carry／clear条件、Main World conversation-state供給経路を変更した場合は、上記contract／traceabilityも同じ論理変更で更新する。
- 検出範囲はComposer、そのdirect parent、surface controls、live trigger、表示中Picker、実際のthinking sliderへ限定する。
- 旧来の永続`documentElement` Observerを復活させない。
- 選択確定はPickerのchecked状態など、確定したUI状態を基準にする。click intentだけで確定扱いにしない。
- Portal teardown前に保持したPicker referenceから最終状態を解決する。
- Chat／Work／New Chatのauthorityを分離し、別surfaceの古い状態をfallbackに使わない。

### タイムスタンプ／Turn番号

- timestamp indexは既存conversation responseからMain Worldで作り、Content側からtimestamp取得用の追加fetchを行わない。
- メッセージ日時UIはまずtimestampだけを表示する。`ターン番号`がONの場合だけ、初期描画後の遅延＋idleで絶対Turn番号を解決し、解決後に`Turn N · timestamp`へ更新する。paginationされた現在pageの相対Turn番号を絶対Turn番号として先に表示しない。総Turn数は表示しない。
- Turn番号はRecent ViewのON/OFFから独立させる。日時OFFまたはTurn番号OFFではTurn counterを走らせず、追加履歴fetchも行わない。
- 絶対Turn番号はMain Worldが担当するが、Turn番号のための追加fetchは行わない。ChatGPT自身の既存conversation responseだけを使い、`page_info.has_previous_page !== true`で全履歴が揃っている場合だけ絶対Turn番号を確定する。過去pageが省略されている場合は相対番号を絶対番号として表示せず、Turn番号を未表示のままにする。
- Turn counterはconversation移動・機能OFFで保留中処理を破棄する。既存responseが更新された場合は変更message IDだけ再適用し、初回確定・会話切替・設定ONなど必要な場合だけ全badgeを再適用する。
- 初期表示時はtimestamp indexを待ち、既存メッセージへ現在時刻を仮値として乱用しない。live生成など必要な場合だけprovisional timestampを使い、公式値取得後に置換する。
- provisionalかどうかは属性・opacityで区別し、ユーザー／アシスタントで書体を不必要に変えない。生成中の最新assistantへ確定timestampを早期表示しない。

### 回答完了判定・通知音

- 完了判定はconversation-boundにする。
- 回答中に別conversationや新規chatへ遷移した場合は`navigation_abandon`として扱い、正常完了通知を出さない。
- stream removal直後は、pending navigationが完了判定を取り消せるよう1 render opportunityだけ猶予する。
- 通知音はoffscreenで再生し、設定変更時だけ関連subsystemを再構成する。
- 同梱通知音はPCM 16-bit WAVを基準とし、ファイル名とプルダウン表示名は`notification-01`／`通知音1`からの連番にする。
- 複数音源を追加・差し替えする場合は、元波形を保持したまま同一RMS目標とピーク上限でノーマライズし、WAV量子化後の音量差も確認する。

### Pinned sidebar

- standalone chat、各Project内chat、トップレベルProject folderを別scopeとして扱う。
- トップレベルProject folder同士の並べ替えを許可するが、Project folderとchatを同一scopeへ混在させない。Project→chat位置、chat→Project位置のdropは拒否する。
- Project folderの保存順はChatGPT自身の既存sidebar responseから観測したstable `g-p-*` IDを使う。Project一覧取得のための追加fetchを発行せず、同名ProjectでIDを一意に対応できない場合はfail-closedでその行を並べ替え対象外にする。
- Project内chatは既存の`project:g-p-*` scope、standalone chatは`standalone` scopeを維持する。同一ULに複数scopeが混在する場合はlist-level dropを無効化し、同種rowのslot間だけ移動する。
- Pinned section、conversation anchor、Project rowに関係する構造変化だけでrescanする。
- 保存済み順序がない場合に不要な初期非表示gateを使わない。

### 折りたたみ・Composer操作

- code／writing blockなど実際の対象だけを折りたたみ、通常本文を誤って対象にしない。
- Ctrl+Enter送信はComposerおよびedit textareaへscopeし、ページ全体のkeydownを広く奪わない。

## 5. 設定・保存・cleanup

- Popupの同一設定送信はfingerprint一致でno-opにする。
- 通常設定変更はsubsystem単位で差分適用し、全機能cleanup／再起動はoperation mode変更など必要な場合だけ行う。
- feature OFF時は、その機能が追加したObserver、DOM、属性、timerだけをcleanupする。
- extension OFF時はArcaia全体のruntime stateを閉じ、Recent Viewで隠したDOMを復元する。
- rapid settings changeは直列化し、後のpayloadが前の成功結果を含むようにする。
- active tabへの適用失敗時はStorageとPopup表示を以前の状態へ戻す。
- Storage key、schema、protocolの変更は状態移行を伴うため、機能追加のついでに行わない。

## 6. probe・診断

### 6.1 汎用Debugを復活させない

- Generic Debug UI、persistent diagnostic logging、通常runtimeの診断ZIP生成は廃止済みである。
- 常時ログ、全Mutation記録、全response保存を通常runtimeへ再導入しない。
- probe解決後に未使用となった診断helperを通常content-scriptとして残さない。
- Git管理が必要な専用probeは`tools/`配下へ置き、問題解決後に通常runtimeへ残さない。
- DevTools Console等で一回実行する単体JavaScript probeは原則としてGit管理しない。`tools/`その他のrepository配下へ追加・commitしない。
- 単体JavaScript probeはChatGPT側で`.js`を生成し、ユーザーへの受け渡しは`.zip`に格納したダウンロードリンクで行う。ソースコード全文のチャット貼り付けを標準手段にしない。
- repositoryへprobeを追加するのは、外部Chrome拡張probe、継続的に保守するprobe、またはユーザーが明示的にGit管理を指示した場合だけとする。
- 「probeを作成する」という指示だけではGit管理の許可を意味しない。

### 6.2 初期表示probe

ChatGPTの初期表示、`document_start`、ページ再読み込み直後、SPA遷移直後など、画面完成前からの時系列を確認する場合は、最初に次の方式を提案・採用する。

- Arcaia本体とは別の、最小構成のChrome拡張probeを生成する。
- probe拡張は通常版Arcaiaと併用し、`run_at: "document_start"`で初期表示前から記録する。
- Arcaia本体一式を複製した診断版や、Arcaiaコードを内包するprobeを第一案にしない。
- 最小probeでDOM出現時系列、要素の追加・削除、ページライフサイクル、必要な既存イベント、最終表示結果を取得する。
- 別拡張のisolated worldから、Arcaia内部変数、Arcaia固有の`chrome.storage.local`、Arcaia Content Script内だけの例外は直接取得できないことを明示する。
- 外部probeだけでは原因を絞れないことが結果で確認された場合に限り、Arcaia本体へ一時的な限定probeを追加する。
- 外部拡張probeは、`document_start`以前からの時系列、ページ再読み込みをまたぐ記録、長時間の自動監視など、DevTools Consoleの一回実行では取得できない証拠が必要な場合だけ選ぶ。

推奨段階:

1. 最小構成の外部probe拡張で初期表示のDOM時系列を取得する。
2. Content UI全体、DOM再適用、個別機能のどこに問題があるか分類する。
3. 必要な場合だけArcaia内部へ範囲を限定した一時probeを追加する。
4. 証明された原因だけを修正し、probe用コードを通常runtimeへ残さない。

### 6.3 既に表示済みの問題

- 既存DOMだけで判定できる場合は、Console貼り付け型のone-shot standalone probeを第一選択とする。対象をユーザーのクリックで一意に指定できる場合、自動検出Observerや専用拡張を作らない。
- one-shot standalone probeの成果物はrepositoryへ保存せず、ChatGPT側でZIP化してダウンロードリンクとして渡す。
- 意図的なタイムアウト、失敗、データ消失を発生させる必要はない。既に残っているDOMや再表示可能な要素から取得する。
- 初期表示からの追加・削除時系列が必要になった時点で、外部拡張probeへ切り替える。

### 6.4 privacy

- 会話本文、会話ID実値、URL全文、Cookie、Authorization、認証情報、Storage生値、HTML全文を収集しない。
- request IDやconversation IDは保存せず、一致／不一致など必要なbooleanへ変換する。
- DOMはselector count、接続状態、表示状態、追加・削除回数など構造情報だけを記録する。
- probeはbounded records、bounded duration、明示stop、完全cleanupを持つ。
- probe結果はJSONファイルとして自動ダウンロードする。Clipboardコピーはdownloadが利用できない場合の明示的なfallbackに限定する。

## 7. 検証と報告

- 変更箇所に対応する専用テストを追加し、既存全テストも実行する。
- 静的テストが証明する範囲を明記し、実ブラウザ確認と混同しない。
- DOM構造、SPA、Chrome extension lifecycleに依存する変更は、最終的に実ブラウザで確認する。
- テスト失敗を単に期待値変更で通さない。仕様変更による正当な差分か、実装不具合かを確認する。
- 修正報告では、証明済み、推定、未確認を分けて記載する。
- probe結果がある場合は、観測値から導ける範囲だけを結論にする。

## 8. バージョン・Git・公開

- Git管理下では原則としてworktreeを使い、統合ブランチへfast-forwardで取り込む。
- runtime変更時は実行ファイル間のversionを揃え、version consistency testを通す。
- probeや文書だけの変更では、拡張本体versionを上げない。
- コミットは論理変更単位に分け、revert可能にする。
- pushはユーザーが明示した場合だけ行う。
- 公開前はcurrent treeと履歴の両方を確認し、秘密情報、ローカル絶対パス、会話ログ、probe結果、個人情報を公開しない。
- 公開用履歴と内部履歴が異なる場合、その理由を明記し、未監査の内部履歴を安易にpushしない。

## 9. 過去の廃止事項

- 汎用Debug UI／runtime
- persistent diagnostic logging
- 診断ZIPの通常機能化
- `content_zip.js`
- model selectorの永続`documentElement` Observer
- Recent ViewのContent側追加conversation fetch
- 常時scroll listenerによるRecent View controls表示
- 到達不能な多段soft-refresh fallback
- 通常runtimeへ残る探索用probe

これらを復活させる場合は、既存方式で解決できないことをprobeで証明し、ユーザーの承認を得ること。

# Arcaia ChatGPT Toolkit v0.1.299

Chrome版ChatGPT向けの表示・操作支援拡張です。現在の基準バージョンは **v0.1.299** です。

## v0.1.299の変更点

- 右側ファイルプレビューのコピーtooltipをChatGPT標準の`bg-token-bg-tooltip`、枠線、余白、角丸へ合わせました。
- tooltipは約200ms後に表示し、上側に空間がなければ下側へ反転、左右はviewport内へ収めます。
- ターン単位Markdown保存ボタンも同じ共通tooltipへ移行し、ブラウザ標準`title`を削除しました。
- 新しいObserverやポーリングは追加していません。

## v0.1.298の変更点

- 右側ファイルプレビューのコピー成功時、コピーアイコンをチェックアイコンへ切り替え、2秒後に元へ戻すようにしました。
- コピー用ツールチップはブラウザ標準`title`を使わず、ChatGPTの既存背景色・文字色・角丸・影のutility classで表示します。
- ホバーとキーボードフォーカスの両方でツールチップを表示し、成功中は文言も「コピーしました」へ切り替えます。

## v0.1.297の変更点

- 右側ファイルプレビューのダウンロードボタン横へコピーボタンを追加しました。
- Markdownプレビューは見出し、リスト、リンク、コードフェンスなどをMarkdown形式へ戻してコピーします。
- CSS、JavaScript、JSONなどのコード系プレビューは、コードフェンスを付けず表示中のソース本文をそのままコピーします。
- PDF、画像などテキスト抽出元がないプレビューにはコピーボタンを表示しません。
- 右ペインの既存`stage-thread-flyout`だけを局所監視し、ポーリングは追加していません。

## v0.1.296の変更点

- 同一会話でGPT-5.6が確定済みの場合、minor versionを含まない一時的なGPT-5系model slugを「詳細待ち」として扱い、既存装飾を維持するようにしました。
- 明示的なGPT-5.5など別version、Pickerの確定選択、別会話への遷移では従来どおり装飾を解除します。
- 新しいObserver、timer、追加取得処理は導入していません。

## v0.1.295の変更点

- 各メッセージの日時左側に表示するターン番号の誤記を、`Trun 12`から`Turn 12`へ修正しました。

## v0.1.294の変更点

- Model Decoration Watch Probe v1.0.5から明示要求された場合だけ、モデル装飾の内部解決境界をboolean・固定enumで返す一時probeを追加しました。
- `activeSurfaceMode`、New Chat用モデル設定の有無、状態候補、解決context、trigger、直近scan結果を記録します。
- Cookie、Storage、model slug、thinking effortの実値は返さず、常時ログ、追加Observer、ポーリングも追加していません。

## v0.1.293の変更点

- 同じGPT画面・同じ会話に対する重複`page_navigation`では、取得済みモデル状態と装飾を維持するようにしました。
- 別会話・別surface・文脈判定不能では従来どおり状態と装飾を解除し、新しいauthorityを待ちます。
- Observer、ポーリング、タイマー、追加のモデル取得処理は増やしていません。

## v0.1.292の変更点

- ヘッダーの全履歴Markdownダウンロードボタンを、独自MDアイコンからLucide公式の`file-down`アイコンへ変更しました。
- SVGはLucide公式の24×24パスと線幅2をそのまま使用し、ChatGPT標準の線画アイコンに近い密度へ揃えています。
- Lucide IconsはISC Licenseで配布されています。

## v0.1.291の変更点

- 全履歴Markdownボタンを、20×20表示向けの「角丸正方形＋大きな`MD`＋下向き矢印」アイコンへ変更しました。
- ドキュメント輪郭と独立バッジを廃止し、3要素を1つの正方形内へ整理して小サイズでの潰れを抑えています。
- 既存ボタンも内容version更新により新しいアイコンへ差し替わります。

## v0.1.290の変更点

- 全履歴Markdownボタンを、20×20表示向けの「ドキュメント＋下向き矢印＋右側へはみ出す`MD`バッジ」アイコンへ変更しました。
- 小サイズでの判別性を優先し、紙本文の装飾線は省略しています。既存ボタンも内容version更新によって新しいアイコンへ差し替わります。

## v0.1.289の変更点

- ChatGPT標準の共有ボタンがアイコンのみへ変わり、従来のダウンロード矢印と見分けにくくなったため、全履歴Markdownボタンを折り返し付きドキュメント＋`MD`の線画アイコンへ変更しました。
- 既存ボタンがSPA遷移後も再利用される場合に、新しいアイコンへ確実に差し替わるよう内容versionを更新しました。

## v0.1.288の変更点

- ChatGPT標準Shareボタンが専用`span`ラッパー内へ移動した後、全履歴Markdownボタンを同じラッパーへ挿入して上下に積んでいた問題を修正しました。
- Shareの直親ではなく、実際のflex／gridアクションコンテナと、その直下のShareアクション単位を解決して直前へ配置します。旧来のShare直下構造にも対応します。
- 原因となる直親挿入前提はv0.1.239で導入されていましたが、当時のChatGPT DOMでは正常でした。今回の表示崩れはChatGPT側のShareラッパー追加によって表面化したものです。

## v0.1.287の変更点

- Recent Viewの閲覧専用rendererが`/mnt/data/...`などの内部パスを画像URLとして扱い、HTML応答を画像Blobとして表示していた問題を修正しました。
- 画像assetは確認済みのfiles API経路を優先し、画像ではない応答を棄却して次の候補へ進みます。画像読込に失敗した場合は壊れた画像を残さず添付カードへ戻します。
- 添付名に内部パスが含まれる場合は、カード上ではファイル名部分だけを表示します。

## v0.1.286の変更点

- Recent Viewの「さらに表示」「全部表示」を、同一会話のdocument reloadから閲覧専用の独自DOM表示へ変更しました。
- Main Worldが既存conversation responseからUser本文とAssistant最終本文だけを選別し、system、tool、code、thoughts、reasoning recapなどの内部nodeをトップレベルへ表示しません。
- 閲覧モードはMarkdown見出し、リスト、引用、表、コードブロック、画像、添付カード、citationを静的に表示します。ChatGPTのReact管理DOMは変更せず、一時的に非表示にします。
- 画像assetは表示時だけ解決し、Blob URLを閲覧モード終了時に破棄します。解決できないassetは静的カードのまま残します。
- 「Recent Viewへ戻る」でnative表示へ即時復帰します。新しいObserver、interval、scroll listener、Content側conversation追加fetchは導入していません。

## v0.1.285の変更点

- Ogg Opus形式の通知音を12件追加し、既存の通知音1・2に続く通知音3〜14として選択・試聴できるようにしました。
- 既存の通知音1・2、保存済みID、旧通知音8から通知音2への移行処理は変更していません。

## v0.1.284の変更点

- Recent Viewの画像表示ONで、画像経路の補完対象がassistantを含まないuser-onlyターンに限定されていた問題を修正しました。保持対象の全user開始ターンについて、次のuser開始までの画像node経路を保持します。
- 既に選択済みの画像signalは重複placeholderへ置換せず、そのまま実画像として保持します。
- PromptジャンプリストをArcaia側のCSS属性で非表示にする処理を撤去しました。ChatGPTが生成したジャンプリストはそのまま表示します。

## v0.1.283の変更点

- 各メッセージの日時左側は総ターン数を表示せず、全ターンMarkdownと同じユーザー開始ターン定義による現在番号だけを`Turn 12`形式で表示します。
- 初期表示・会話切替・conversation content root交換時だけ既存メッセージへ全体適用し、送信時は追加されたuser要素、受信完了時は該当assistant要素だけを更新します。送受信イベントで過去メッセージ全体を再走査しません。
- 通知音は旧通知音1と旧通知音8だけを残し、旧通知音8を新しい通知音2へ繰り上げました。旧通知音3〜10の選択肢と音源を削除しています。
- 保存済みIDが旧通知音8の場合は新通知音2へ移行し、それ以外の削除済みIDは通知音1へフォールバックします。

## v0.1.282の変更点

- 各メッセージの日時表示左側へ、全ターンMarkdownと同じユーザー開始ターン定義による`T現在/総数`を表示します。
- ファイル添付だけのユーザーメッセージをRecent Viewが空メッセージとして除外していた判定を修正しました。
- 通知音1〜10をWebM/Opusから、圧縮前の生成波形を直接保持するPCM 16-bit WAVへ戻しました。
- 通知音の保存ID、選択肢、音量設定、offscreen再生経路は変更していません。

## v0.1.281の変更点

- ChatGPT自身が`200`で取得した現在conversationのRequestをcloneして再実行しても、conversation DOM、React状態、section数は変化しないことを専用probeで確認しました。単純な同一スレッド再fetchはdocument reloadの代替になりません。
- `React Router revalidate()`、限定React Query `refetch()`、同一サイドバーリンク再クリック、同一URLへの`popstate`もconversation再取得・UI更新を起こさないことを確認しました。
- 結論が出た同一スレッド再検証probeのソース、配布ZIP、専用テストを通常treeから削除しました。
- 通常runtimeに残っていた履歴probe arm、response body複製検査、内部Lite診断protocol、未使用Dry Run推定、旧診断bundle helperを削除しました。
- 実際にはdocument reloadを行う関数・action名を`in_place`から`with_reload`へ変更し、実装と名称を一致させました。
- Recent View経路にはContent側追加fetch、常時ポーリング、scroll listener、旧SPA往復を追加していません。初期DOM待ちObserverの30秒上限と段階同期の重複抑制も維持しています。

## v0.1.280の変更点

- Recent Viewの「さらに10件表示」「全部表示」で、reloadとconversation再取得までは成功していた一方、reload後のstartup設定同期がMain World設定を`replaceExisting`で作り直し、保存済みの`turnCountOverride`／`fullLoadOnce`をconversation取得前に消していた問題を修正しました。
- startup同期は通常の保持件数・画像設定だけをmergeし、会話単位の一時状態を保持します。
- Content側からの追加conversation fetch、常時ポーリング、scroll listener、旧SPA往復は追加していません。
- 原因確定後、v0.1.279の内部probe、probe専用session trace、`beforeunload`／`pagehide` listener、750ms診断timer、外部reload probe一式を通常treeから削除しました。
- `全部表示`はoverride解除と`fullLoadOnce`設定を1回のMain World要求へ統合し、中間状態と余分な往復をなくしました。
- 初期DOM待ちのpending Observerは30秒で必ず終了し、header／Composerとconversation content rootの二段階同期でもMain World同期は最初の1回だけ実行します。
- 動作を持たなかった`disableLite`引数、probe用詳細state、startup専用関数の未使用レスポンス構築を削除しました。

## v0.1.279の変更点

- v0.1.278のdocument reload修正後も実ブラウザ挙動が変わらなかったため、推定修正を継続せず、Recent View操作専用の限定probe経路を追加しました。
- 外部probeが明示的にarmされている間だけ、Content Scriptの操作受付・Main World設定・検証・reload呼び出し・内部例外・ロールバックをprivacy-safeな段階イベントとして記録します。
- Main World側も、conversation response観測、rewrite gate、`fullLoadOnce`消費、rewrite試行・成功・失敗を一致／不一致のbooleanと件数だけで記録します。
- reload直前のイベント消失を避けるため、probe専用のbounded session traceへ同期保存し、次document startで外部probeが回収します。
- 通常利用時はprobe arm情報が存在しないため、診断イベント・trace書き込み・追加timerは動作しません。
- 専用probe拡張をv2.0.0へ更新しました。今回の版は原因特定用であり、Recent Viewの挙動を直したとみなしていません。

## v0.1.278の変更点

- Recent Viewの「さらに10件表示」「全部表示」で、設定は更新される一方、ChatGPTがSPA往復時にconversation responseを再取得せず、初回のRecent View payloadを再利用する問題を修正しました。
- 会話単位の`turnCountOverride`または`fullLoadOnce`をMain Worldとsession storageへ確定させた後、同一会話をdocument reloadしてChatGPT自身の通常conversation取得へ通す方式へ変更しました。
- 旧来の新規チャット→元会話のSPA往復、サイドバーリンク探索、広域の一時DOM待機、手動スクロール復元を削除しました。
- Content側からの追加conversation fetch、常時ポーリング、scroll listenerは追加していません。

## v0.1.277の変更点

- 回答完了通知音を通知音1〜10へ拡張しました。プルダウン表示名と実ファイル名は連番で統一しています。
- 全通知音をWebM/Opusの非可逆圧縮音源へ統一し、旧runtime合成音と旧`assistant-complete.ogg`を廃止しました。
- 音源は同一RMS目標とピーク上限でノーマライズし、圧縮後のデコード結果でも確認しています。10音間のRMS差は0.16dBです。
- 既存の通知音1／通知音2の保存IDは維持しているため、アップデート後も現在の選択が変わりません。
- Recent Viewの「さらに10件表示」「全部表示」について、SPA往復・override・rewrite・再描画DOMを記録する外部probe拡張を追加しました。Arcaia本体runtimeへ診断処理は追加していません。

## v0.1.276の変更点

- 初期表示でChatGPTの仮ヘッダーへMarkdownボタンを追加した後、最終ヘッダーへ交換されるとボタンが消えたままになる問題を修正しました。
- 初回の`page_navigation`がContent側Monitor開始前に発生しても、Monitor開始時に既存のconversation pending syncを開始するようにしました。
- 一時Observerは、置換後のheader／Composerが揃った時点でヘッダー系UIを再同期し、会話content rootが後から現れた時点でもう一度共有再同期経路を実行します。
- 会話content rootの準備後に、ターンMarkdown、Recent View controls、タイムスタンプなどを既存のconversation observerへbindします。
- 新しい永続Observer、interval、固定待機、追加conversation fetchは導入していません。

## v0.1.275の変更点

- Recent Viewの「さらに表示」「全部表示」が失敗した場合だけ、会話領域へ一時的な通知を表示するようにしました。
- 元の会話を表示できている場合はその状態を案内し、元の会話へ戻れていない場合は左サイドバーから開き直すよう案内します。
- 通知は低彩度の専用帯として表示し、約7秒後に自動で消えます。成功時には通知を表示しません。
- 内部の詳細エラー記録と既存の設定ロールバック／復帰処理は維持しています。新しいObserverや常時監視は追加していません。

## v0.1.274の変更点

- Recent Viewの最初の表示ターン直前へ、「さらに最大10件表示」と「全部表示」を追加しました。残件数が取得できる場合は「残り○件」も表示します。
- 「さらに表示」はオプションの通常保持件数を変更せず、現在の会話だけを `3 → 13 → 23` のように段階拡張します。段階表示は最大50件で、それ以降も「全部表示」は利用できます。
- 「全部表示」は既存の `fullLoadOnce` を使い、次の対象conversation responseだけRecent View rewriteをスキップします。
- 再取得はprobeで確認したChatGPT標準のSPA経路（新しいチャットへ遷移して元の会話へ戻る）を使用します。`document`を再読み込みせず、交換された会話content rootへ既存機能を再bindします。
- SPA往復中は会話領域へ読み込み中オーバーレイを表示し、完了後は直前の最初の表示ターンを基準にスクロール位置を復元します。
- ページリロード、content scriptからの追加conversation fetch、常時scroll listener、ポーリングは追加していません。失敗時は設定をロールバックし、可能なら元の会話へ復帰します。

## v0.1.273の変更点

- 現行ソースを実行ファイル、権限、起動停止、Observer／timer、SPA再適用、設定保存、Main World hook、Markdown、Recent View、通知音の各経路で全体レビューしました。
- SPA遷移の再同期条件を、新しいComposerの存在までに修正しました。モデルtriggerの遅延描画は既存のモデルセレクターObserverへ任せ、ヘッダーMarkdown復元を不要に待たせません。
- SPA遷移中の一時DOM Observerは、header／Composerの交換またはheader内のchildList変更だけを処理し、会話本文の無関係なMutationでは再評価しないよう局所化しました。
- 仮timestampのイタリック指定を削除し、ユーザーとアシスタントの日時表示を同じ書体へ統一しました。仮timestampを示す低いopacityと属性は維持しています。
- 新しいinterval、固定待機、ポーリングは追加していません。

## v0.1.272の変更点

- SPA遷移で新しいheaderとShareボタンが先に完成し、Composerのモデルtriggerだけが遅れて描画される場合に、会話全体Markdownボタンの再適用が停止する問題を修正しました。
- 会話遷移中だけ有効な一時DOM Observerを追加し、header／Composerの置換後に遅れてモデルtriggerが追加された時点で、既存の会話依存同期を1回再実行します。
- 一時Observerは会話URLにだけ限定し、同期完了時またはページ会話Monitor停止時に必ず解除します。

## v0.1.271の変更点

- 左ペインからのSPA遷移後に、モデルセレクター装飾とヘッダーMarkdown出力ボタンが新しい会話DOMへ再適用されない問題を修正しました。
- ChatGPT側に `history.pushState` / `history.replaceState` のwrapperを差し替えられた場合、次の既存会話同期で現在の関数を再ラップします。
- 遷移開始時のheader／Composer／native control identityを保持し、既存の会話DOM Observerで新しいidentityが揃った時だけ、会話依存同期を1回再実行します。
- 同じ再同期経路で、モデル装飾、ヘッダーMarkdown、時刻、Recent View、ターンMarkdown、完了状態の既存Observer bindingを更新します。
- 新しいObserver、固定待機、ポーリングは追加していません。同一DOM identityのMutationは重複実行しません。

## v0.1.270の変更点

- 初期設定の同期時点で共有ボタンがまだ描画されていない場合、ヘッダーMarkdown出力ボタンが表示されない問題を修正しました。
- 共有ボタン出現前だけheader内部を監視し、出現後は実際のactions container直下へ同じObserverを局所化します。
- 会話／URL遷移時は既存のページ構造イベントからボタン同期とObserver再bindを行います。
- 新しい広域Observer、固定待機、ポーリングは追加していません。OFF時はObserver切断、参照破棄、ボタン削除を対称に行います。

## v0.1.269の変更点

- ソフトグラファイトのダークテーマを、モックHTMLを正本としたフラットな単色面へ更新しました。
- ヘッダー、セクション、セクション帯からグラデーション、ドロップシャドウ、内側ハイライトを撤去しました。
- ダークテーマ全体へ不透明度3.5%の微細なSVG `feTurbulence` ノイズを重ね、画像案の粒状感を再現しました。
- ONスイッチを低彩度ブルー `#4F6F9F`、ノブをライトグレー `#D9DEE5` へ調整しました。

## v0.1.268の変更点

- ソフトグラファイトのダークテーマを、外側背景、ヘッダー、セクション帯、本文面、入力面の5階層に再調整しました。
- セクションとヘッダーへ弱い内側ハイライトとソフトシャドウを追加し、単一の暗色面に見えないよう質感を整えました。
- ダークテーマのONスイッチを明るい青からブルーグレーへ変更し、ノブも純白から淡いグレーへ抑えました。
- サブ設定線、フォーカス、試聴ボタンなどの青アクセントを低彩度化し、長時間表示時の主張を弱めました。

## v0.1.267の変更点

- オプションメニューへ、OS／ブラウザの `prefers-color-scheme` に追従するソフトグラファイトのダークテーマを追加しました。
- 通常動作中の文言を非表示にし、停止時だけ状態を表示します。
- 保存状態は初期表示せず、オプション変更の保存中・保存完了・失敗時だけ表示します。
- セクションヘッダーの補足説明を削除し、通知音の表示名を「通知音1」「通知音2」の連番へ整理しました。

## v0.1.266の変更点

- オプション上部を、Arcaia名、稼働状態、バージョン、保存状態、全体トグルを横一列に並べたシンプルなヘッダーへ更新しました。
- 「オプション」見出し、閉じるボタン、装飾アイコンを撤去しました。
- 全体トグルを通常の設定トグルより大きい48×28pxとし、ヘッダー右端へ固定しました。
- セクションバンド以下の設定構造と既存の保存・同期動作は維持しています。

## v0.1.265の変更点

- オプションメニューを、淡いブルーの固定セクションバンドで区切るレイアウトへ更新しました。
- セクションの開閉操作を廃止し、「表示」「操作・通知」「サイドバー」「保存・出力」を常時表示します。
- セクション間に余白と独立した外枠を設け、項目の密度を少し緩めながらグループ境界を明確にしました。
- ヘッダー左側へ小型のArcaia識別表示を追加し、通知音の試聴・音量・保存同期など既存機能は維持しています。

## v0.1.264の変更点

- オプションメニューを、白背景、細い区切り線、小型コントロールを中心としたコンパクトなリストUIへ全面刷新しました。
- 「表示」「操作・通知」「サイドバー」「保存・出力」の全セクションを初期展開し、各設定へすぐアクセスできる構成にしました。
- 通知音選択、試聴ボタン、音量スライダーを同一の通知設定領域へコンパクトに配置しました。
- Arcaia全体の有効化、自動保存状態、無効状態、設定同期・ロールバックの既存動作は維持しています。
- ポップアップ右上に閉じるボタンを追加しました。

## v0.1.263の変更点

- Recent ViewのGrouping再走査を、probeで意味変化が確認されたturn section、role node、role／message ID属性、role未確定sectionの空／非空遷移だけに限定しました。
- 共有会話Observerの範囲は維持し、コードブロック、メッセージ時刻、Markdown機能のMutation処理には影響させていません。
- role確定済みturn内の通常ストリーミング、`data-start`／`data-end`変更、Groupingに影響しないArcaia要素追加ではRecent Viewを再走査しません。
- 新しいObserver、タイマー、ポーリングは追加せず、実DOM MutationObserverを使う回帰テストを追加しました。

## v0.1.262の変更点

- Pinned初期化でObserver rootが見つからない場合の無制限な500ms再試行を削除し、既存の有限startup burstだけに限定しました。
- Recent Viewの到達不能な疑似sidebar click／`pushState + popstate`／隠しlink clickの旧3段soft-refreshフォールバックを削除しました。
- Assistant turn内に`data-streaming-response-status`がある間は、`data-stream-active`の一時解除を完了と扱わないようにしました。「今すぐ回答」などの表示文字列には依存しません。
- 新しい広域Observerやポーリングは追加せず、通常完了と一時的な応答待ちを分離する回帰テストを追加しました。

## v0.1.261の変更点

- 回答中の会話から新規Chatへ移動する際、stream終了Mutationがnavigation通知より先に処理されると完了音が鳴る競合を修正しました。
- 最終stream終了だけを次の描画機会まで保留し、その前に`page_navigation`を受けた場合は正常完了ではなく`navigation_abandon`として破棄します。
- 通常完了、生成再開、navigation、監視停止における保留処理の回帰テストを追加しました。

## v0.1.260の変更点

- 新規ChatでGPT-5.6からGPT-5.5へ切り替えた際、確定済みの5.5ではなく旧5.6装飾が残る競合を修正しました。
- Picker内の`aria-checked`／`data-state`確定Mutationを、Portal切断前のPicker参照から直接反映するようにしました。
- モデルセレクターの常設`documentElement`全体Observerを廃止し、Composer、Composer直親、Chat／Work切替、Trigger、表示中Picker、実Sliderへ監視を局所化しました。
- クリック意図だけを処理する`menu.itemSelect`経路を削除し、確定DOM状態だけを採用します。
- 旧汎用probe protocol削除後もversion helperが検証に失敗していたため、現行の実行ファイルだけを検証するよう更新しました。

## v0.1.259の変更点

- 回答生成中の会話から新規Chat、別Chat、Workなどへ移動した際、旧会話DOMの破棄を正常完了と誤判定して完了音が鳴る問題を修正しました。
- 回答開始時のconversation identityとstream rootを保持し、同一conversation内の終了だけを正常完了として受理します。
- route／conversation変更による終了は`navigation_abandon`として扱い、回答中タイトルを解除しますが、完了音・完了タイトル・正常完了記録は発生させません。

## v0.1.258の変更点

- popupから現在タブの設定状態を取得する際、同期ハンドラーの戻り値へ直接 `.then()` を呼んでいた不具合を修正しました。
- runtime message dispatcherを同期・非同期ハンドラーの両方に対応させました。
- 設定変更時に「有効状態を保存できませんでした」と表示され、変更がロールバックされる問題を修正しました。
- 同期ハンドラーの回帰テストを追加しました。

## 現在の主な機能

- Recent View（保持ターン数・画像表示設定・全表示復元）
- ユーザー／Assistantメッセージの時刻表示
- GPT-5.6モデルセレクター装飾とthinking level表示
- コードブロック／Writing Block折りたたみ
- Ctrl+Enter送信
- 回答中タイトル表示と回答完了音
- ピン留めチャットの並べ替えとアイコン設定
- ターン単位／会話全体のMarkdown保存
- 機能ごとの設定差分反映と失敗時ロールバック

## 現在のContent Script構成

`manifest.json`では、次の順に読み込みます。

```text
content_toolbar.js
content_markdown.js
content_filename.js
content_model_selector.js
content.js
```

`content_zip.js`と未使用になった`content_diagnostics.js`は削除済みで、現在のmanifestには登録されていません。

## 診断機能の方針

Arcaia本体には、汎用Debugモード、継続ログ蓄積、汎用診断ZIP、モデルセレクター専用の常設詳細診断を持たせません。問題調査が必要な場合は、`tools/`配下の独立した手動probeを使用します。probeは通常動作では自動実行されません。

## 開発版の読み込み

1. 拡張フォルダを展開します。
2. `chrome://extensions`を開きます。
3. デベロッパーモードを有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」で展開フォルダを選択します。
5. ChatGPTタブを完全再読み込みします。

## 履歴について

以下は過去バージョンの変更履歴です。`content_zip.js`、Debug UI、診断ZIPなどへの記載は当時の履歴であり、v0.1.271の現行構成を示すものではありません。

## v0.1.115の変更点

- popup側の `ensureContentScript()` を `content.js` 単体注入から、`content_zip.js` → `content_toolbar.js` → `content.js` の順序注入へ変更しました。
- 更新直後の既存タブや、content script未接続時の自動再注入でも、分割済みhelperが揃うようにしました。
- `content_toolbar.js` が `APP_VERSION` を直接参照しないことをテストで確認します。

## v0.1.114の変更点

- `content_toolbar.js` を追加しました。
- toolbar modal / toast / page job orchestration / Markdown保存 / 診断ZIP保存の操作部分を `content.js` から切り出しました。
- `content.js` 側には toolbar helper への依存注入ラッパーだけを残しました。
- `manifest.json` の `content_scripts.js` は `content_zip.js` → `content_toolbar.js` → `content.js` の順に読み込みます。
- 診断payload作成、Markdown本文生成、download helper、Debug状態、Lite本体は `content.js` 側に残しています。

## v0.1.113の変更点

- `content_zip.js` を追加しました。
- ZIP生成ヘルパー、CRC32、DOS date/time、deflate補助を `content.js` から切り出しました。
- `manifest.json` の `content_scripts.js` で `content_zip.js` を `content.js` より先に読み込むようにしました。
- `content.js` 側には `window.ArcaiaContentZip.createToolbarZipBlob` を呼ぶ薄い互換ラッパーだけ残しました。
- 診断ZIP / Markdown保存 / Lite / timestamp / pinned sidebar の挙動は変更しない方針です。

## v0.1.112の変更点

- `docs/content_split_plan.md` を追加しました。
- `content.js` の主要領域、依存方向、分割順を整理しました。
- 初回分割候補を `content_zip.js` に固定しました。
- Lite / timestamp / pinned sidebar / backend rewrite は初回分割対象から外し、後続マイルストーンへ回す方針を明記しました。
- 既存の `scripts/bump_version.py` で v0.1.112 へ更新しました。

## v0.1.111の変更点

- メインアイコンとChromeツールバーアイコンを新しいInterlock Outline系アイコンへ差し替えました。
- Markdown保存ボタン用に `icons/md_download/icon32.png` を追加し、Turn単位のMarkdown保存ボタンで `mask + currentColor` として表示するようにしました。
- `manifest.json` の `web_accessible_resources` に `icons/md_download/icon32.png` を追加しました。
- 診断ZIPのDebug自動ON/OFFを削除し、すべて手動Debug状態に従うシンプルな運用へ戻しました。
- Debug OFF時の診断ZIPは軽量情報のみを含み、重いDebug詳細・蓄積ログは `debug_mode_off_manual_only` として省略します。
- `scripts/bump_version.py` を追加し、`manifest.json` / `APP_VERSION` / protocol suffix / popup表示 / version test の一括更新を補助できるようにしました。

## v0.1.107の変更点

- Chrome拡張の表示名を `Arcaia ChatGPT Toolkit` に変更しました。
- `short_name` を `Arcaia` として追加しました。
- popup / action title / README / Markdown export metadata のユーザー表示名を更新しました。
- 内部prefix、storage key、diagnostic file prefix、`arcaia-*` / `AICE_*` 系識別子は互換性維持のため変更していません。
- アイコン整理・差し替えはこの版では未実施です。

## v0.1.106の変更点

- URL/会話ID監視を、500ms常時polling中心から `history.pushState` / `history.replaceState` hook + `popstate` / `hashchange` + 低頻度fallback intervalへ変更しました。
- fallback intervalを500msから2500msへ緩和しました。
- Rolling LiteのMutationObserver発火時にもURL/会話ID差分を軽く確認し、必要な場合だけ会話状態同期を走らせます。
- Lite状態取得のmain-world往復を、同一conversationIdかつ短時間の非manual applyではキャッシュ利用するようにしました。
- popup/manual/bar操作、会話切替、full load、Lite OFF/RESET系ではキャッシュを使わず、main-world状態を再確認します。

## v0.1.105の変更点

- `star` アイコンを塗りつぶし表示に変更しました。
- アイコン候補に `brain-cog` / `globe` / `globe-2` を追加しました。
- `globe` の重複指定は、保存ID衝突を避けるため2つ目を `globe-2` として扱います。
- 既存の `star` / `bot` / `vector-square` / `wrench` は維持しました。

## v0.1.104の変更点

- 初期ロード直後はLiteバーを即時表示せず、短い安定化時間を置いてから表示判定するようにしました。
- LiteのDOM整理処理は維持し、ツールバー表示だけを初期安定化ゲートで抑制します。
- ChatGPT本体の初期DOM差し替えや最下部スクロール前に、Liteバーが見えたり消えたりする挙動を抑えます。
- 会話切替時にも同じ初期安定化ゲートをリセットします。

## v0.1.103の変更点

- アイコン候補を `star` / `bot` / `vector-square` / `wrench` の4つに絞りました。
- 文字アイコン表示を廃止し、拡張機能内のinline SVGで表示するようにしました。
- アイコン選択ポップアップも同じSVGアイコンを表示します。
- 旧 `favoriteIds` 形式の保存データは、引き続き `star` アイコンとして読み替えます。

## v0.1.101の変更点

- Debug ON永続化の現行仕様に合わせ、古いテスト期待値を更新しました。
- 画像生成placeholderの挿入条件と、検索結果サムネイルによる誤placeholder防止を回帰テスト化しました。
- ツールバーからのMarkdown保存/診断ZIP保存がページ側ジョブとして動作し、Popupを閉じても継続することをテスト化しました。
- `icons/toolbar.zip` は配布対象外の一時ZIPとして削除しました。
- 表示や診断文言に残っていた古い版番号を整理しました。

## v0.1.91の変更点

- 初期表示時の既存チャット履歴に `dom_first_observed_at` として現在時刻が表示される問題を修正しました。
- 起動直後/会話切替直後の既存DOMを `initial-dom` としてマークし、公式timestamp indexが取れるまで暫定日時を表示しないようにしました。
- 公式timestamp indexが取得できた既存メッセージは従来どおり公式時刻へ反映されます。
- 公式indexに一致しない既存DOMは、誤った現在時刻を出さず `initial_existing_dom_waiting_for_index` として診断に残します。
- 新規追加ブロックについては、従来どおり必要に応じて `dom_first_observed_at` 暫定timestampを使えます。

## v0.1.90の変更点

- Assistant回答中faviconの生成中判定を、確認済みDOM `button#composer-submit-button[data-testid="stop-button"]` のみに絞りました。
- `streaming` / `loading` / `typing` / `button全件scan` / `copy toolbar未出現` / `送信直後pending` の推測fallbackを削除しました。
- stop-buttonが取れない場合は `generating=false` とし、`composerSubmitButton` 診断に `aria-label` / `data-testid` / `class` / `rect` を出す方針にしました。
- favicon監視はページ全体の広いMutationObserverではなく、`button#composer-submit-button` の属性監視と低頻度のexact rescanへ縮小しました。
- 既存favicon退避対象を `rel="icon"` / `rel="shortcut icon"` のみに限定しました。

## v0.1.89の変更点

- 診断ZIPで、回答完了後も `recent_prompt_latest_assistant_without_completion_toolbar` が `generating=true` にしていることを確認しました。
- 短い回答ではcopy toolbarが未検出のままでも完了していることがあるため、このfallbackを最大2分から8秒へ短縮しました。
- 回答中判定の主軸は、停止ボタン・streaming系DOMシグナル・送信直後の短時間pendingに戻しました。
- これにより、短い回答完了後もfaviconが戻らない問題を抑制します。

## v0.1.88の変更点

- 診断ZIPで、回答完了後も `button[title*="停止"]` がArcaia Liteバーの「すべて読み込む」ボタンに誤ヒットしていることを確認しました。
- `#arcaia-lite-display-bar` などArcaia内部UIをAssistant回答中候補から除外しました。
- 回答中候補の可視判定を、単なる幅/高さありではなく、viewport内に交差している要素へ限定しました。
- これにより、画面外に残ったArcaia UIボタンによってfaviconが戻らない問題を修正しました。

## v0.1.87の変更点

- 診断ZIPで `assistantLoadingFavicon.detector.generating=true` / `active=true` / `linkPresent=true` が確認できたため、検知側ではなくfavicon優先順位側を修正しました。
- Assistant回答中は既存 `rel=icon` / `shortcut icon` / `apple-touch-icon` / `mask-icon` を一時的に `x-arcaia-disabled-favicon` へ退避します。
- Arcaia側の `icon` と `shortcut icon` を2本挿し、hrefに短いトークンを付けてChrome側のfavicon更新を促します。
- 回答完了時はArcaia faviconを削除し、退避した既存faviconの `rel` / `href` / `type` を復元します。
- 診断に `arcaiaIconLinkCount` と `disabledNativeFaviconCount` を追加しました。

## v0.1.86の変更点

- Assistant回答中faviconの検知を、停止ボタン単独依存から複数シグナル方式へ拡張しました。
- `stop` / `abort` / `interrupt` / `streaming` / `aria-busy` / `data-state` などのDOMシグナルも確認します。
- 送信ボタン押下、Enter送信、form submit直後を短時間の回答中候補として扱います。
- 最新assistantメッセージが直近user送信後に出現し、copy toolbarが未出現の場合も生成中候補として扱います。
- `AICE_ASSISTANT_LOADING_FAVICON_STATUS` を追加し、favicon判定状態を診断できるようにしました。

## v0.1.85の変更点

- ツールバー用アイコンのみ、線を少し細くしました。
- `icons/toolbar/toolbar_icon.svg` の `stroke-width` を `2.85` から `2.25` に変更しました。
- `icons/toolbar/icon16.png` / `icon32.png` / `icon48.png` / `icon128.png` / `icon128_white_preview.png` を更新しました。
- mainアイコンは変更していません。

## v0.1.84の変更点

- Liteモードでは画像本体の再取得・保存・復元は行いません。
- 画像を含むassistant回答は、Lite表示用に明示プレースホルダーを表示します。
- プレースホルダー文言は「画像出力」「Liteモードでは画像本体は表示されない」「通常表示で確認」の3点を明記します。
- Assistant回答中は、タブfaviconを静止画の太め3ドットへ切り替えます。
- 回答完了検知後は通常faviconへ戻します。
- 非アクティブタブ中の完了取り逃しに備え、MutationObserver / interval / visibilitychange / focus / pageshow で状態を再判定します。
- v0.1.83 のDebug OFF時のログ最軽量化は維持します。

## v0.1.83の変更点

- Debug modeはcontent script、main world、popupの起動時に必ずOFFから始まります。
- 起動時に過去のON値を `chrome.storage.local` / main-world storageから復元しません。
- popupは起動直後にstorageへDebug OFFを書き戻し、通常モード状態を表示します。
- 手動のDebug ON/OFF切り替えは維持します。
- `contentFailedTrace` はDebug OFFでは収集しません。Debug ON時のみ診断ZIPに含めます。
- Debug OFFではtimestamp適用時の `lastApplySamples` を保持せず、`lastApplyElapsedMs` も記録しません。
- Debug OFFでは `messageTimestampUi.unmatchedDomTimestampBlocks` などの詳細timestamp診断を省略し、通常表示に必要な最小状態だけ返します。
- Debug OFFでは診断ZIPのDOM diagnostics / wiring diagnostic / hook debug / network lite probe詳細を省略します。
- Debug OFFでは main-world の `liteConfigDecisionLog` / observations / response probes / network lite probes の詳細配列を返しません。
- `AICE_LITE_DISPLAY_WIRING_DIAGNOSTIC` と `AICE_NETWORK_LITE_PROBE_STATUS` はDebug OFF時の通常許可コマンドから外しました。
- message timestampは既存のmain-world timestamp indexを優先して表示します。
- index未反映の新規user DOM blockは、DOM初回観測時刻を `dom_first_observed_at` として暫定JST表示します。
- index未反映の新規assistant DOM blockは、回答生成中はtimestampを表示せず、完了後にDOM初回観測時刻のJSTを表示します。
- assistant toolbar / copyボタン出現を生成完了シグナルとして扱い、timestamp badgeを再適用します。
- ChatGPT本体の通常conversation fetchからtimestamp indexが更新されたら、暫定表示を公式timestampへ置換します。
- live timestamp fallbackのための追加 `fetch()` は行いません。
- `role_ordinal` timestamp fallbackは廃止済みです。
- 新規DOM blockで `message_id` / `node_id` 一致できない場合、過去メッセージのtimestampを採用せず `provisional: dom_first_observed_at` を表示します。
- 候補日時の羅列UIと `timestampCandidates` 収集は削除済みです。
- ピン留めセクション内の会話をドラッグで並べ替えできます。
- 保存済みのピン留め順がある場合、document_start直後にearly gateを設置し、保存順適用前のnative順paintを抑制します。
- early gateは `data-arcaia-pinned-sort-ready` で解除し、1.8秒のfail-safe timeoutでも必ず解除します。
- ピン留め行の星アイコンをクリックすると、絵文字ではなくinline SVGの星アイコンへ切り替えます。
- SVG星のON/OFF状態は `localStorage` の `arcaia.sidebarPinnedFavorites.v1` に保存します。
- drop marker周辺に `PINNED_SORT_DROP_MARKER_STICKY_PX` のデッドゾーンを設け、marker近辺では再判定による位置ぶれを抑えます。
- ピン留め並べ替えはnative sidebar行を `insertBefore` / `appendChild` で移動するだけで、行のcloneや再生成は行いません。
- ピン留め順は `localStorage` の `arcaia.sidebarPinnedSorter.v1` に保存します。

## timestamp fallback

表示順は次の通りです。

1. main-world timestamp indexに一致するmessage ID / node ID / role ordinalがあれば、その公式timestampを使います。
2. まだindexに存在しないuser DOM blockは、Arcaiaが最初にDOMで観測した時刻を仮timestampとして即時表示します。
3. まだindexに存在しないassistant DOM blockは、回答生成中は表示を延期し、生成完了後に仮timestampを表示します。
4. 後続の既存conversation fetchでtimestamp indexが更新されると、仮timestamp badgeを公式timestamp badgeへ置き換えます。

仮timestamp badgeは `data-arcaia-timestamp-provisional="true"` と `arcaia-message-time-provisional` を持ちます。仮timestampには `displayTimezone: Asia/Tokyo` を持たせます。公式timestampへ置き換わると provisional flag は `false` になります。

## 既存仕様の維持

- 通常ページのBackend rewriteはデフォルトONです。
- Backend rewriteは `/backend-api/conversation` のJSONレスポンスをChatGPT描画前に直近表示向けへ縮小し、描画対象payloadを減らします。
- Debug OFF時は、Content failed trace / observerを停止し、蓄積ログも追加しません。
- Backend rewrite有効時は、スクロール安定化のためDOM側の古いturn CSS hide / pruneをスキップします。
- Backend rewrite有効時の5秒intervalでは、DOM集計を行わず軽量no-opで戻ります。
- Turn単体Markdown保存ボタンはcopyボタンの親toolbarを注入単位にし、toolbar内の先頭側へ挿入します。
- `data-arcaia-turn-export-toolbar` で二重挿入を防ぎます。
- Turn保存ボタンのMutationObserverはcopyボタン追加に関係するDOM変化だけに反応し、定期pollingは行いません。
- timestampのMutationObserverはmessage DOMまたはassistant toolbar / copyボタン追加に関係するDOM変化だけに反応し、定期pollingは行いません。
- Backend rewriteが無効または使えない場合のみ、DOM側では古いturnを物理削除せずCSS hideをfallbackとして使います。
- Full load onceは、1回だけbackend rewriteをスキップして同一チャットを再読み込みします。
- Backend rewrite実験ON中もDOM hard pruneは行いません。

# Recent View 分離・公開検討 Later Plan

Last updated: 2026-08-23

## 目的

Arcaia に追加したい機能がいったん落ち着いた後に、`Recent View` を Arcaia から分離し、将来的な一般公開を検討できる独立拡張機能として整理する。

この資料は、別チャットへ移行した後でも、今回までに確認・合意した設計意図、競合比較、現行実装、Later 要件を失わずに再開するための正本候補とする。

## 現時点の構想

### Arcaia

Arcaia は今後も個人使用向けの多機能 ChatGPT 拡張として維持する。

Recent View 分離後も、Recent View 以外の既存機能は原則そのまま残す。

例:

- Model decoration
- Message timestamps
- Markdown export
- Pinned 関連
- Completion sound
- Block collapser
- Ctrl+Enter send
- その他の個人向け補助機能

### Recent View 独立拡張

Recent View は単独機能として新しい拡張へ分離する。

将来的な Chrome Web Store 等での公開を検討する。

公開版の主目的は明確に以下へ限定する。

> 長い ChatGPT 会話の初期描画負荷を小さくし、必要な過去履歴は後から閲覧できるようにする。

検索、ブックマーク、Markdown、通知音、モデル装飾などを安易に追加せず、長い会話の軽量化と履歴閲覧に集中する。

## 分離時の重要方針

### Recent View のコピーを Arcaia 内に残さない

分離後は、Arcaia に内蔵 Recent View を残して二重保守しない。

個人環境で Recent View を使う場合も、Arcaia と独立 Recent View 拡張を併用する構成を基本とする。

理由:

- 公開版と個人版の実装が分岐するのを防ぐ
- バグ修正を二重適用しない
- 公開版だけを独立して品質管理・権限最小化できる
- Arcaia の個人向け実験的変更から Recent View を切り離せる

## 現在の Recent View 実装概要

### 通常表示

Main World で `window.fetch` を patch し、ChatGPT 自身の次の conversation detail response を観測する。

```text
GET /backend-api/conversation/<conversation-id>
```

流れ:

```text
ChatGPT original fetch
        ↓
full conversation JSON response
        ↓
Arcaia Main World
        ├─ full read-only conversation model を生成・メモリキャッシュ
        └─ Recent View 用の小さい conversation JSON に rewrite
                ↓
            ChatGPT へ返却
```

通常 Recent View は、DOM が作られた後に大量の古い turn を隠す方式ではなく、ChatGPT が描画する前の conversation response を縮小する。

### Lite rewrite の基本

現在は latest path を解析し、User を起点とした turn 単位で直近 N turn を選択する。

既定表示対象に加えて、ChatGPT の描画安定用に render anchor 相当の追加 turn を保持する。

画像等に必要な中間 node も必要に応じて保持・補完する。

backend rewrite 後は、通常経路では追加 DOM prune を原則行わない。

## Full read-only conversation model

### 保存場所

永続保存ではない。

Main World の JavaScript メモリ上のみで保持する。

現在の実装概念:

```text
window[GLOBAL_KEY]
└─ state
   └─ readOnlyConversationModelsByConversation
      └─ Map ベース bounded cache
```

現在のキャッシュ上限は 1 タブあたり 2 conversation。

別タブ同士では JavaScript context が別なのでキャッシュも独立する。

### 永続化しないもの

full conversation model は以下へ保存しない。

- `chrome.storage.local`
- `sessionStorage`
- IndexedDB
- ディスク

タブ reload / discard / close 等でメモリ上の model は消える。

### read-only model へ残す主情報

現在は ChatGPT の巨大な conversation graph をそのまま保持せず、閲覧に必要な turn model へ正規化する。

主な構造:

```text
conversationId
totalTurnCount
turns[]
  ├─ turnNumber
  ├─ user
  │  ├─ text
  │  ├─ createdAtIso
  │  ├─ resources
  │  └─ citations
  └─ assistant
     ├─ text
     ├─ createdAtIso
     ├─ resources
     └─ citations
```

### 主に落としている情報

- `mapping` graph 自体
- node ID / `parent` / `children`
- `current_node`
- 現在選択されていない別 branch
- system message 本文
- visually hidden message
- assistant の途中状態
- `end_turn !== true` の assistant message
- `recipient !== all` の内部向け assistant message
- tool / internal message の本文
- author の詳細 metadata
- model 情報
- message status や多数の内部フラグ
- renderer が使用しないその他の conversation metadata

ただし tool / internal node の本文を捨てても、そこから検出した画像、添付、asset pointer、file ID、MIME type、citation 等は最終 assistant turn へ集約して保持する場合がある。

## 現在の履歴表示方式

通常 Recent View から過去を見る場合は、native ChatGPT DOM を大量復元するのではなく、保存済み read-only model から独自 DOM を生成する。

現在の UI:

- 「全文表示」

read-only 表示中は native conversation content root を非表示にし、`content_recent_view_renderer.js` の独自 DOM を表示する。

## Later 要件

以下では、すでに実装済みの履歴取得基盤と、分離後に再検討する未実装項目を分けて記録する。

### Implemented: on-demand full-history pagination

「全文表示」は Main World の `readOnlyConversationModelsByConversation` を参照する。

- 完全なcacheがあれば追加fetchせず、そのmodelを表示する。
- cache miss、または`page_info.has_previous_page=true`の不完全cacheなら、ユーザーの明示操作を契機に現在conversation detailを再取得する。
- 新しいflat `messages` transportでは、`start_cursor`を使って`/backend-api/conversations/<id>/messages?before=...`を`has_previous_page=false`まで遡る。
- ページ間でmessage IDを重複排除して古い順に結合し、全履歴read-only modelを再構築する。
- 通常Recent Viewでは追加fetchしない。Content Script側からconversation APIを直接fetchせず、Main Worldの`originalFetch`経路だけを使う。
- cursor不正、反復cursor、取得失敗、bounded safety limit到達時は、不完全な履歴を「全文」として表示せず失敗扱いにする。

この挙動は2026-08-23のBackend Contract Probeで、conversation detailが`has_previous_page=true`の部分pageを返すことを確認した後に追加した。
### Later 2: 上スクロールで過去 turn を自動復元

現在の「全文表示」に加え、read-only mode内で過去turnを段階的に読むreverse lazy loadingを検討する。

理想形:

```text
read-only model: 全 turn

custom DOM:
直近 10～20 turn のみ
       ↑
上端 sentinel が viewport に入る
       ↓
古い 10 turn を prepend
```

実装候補は独自 read-only root の上端 sentinel に対する `IntersectionObserver`。

document 全体の `scroll` / `wheel` / `touchmove` listener を増やす方式は避ける。

prepend 時は scroll anchor を維持し、現在見ている位置が飛ばないようにする。

概念:

```text
beforeHeight = scrollHeight
prepend older turns
afterHeight = scrollHeight
scrollTop += afterHeight - beforeHeight
```

### Later 3: read-only DOM の windowing / virtualization

非常に長い conversation では full read-only model はメモリに保持しつつ、DOM は 20～30 turn 程度に限定する方式を検討する。

```text
Full model: 1 ... 1000

DOM window:
Turn 471 ... 500
```

上方向へ移動した場合:

- 古い turn を prepend
- 十分離れた下側 turn を DOM から解放

これにより、全文データを閲覧可能な状態で保持しつつ DOM 負荷を一定程度に抑える。

### Later 4: 独自 jump list

ChatGPT native jump list を custom read-only DOM と無理に同期させない。

read-only mode 中だけ独自 jump list に切り替える構成を検討する。

通常:

```text
Native conversation → visible
Native jump list    → visible
```

read-only mode:

```text
Native conversation → hidden
Native jump list    → hidden

Recent View custom DOM       → visible
Recent View custom jump list → visible
```

read-only mode を閉じたら native 側を復元する。

#### 独自 jump list のデータ元

DOM から抽出せず full read-only model をauthorityとする。

各 turn の `user.text` 冒頭を一覧として使える。

例:

```text
Turn 1   ユーザー質問の冒頭...
Turn 2   次の質問...
...
```

テキストなし添付のみ turn についても `user.resources` から `File upload` 相当を表示可能。

#### 未 mount turn への jump

全文 jump list は、本文 DOM に現在 mount されていない turn も表示する。

例えば Turn 25 が未 mount の状態でクリックされた場合:

```text
Turn 25 click
   ↓
DOM に存在するか
├─ Yes → scrollIntoView
└─ No
     ↓
   model から Turn 25 周辺を render
     ↓
   DOM window を差し替え / 拡張
     ↓
   Turn 25 へ移動
```

#### 見た目の再現

ChatGPT native jump list は、通常は右側の短い横線群、focus / hover 時には User prompt の冒頭一覧を表示する。

独自版でも見た目・操作感を近づけることは可能と考えている。

ただし実装前に dedicated probe で以下を採取する。

- native DOM hierarchy
- marker 数 / gap / 幅
- popup width / positioning
- background / border / radius token
- active / hover state
- overflow behavior
- user prompt snippet の生成ルール
- attachment-only turn の label
- current turn 判定
- click 時の navigation behavior

添付済みの `chatgpt-original-style-integrated-probe-v1.0.0.zip` は今後の native style / behavior 調査候補として保持する。

## 競合調査から得た重要事項

### ChatGPT Performance Long Chats

添付 CRX を静的確認済み。

この拡張も Recent View と同様に、ChatGPT の:

```text
GET /backend-api/conversation/<id>
```

response を `window.fetch` patch で縮小している。

つまり「初期描画前に conversation payload を縮小する」という核心アイデア自体は競合にも存在する。

ただし差異がある。

#### Performance Long Chats

- message node 数を基準に末尾 N 件を残す
- rewrite 後の native DOM に対してさらに古い turn を `display:none` する
- document `scroll` / `wheel` / `touchmove` で上端付近を検知
- hidden native turn を 1 件ずつ reveal
- rewrite で落とした範囲を超える履歴は単純 reveal できない
- モード変更時に reload を使う経路がある

#### Recent View

- User 起点の turn 単位で recent history を選ぶ
- render anchor や画像関連 path も考慮
- rewrite 前の full read-only model をメモリ保持
- 過去履歴は native DOM ではなく custom read-only DOM で表示可能
- native DOM との二重 windowing を避けられる
- 将来 custom DOM 側だけで reverse lazy loading / virtualization / jump navigation を構成できる

## メモリに関する現時点の評価

Recent View は Performance Long Chats より、拡張自身の JavaScript heap を多く使う可能性が高い。

理由:

- full read-only conversation model を一時メモリ保持するため

ただし保持対象は raw conversation graph そのものではなく正規化 model である。

一方、Recent View は ChatGPT native 側へ渡す payload / render 対象をかなり小さくできる。

したがってタブ全体では:

```text
+ read-only model の JS memory
- ChatGPT 側の大きな React / DOM / layout 負荷
```

というトレードになる。

どちらが総メモリで有利かは実測前には断定しない。

分離・公開検討時に次を比較する。

- Recent View OFF
- Recent View ON native recent only
- read-only history open
- Performance Long Chats 同条件

Chrome Task Manager / DevTools heap / DOM node count / long-task 等を必要に応じて測定する。

## 独立版の想定最小権限

現在の Arcaia 全体は以下を持つ。

```text
activeTab
offscreen
scripting
tabs
storage
host: https://chatgpt.com/*
```

ただし Recent View 単独版なら、現時点では基本的に次だけで成立する見込み。

```text
permissions:
- storage

host_permissions:
- https://chatgpt.com/*
```

Main World script は `web_accessible_resources` + script tag injection で扱えるため、Recent View 本体だけなら `scripting` は必須ではない。

`storage` は表示 turn 数、画像表示、ON/OFF 等の設定保存用途。

公開時は権限を最小化し、不要な Arcaia 権限を持ち込まない。

## 分離時の最大の技術課題: Arcaia との fetch hook 共存

現在 Arcaia の Main World fetch hook は Recent View 以外にも conversation response を利用している。

例:

- Recent View rewrite
- Message timestamp index
- Current conversation model config
- read-only model

Recent View を別拡張にすると:

```text
Arcaia      → window.fetch patch
Recent View → window.fetch patch
```

という二重 patch が発生する。

注入順によっては、Recent View が先に縮小した response を Arcaia が観測し、timestamp 等で full conversation を取得できなくなる可能性がある。

### 分離前に整理する推奨境界

Arcaia 内部で先に、conversation fetch 処理を概念的に:

```text
Original conversation response
        ↓
Observer phase
├─ timestamps
├─ model config
└─ その他 full response 必須処理
        ↓
Transformer phase
└─ Recent View rewrite
        ↓
ChatGPT
```

へ整理する。

分離後も両拡張を同時インストールできることを正式なテストケースとする。

大げさな共有ライブラリ repo を最初から作る必要はない。

必要なら Main World 上に小さな versioned broker / protocol を定義し、両拡張が full response observer と final transformer の順序を安全に共有できるようにする。

## 分離作業を開始する推奨順序

1. Arcaia 側の当面の追加機能を完了させる。
2. Recent View の依存関係を再調査する。
3. Recent View を Arcaia 内で独立 subsystem として整理する。
4. conversation fetch observer / transformer の境界を整理する。
5. Arcaia + 独立 Recent View 共存方式を設計する。
6. 新しい独立 repo / extension を作成する。
7. Recent View の namespace / storage key / DOM attr / protocol 名を Arcaia から分離する。
8. 独立版へ Recent View 本体を移植する。
9. Arcaia から Recent View 本体・設定 UI を削除する。
10. 2拡張同時導入テストを行う。
11. reverse lazy loading、custom jump list 等の未実装Later要件を順に検討する。
12. 権限・privacy・performance を公開品質で再評価する。

## 公開版で維持したい設計原則

- 単機能を維持する
- Chrome 権限を最小化する
- conversation 全文を extension storage へ永続保存しない
- 通常時は native ChatGPT に大量の過去 turn を描画させない
- 過去閲覧は read-only model を authority とする
- DOM 監視・polling・timer を安易に増やさない
- browser/runtime 挙動は dedicated probe で確認してから修正する
- ChatGPT native DOM との競合をなるべく避ける
- 長大 conversation でも本文 DOM 数を制御できる構造を優先する

## 現時点で実装しないこと

この資料作成時点では、以下は着手しない。

- Recent View の repo 分離
- Arcaia からの Recent View 削除
- reverse lazy loading
- read-only virtualization
- custom jump list
- native jump list probe の追加調査
- 公開申請

Arcaia の当面の追加機能が落ち着いた後に再開する。

## 次チャット再開時の確認文

次のチャットでこの作業を再開するときは、まずこのファイルを読み、次を確認する。

```text
docs/recent-view-separation-later-plan.md
```

そのうえで、現在の Arcaia HEAD と Recent View 実装が本資料作成時点から変化していないかを確認し、古い仮定のまま分離を始めないこと。


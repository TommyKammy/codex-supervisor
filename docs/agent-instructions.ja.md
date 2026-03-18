# Agent Bootstrap Protocol

この文書は、`codex-supervisor` を操作しようとしている AI agent 向けの日本語 bootstrap hub です。

これは canonical なルールを重複して書くための第 2 の reference ではありません。agent が最初に何を確認し、次に何を読み、どの時点で即興で埋めずに止まってエスカレーションすべきかを明示するための入口です。

## 目的

repo に初めて入る時、または長い間隔を空けて再開する時はここから始めてください。

詳細なポリシーはリンク先の reference docs を使います。

- [codex-supervisor 入門](./getting-started.ja.md): 日本語での初回運用フローと最初の確認手順
- [Getting started](./getting-started.md): 英語版の初回運用フロー
- [Configuration reference](./configuration.md): config 項目、provider setup、durable memory、実行ポリシー
- [Issue metadata reference](./issue-metadata.md): execution-ready issue の構造と scheduling inputs
- [Local review reference](./local-review.md): local review の role、artifact、threshold、merge policy

このファイルは、それらの canonical references へ案内する bootstrap hub として扱ってください。

## 前提条件

行動を始める前に、次を確認してください。

- `gh auth status` が成功する
- `codex` CLI が install 済みで shell から使える
- 対象 repository がすでにローカルに clone 済みである
- 管理対象 repository ですでに branch protection と CI が設定されている
- supervisor config が per-issue worktree 用の書き込み可能な `workspaceRoot` を指している

auth、binary、repository 準備が欠けている状態を推測で埋めて進めてはいけません。その場合はエスカレーションします。

## 最初に読む順番

次の順番で読みます。

1. このファイル。実行順序を明示するためです。
2. [codex-supervisor 入門](./getting-started.ja.md)。初回運用フローと operator の確認点を日本語で把握するためです。
3. [Getting started](./getting-started.md)。英語版の bootstrap hub と wording drift がないか確認する必要がある時だけ開きます。
4. [Configuration reference](./configuration.md)。今回の run に必要な field と provider 挙動だけを確認します。
5. [Issue metadata reference](./issue-metadata.md)。issue を execution-ready だと信頼する前に確認します。
6. [Local review reference](./local-review.md)。local review が有効な時、または issue が local-review 状態に入った時だけ開きます。

reference doc は必要な範囲だけを読みます。毎回すべてを最初から通読するのではなく、今の判断に必要な canonical source を選んでください。

## 初回実行の順序

repo で supervisor を初めて運用する時は、次の順で進めます。

1. 前提条件を確認し、正しい `supervisor.config.json` を使っていることを確かめます。
2. [codex-supervisor 入門](./getting-started.ja.md) を読み、その repo が backlog planning ではなく supervisor 実行の準備ができているかを確認します。
3. active config を [Configuration reference](./configuration.md) と照合し、特に `repoPath`、`repoSlug`、`workspaceRoot`、`codexBinary`、review-provider 関連設定を確認します。
4. candidate issue を [Issue metadata reference](./issue-metadata.md) で検証し、dependencies、execution order、acceptance criteria、verification が具体的かを見ます。
5. 一度 `npm run build` を実行します。
6. `node dist/index.js run-once --config /path/to/supervisor.config.json` から始めます。
7. `loop` に切り替える前に `node dist/index.js status --config /path/to/supervisor.config.json` で結果を確認します。

`run-once` が想定どおりの issue を選び、想定どおりの worktree を作り、journal に妥当な state を残すまで、最初から `loop` を回してはいけません。

## 推測せずにエスカレーションする条件

次の状況では止まり、operator の助けを求めます。

- auth、binary、provider setup が不足している
- config から target repo や workspace が明確に読み取れない
- issue の dependencies や execution order が曖昧
- acceptance criteria や verification が曖昧で完了を証明できない
- 現在の state に対する local review や external review policy が不明
- 実際の repo state が issue、PR、journal の説明と食い違っている

エスカレーション時は、どの blocker があり、どの command または file で判明し、どの canonical reference だけでは足りなかったかを明示してください。

## 正式な参照先

- [codex-supervisor 入門](./getting-started.ja.md)
- [Getting started](./getting-started.md)
- [Configuration reference](./configuration.md)
- [Issue metadata reference](./issue-metadata.md)
- [Local review reference](./local-review.md)

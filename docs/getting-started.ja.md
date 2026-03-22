# codex-supervisor 入門

このガイドは、`codex-supervisor` を実際の repo で運用し始める人向けの、日本語での詳しい getting started です。

主に次の流れを扱います。

- supervisor を使う準備が整っているかを判断する
- review provider を含む config を用意する
- scheduler が安全に実行できる issue を書く
- 最初は `run-once` で確認し、その後 `loop` に移る
- 迷った時にどの reference doc を開くかを判断する

概要は [README](../README.md) と [README.ja](./README.ja.md) を参照してください。この文書は、README より踏み込んだ運用ガイドとして維持します。AI agent に repo を引き継ぐ時は、この文書で bootstrap 手順を重ね書きせず [Agent Bootstrap Protocol](./agent-instructions.ja.md) を入口にしてください。

## 始める前に

まず次を確認してください。

- `gh auth status` が成功する
- `codex` CLI が shell から使える
- 管理対象 repo がローカルに clone 済み
- 対象 repo に branch protection と CI がある
- supervisor が issue ごとの worktree を作れる場所がある
- autonomous execution を使うなら、その repo を trusted repo として扱える
- issue body、review comment、関連する GitHub-authored execution text を書ける GitHub author を trusted author として扱える

supervisor repo では一度ビルドしておきます。

```bash
npm install
npm run build
```

WebUI の browser smoke suite をローカルや CI で回したい時は次を使います。

```bash
npm run test:webui-smoke
```

この harness は `playwright-core` とローカルの Chrome/Chromium を使って、in-process の dashboard fixture を開きます。標準の `google-chrome`、`google-chrome-stable`、`chromium`、`chromium-browser` で browser が見つからない時は `CHROME_BIN=/path/to/browser` を設定してください。

現在の実行安全ルール: GitHub-authored issue body や review comment は Codex への execution input なので trust boundary の一部です。現在の runtime は `--dangerously-bypass-approvals-and-sandbox` を使うため、trusted repo / trusted author が前提でない限り autonomous execution を有効にすべきではありません。

現在の state recovery ルール: missing JSON state は empty bootstrap として扱えますが、corrupted JSON state は同じではありません。corrupted JSON state は recovery event として扱い、operator が inspect して acknowledge または reset するまで durable recovery point だと見なしてはいけません。

現在の workspace recovery ルール: `ensureWorkspace()` は local issue branch、remote issue branch、`origin/<defaultBranch>` からの fresh bootstrap の順で復元を試みます。missing local branch だけを理由に、既存の remote issue branch を無視して fresh bootstrap してはいけません。

## どの運用モードを使うか

`codex-supervisor` は execution-ready な issue を前に進めるツールです。まだ planning が必要なら、先に GSD を使って backlog を整えます。

そのまま supervisor に流してよい条件:

- issue body に変更内容が明確に書かれている
- 依存関係が `Depends on` で明示されている
- sibling issue の順番が `Execution order` で書かれている
- acceptance criteria と verification が観測可能な形になっている

先に GSD を使うべき条件:

- 依頼がまだ曖昧
- 1 issue が大きすぎて複数 issue に分ける必要がある
- repo memory や planning docs を先に更新したい

覚え方:

**GSD は backlog を設計し、`codex-supervisor` は backlog を実行します。**

## supervisor config を準備する

ベース設定から active config を作ります。

```bash
cp supervisor.config.example.json supervisor.config.json
```

次に、PR review の運用に合う provider profile を選びます。

- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

選んだ profile を `supervisor.config.json` に丸ごとコピーしてもよいですし、`reviewBotLogins` だけを手元の active config に移しても構いません。

初回起動前に最低限設定する値:

- `repoPath`
- `repoSlug`
- `workspaceRoot`
- `codexBinary`
- 利用する review provider に応じた設定

config の全項目、model policy、durable memory、provider guidance は [Configuration reference](./configuration.md) を参照してください。

## execution-ready issue を書く

scheduler は「新しく open された issue」ではなく「今 runnable な issue」を選びます。matching する open issues を candidate discovery fetch window ごとに page しながら backlog 全体を見て、deterministic な順序で最初に runnable な issue を選びます。したがって、issue 側の metadata を explicit にしておく必要があります。

candidate discovery は matching する open backlog 全体を評価します。repo が大きくても、より古い runnable issue が最初の page の外にあるだけで選定対象から見えなくなることはありません。backlog の順番がおかしく見える時は、まず metadata を確認してください。

最低限そろえたい項目:

- `## Summary`
- `## Scope`
- `Depends on`
- `## Execution order`
- `## Acceptance criteria`
- `## Verification`

最小例:

```md
## Summary
Refocus the Japanese docs so README is lighter and getting-started stays the fuller guide.

## Scope
- keep the Japanese getting-started guide as the detailed operator doc
- reduce duplicated detail in docs/README.ja.md
- keep README/docs cross-links coherent

Part of: #259
Depends on: #263
Parallelizable: No

## Execution order
5 of 5

## Acceptance criteria
- docs/getting-started.ja.md remains useful as the fuller guide
- docs/README.ja.md is lighter and links to the deeper docs
- Japanese and English doc links stay coherent

## Verification
- review Japanese doc links and structure
- run npm run build
```

metadata の canonical な書式と scheduling への効き方は [Issue metadata reference](./issue-metadata.md) を参照してください。

## 最初の 1 パスを実行する

いきなり常駐 loop にせず、まずは単発の supervised pass で挙動を確認します。

```bash
node dist/index.js run-once --config /path/to/supervisor.config.json
node dist/index.js status --config /path/to/supervisor.config.json
```

`run-once` 後に確認する点:

- 選ばれた issue が想定どおりか
- issue worktree が `workspaceRoot` 配下に作られたか
- restore された issue workspace が、期待した local branch、または remote branch を使っていて、不要に fresh bootstrap していないか
- issue journal に仮説、blocker、次の一手が残っているか
- PR や state hint の変化が実際の GitHub 状態と一致しているか
- orphaned `issue-*` worktree が tracked done cleanup と同一視されず、明示的な prune なしに消えていないか

もし違う issue を拾うなら、`status` や `doctor` で effective な candidate discovery 設定を確認し、そのうえでコードではなく issue metadata を先に直してください。issue 作成順を source of truth だと思わないでください。
もし `status` や `doctor` が corrupted JSON state を報告したら、その state file を safe checkpoint として扱うのをやめ、recent operator action と file を確認してから明示的な acknowledge または reset を行ってください。

## run-once から loop に移る

1 回の supervised pass が正しく動いたら、連続 loop に切り替えます。

```bash
node dist/index.js loop --config /path/to/supervisor.config.json
```

同じ config を使って local operator dashboard を見たい時は次を使えます。

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

WebUI は CLI と同じ `SupervisorService` を使い、typed な `status`、`doctor`、`explain`、`issue-lint` を読みます。現在の safe command surface は `run-once`、`requeue`、`prune-orphaned-workspaces`、`reset-corrupt-json-state` です。

通常運用では、supervisor は次を繰り返します。

1. GitHub とローカル state を再取得する
2. 次の runnable issue を選ぶか再開する
3. issue 専用 worktree で Codex turn を実行する
4. coherent checkpoint があれば draft PR を開くか更新する
5. CI、review、mergeability に応じて repair または merge に進む

状態ヒントの意味を短く覚えるなら次です。

- `reproducing`: 問題や要件を再現可能に寄せる段階
- `stabilizing`: clean checkpoint を作って draft PR に近づける段階
- `draft_pr`: 途中でも coherent checkpoint を公開した段階
- `local_review`: ローカル review swarm を実行中の段階
- `waiting_ci`: CI や review の結果待ち
- `addressing_review`: bot review の妥当な指摘を修正中
- `repairing_ci`: failing checks の修正中
- `resolving_conflict`: dirty merge state を解消中

## よくある運用判断

GSD を先に使うべき時は?
まだ planning 問題である時です。execution 問題に落ちてから supervisor に渡します。

PR はいつ開くべきか?
branch に coherent checkpoint ができた時点です。完璧な最終形まで待たず、draft PR を早めに出します。

local review はいつ有効にすべきか?
merge 前の追加 gate を入れたい時、または外部 review の前にローカル advisory pass を入れたい時です。role、threshold、artifact、guardrail は [Local review reference](./local-review.md) を参照してください。

backlog の順番がおかしい時は?
GitHub issue の `Depends on` と `Execution order` を直してください。scheduler は chat history ではなく metadata に従い、matching する open backlog を candidate discovery fetch window ごとに page しながら backlog 全体を評価します。

loop が blocked issue に当たり続ける時は?
その issue は execution-ready ではありません。issue body を締めるか、分割するか、GSD で backlog を作り直してください。

## よくある失敗

- `run-once` を見ずに最初から `loop` を常駐させる
- planning が残った issue をそのまま supervisor に渡す
- issue の作成順を実行順だと思い込む
- README レベルの概要で十分だと考え、issue metadata を薄くする
- config や local review の詳細をこのガイドだけに持たせようとする

## 関連ドキュメント

- [README](../README.md): 英語版の概要、適用範囲、docs map
- [README.ja](./README.ja.md): 日本語の軽い overview と導線
- [Agent Bootstrap Protocol](./agent-instructions.ja.md): AI agent 向けの bootstrap 順序、初回確認、エスカレーション条件
- [Configuration reference](./configuration.md): config 項目、provider setup、durable memory、実行ポリシー
- [Operator dashboard](./operator-dashboard.md): local WebUI、panel の意味、safe command、browser smoke harness
- [Local review reference](./local-review.md): review role、artifact、threshold、merge policy
- [Issue metadata reference](./issue-metadata.md): execution-ready issue の構造と scheduling inputs

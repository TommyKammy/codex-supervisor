# codex-supervisor 日本語ガイド

`codex-supervisor` は、execution-ready な GitHub issue を `codex exec` と `gh` で継続実行していくための durable な outer loop です。CI 失敗、review 待ち、draft PR、merge 直前の確認までを、chat thread ではなく GitHub とローカル state を使って追い続けます。

英語版の一次ソースは [README.md](../README.md) です。この文書は、日本語で全体像と入口を把握するための軽い案内として使ってください。人がセットアップと運用手順を確認するときは [docs/getting-started.ja.md](./getting-started.ja.md) から始め、repo に入った AI agent は [docs/agent-instructions.ja.md](./agent-instructions.ja.md) を先に読んでください。

## 何が解決されるか

Codex CLI 単体でも実装は進められますが、長い実行では次のようなところで止まりやすくなります。

- session が切れて、次の実行で context を作り直す必要がある
- CI が失敗しても、その修復 loop を自動で拾い直せない
- review や mergeability の変化を、元の session が知らないまま止まる

`codex-supervisor` は、その外側で動く継続 loop です。issue ごとの worktree と journal を維持しながら、毎サイクル GitHub とローカル state を見直して、次に進めるべき runnable issue と PR 状態を選び直します。

## 何をするツールか

`codex-supervisor` は、長い chat thread を覚え続ける代わりに、毎サイクル GitHub とローカル state を読み直して次の行動を決めます。

- issue、PR、checks、review、mergeability を再取得する
- runnable な issue を readiness-driven に選ぶ
- issue ごとの worktree と issue journal を維持する
- draft PR、CI 修復、review 対応、merge までの loop を継続する

詳しい初回手順は [docs/getting-started.ja.md](./getting-started.ja.md)、AI agent 向けの bootstrap 手順は [docs/agent-instructions.ja.md](./agent-instructions.ja.md) に分けています。

## 向いているケース

Best fit:

- 1 人、または ownership が明確な automation lane
- `Depends on` と `Execution order` が明示された backlog
- branch protection と CI が整った repo
- execution-ready issue を順に回したい運用

Not a fit:

- 優先順位や依存関係が暗黙な backlog
- 相談単位の issue が多く、実装単位に分解されていない repo
- 複数人が同じ領域を頻繁に触る repo

## クイックスタート

前提条件:

- `gh auth status` が通る
- `codex` CLI が shell から使える
- Node.js 18+ が入っている

1. 依存関係を入れてビルドします。

   ```bash
   npm install
   npm run build
   ```

2. ベース設定から active config を作ります。

   ```bash
   cp supervisor.config.example.json supervisor.config.json
   ```

3. review provider に合う profile を選び、`supervisor.config.json` に反映します。

   - [supervisor.config.copilot.json](../supervisor.config.copilot.json)
   - [supervisor.config.codex.json](../supervisor.config.codex.json)
   - [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

4. `repoPath`、`repoSlug`、`workspaceRoot`、`codexBinary` などを初回実行前に設定します。`supervisor.config.coderabbit.json` は、customize を必須にするため `repoSlug` に無効な placeholder を入れています。
5. まず `run-once` と `status` で挙動を確認します。

   ```bash
   node dist/index.js run-once --config /path/to/supervisor.config.json
   node dist/index.js status --config /path/to/supervisor.config.json
   ```

6. 問題なければ `loop` と必要に応じて WebUI を起動します。

   ```bash
   node dist/index.js loop --config /path/to/supervisor.config.json
   node dist/index.js web --config /path/to/supervisor.config.json
   ```

最初の runnable issue は README のテンプレか [docs/issue-metadata.md](./issue-metadata.md) の完成例から書き始めるのが安全です。issue の scheduling metadata が正しいかは、`node dist/index.js issue-lint <issue-number> --config /path/to/supervisor.config.json` で先に確認してください。

より詳しい初回手順、issue の書き方、運用中の判断は [docs/getting-started.ja.md](./getting-started.ja.md) を参照してください。AI agent が repo に入るときの読み順と escalation ルールは [docs/agent-instructions.ja.md](./agent-instructions.ja.md) を参照してください。

## ドキュメントマップ

- [docs/agent-instructions.ja.md](./agent-instructions.ja.md): repo に入った AI agent 向けの bootstrap 読み順、初回確認、escalation ルール
- [docs/getting-started.ja.md](./getting-started.ja.md): 日本語での詳しいセットアップ、issue readiness、初回実行、運用判断
- [docs/getting-started.md](./getting-started.md): 英語版の getting started
- [Configuration reference](./configuration.md): config 項目、provider profile、durable memory、実行ポリシー
- [Operator dashboard](./operator-dashboard.md): local WebUI、safe command surface、browser smoke harness
- [Local review reference](./local-review.md): local review の role、artifact、threshold、guardrail
- [Architecture](./architecture.md): core loop、durable state、reconciliation、安全境界
- [Issue metadata](./issue-metadata.md): issue body の canonical fields と scheduling inputs
- [Validation checklist](./validation-checklist.md): 導入前後の確認項目

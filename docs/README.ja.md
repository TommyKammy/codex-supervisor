# codex-supervisor 日本語ガイド

`codex-supervisor` は、`codex exec` と `gh` を使って GitHub issue、PR、CI、review、merge の進行を継続監督するための deterministic な supervisor です。

英語版の一次ソースは [README.md](../README.md) です。この文書は、日本語で全体像と入口を把握するための軽い案内として使ってください。人がセットアップと運用手順を確認するときは [docs/getting-started.ja.md](./getting-started.ja.md) から始め、repo に入った AI agent は [docs/agent-instructions.ja.md](./agent-instructions.ja.md) を先に読んでください。

## 何をするツールか

`codex-supervisor` は、長い chat thread を覚え続ける代わりに、毎ターン GitHub とローカル state を読み直して次の行動を決めます。

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

4. `repoPath`、`repoSlug`、`workspaceRoot`、`codexBinary` などを設定します。
5. まず `run-once` と `status` で挙動を確認し、その後 `loop` に切り替えます。

より詳しい初回手順、issue の書き方、運用中の判断は [docs/getting-started.ja.md](./getting-started.ja.md) を参照してください。AI agent が repo に入るときの読み順と escalation ルールは [docs/agent-instructions.ja.md](./agent-instructions.ja.md) を参照してください。

## ドキュメントマップ

- [docs/agent-instructions.ja.md](./agent-instructions.ja.md): repo に入った AI agent 向けの bootstrap 読み順、初回確認、escalation ルール
- [docs/getting-started.ja.md](./getting-started.ja.md): 日本語での詳しいセットアップ、issue readiness、初回実行、運用判断
- [docs/getting-started.md](./getting-started.md): 英語版の getting started
- [Configuration reference](./configuration.md): config 項目、provider profile、durable memory、実行ポリシー
- [Local review reference](./local-review.md): local review の role、artifact、threshold、guardrail
- [Architecture](./architecture.md): core loop、durable state、reconciliation、安全境界
- [Issue metadata](./issue-metadata.md): issue body の canonical fields と scheduling inputs
- [Validation checklist](./validation-checklist.md): 導入前後の確認項目

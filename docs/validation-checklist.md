# Validation Checklist

`codex-supervisor` を一般化や public repo 化に進める前に、まず managed repo 上の loop が安定して end-to-end で回ることを確認するための checklist です。

## 観測項目

- [ ] `Issue選定`: open issue から 1 件だけ選ばれ、専用 worktree と branch が作られる
- [ ] `初回実装`: `codex exec` が変更を作り、commit / push / PR 作成まで自動で進む
- [ ] `CI待機`: PR 作成後に `waiting_ci` へ遷移し、loop が落ちずに監視を継続する
- [ ] `Copilot待機`: Copilot auto review が遅れても grace period 中は merge へ進まない
- [ ] `Review検出`: unresolved な Copilot review thread を検出して `addressing_review` に入る
- [ ] `Review反映`: review 対応の commit / push が自動で行われる
- [ ] `CI再待機`: review 対応後に再度 `waiting_ci` に戻る
- [ ] `自動マージ`: required checks / required review / branch protection 充足後に `merging` へ進み、PR が merge される
- [ ] `Issue完了`: merge 後に state が `done` になり、active issue が解放される
- [ ] `次Issue遷移`: 次の open issue を自動で拾って新しい worktree / branch / PR に進む
- [ ] `継続稼働`: `blocked` / `failed` / timeout が発生しても supervisor プロセス自体は落ちない
- [ ] `安全性`: `main` 直接 push が一度も発生しない
- [ ] `生成物管理`: 不要な生成物やローカル依存ファイルを不適切に commit しない
- [ ] `可観測性`: state file、stdout/stderr ログ、GitHub 上の PR 履歴で挙動を追跡できる

## 一般化に進んでよい基準

### 最低基準

1. 1 issue を end-to-end で完走する
2. Copilot review ありのケースを 1 回通す
3. merge 後に次 issue を自動で拾うところまで確認する

### 推奨基準

1. 2 issue 以上を連続完走する
2. そのうち 1 件は review 対応あり、1 件は review なしで通す
3. 少なくとも 1 回は timeout か CI fail を経験し、loop が継続することを確認する

### 十分基準

1. 3 issue 以上連続で処理できる
2. `implementing -> pr_open -> waiting_ci -> addressing_review -> waiting_ci -> ready_to_merge -> merging -> done` の主要遷移を実地で一通り踏む
3. 人手介入が必要なのは本当に `blocked` なケースだけと判断できる

## 判断ライン

- 「最低基準」を満たしたら、限定的な一般化の設計を始めてよい
- 「推奨基準」を満たしたら、public repo 化を前提にリファクタへ進んでよい
- 「十分基準」を満たしたら、macOS/Ubuntu 両対応と multi-repo 対応の切り出しに入ってよい

## 観測に使う場所

- state: `.local/state.json`
- stdout log: `.local/logs/launchd.stdout.log` or your systemd journal
- stderr log: `.local/logs/launchd.stderr.log` or your systemd journal
- macOS: `launchctl print gui/$(id -u)/io.codex.supervisor`
- Linux: `systemctl --user status codex-supervisor.service`
- status: `node dist/index.js status`

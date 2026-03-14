# Issue Metadata

`codex-supervisor` で安全に issue 順序を扱うための最小記法です。

## 目的

- supervisor が依存関係を機械的に enforce できるようにする
- 並列化を始める前に、人間が安全な前提を issue に残す
- 「コードから推測」ではなく issue を正とする

## 最小記法

issue 本文に次の行を追加します。

```md
Depends on: #232, #240
Parallel group: timeline-layout
Touches: web-ui, core-api, prisma
Risky change opt-in: auth, ci
```

既存の順序情報も引き続き使えます。

```md
Part of #227

## Execution order
7 of 15
```

## 現在 enforce されるもの

- `Depends on`
  - 指定した issue が open の間、その issue には着手しません
- `Part of` + `Execution order`
  - 同じ parent issue 配下で、先行番号が終わるまで後続番号には着手しません
- risky change classes (`auth`, `billing`, `permissions`, `ci`, `migrations`, `secrets`)
  - title / `Summary` / `Scope` / `Touches` から決定的に検出した場合、対応する `Risky change opt-in` がない限り着手しません
  - 本文に `This issue is explicitly approved for auth changes.` のような明示文でも許可できます

## 現在は advisory のもの

- `Parallel group`
  - いまは記法だけを予約しています。将来の並列 scheduler 用です
- `Touches`
  - 依存関係や順序を直接 enforce するものではありません
  - ただし risky change class の検出入力には使われるため、`Touches: secrets` のような記述は explicit opt-in gate を発火させることがあります
- `Scope` / `Verification` の弱い書き方
  - `Scope` は「何を変えるか」に加えて「何を維持するか / 何を含めないか」もあると扱いやすいです
  - `Verification` は `run tests` のような抽象語だけでなく、具体的な command・test file・manual check target を書くのが推奨です

## 推奨運用

- 本当に前提 issue があるなら、`Execution order` だけに頼らず `Depends on` も書く
- DB migration や shared schema を触る issue は `Touches: prisma, core-api` のように広めに書く
- 同時に動かしてよい issue 群だけ同じ `Parallel group` を付ける
- 並列可能か迷う場合は、まず `Depends on` を付けて直列にする

## 例

```md
Part of #227
Depends on: #232
Parallel group: timeline-layout
Touches: web-ui, core-api, prisma
Risky change opt-in: migrations

## Execution order
7 of 15
```

---
name: Codex Execution-Ready Issue
about: Create a supervisor-runnable codex issue with canonical scheduling metadata
title: ""
labels: ["codex"]
assignees: []
---

<!--
Use this template for issues that should be runnable by codex-supervisor.

Standalone issue:
- leave Part of blank
- use Depends on: none
- use Parallelizable: No unless you are sure
- use Execution order: 1 of 1
- avoid raw workstation-local absolute path literals in issue text, tests, fixtures, or examples when placeholders or fragment-based strings would verify the same behavior

Sequenced child issue:
- fill Part of with the parent epic number
- use Depends on only for real prerequisites
- use explicit Execution order such as 2 of 4

Canonical reference:
- docs/issue-metadata.md
-->

## Summary

Explain one concrete behavior change.

## Scope

- describe what changes
- describe what must remain unchanged

<!-- Leave this line out only for standalone 1 of 1 issues. -->
Part of: #____

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria

- list the observable outcomes

## Verification

- `npm test -- path/to/focused.test.ts`

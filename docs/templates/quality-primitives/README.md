# Quality Primitive Templates

These templates are copyable adoption primitives for a new repository. Each file covers one adoption primitive and uses placeholders instead of host-specific paths, secrets, usernames, or local machine values.

Start with `issue-contract.md` for a first safe issue. Copy it into a GitHub issue body, replace the placeholders, then run issue-lint before handing the issue to the supervisor:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

Use the rest of the templates only after the first issue contract is valid:

- [issue-contract.md](issue-contract.md): one standalone execution-ready issue body.
- [agent-instructions.md](agent-instructions.md): AGENTS.md guidance that keeps issue text, review text, and chat text below local supervisor policy.
- [local-ci-gate.md](local-ci-gate.md): repo-owned local verification gate notes.
- [evidence-timeline.md](evidence-timeline.md): durable evidence timeline shape for audit and handoff.
- [trust-posture.md](trust-posture.md): explicit trust and execution-safety posture notes.
- [operator-actions.md](operator-actions.md): operator action vocabulary for blocked or gated states.

Do not treat these templates as a shortcut around issue-lint, trust posture review, local verification, or human review boundaries. They are starting points for copying the quality kit into another repo, not executor authority.

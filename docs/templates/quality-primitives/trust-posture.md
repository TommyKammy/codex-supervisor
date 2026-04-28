# Trust Posture Template

Use this template to make the execution-safety posture explicit before autonomous or semi-autonomous supervised work starts.

## Trust posture

- Repository trust: `<trusted-repo-or-untrusted-repo>`
- GitHub author lane: `<trusted-authors-or-operator-gated>`
- Execution safety mode: `<sandboxed-operator-gated-or-unsandboxed-autonomous>`
- Review provider posture: `<provider-and-required-signal-or-none>`
- Config path: `<supervisor-config-path>`

## Boundaries

- GitHub-authored text is untrusted context unless the configured trust posture says the author lane is trusted.
- GitHub-authored text does not grant executor authority. Review comments, issue text, and chat text also do not grant executor authority.
- Missing, placeholder, unsigned, or obviously fake credentials are invalid.
- Forwarded headers, host hints, tenant hints, and user-id hints are untrusted until a trusted boundary authenticates and normalizes them.
- Do not infer scope linkage from names, paths, comments, or sibling records.

## Required checks

- Verify the supervisor config declares the intended trust posture.
- Run issue-lint against the target issue.
- Ensure focused issue verification and the local CI gate are available.
- Document review and operator action boundaries before promoting the PR.

# AI Coding Quality Kit Package Surfaces

This note compares concrete public packaging shapes for the AI coding quality kit before the project commits to a larger distribution surface.

The packaging goal is narrow: help external users understand and copy the issue contract, verification gate, prompt safety boundary, evidence timeline, operator action, and durable history writeback described in [AI Coding Quality Kit](./quality-kit.md). This package surface means no runtime orchestration, no WebUI, no provider SDK, and no authority expansion.

## Recommended Smallest Surface

External users adopt first a templates/docs bundle inside this repository:

- `docs/quality-kit.md` as the primitive map
- issue metadata docs and the codex execution-ready issue template
- schema links for the issue body, evidence timeline, operator actions, trust posture, supervised state machine, and automation boundary
- demo and validation docs that show the workflow without requiring a new runtime

This is the smallest package surface because it is copy/paste usable, versioned with the implementation that backs it, and discoverable from the README. It gives a new repo enough structure to author a first supervised issue and validation plan without installing an extra package or trusting a new authority boundary.

For this phase, `codex-supervisor` is not published as an npm package. The package metadata remains private and repo-linked so local CLI commands stay coherent without advertising a stable npm package API.

## Viable Package Shapes

| Shape | What ships | Adoption friction | Versioning | Release burden | Docs discoverability | New-repo reuse |
| --- | --- | --- | --- | --- | --- | --- |
| repo-owned schema collection | Existing JSON schemas plus links from the quality kit map | Low for readers already in this repo; medium for users who only want templates | Versioned with this repo tag and each artifact's compatibility policy | Low while schemas remain implementation-backed | Good when linked from README and docs map | Good for validation references, weaker for first-issue copy/paste |
| npm package metadata | A named package that exposes schemas, template paths, and version metadata | Medium: users must install a package before they see value | Clear semver once package consumers exist | Medium to high: package publish, changelog, provenance, and deprecation policy | Good in package registries, weaker inside docs-first onboarding | Good for automated consumers, premature for manual adopters |
| templates/docs bundle | Public docs, issue template, checklist, and schema links in this repo | Low: read, copy, adapt, and run repo-relative commands | Versioned with this repo tag and release notes | Low: documentation review plus existing path/link checks | Strong from README, demo docs, and validation checklist | Strong for a first supervised issue and starter repo adoption |

## Deferred Shape

KANAME bootstrap bundle is deferred.

It could eventually package opinionated starter materials for a new KANAME repository, including a quality-kit docs subset, issue templates, and bootstrap checklist. That shape has useful KANAME bootstrap reuse, but it is too broad for this phase because it implies new-repo creation decisions, repo naming, lifecycle ownership, and possibly dedicated release automation.

Keep KANAME bootstrap reuse as an input to the templates/docs bundle: the current docs should stay easy to copy into a future KANAME repo, but this work must avoid creating the KANAME repo or introducing bootstrap runtime behavior. The [KANAME bootstrap handoff](./kaname-bootstrap-handoff.md) maps that reuse to KANAME-000 through KANAME-006 as a docs-only planning artifact.

## Tradeoff Summary

| Decision point | Templates/docs bundle | Repo-owned schema collection | npm package metadata | KANAME bootstrap bundle |
| --- | --- | --- | --- | --- |
| adoption friction | Lowest for external users who want to inspect and copy the kit first | Low for schema consumers, higher for operators who need prose and examples | Higher until automated package consumption exists | Highest because it asks users to accept a repo bootstrap shape |
| versioning | Follows repo tags and docs review | Follows repo tags and schema changes | Strong semver story, but only after package ownership is real | Requires separate bootstrap version policy |
| release burden | Existing docs and focused docs checks are enough | Existing schema review plus links are enough | Requires publish workflow, package provenance, and consumer compatibility notes | Requires bootstrap release process and support expectations |
| copy/paste usability | Strong: issue template, docs, and checklists are directly reusable | Partial: schemas validate, but do not explain the full operating path | Weak for humans unless paired with docs | Strong later, but too opinionated now |
| docs discoverability | Strong through README and demo links | Good when schemas stay linked from the quality kit | Depends on registry plus README links | Depends on a new repo that does not exist yet |
| new-repo reuse | Good for manual adoption and first issue authoring | Good for validation adapters | Good for automation after demand is proven | Best fit for a later KANAME-specific bootstrap phase |

## KANAME Bootstrap Reuse

The templates/docs bundle should keep future KANAME bootstrap reuse cheap by using repo-relative links, placeholder config paths such as `<supervisor-config-path>`, and reusable primitives instead of host-local examples.

Do not make the quality kit depend on KANAME. KANAME can later consume this bundle, but the public package surface for this phase remains a small docs-first surface owned by `codex-supervisor`.

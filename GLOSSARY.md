# Review Deck

An Azure DevOps extension for reviewing pull requests and browsing what a repository has shipped. It uses Azure DevOps' own terms, even where they're overloaded.

## Language

### Tags

**PR tag**:
A label on a pull request, with a color and description kept by the extension. Azure DevOps calls it a "tag".
_Avoid_: Label

**Git tag**:
A named ref in a repository that points at a commit. Azure DevOps also calls it a "tag".

**Tag convention**:
The project's pattern for git tags that mark versions (for example `v*` semver). Git tags that don't match are ignored.

### Releases

**Release**:
A git tag that follows the tag convention and whose latest publishing pipeline run succeeded (fully or partially) and produced Artifacts.
_Avoid_: Version

**Changelog**:
The generated notes for a git tag. They list each commit since the previous matching git tag, grouped by conventional-commit type, and anything that isn't conventional goes under "Other changes".
_Avoid_: Release notes

**Previous tag**:
The git tag a Changelog starts from. For a stable version it's the previous stable version, and for a prerelease it's the tag immediately before it in semver order.

**Release description**:
Text written by hand that appears above a git tag's Changelog. If nobody has written one, the annotated tag's message is used.

**Publishing pipeline**:
The pipeline chosen for a repo whose runs on a git tag turn it into a Release. If none is chosen, any pipeline run on the tag counts.
_Avoid_: Release pipeline (that name belongs to Azure DevOps classic releases)

**Artifact**:
A named set of files published by one pipeline run. A Release's Artifacts are those published by its latest publishing pipeline run, and each one can be downloaded whole or file by file. This is Azure DevOps' term.
_Avoid_: Asset

### Reviews

**Guide**:
A pull request comparison's changes grouped by concern and put in reading order: the Guided view. It's saved in extension data for everyone who opens that comparison.
_Avoid_: Grouping (in UI copy)

**Published guide**:
A guide another app wrote for Review Deck to show, today only Ajour (`madeWith.app: "ajour"`). It shows whatever the reader's backend and AI-title settings are, as long as it covers the comparison's hunks. Review Deck never replaces it on its own: a reader who regroups gets their own guide for the session, and only **Publish** puts that guide in its place.

**Summary**:
What a published guide says above the guide: the problem the pull request fixes, its kinds of change, breaking changes, risky areas, test coverage and leftovers.
_Avoid_: Description (that's the author's text on the pull request)

### Infrastructure

**Infra view**:
The Infra tab and the Overview's Infrastructure card: what a pull request comparison changes in Terraform or OpenTofu, read from its changed files. Never from a plan or the state.

**Block**:
One addressable piece of Terraform configuration: a resource, data source, module, variable, local or output. Compared across the two sides of a comparison by its address (`azurerm_storage_account.uploads`).

**Risk**:
What the Infra view says may happen to a resource beyond an update in place: a **destroy**, a **replace** (destroyed and created again), or **may follow** (it uses a resource that may be destroyed or replaced). It is a reading of the code, with a certainty (likely or possible) and a reason.
_Avoid_: Plan, action (those are what `terraform plan` reports, which the Infra view doesn't have)

**Neighbour**:
An unchanged resource drawn next to a changed one because the change involves it. One declared in a file the pull request doesn't change is known by its address alone.

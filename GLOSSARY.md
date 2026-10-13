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

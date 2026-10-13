# Stacked PRs and auto-restack

A **stack** is a chain of PRs where each one targets the previous one's branch:

```
main  ←  !1 feature/a  ←  !2 feature/b  ←  !3 feature/c
```

## Trunk branches

Trunk branches are where stacks end. A PR into a trunk branch is the bottom of a stack, and
auto-restack never rewrites a trunk branch. They're set per project in **Project settings → Review Deck**
(**Edit**, project administrators only), one pattern per line:

| Pattern | Matches |
| --- | --- |
| `main`, `dev`, `uat` | exactly that branch |
| `*/00-*` | `release/00-q4` (`*` stays within one folder), not `a/b/00-x` |
| `release/**` | anything under `release/` |

The default is `main` and `master`. Matching is case-insensitive, like Azure DevOps refs. A PR
*from* a trunk branch (`dev → uat`) is a promotion, not a stack layer, so it's never restacked.

## What the extension shows

- **PR page:** a bar under the header ("Stack · 3 of 4", with steps to the layers below and above
  and the last restack result). The Overview sidebar shows the whole stack, Graphite-style: newest on
  top, the base branch underneath, each layer's review state, checks and restack status. Forks (two
  PRs on the same parent) are shown under their parent.
- **Hub:** a `2/4` chip on stacked PRs, orange when the last auto-restack failed.
- A layer whose target branch has no open PR (its parent merged or was abandoned) is flagged.

Stacks are computed from the project's open PRs (`src/stack/stacks.ts`), so they need no setup.

## Auto-restack

When **Auto-restack** is on for a project, the backend keeps every layer based on the current tip of
the layer below. It uses Azure DevOps' server-side Git operations, with no clone or pipeline
(`src/stack/restack.ts`, `backend/src/stacks/`):

- **A layer gets new commits** (or is force-pushed): for each PR targeting that branch, the commits
  that are only in that PR are cherry-picked onto the new tip (Cherry Picks API). Then its branch is
  moved there (Refs API, guarded by the old commit). That move restacks the layer above it, and so on
  up the stack.
- **A layer merges** (including squash merges): the PRs on top of it are restacked onto the branch it
  merged into, then retargeted there.
- **When it can't** (a conflict, merge commits inside a layer, a missing permission, or someone pushed
  mid-restack): that layer and the ones above stay unchanged. The PR gets a failed **restack** status
  and, for conflicts, a comment with the `git rebase --onto` command to run locally.
- **When it can't retarget** after a merge (usually because another active PR already merges the same
  branch into the new target, which Azure DevOps forbids): the branch is still moved, and the PR gets
  a failed status naming the other PR. Abandon one of them.

Every PR it touches gets a `review-deck/restack` status, shown with the PR's checks.

### How events reach the backend

Turning the toggle on registers two service hooks for the project (`git.push` and
`git.pullrequest.updated`), signed in as the admin who flips it, so they need "Edit subscriptions"
on the project:

1. The hooks POST to `/api/hooks/ado?org=<org>` with an `X-Review-Deck-Hook` secret
   (HMAC of `HOOK_KEY` and the organization). The function only queues the job and answers at once.
2. The `restack` queue runs jobs one at a time. Each job re-reads the project's settings and the
   repository state, so a replayed or forged event can't restack anything that isn't behind.

Turning it off removes the hooks. Each toggle replaces the project's hooks rather than adding to
them, so toggling off and on also cleans up duplicates.

The function writes its logs to `LogFiles/Application/Functions/Function/restack/` (Kudu, or
`az webapp log tail`), which is where a job's error ends up when it fails before it can post a status.

### Setup

1. **Deploy the backend** with Terraform (`infra/`). That generates `HOOK_KEY`. An organization
   administrator connects it in **Project settings → Review Deck → Backend** (see `docs/azure-backend.md`).
2. **Give the backend an Azure DevOps identity.** Choose one:
   - **Managed identity:** your organization must be connected to Microsoft Entra ID. Add the Function
     App's identity (`terraform output restack_identity`) as a user in **Organization settings →
     Users**, with Basic access.
   - **PAT:** set `ado_pat` in `terraform.tfvars` to a token from a service account, with scopes
     *Code (read, write & manage)*, *Code (status)* and *Extension data (read)*. It's stored in the
     Terraform state and the app settings, so prefer the managed identity.
3. **Permissions for that identity:** in **Project settings → Repositories → (repository or all
   repositories) → Security**:
   - **Contribute**, **Create branch** and **Contribute to pull requests**: allow.
   - **Force push (rewrite history and delete branches)**: allow. Restacking moves branches to
     rewritten history. You can grant it on a branch folder only (for example `feature/`) instead of
     the whole repository. Layers outside it then fail with a clear status rather than being changed.
   - Leave trunk branches protected; auto-restack never moves them anyway.
4. **Read access to the extension's settings:** the identity reads the project's stack settings from
   extension data. I expect organization members to be able to read it, but haven't confirmed that
   for a managed identity. If the backend logs a 401 or 403 from `extmgmt.dev.azure.com`, this is why.
5. A project administrator opens **Project settings → Review Deck** and turns on **Auto-restack**.

### Limits

- **No conflict resolution:** conflicts are reported, never resolved.
- **Linear layers only:** a layer containing merge commits is skipped, because the server can only
  replay linear history.
- **Layer size:** at most 200 commits per layer (the backend walks them one by one).
- **Forks:** both children of a forked layer are restacked.
- **Not run end to end:** checked with unit tests against an in-memory Git model
  (`extension/tests/stack.test.ts`), not yet against a live organization.

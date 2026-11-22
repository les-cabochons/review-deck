# Demo-only pull requests

Pull requests the local demo shows (`npm run ext:demo`) that are not grouping fixtures: they have no hand-written
truth, and `npm run eval` never reads them. Each folder holds both sides of the files the pull request changes,
in `base/` and `head/`. A file in only one of them is added or deleted.

- `infra-pr`: Terraform changes that show every state of the Infra view: a likely replace, a resource that may
  follow it, a destroy, an added resource, and a change in place.

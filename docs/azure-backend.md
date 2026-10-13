# Backend on Azure: group titles and embeddings

The review page groups hunks in its browser worker. With this backend it gets two more things:

- **Group titles from a small LLM** (gpt-5-nano on Azure OpenAI), **opt-in per project**. The model reads
  each group's changed lines and writes a commit-style title and a one-sentence rationale. This uses the
  same prompt as `npm run review -- --llm claude` (`src/title/prompt.ts`). Otherwise titles come from heuristics.
- **Sentence embeddings for grouping** (MiniLM, int8, run on the function's own CPU). This is the semantic
  signal from `--embeddings`, which raised mean grouping ARI from 0.931 to 0.948 on the synthetic PRs.

## Per-project AI opt-in

Some projects have policies against sending code to AI services, so LLM titles are **off by default** in
every project. A project administrator turns them on with the **AI group titles** toggle in **Project settings →
Semantic PR Review**. The toggle is disabled when the extension was built without a backend URL.

- The page calls `/api/titles` only when its project's setting is on. If the setting can't be read, the page treats it as off.
- Embeddings are not covered by the switch. They stay on wherever the backend is configured, because the
  embedding model runs inside the function and hunk text never reaches an external AI service.
- The setting is stored in Azure DevOps extension data (collection `project-settings`, one document per project ID).
- The toggle is enabled only for users with "Edit project-level information" on the project (Project
  Administrators). This is checked with the permission evaluation API. If that check fails, the toggle stays disabled.
- **Limit:** extension data has no access control of its own. A project member who calls the extension
  data REST API directly could change the setting. The UI won't let them, but Azure DevOps doesn't stop them.
  Treat the switch as a project policy setting, not a security boundary.

Pieces:
- `backend/`: one Azure Function (Node 22).
  - `POST /api/titles {"context", "groups"}` returns `{"titles": [{id, title, rationale}], "cached"}`.
    The function builds the prompt itself from the hunks' changed lines, with at most 40 groups and 200 hunks.
  - `POST /api/embed {"texts": [...]}` returns `{"vectors": [[...384 floats]]}` for at most 2,000 texts.
  - `GET /api/warm` loads the embedding model. The page calls it first, so the cold start overlaps fetching files.
  - Every call needs `Authorization: Bearer <SDK.getAppToken()>`, an HS256 token signed with the
    extension's certificate secret. Only users of organizations with the extension installed can call it.
- `infra/`: Terraform for the resource group, storage account, Windows Consumption plan, Function App,
  Azure OpenAI resource with a gpt-5-nano deployment, and a $1 budget alert.

If anything fails, the page falls back and logs `[semantic-pr] …` to the console. That covers a missing
backend, a timeout, a spent budget (429), or a PR too large for the limits. Failed titles fall back to
heuristic titles. Failed embeddings fall back to structural grouping.

## Spending caps for AI titles

Title spend is capped at three levels. The function checks all three before each model call and returns
429 once any is reached. The page then shows rule-based titles.

| Cap | Default | Period | Set in |
| --- | --- | --- | --- |
| Whole backend | $0.025 | UTC day | `titles_daily_budget_usd` |
| Per organization | $0.50 | UTC month | `titles_caps.org_monthly_usd`, or `orgs.<org>.monthly_usd` |
| Per project | $0.25 | UTC month | `titles_caps.project_monthly_usd`, `orgs.<org>.project_monthly_usd`, or `orgs.<org>.projects.<project>` |

```hcl
titles_caps = {
  org_monthly_usd     = 0.5
  project_monthly_usd = 0.25
  orgs = { cabochons = { monthly_usd = 1, projects = { Semantic_pr = 0.5 } } }
}
```

- Org and project keys are names and are case-insensitive. A project can also be keyed by its ID.
- Spend is tracked per organization name and project ID, in the `usage` table.
- The hub's AI toggle shows this month's spend against the project and organization caps, and says when a cap is used up.
- Cache hits cost nothing and don't count against any cap.
- Cached answers are kept per organization, so one organization never gets another's.
- **Limit:** the organization and project come from the page. The token proves the caller uses the
  extension, but not which project they're in. Someone who forges requests could charge another project's
  budget. They still can't go past the daily cap for the whole backend, which is the real ceiling.

## Cost

Estimates are for 1,000 PRs a month, each viewed about 5 times over about 2 iterations.

| Item | Expected | Hard limit |
| --- | --- | --- |
| Titles (gpt-5-nano, $0.05 / $0.40 per M input/output tokens) | ~2.2k input + ~300 output tokens per PR iteration ≈ $0.0002. Same groups = same prompt = served from the Table cache, so ~2,000 calls ≈ **$0.45**. | `titles_daily_budget_usd` ($0.025/day): the function returns 429 until UTC midnight. At most ~$0.78/month. Monthly caps per organization and project sit under it (see above). The Azure OpenAI resource has keys disabled and accepts only the function's managed identity, so nothing can bypass the cap. |
| Function compute (GB-s) | ~5k–25k GB-s, within the 400k GB-s monthly free grant: **$0** | `daily_gb_seconds_quota` (2,000/day) stops the app for the day. |
| Executions | ~20k, within the free 1M: **$0** | One instance (`app_scale_limit`). |
| Storage (package, keys, title cache, spend counter) | A few cents. | — |
| Egress, Application Insights | $0 (none for App Insights). | — |

Expected total: **~$0.50/month**. The budget alert emails you at 50% of $1 (actual) and 100% (forecast).

Notes on the limits:
- Title caps are checked before each call, so each one can be exceeded by at most one call (~$0.001).
- The compute quota is a backstop. Without the free grant, its ceiling alone would be ~$0.99/month. With the grant, compute is free.
- Requests with an invalid token get a quick 401 but still count as executions ($0.20 per million beyond 1M).

### Why gpt-5-nano and not Gemma or GLM

On Azure, GLM is only offered as large GLM 5.x models. Gemma needs a GPU: a VM, or a serverless-GPU
container billed per second, with 1–2 minute cold starts. Either way it costs well over $1 at this volume.
gpt-5-nano is the cheapest pay-per-token model Azure sells. The prices are third-party figures, so check
the [Azure OpenAI pricing page](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) and update
`titles_price_per_million` if they differ. The function uses those numbers to track its daily spend.

### Why Windows Consumption (Y1)

Only Windows Consumption supports `daily_memory_time_quota`, a cap the platform enforces. Flex
Consumption has no spending cap, and Linux Consumption is being retired.

## Deploy

Prerequisites:
- Terraform ≥ 1.6 and the Azure CLI (`az login` as someone who can assign roles, e.g. subscription Owner).
- The extension secret: go to [Marketplace › Manage publishers](https://marketplace.visualstudio.com/manage/publishers/cabochonio),
  open the ⋯ menu on *Semantic PR Review*, and choose **Certificate**.

```sh
cp infra/terraform.tfvars.example infra/terraform.tfvars   # fill in subscription, secret, email
just deploy-backend        # npm run backend:build, then terraform init + apply
terraform -chdir=infra output backend_url
```

`openai_location` (default `eastus2`) must offer gpt-5-nano as a Global Standard deployment. The
package (~92 MB unzipped) contains the bundled code, the embedding model, and only the Windows x64 ONNX
binaries. Terraform names the zip after its content hash, so `apply` redeploys only on change. State is
local (`infra/terraform.tfstate`, git-ignored).

Then build the extension with the URL:

- CI: set the repository variable `SEMANTIC_PR_BACKEND_URL`. The publish job passes it to `ext:build`.
- Locally: `SEMANTIC_PR_BACKEND_URL=https://func-….azurewebsites.net npm run ext:package`.
- Dev server: add `?backend=http://localhost:7071` to use a local `func start` in `backend/.build/app`,
  with Azurite for storage. Without `EXTENSION_SECRET`, a local run skips the token check (a deployed app rejects
  every request). Set `OPENAI_ENDPOINT` and `OPENAI_API_KEY` to try titles locally.

If the extension's publisher changes, update `allowed_origins` (CORS) in `infra/variables.tf`.

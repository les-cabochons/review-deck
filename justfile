default:
    @just --list

dev:
    npm run ext:dev

check:
    npm run typecheck
    npm run lint:boundaries
    npm test
    npm run ext:typecheck
    npm run ext:test
    npm run backend:typecheck
    npm run browser:typecheck
    npm run browser:test

build:
    npm run ext:build

review *args:
    npm run review -- {{args}}

evaluate *args:
    npm run eval -- {{args}}

package:
    npm run ext:package

# Regenerates the Infra view's list of azurerm arguments that force a new resource, from the provider's latest release docs.
force-new-list *version:
    npx tsx scripts/build-force-new.ts {{version}}

# Backend function (backend/: titles + embeddings) on Azure, via infra/. Needs infra/terraform.tfvars and `az login`.
deploy-backend:
    npm run backend:build
    terraform -chdir=infra init -input=false
    terraform -chdir=infra apply

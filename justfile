default:
    @just --list

dev:
    npm run ext:dev

check:
    npm run typecheck
    npm run ext:typecheck
    npm run ext:test
    npm run backend:typecheck

build:
    npm run ext:build

review *args:
    npm run review -- {{args}}

evaluate *args:
    npm run eval -- {{args}}

package:
    npm run ext:package

# Backend function (backend/: titles + embeddings) on Azure, via infra/. Needs infra/terraform.tfvars and `az login`.
deploy-backend:
    npm run backend:build
    terraform -chdir=infra init -input=false
    terraform -chdir=infra apply

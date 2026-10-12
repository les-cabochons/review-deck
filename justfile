default:
    @just --list

dev:
    npm run ext:dev

check:
    npm run typecheck
    npm run ext:typecheck
    npm run ext:test

build:
    npm run ext:build

review *args:
    npm run review -- {{args}}

evaluate *args:
    npm run eval -- {{args}}

package:
    npm run ext:package

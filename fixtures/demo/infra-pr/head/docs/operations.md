# Operations

## Avatars

Uploads land in the `avatars` container. Each upload puts a message on the `avatar-resize` queue, and the
function app resizes it to the widths in `avatar_sizes`.

## Audit trail

The audit trail moved to the platform team's log workspace. The `audit` table is gone.

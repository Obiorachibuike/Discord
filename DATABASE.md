# Database and migrations

Cove uses **PostgreSQL 16** as its durable source of truth. The Prisma schema is `packages/db/prisma/schema.prisma`; the **version-controlled** initial migration is `packages/db/prisma/migrations/20261020204500_initial/migration.sql`. `packages/db/src/index.ts` exports one Prisma Client using the PostgreSQL driver adapter (`engineType = "client"`). All IDs are UUIDs. Neither an in-memory mock database nor a seeded demo account is required for the application to function.

## Main entities

- `User`, `Account`, `Session`, `VerificationToken`: identities, optional OAuth link, opaque session/CSRF **hashes**, expiring verification/reset tokens.
- `Server`, `ServerMember`, `Role`, `RolePermission`, `MemberRole`, `ChannelCategory`, `Channel`, `ChannelPermissionOverride`: communities, membership, position-ordered roles and permissions, channels/categories, per-role or per-user allow/deny overrides.
- `Invitation`, `ServerBan`: hashed expiring/limited-use invite and ban enforcement.
- `Message`, `MessageAttachment`, `MessageReaction`, `MessagePin`: one authorized destination, durable content/metadata, file association, reactions and pin state. Soft-deleted messages have `deletedAt` and empty serialized content; reply references may remain.
- `Friendship`, `UserBlock`, `Conversation`, `ConversationMember`: canonical friend pairs, blocks, direct/group membership, per-user `lastReadAt`.
- `Notification`, `ModerationAction`, `ModerationReport`, `AuditLog`: deduplicated notices, actions/reports and community security history.

The migration contains additional PostgreSQL constraints beyond Prisma's schema DSL: every message has **exactly one** channel/conversation; friendship keys are canonical and non-self; a block cannot target the same user; an override belongs to **exactly one** role/user and cannot simultaneously allow and deny the same permission; invitation uses cannot exceed limits; attachments have positive size; reports have a target; direct/group keys match their kind. Partial unique indexes protect role/user overrides. An index on `(authorId,clientNonce)` enforces message idempotency. Channel/conversation message indexes support descending `(createdAt,id)` cursor paging; a partial **GIN full-text index** supports search over non-deleted channel messages. Search always intersects that index with authorized channel IDs.

## Apply and evolve

```bash
# PostgreSQL must be running; set DATABASE_URL in .env or environment.
npm ci
npm run db:validate
npm run db:deploy       # official Prisma migrate deploy, production preference
```

On restricted local hosts where Prisma's native schema engine cannot be fetched, **only for the committed SQL** use `npm run db:local-deploy`. It records Prisma-compatible migration checksums in `_prisma_migrations` and refuses a changed or failed migration. Do **not** edit an applied SQL migration or use the fallback to generate new SQL. In a normal development environment, change `schema.prisma`, run `npm run db:migrate`, inspect generated SQL/constraints/indexes, test against a disposable DB, and commit the new migration. Never call `prisma db push` against production as a substitute for migrations.

`npm run db:local-deploy` executes files in a transaction and tracks applied versions. It is intentionally simpler than the official Prisma schema engine and should not replace production migration review. Use a privileged migration role separately from the least-privilege application DB role in production.

## Test isolation

`npm run test:integration` and `npm run test:e2e` invoke `scripts/prepare-test-db.mjs`. It **drops and recreates** a database only if its name matches `*_test`, migrates it, then runs tests. Default: `cove_test` on `127.0.0.1:5432`. Override with `TEST_DATABASE_URL` ending in `_test`. The development `cove` database is not reset by these commands. Do not run both test commands simultaneously against the same `_test` database. Browser E2E starts an API connected to this test DB, plus its own web server on ports 4100/3100.

## Data lifecycle and operations

- Back up **both** PostgreSQL and external object storage. Example: `pg_dump --format=custom "$DATABASE_URL" > cove-YYYYMMDD.dump`, encrypted and stored outside the app host. Regularly test `pg_restore` in a staging database and verify object keys still match attachments. Stop writes or take a consistent snapshot for cross-system recovery.
- Add migrations using expand/contract techniques on live installations (create/backfill/read-switch/remove) rather than dropping active columns. Maintain index health and monitor connection-pool limits, transaction latency, table growth and GIN index size.
- With Redis, BullMQ runs an hourly job removing up to 100 **unclaimed** uploads older than 24 hours. Without Redis, schedule `npm run cleanup:orphans`. Cleanup rechecks references under a row lock; profile/icon assignments hold a shared lock so the cleanup cannot delete a newly assigned file. Provider deletion and PostgreSQL are not one atomic transaction: backup and reconcile both systems after partial failures, and keep older provider credentials until its objects have been migrated. Database cascades on community/channel deletion can leave externally stored blobs unreferenced; configure object-store lifecycle or add a reconciliation worker before production retention commitments. There is no self-service account-erasure flow in this release.
- Presence is intentionally ephemeral, in Redis when configured or process memory for one instance. Messages, membership, blocks and permissions are never stored solely in Redis or browser state.

# Database

PostgreSQL via **Prisma** (`packages/database`). SQL migrations live in
`packages/database/prisma/migrations/` and are applied with a plain SQL runner
(`src/migrate.ts`) — no interactive Prisma CLI needed in constrained environments.

## Setup

```bash
npm run generate --workspace @aether/database   # generate the client
npm run migrate                                 # apply all migrations
npm run seed                                    # demo data (ada/grace/alan/katherine)
npm run reset --workspace @aether/database      # drop + recreate (dev only!)
```

With no local PostgreSQL, `node scripts/run-app.mjs` boots an embedded one (data in
`.pg-data/`, ignored by Git).

## Models

### Identity
| Model | Purpose |
| --- | --- |
| `User` | account (email, username, Argon2id `passwordHash`, avatar, status, settings JSON) |
| `Account` | linked OAuth accounts (Google) |
| `Session` | opaque token sessions (HTTP-only cookie), expiry + revocation |
| `VerificationToken` | email verification & password reset tokens (single-use, hashed) |

### Servers
| Model | Purpose |
| --- | --- |
| `Server` | guild; `ownerId` |
| `ServerMember` | membership, nickname, `timeoutUntil` |
| `Role` | name, color, `permissions: Decimal` (bigint bits), hoist/mentionable, position |
| `MemberRole` | member ↔ role assignment |
| `ChannelCategory` | grouping + ordering |
| `Channel` | TEXT/VOICE/ANNOUNCEMENT, `isPrivate`, topic, position |
| `ChannelPermissionOverride` | per-role / per-member allow/deny masks |
| `Invitation` | code, maxUses, uses, expiresAt |

### Messaging
| Model | Purpose |
| --- | --- |
| `Message` | content, author, `channelId`?/`conversationId`?, `replyToId`, `clientId` (idempotency), editedAt |
| `MessageAttachment` | file metadata + storage key/URL (`messageId` nullable — uploaded before send) |
| `MessageReaction` | emoji per user per message (unique) |
| `MessagePin` | pins per channel |
| `ChannelReadState` | per-user last-read marker |

### Social
| Model | Purpose |
| --- | --- |
| `FriendRequest` | PENDING/ACCEPTED/REJECTED with sender/recipient |
| `UserBlock` | blocker ↔ blocked |
| `Conversation` | DIRECT/GROUP |
| `ConversationMember` | membership |
| `ConversationReadState` | per-user last-read |
| `Notification` | DM/MENTION/FRIEND_REQUEST/INVITE/MODERATION rows with read state |

### Moderation
| Model | Purpose |
| --- | --- |
| `ModerationAction` | KICK/BAN/UNBAN/TIMEOUT records with actor + reason |
| `ModerationReport` | user reports + review status |
| `AuditLog` | server audit trail |
| `BanEntry` | active bans (serverId + userId unique) |

## Conventions

- **IDs**: cuid-style strings (`cuid()`), opaque to clients.
- **Money/permissions**: role permission masks are stored as `Decimal` to hold 64-bit
  bitflags losslessly in Prisma.
- **Timestamps**: `createdAt`/`updatedAt` (DateTime); DTOs serialize ISO strings.
- **Cascades**: deleting a server removes channels/messages/memberships via FK cascade;
  deleting a user anonymizes-or-cascades per FK rules in the migration.
- **Pagination**: every message/list endpoint is cursor-based (id cursors). Message pages
  return `items` **ascending** in transcript order with `nextCursor` pointing past the
  boundary (oldest id for `direction=before`, newest for `after`).

## Full-text search

`Message.searchVector` is a generated tsvector column (weighted A/B on content/author) with
a GIN index. `message.service.search` runs `websearch_to_tsquery` and intersects with the
caller's visible-channel set — search never leaks private channel content.

## Migrations workflow

1. Edit `prisma/schema.prisma`.
2. Create `prisma/migrations/<timestamp>_<name>/migration.sql` by hand or with
   `npx prisma migrate dev` where the Prisma CLI is available.
3. `npm run migrate` applies pending SQL in lexical order inside a transaction each.
4. Keep migrations backward-compatible for one release (add columns nullable/backfilled,
   then tighten).

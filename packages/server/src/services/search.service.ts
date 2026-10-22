import type { SearchMessagesInput, MessageDTO } from '@aether/shared';
import { prisma } from '../context.js';
import { toMessageDTO } from '../utils/dto.js';
import { permissions } from './permission.service.js';

export class SearchService {
  /**
   * PostgreSQL full-text search over messages the user is allowed to see.
   * Private-channel content never leaks: results are limited to channel ids
   * from `visibleChannelIds` (and DMs the user participates in).
   */
  async searchMessages(userId: string, input: SearchMessagesInput) {
    const limit = input.limit ?? 25;

    // Resolve searchable channel ids with authorization applied.
    let channelIds: string[] = [];
    if (input.channelId) {
      const ok = await permissions.canViewChannel(input.channelId, userId);
      if (ok) channelIds = [input.channelId];
    } else if (input.serverId) {
      channelIds = await permissions.visibleChannelIds(input.serverId, userId);
    } else {
      const memberships = await prisma.serverMember.findMany({
        where: { userId },
        select: { serverId: true },
      });
      for (const m of memberships) {
        channelIds.push(...(await permissions.visibleChannelIds(m.serverId, userId)));
      }
    }
    const convs = await prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    if (!channelIds.length && !convs.length) {
      return { items: [] as MessageDTO[], nextCursor: null };
    }

    const filters: string[] = [];
    const params: unknown[] = [];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    const tsExpr = `websearch_to_tsquery('simple', ${push(input.q)})`;
    filters.push(`m."searchVector" @@ ${tsExpr}`);

    const cond: string[] = [];
    if (channelIds.length) {
      cond.push(`m."channelId" IN (${channelIds.map((c) => push(c)).join(',')})`);
    }
    if (convs.length) {
      cond.push(`m."conversationId" IN (${convs.map((c) => push(c.conversationId)).join(',')})`);
    }
    filters.push(`(${cond.join(' OR ')})`);

    if (input.authorId) filters.push(`m."authorId" = ${push(input.authorId)}`);
    if (input.after) filters.push(`m."createdAt" >= ${push(input.after)}::timestamptz`);
    if (input.before) filters.push(`m."createdAt" <= ${push(input.before)}::timestamptz`);
    if (input.cursor) {
      filters.push(`m."id" < ${push(input.cursor)}`);
    }

    const sql = `
      SELECT m."id"
      FROM "Message" m
      WHERE ${filters.join(' AND ')}
      ORDER BY m."createdAt" DESC, m."id" DESC
      LIMIT ${push(limit + 1)}
    `;
    const result = await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
    const hasMore = result.length > limit;
    const ids = result.slice(0, limit).map((r) => r.id);
    if (!ids.length) return { items: [] as MessageDTO[], nextCursor: null };

    const full = await prisma.message.findMany({
      where: { id: { in: ids } },
      include: {
        author: true,
        replyTo: { include: { author: true } },
        attachments: true,
        reactions: true,
        pins: true,
      },
    });
    const byId = new Map(full.map((m) => [m.id, m]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => toMessageDTO(m, userId));
    return {
      items,
      nextCursor: hasMore ? ids[ids.length - 1]! : null,
    };
  }
}

export const search = new SearchService();

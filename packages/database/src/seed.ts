/**
 * Development seed data. Run with `npm run db:seed`.
 * Creates demo users (password: Passw0rd!demo for all), a community server
 * with roles, categories, channels and messages, plus friend/DM data.
 */
import { hash } from '@node-rs/argon2';
import { createPrisma } from './client.js';
import { runMigrations } from './migrate.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  Permissions,
} from '@aether/shared';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await runMigrations(url);
const prisma = createPrisma(url);

const passwordHash = await hash('Passw0rd!demo', { algorithm: 2 });

const users = [
  { username: 'ada', displayName: 'Ada Lovelace', email: 'ada@aether.dev', bio: 'Building analytical engines.' },
  { username: 'grace', displayName: 'Grace Hopper', email: 'grace@aether.dev', bio: 'Compilers & debugging.' },
  { username: 'alan', displayName: 'Alan Turing', email: 'alan@aether.dev', bio: 'Enigma enthusiast.' },
  { username: 'katherine', displayName: 'Katherine Johnson', email: 'katherine@aether.dev', bio: 'Orbital mechanics.' },
];

const createdUsers: Record<string, string> = {};
for (const u of users) {
  const user = await prisma.user.upsert({
    where: { username: u.username },
    update: {},
    create: {
      ...u,
      passwordHash,
      emailVerifiedAt: new Date(),
      presenceStatus: 'ONLINE',
    },
  });
  createdUsers[u.username] = user.id;
}

const existing = await prisma.server.findFirst({ where: { name: 'Aether HQ' } });
if (!existing) {
  const server = await prisma.server.create({
    data: {
      name: 'Aether HQ',
      description: 'The official demo community for the Aether platform.',
      ownerId: createdUsers.ada!,
      members: {
        create: Object.values(createdUsers).map((userId) => ({ userId })),
      },
      roles: {
        create: [
          { name: 'Administrator', permissions: ALL_PERMISSIONS, position: 3, color: '#e11d48' },
          { name: 'Moderator', permissions: DEFAULT_ROLE_PERMISSIONS.Moderator, position: 2, color: '#2563eb' },
          { name: 'Member', permissions: DEFAULT_ROLE_PERMISSIONS.Member, position: 1, isDefault: true },
        ],
      },
      categories: {
        create: [
          { name: 'Welcome', position: 0 },
          { name: 'Projects', position: 1 },
        ],
      },
    },
    include: { categories: true },
  });

  const welcome = server.categories.find((c) => c.name === 'Welcome')!;
  const projects = server.categories.find((c) => c.name === 'Projects')!;
  await prisma.channel.createMany({
    data: [
      { serverId: server.id, categoryId: welcome.id, name: 'general', type: 'TEXT', position: 0, topic: 'Say hi 👋' },
      { serverId: server.id, categoryId: welcome.id, name: 'announcements', type: 'ANNOUNCEMENT', position: 1 },
      { serverId: server.id, categoryId: welcome.id, name: 'hangout', type: 'VOICE', position: 2 },
      { serverId: server.id, categoryId: welcome.id, name: 'mod-chat', type: 'TEXT', position: 3, isPrivate: true },
      { serverId: server.id, categoryId: projects.id, name: 'engineering', type: 'TEXT', position: 0 },
      { serverId: server.id, categoryId: projects.id, name: 'design', type: 'TEXT', position: 1 },
    ],
  });

  const channels = await prisma.channel.findMany({ where: { serverId: server.id } });
  const roles = await prisma.role.findMany({ where: { serverId: server.id } });

  // Private channel: restrict to Administrator + Moderator roles.
  const modChannel = channels.find((c) => c.name === 'mod-chat');
  const adminRole = roles.find((r) => r.name === 'Administrator');
  const modRole = roles.find((r) => r.name === 'Moderator');
  if (modChannel && adminRole && modRole) {
    await prisma.channelPermissionOverride.createMany({
      data: [
        { channelId: modChannel.id, roleId: adminRole.id, allow: ALL_PERMISSIONS },
        {
          channelId: modChannel.id,
          roleId: modRole.id,
          allow: Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES,
        },
      ],
    });
  }

  const general = channels.find((c) => c.name === 'general');
  if (general) {
    await prisma.message.createMany({
      data: [
        { channelId: general.id, authorId: createdUsers.ada!, content: 'Welcome to Aether HQ! 🎉' },
        { channelId: general.id, authorId: createdUsers.grace!, content: 'Glad to be here. The ship is compiling nicely.' },
        { channelId: general.id, authorId: createdUsers.alan!, content: 'Anyone up for voice later?' },
      ],
    });
  }
  console.log(`Seeded server ${server.id}`);
}

// Friendships & DMs
const ada = createdUsers.ada!;
const grace = createdUsers.grace!;
const req = await prisma.friendRequest.findUnique({
  where: { senderId_recipientId: { senderId: grace, recipientId: ada } },
});
if (!req) {
  await prisma.friendRequest.create({
    data: { senderId: grace, recipientId: ada, status: 'ACCEPTED', respondedAt: new Date() },
  });
}
const directKey = [ada, grace].sort().join(':');
const dm = await prisma.conversation.upsert({
  where: { directKey },
  update: {},
  create: {
    type: 'DIRECT',
    directKey,
    members: { create: [{ userId: ada }, { userId: grace }] },
  },
});
const lastMsg = await prisma.message.findFirst({ where: { conversationId: dm.id } });
if (!lastMsg) {
  await prisma.message.create({
    data: { conversationId: dm.id, authorId: grace, content: 'Hey Ada — ready for the demo?' },
  });
}

console.log('Seed complete.');
console.log('Demo accounts (password for all: Passw0rd!demo):');
for (const u of users) console.log(`  - ${u.email} / ${u.username}`);
await prisma.$disconnect();

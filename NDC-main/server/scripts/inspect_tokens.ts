import prisma from '../src/config/prisma';

async function main() {
  const total = await prisma.aiConfirmationToken.count();
  const nullHash = await prisma.aiConfirmationToken.count({ where: { tokenHash: null } });
  const active = await prisma.aiConfirmationToken.count({ where: { consumed: false, expiresAt: { gt: new Date() } } });
  const sample = await prisma.aiConfirmationToken.findFirst({ select: { id: true, token: true, tokenHash: true, consumed: true, expiresAt: true } });
  console.log({ total, nullHash, active, sampleId: sample?.id, hasToken: Boolean(sample?.token), hasHash: Boolean(sample?.tokenHash) });
  await prisma.$disconnect();
}

main().catch(console.error);


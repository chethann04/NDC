import prisma from '../src/config/prisma';

async function main() {
  const res: any = await prisma.$queryRawUnsafe(`
    SELECT 
      conname, 
      pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c 
    JOIN pg_namespace n ON n.oid = c.connamespace 
    WHERE conrelid = 'ndc_requests'::regclass;
  `);
  console.log(JSON.stringify(res, null, 2));
}

main().finally(() => prisma.$disconnect());

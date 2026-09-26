import prisma from '../src/config/prisma';

async function main() {
  console.log('Applying ON DELETE SET NULL migration to ndc_certificates...');

  // 1. Make studentId nullable in ndc_certificates
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ndc_certificates" ALTER COLUMN "studentId" DROP NOT NULL;
  `);
  console.log('1. Made ndc_certificates.studentId nullable.');

  // 2. Drop the restrictive foreign key constraint
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ndc_certificates" DROP CONSTRAINT IF EXISTS "ndc_certificates_studentId_fkey";
  `);
  console.log('2. Dropped existing RESTRICT constraint.');

  // 3. Add foreign key with ON DELETE SET NULL
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ndc_certificates" 
    ADD CONSTRAINT "ndc_certificates_studentId_fkey" 
    FOREIGN KEY ("studentId") 
    REFERENCES "students"("id") 
    ON UPDATE CASCADE 
    ON DELETE SET NULL;
  `);
  console.log('3. Added foreign key with ON DELETE SET NULL ON UPDATE CASCADE.');

  // 4. Verify updated constraint
  const res: any = await prisma.$queryRawUnsafe(`
    SELECT 
      conname, 
      pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c 
    WHERE conname = 'ndc_certificates_studentId_fkey';
  `);
  console.log('Updated constraint definition:', res);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

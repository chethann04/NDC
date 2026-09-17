import prisma from '../config/prisma';

async function addDobColumn() {
  try {
    console.log('Adding dateOfBirth column to students table if not present...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP WITH TIME ZONE;
    `);

    console.log('Updating existing students with default DOB (2004-05-15)...');
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE "students" 
      SET "dateOfBirth" = '2004-05-15 00:00:00+00'::timestamptz 
      WHERE "dateOfBirth" IS NULL;
    `);

    console.log(`Updated ${updated} student records with default DOB.`);

    const sample = await prisma.$queryRawUnsafe(`
      SELECT id, usn, "fullName", "dateOfBirth" FROM "students" LIMIT 3;
    `);
    console.log('Sample students after update:', sample);

    await prisma.$disconnect();
    console.log('Done!');
  } catch (err) {
    console.error('Error adding dateOfBirth column:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

addDobColumn();

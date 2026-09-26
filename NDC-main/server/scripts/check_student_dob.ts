import { PrismaClient } from '../src/generated/client';
const p = new PrismaClient();

async function main() {
  const student = await p.student.findUnique({
    where: { usn: '4MC22IS001' },
    select: {
      fullName: true,
      usn: true,
      dateOfBirth: true,
      email: true,
      isActive: true
    }
  });

  if (!student) {
    console.log('Student NOT FOUND');
    return;
  }

  console.log('Student:', student.fullName, student.usn);
  console.log('isActive:', student.isActive);
  console.log('Raw dateOfBirth:', student.dateOfBirth);

  if (student.dateOfBirth) {
    const d = new Date(student.dateOfBirth);
    console.log('UTC:', d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    console.log('Local:', d.getFullYear(), d.getMonth() + 1, d.getDate());
    console.log('ISO string:', d.toISOString());
  } else {
    console.log('dateOfBirth is NULL — not set yet');
  }
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => p.$disconnect());

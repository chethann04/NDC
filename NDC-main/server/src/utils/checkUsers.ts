import dotenv from 'dotenv';
import prisma from '../config/prisma';

dotenv.config();

async function checkUsers() {
  try {
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users in database:`);
    users.forEach((u) => {
      console.log(`- [${u.role}] ${u.email} (${u.name})`);
    });
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();

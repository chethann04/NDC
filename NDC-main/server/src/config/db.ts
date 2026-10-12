import prisma from './prisma';

export const connectDB = async (): Promise<void> => {
  try {
    // Ping Supabase PostgreSQL via Prisma
    await prisma.$connect();
    console.log(`[Supabase PostgreSQL Connected via Prisma]`);
  } catch (error) {
    console.error(`[Database Connection Warning]:`, error);
  }
};

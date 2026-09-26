const { PrismaClient } = require('../src/generated/client');
require('dotenv').config();

const p = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } }
});

async function main() {
  const cols = await p.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'students'
    ORDER BY ordinal_position;
  `;
  console.table(cols);
  await p.$disconnect();
}

main().catch(console.error);

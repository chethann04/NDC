const { PrismaClient } = require('../src/generated/client');
require('dotenv').config();

const p = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } }
});

async function main() {
  const fks = await p.$queryRaw`
    SELECT 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name, 
      ccu.column_name AS foreign_column_name, 
      rc.delete_rule 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu 
      ON tc.constraint_name = kcu.constraint_name 
      AND tc.table_schema = kcu.table_schema 
    JOIN information_schema.constraint_column_usage AS ccu 
      ON ccu.constraint_name = tc.constraint_name 
      AND ccu.table_schema = tc.table_schema 
    JOIN information_schema.referential_constraints AS rc 
      ON rc.constraint_name = tc.constraint_name 
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND ccu.table_name = 'students';
  `;

  console.log('Foreign keys pointing to students table:');
  console.table(fks);

  // Also check all tables pointing to ndc_requests
  const reqFks = await p.$queryRaw`
    SELECT 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name, 
      ccu.column_name AS foreign_column_name, 
      rc.delete_rule 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu 
      ON tc.constraint_name = kcu.constraint_name 
      AND tc.table_schema = kcu.table_schema 
    JOIN information_schema.constraint_column_usage AS ccu 
      ON ccu.constraint_name = tc.constraint_name 
      AND ccu.table_schema = tc.table_schema 
    JOIN information_schema.referential_constraints AS rc 
      ON rc.constraint_name = tc.constraint_name 
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND ccu.table_name = 'ndc_requests';
  `;
  console.log('\nForeign keys pointing to ndc_requests table:');
  console.table(reqFks);

  await p.$disconnect();
}

main().catch(console.error);

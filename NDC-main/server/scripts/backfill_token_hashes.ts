import prisma from '../src/config/prisma';
import crypto from 'crypto';

export interface BackfillReport {
  totalRows: number;
  eligibleRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  isDryRun: boolean;
  errors: string[];
}

export async function runTokenHashBackfill(dryRun = false): Promise<BackfillReport> {
  const report: BackfillReport = {
    totalRows: 0,
    eligibleRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    isDryRun: dryRun,
    errors: []
  };

  const allTokens = await prisma.aiConfirmationToken.findMany({
    select: {
      id: true,
      token: true,
      tokenHash: true,
      consumed: true,
      expiresAt: true
    }
  });

  report.totalRows = allTokens.length;

  const BATCH_SIZE = 50;
  const updates: Array<{ id: string; computedHash: string }> = [];

  for (const t of allTokens) {
    // If tokenHash is already populated, skip
    if (t.tokenHash && t.tokenHash.trim().length === 64) {
      report.skippedRows++;
      continue;
    }

    // Must have a valid plaintext token to hash
    if (!t.token || typeof t.token !== 'string' || t.token.trim().length === 0) {
      report.failedRows++;
      report.errors.push(`Token row ${t.id} has empty token and empty tokenHash.`);
      continue;
    }

    const cleanToken = t.token.trim();
    // Compute SHA-256 hash
    const computedHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    report.eligibleRows++;
    updates.push({ id: t.id, computedHash });
  }

  if (dryRun) {
    console.log(`[Backfill DRY-RUN] Eligible for update: ${updates.length}, Skipped: ${report.skippedRows}`);
    report.updatedRows = updates.length;
    return report;
  }

  // Execute in batches inside transactions
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$transaction(
        chunk.map((item) =>
          prisma.aiConfirmationToken.update({
            where: { id: item.id },
            data: { tokenHash: item.computedHash }
          })
        )
      );
      report.updatedRows += chunk.length;
    } catch (batchErr: any) {
      report.failedRows += chunk.length;
      report.errors.push(`Batch ${i / BATCH_SIZE + 1} failed: ${batchErr.message}`);
    }
  }

  return report;
}

// Direct CLI invocation
if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`================================================================`);
  console.log(`🔐 AI CONFIRMATION TOKEN HASH BACKFILL (${isDryRun ? 'DRY-RUN' : 'LIVE'})`);
  console.log(`================================================================\n`);

  runTokenHashBackfill(isDryRun)
    .then((report) => {
      console.log('Backfill Results:');
      console.log(`  Total Rows in Table: ${report.totalRows}`);
      console.log(`  Eligible for Hashing: ${report.eligibleRows}`);
      console.log(`  Successfully Updated: ${report.updatedRows}`);
      console.log(`  Already Hashed / Skipped: ${report.skippedRows}`);
      console.log(`  Failed Rows: ${report.failedRows}`);
      if (report.errors.length > 0) {
        console.error('Errors encountered:');
        report.errors.forEach((e) => console.error(`  - ${e}`));
      }
      console.log('\n================================================================\n');
      process.exit(report.failedRows > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal backfill error:', err);
      process.exit(1);
    });
}


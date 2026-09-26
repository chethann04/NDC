import prisma from '../src/config/prisma';

async function syncLoginIds() {
  console.log('[Sync]: Setting standard login IDs for all accounts...');

  const mappings: { email: string; loginId: string }[] = [
    // Admins
    { email: 'superadmin@mce.ac.in', loginId: 'SUPERADMIN' },
    { email: 'admin@mce.ac.in', loginId: 'ADMIN001' },

    // Central Clearance Desks
    { email: 'library@mce.ac.in', loginId: 'LIB001' },
    { email: 'lab@mce.ac.in', loginId: 'LAB001' },
    { email: 'hostel@mce.ac.in', loginId: 'HST001' },
    { email: 'sports@mce.ac.in', loginId: 'SPT001' },
    { email: 'accounts@mce.ac.in', loginId: 'ACC001' },
    { email: 'cashfee1@mce.ac.in', loginId: 'ACC002' },
    { email: 'cashfee2@mce.ac.in', loginId: 'ACC003' },
    { email: 'cashfee3@mce.ac.in', loginId: 'ACC004' },
    { email: 'office@mce.ac.in', loginId: 'ADM001' },

    // Specialized Labs
    { email: 'physics.lab@mce.ac.in', loginId: 'PHY001' },
    { email: 'chemistry.lab@mce.ac.in', loginId: 'CHEM001' },

    // Department Faculty Desks
    { email: 'ise.officer@mce.ac.in', loginId: 'ISE001' },
    { email: 'cse.officer@mce.ac.in', loginId: 'CSE001' },
    { email: 'faculty.is@mce.ac.in', loginId: 'FAC-IS' },
    { email: 'faculty.cs@mce.ac.in', loginId: 'FAC-CS' },
    { email: 'faculty.ai@mce.ac.in', loginId: 'FAC-AI' },
    { email: 'faculty.cb@mce.ac.in', loginId: 'FAC-CB' },
    { email: 'faculty.cv@mce.ac.in', loginId: 'FAC-CV' },
    { email: 'faculty.ec@mce.ac.in', loginId: 'FAC-EC' },
    { email: 'faculty.ee@mce.ac.in', loginId: 'FAC-EE' },
    { email: 'faculty.et@mce.ac.in', loginId: 'FAC-ET' },
    { email: 'faculty.me@mce.ac.in', loginId: 'FAC-ME' },
    { email: 'faculty.ra@mce.ac.in', loginId: 'FAC-RA' },
    { email: 'faculty.vl@mce.ac.in', loginId: 'FAC-VL' },

    // Department HOD Desks
    { email: 'hod.is@mce.ac.in', loginId: 'HOD-IS' },
    { email: 'hod.cs@mce.ac.in', loginId: 'HOD-CS' },
    { email: 'hod.ai@mce.ac.in', loginId: 'HOD-AI' },
    { email: 'hod.cb@mce.ac.in', loginId: 'HOD-CB' },
    { email: 'hod.cv@mce.ac.in', loginId: 'HOD-CV' },
    { email: 'hod.ec@mce.ac.in', loginId: 'HOD-EC' },
    { email: 'hod.ee@mce.ac.in', loginId: 'HOD-EE' },
    { email: 'hod.et@mce.ac.in', loginId: 'HOD-ET' },
    { email: 'hod.me@mce.ac.in', loginId: 'HOD-ME' },
    { email: 'hod.ra@mce.ac.in', loginId: 'HOD-RA' },
    { email: 'hod.vl@mce.ac.in', loginId: 'HOD-VL' }
  ];

  for (const item of mappings) {
    const user = await prisma.user.findUnique({ where: { email: item.email } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { loginId: item.loginId }
      });
      console.log(`Updated [${item.email}] -> loginId: ${item.loginId}`);
    } else {
      console.warn(`User not found for email: ${item.email}`);
    }
  }

  console.log('[Sync]: Complete.');
}

syncLoginIds()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

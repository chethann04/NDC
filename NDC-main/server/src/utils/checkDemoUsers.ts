import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from '../models/User';

dotenv.config();

export const checkUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/NDS');
    const demoEmails = [
      'admin@mce.ac.in',
      'superadmin@mce.ac.in',
      'library@mce.ac.in',
      'lab@mce.ac.in',
      'hostel@mce.ac.in',
      'sports@mce.ac.in',
      'accounts@mce.ac.in',
      'faculty.is@mce.ac.in',
      'hod.is@mce.ac.in'
    ];

    const users = await User.find({ email: { $in: demoEmails } });
    console.log(`Found ${users.length} demo accounts in DB:`);
    for (const u of users) {
      const matchAdmin = await bcrypt.compare('Admin@123', u.passwordHash);
      const matchOfficer = await bcrypt.compare('Officer@123', u.passwordHash);
      console.log(`- ${u.email} | Role: ${u.role} | Active: ${u.isActive} | Admin@123: ${matchAdmin} | Officer@123: ${matchOfficer}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
};

checkUsers();

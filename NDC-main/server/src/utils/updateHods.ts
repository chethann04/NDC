import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ClearanceDepartment from '../models/ClearanceDepartment';

async function check() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/NDS';
  console.log('Connecting to:', uri);
  await mongoose.connect(uri);

  const depts = await ClearanceDepartment.find();
  console.log('Found', depts.length, 'departments in DB:');

  const hodMap: Record<string, string> = {
    'IS': 'Dr. Umashankar M.',
    'Information Science & Engineering': 'Dr. Umashankar M.',
    'CS': 'Dr. Ramesh B.',
    'Computer Science & Engineering': 'Dr. Ramesh B.',
    'EC': 'Dr. B. R. Sujatha',
    'Electronics & Communication Engg': 'Dr. B. R. Sujatha',
    'EE': 'Dr. H. S. Kumar',
    'Electrical & Electronics Engineering': 'Dr. H. S. Kumar',
    'ME': 'Dr. S. Pradeep',
    'Mechanical Engineering': 'Dr. S. Pradeep',
    'CV': 'Dr. Mohan Kumar',
    'Civil Engineering': 'Dr. Mohan Kumar',
    'CI': 'Dr. Chandrashekar S.',
    'CSE (Artificial Intelligence & Machine Learning)': 'Dr. Chandrashekar S.',
    'CB': 'Dr. Anitha G.',
    'Computer Science & Business System': 'Dr. Anitha G.',
    'EI': 'Dr. Ravishankar K.',
    'Electronics & Instrumentation Engineering': 'Dr. Ravishankar K.'
  };

  for (const dept of depts) {
    const hod = hodMap[dept.code] || hodMap[dept.name];
    if (hod) {
      dept.hodName = hod;
      dept.hodDesignation = 'Head of the Department';
      await dept.save();
      console.log(`Saved HOD [${hod}] for ${dept.code} - ${dept.name}`);
    }
  }

  await mongoose.disconnect();
  console.log('Finished updating HOD names.');
}

check().catch(console.error);

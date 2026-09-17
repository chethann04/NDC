import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Student from '../models/Student';
import ClearanceDepartment from '../models/ClearanceDepartment';
import User from '../models/User';
import { UserRole } from '../constants/roles';
import { USN_DEPARTMENT_MAP } from '../constants/usnDepartmentMap';

dotenv.config();

export const syncDepartments = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/NDS';
    await mongoose.connect(mongoUri);
    console.log('[Sync]: Connected to MongoDB...');

    // 1. Get all students
    const students = await Student.find({});
    console.log(`[Sync]: Total students found in DB: ${students.length}`);

    // 2. Loop through all students and ensure their department exists and is linked
    let updatedCount = 0;
    for (const student of students) {
      const match = student.usn.match(/4MC\d{2}([A-Z]{2})/i);
      const deptCode = match ? match[1].toUpperCase() : null;
      const deptName = deptCode ? USN_DEPARTMENT_MAP[deptCode] : null;

      if (deptCode && deptName) {
        let dept = await ClearanceDepartment.findOne({
          $or: [{ code: deptCode }, { name: deptName }]
        });

        if (!dept) {
          dept = await ClearanceDepartment.create({
            name: deptName,
            code: deptCode,
            description: `Department of ${deptName} Academic Clearance Desk`,
            isAcademicBranch: true,
            displayOrder: 10
          });
          console.log(`[Sync]: Created academic department [${dept.code}] ${dept.name}`);
        } else if (!dept.isAcademicBranch) {
          dept.isAcademicBranch = true;
          await dept.save();
        }

        if (!student.departmentId || String(student.departmentId) !== String(dept._id)) {
          student.departmentId = dept._id as any;
          await student.save();
          updatedCount++;
        }
      }
    }
    console.log(`[Sync]: Updated ${updatedCount} students with valid academic department IDs.`);

    // 3. Ensure HOD is linked to ISE department
    const iseDept = await ClearanceDepartment.findOne({ code: 'IS' });
    if (iseDept) {
      const iseStudentsCount = await Student.countDocuments({ departmentId: iseDept._id });
      console.log(`[Sync]: Total ISE students linked to [${iseDept.code}]: ${iseStudentsCount}`);

      const hodUser = await User.findOne({ email: 'hod.is@mce.ac.in' });
      if (hodUser) {
        hodUser.departmentId = iseDept._id as any;
        await hodUser.save();
        console.log(`[Sync]: HOD hod.is@mce.ac.in linked to ISE department (${iseDept._id})`);
      }
    }

    console.log('\n--- DEPARTMENT BREAKDOWN ---');
    const allDepts = await ClearanceDepartment.find({});
    for (const d of allDepts) {
      const count = await Student.countDocuments({ departmentId: d._id });
      if (count > 0) {
        console.log(`- [${d.code}] ${d.name}: ${count} students`);
      }
    }

    console.log('[Sync]: Synchronization complete.');
  } catch (err) {
    console.error('[Sync Error]:', err);
  } finally {
    process.exit(0);
  }
};

syncDepartments();

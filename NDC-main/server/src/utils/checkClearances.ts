import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Student from '../models/Student';
import NdcRequest from '../models/NdcRequest';
import NdcClearance from '../models/NdcClearance';
import ClearanceDepartment from '../models/ClearanceDepartment';

dotenv.config();

export const check = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/NDS');
    const iseDept = await ClearanceDepartment.findOne({ code: 'IS' });
    console.log('ISE Dept ID:', iseDept?._id);

    const iseStudents = await Student.find({ departmentId: iseDept?._id });
    console.log('ISE Students count:', iseStudents.length);

    const iseStudentIds = iseStudents.map((s) => s._id);
    const requests = await NdcRequest.find({ studentId: { $in: iseStudentIds } });
    console.log('NdcRequests for ISE students:', requests.length);

    const clearances = await NdcClearance.find({ studentId: { $in: iseStudentIds } });
    console.log('NdcClearance records for ISE students:', clearances.length);

    const totalClearances = await NdcClearance.countDocuments({});
    console.log('Total NdcClearance records in DB:', totalClearances);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
};

check();

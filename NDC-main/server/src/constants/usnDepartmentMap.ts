/**
 * AUTHORITATIVE USN DEPARTMENT CODE MAPPING
 * Centralized Single Source of Truth for USN Department Resolution.
 * DO NOT MODIFY CODES.
 */
export const USN_DEPARTMENT_MAP: Record<string, string> = {
  // CIVIL / CONSTRUCTION / MINING
  CV: 'Civil Engineering',
  CC: 'Ceramics and Cement Technology',
  CT: 'Construction Technology & Management',
  EV: 'Environmental Engineering',
  MI: 'Mining Engineering',

  // COMPUTER SCIENCE / COMPUTING
  CS: 'Computer Science & Engineering',
  CE: 'Computer Engineering',
  AD: 'Artificial Intelligence & Data Science',
  AI: 'Artificial Intelligence and Machine Learning',
  BT: 'Biotechnology',
  CM: 'Computer & Communication Engineering',
  CB: 'Computer Science & Business System',
  CG: 'Computer Science & Design',
  CO: 'Computer Science & Engineering (IoT)',
  CI: 'CSE (Artificial Intelligence & Machine Learning)',
  CA: 'CSE (Artificial Intelligence)',
  CY: 'CSE (Cyber Security)',
  CD: 'CSE (Data Science)',
  IC: 'CSE (IoT & Cyber Security including Block Chain Technology)',
  DS: 'Data Science',
  IS: 'Information Science & Engineering',

  // ELECTRONICS / ELECTRICAL
  EC: 'Electronics & Communication Engg',
  BM: 'Biomedical Engineering',
  EE: 'Electrical & Electronics Engineering',
  EI: 'Electronics & Instrumentation Engineering',
  ET: 'Electronics & Telecommunication Engg',
  IO: 'Industrial IoT',
  ML: 'Medical Electronics Engineering',
  VL: 'Electronics Engg (VLSI Design and Technology)',
  UE: 'Electronics & Computer Engineering',

  // CORE ENGINEERING
  AE: 'Aeronautical Engineering',
  AS: 'Aerospace Engineering',
  AG: 'Agreecultural Engineering',
  AR: 'Automation and Robotics',
  AU: 'Automobile Engineering',
  CH: 'Chemical Engineering',
  IP: 'Industrial & Production Engineering',
  IM: 'Industrial Engineering & Management',
  MS: 'Manufacturing Science & Engineering',
  MR: 'Marine Engineering',
  MM: 'Mechanical & Smart Manufacturing',
  ME: 'Mechanical Engineering',
  MT: 'Mechatronics',
  PC: 'Petrochem Engineering',
  RA: 'Robotics & Automation',
  RI: 'Robotics and Artificial Intelligence',
  ST: 'Silk Technology',
  TX: 'Textile Technology',
  ER: 'Energy Engineering',
  SA: 'Smart Agritech'
};

export const getDepartmentNameByCode = (code: string): string | null => {
  if (!code) return null;
  const upperCode = code.trim().toUpperCase();
  return USN_DEPARTMENT_MAP[upperCode] || null;
};

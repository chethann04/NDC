/**
 * AUTHORITATIVE USN DEPARTMENT CODE MAPPING (FRONTEND READ-ONLY)
 * Centralized Single Source of Truth for USN Department Resolution.
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

export const normalizeUsn = (usn: string): string => {
  if (!usn) return '';
  return usn.trim().toUpperCase().replace(/\s+/g, '');
};

export const getDepartmentCodeFromUsn = (usn: string): string | null => {
  const normalized = normalizeUsn(usn);
  if (!normalized) return null;

  // 1. Direct match: digits followed by 2 to 4 letters, then optional digits
  // e.g. 4MC22CS001, 4MC22CS, 4MC22AIML001, 4MC23IS, 1AM21EC005
  const match = normalized.match(/\d{2}([A-Z]{2,4})(\d*)$/);
  if (match && match[1]) {
    const raw = match[1];
    if (raw === 'AIML') return 'AI';
    if (USN_DEPARTMENT_MAP[raw]) return raw;
  }

  // 2. Lookup known branch codes present after college prefix
  const knownCodes = ['AIML', 'CS', 'IS', 'EC', 'ME', 'CV', 'EE', 'AI', 'CB', 'VL', 'ET', 'RA', 'ST', ...Object.keys(USN_DEPARTMENT_MAP)];
  for (const k of knownCodes) {
    const idx = normalized.indexOf(k);
    if (idx >= 3) {
      return k === 'AIML' ? 'AI' : k;
    }
  }

  return null;
};

export const extractDepartmentFromUsn = (usn: string): { code: string | null; name: string | null; error?: string } => {
  const code = getDepartmentCodeFromUsn(usn);
  if (code && USN_DEPARTMENT_MAP[code]) {
    return {
      code,
      name: USN_DEPARTMENT_MAP[code]
    };
  }

  return {
    code: code || null,
    name: null,
    error: 'Unable to determine department from USN.'
  };
};

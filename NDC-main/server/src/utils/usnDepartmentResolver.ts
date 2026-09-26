import prisma from '../config/prisma';
import { USN_DEPARTMENT_MAP } from '../constants/usnDepartmentMap';
import { departmentCache } from './departmentCache';

export interface UsnDepartmentResolution {
  success: boolean;
  code: string | null;
  name: string | null;
  departmentId?: string;
  error?: string;
}

/**
 * Normalizes USN string according to specification:
 * 1. Remove leading/trailing spaces.
 * 2. Convert to uppercase.
 * 3. Remove accidental internal spaces.
 */
export const normalizeUsnString = (usn: string): string => {
  if (!usn) return '';
  return String(usn).trim().toUpperCase().replace(/\s+/g, '');
};

/**
 * Extracts Department Code and Name from USN using centralized authoritative mapping.
 */
export const resolveDepartmentFromUsn = (usn: string): UsnDepartmentResolution => {
  const normalized = normalizeUsnString(usn);
  if (!normalized) {
    return {
      success: false,
      code: null,
      name: null,
      error: 'Please enter a valid USN.'
    };
  }

  const match = normalized.match(/\d{2}([A-Z]{2,4})(\d*)$/);
  let code: string | null = null;

  if (match && match[1]) {
    code = match[1] === 'AIML' ? 'AI' : match[1];
  } else {
    const knownCodes = ['AIML', 'CS', 'IS', 'EC', 'ME', 'CV', 'EE', 'AI', 'CB', 'VL', 'ET', 'RA', 'ST', ...Object.keys(USN_DEPARTMENT_MAP)];
    for (const k of knownCodes) {
      const idx = normalized.indexOf(k);
      if (idx >= 3) {
        code = k === 'AIML' ? 'AI' : k;
        break;
      }
    }
  }

  if (code && USN_DEPARTMENT_MAP[code]) {
    return {
      success: true,
      code,
      name: USN_DEPARTMENT_MAP[code]
    };
  }

  return {
    success: false,
    code: code || null,
    name: null,
    error: 'Unable to determine department from USN.'
  };
};

/**
 * Resolves USN department and finds or creates the corresponding ClearanceDepartment record in Supabase/Prisma.
 */
export const getOrCreateDepartmentByUsn = async (usn: string): Promise<UsnDepartmentResolution> => {
  const resolution = resolveDepartmentFromUsn(usn);
  if (!resolution.success || !resolution.code || !resolution.name) {
    return resolution;
  }

  // Fast memory lookup from department cache
  let dept = await departmentCache.getDepartmentByCodeOrName(resolution.code);
  if (!dept && resolution.name) {
    dept = await departmentCache.getDepartmentByCodeOrName(resolution.name);
  }

  if (!dept) {
    // Auto-create department master record if not exists
    dept = await prisma.clearanceDepartment.create({
      data: {
        code: resolution.code,
        name: resolution.name,
        description: `${resolution.name} Academic Branch Department (HOD)`,
        requiresClearance: true,
        isAcademicBranch: true,
        displayOrder: 10,
        isActive: true
      }
    });
    try {
      const { DepartmentController } = await import('../controllers/DepartmentController');
      await DepartmentController.provisionDepartmentDefaults(dept);
    } catch (provisionErr) {
      console.error('[usnDepartmentResolver] Error auto-provisioning department defaults:', provisionErr);
    }
    departmentCache.invalidate();
  }

  return {
    ...resolution,
    departmentId: dept.id
  };
};

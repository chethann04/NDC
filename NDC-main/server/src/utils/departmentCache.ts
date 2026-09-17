import prisma from '../config/prisma';

export interface CachedDepartment {
  id: string;
  name: string;
  code: string;
  description: string;
  requiresClearance: boolean;
  isAcademicBranch: boolean;
  displayOrder: number;
  isActive: boolean;
}

class DepartmentCache {
  private cache: CachedDepartment[] | null = null;
  private lastFetched = 0;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  public async getAllActiveDepartments(): Promise<CachedDepartment[]> {
    const now = Date.now();
    if (this.cache && (now - this.lastFetched < this.TTL_MS)) {
      return this.cache;
    }

    const depts = await prisma.clearanceDepartment.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    });

    this.cache = depts;
    this.lastFetched = now;
    return depts;
  }

  public async getDepartmentById(id: string): Promise<CachedDepartment | null> {
    const all = await this.getAllActiveDepartments();
    const found = all.find((d) => d.id === id);
    if (found) return found;

    // Fallback direct DB query if not in cache (e.g. inactive)
    return prisma.clearanceDepartment.findUnique({ where: { id } });
  }

  public async getDepartmentByCodeOrName(codeOrName: string): Promise<CachedDepartment | null> {
    const all = await this.getAllActiveDepartments();
    const normalized = codeOrName.trim().toUpperCase();
    const found = all.find(
      (d) => d.code.toUpperCase() === normalized || d.name.toUpperCase() === normalized
    );
    if (found) return found;

    // Fallback DB query
    return prisma.clearanceDepartment.findFirst({
      where: {
        OR: [
          { code: { equals: codeOrName, mode: 'insensitive' } },
          { name: { equals: codeOrName, mode: 'insensitive' } }
        ]
      }
    });
  }

  public invalidate(): void {
    this.cache = null;
    this.lastFetched = 0;
  }
}

export const departmentCache = new DepartmentCache();

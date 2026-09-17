/**
 * Helper to ensure database entities have `_id` populated with `id`
 * for 100% backward-compatibility with the frontend React UI.
 */
export function withId<T extends { id: any }>(obj: T | null | undefined): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => withId(item));
  }
  if (typeof obj === 'object') {
    const res: any = { ...obj, _id: (obj as any).id };
    for (const key of Object.keys(res)) {
      if (res[key] && typeof res[key] === 'object' && res[key].id && !res[key]._id) {
        res[key] = withId(res[key]);
      } else if (Array.isArray(res[key])) {
        res[key] = res[key].map((sub: any) => (sub && typeof sub === 'object' && sub.id ? withId(sub) : sub));
      }
    }
    return res;
  }
  return obj;
}

export function withIds<T extends { id: any }>(arr: T[]): any[] {
  return arr.map(item => withId(item));
}

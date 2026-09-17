export const normalizeUsn = (usn: string): string => {
  if (!usn) return '';
  return usn.trim().toUpperCase().replace(/\s+/g, '');
};

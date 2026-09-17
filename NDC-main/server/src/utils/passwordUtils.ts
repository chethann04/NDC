import bcrypt from 'bcryptjs';

export const hashPassword = async (plainText: string): Promise<string> => {
  const saltRounds = 10; // Standard production salt rounds for bcryptjs (~60ms vs 1260ms)
  return bcrypt.hash(plainText, saltRounds);
};

export const comparePassword = async (plainText: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plainText, hash);
};

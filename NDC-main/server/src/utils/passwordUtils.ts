import bcrypt from 'bcryptjs';

export const hashPassword = async (plainText: string, saltRounds: number = 10): Promise<string> => {
  return bcrypt.hash(plainText, saltRounds);
};

export const comparePassword = async (plainText: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plainText, hash);
};

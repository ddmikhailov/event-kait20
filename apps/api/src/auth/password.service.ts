import { hash, verify, argon2id } from 'argon2';

export const hashPassword = (password: string): Promise<string> =>
  hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

export const verifyPassword = (
  passwordHash: string,
  password: string,
): Promise<boolean> => verify(passwordHash, password);

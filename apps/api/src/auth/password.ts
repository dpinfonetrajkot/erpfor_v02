import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/**
 * Also accepts hashes made by PHP's password_hash() ("$2y$..."), so users
 * imported from the old ERP keep their current passwords.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  return bcrypt.compare(plain, normalized);
}

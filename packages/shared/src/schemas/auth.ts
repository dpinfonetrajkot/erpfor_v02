import type { CompanyAppearance, UserPreferences } from './preferences';
import { z } from 'zod';
import { optionalEmail, optionalPhone, optionalText, id, text } from './common';

export const loginSchema = z.object({
  username: text(50),
  password: z.string().min(1, 'Required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ------------------------------------------------------------------ password rules

/** Words that make a password easy to guess, also with numbers or symbols around them ("Password@123"). */
const COMMON_WORDS = [
  'password', 'passw', 'admin', 'administrator', 'welcome', 'qwerty', 'asdf', 'zxcv', 'letmein', 'login', 'iloveyou',
  'abc', 'abcd', 'test', 'demo', 'user', 'guest', 'default', 'changeme', 'secret', 'master', 'erp', 'india', 'bharat',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'cricket', 'superman', 'batman',
];
const COMMON_NUMBERS = /^(?:0123456789|1234567890|123456789|12345678|987654321|11111111|00000000|12341234)$/;

export interface PasswordRule {
  id: 'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'username' | 'common';
  label: string;
  test: (password: string, context: { username?: string }) => boolean;
}

/**
 * The company password rules, used by the server (enforced) and by the screens (live checklist).
 * Old passwords keep working; the rules apply whenever a password is set or changed.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'An uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'A lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'A number (0–9)', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'A symbol (like @ # $ ! %)', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  {
    id: 'username',
    label: 'Does not contain the username',
    test: (p, { username }) => !username || username.trim().length < 3 || !p.toLowerCase().includes(username.trim().toLowerCase()),
  },
  {
    id: 'common',
    label: 'Not a common or easy-to-guess password',
    test: (p) => {
      const letters = p.toLowerCase().replace(/[^a-z]/g, '');
      const digits = p.replace(/\D/g, '');
      return !COMMON_WORDS.includes(letters) && !(letters.length === 0 && COMMON_NUMBERS.test(digits));
    },
  },
];

/** The rules this password does not meet yet (empty = good). */
export function passwordProblems(password: string, context: { username?: string } = {}): PasswordRule[] {
  return PASSWORD_RULES.filter((r) => !r.test(password, context));
}

/** Everything except the username rule, which needs the user (checked again on the server). */
const strongPassword = z
  .string()
  .max(100, 'At most 100 characters')
  .superRefine((value, ctx) => {
    const first = passwordProblems(value).find((r) => r.id !== 'username');
    if (first) ctx.addIssue({ code: 'custom', message: `Password needs: ${first.label.charAt(0).toLowerCase()}${first.label.slice(1)}` });
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const username = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Only letters, numbers, dot, dash and underscore');

const userBase = {
  username,
  name: text(100),
  email: optionalEmail(),
  phone: optionalPhone(),
  roleId: id(),
  isActive: z.boolean().default(true),
};

export const userCreateSchema = z.object({
  ...userBase,
  password: strongPassword,
  /** The user must choose their own password at the first sign-in. */
  mustChangePassword: z.boolean().default(true),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object(userBase);
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const resetPasswordSchema = z.object({
  newPassword: strongPassword,
  /** The user must choose their own password at the next sign-in. */
  mustChangePassword: z.boolean().default(true),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ------------------------------------------------------------------ 2-step login

const sixDigits = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from the app');

/** Second step of sign-in: the code from the authenticator app, or one of the backup codes. */
export const loginVerifySchema = z.object({
  ticket: z.string().min(10).max(2000),
  code: z
    .string()
    .trim()
    .min(6, 'Enter the 6-digit code')
    .max(20),
});
export type LoginVerifyInput = z.infer<typeof loginVerifySchema>;

export const twoFactorCodeSchema = z.object({ code: sixDigits });
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Required').max(200),
  code: sixDigits,
});
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;

/** Who must use 2-step login (Settings → Company security). */
export const TWO_FACTOR_POLICIES = ['off', 'admins', 'everyone'] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];
export const securityPolicySchema = z.object({ twoFactor: z.enum(TWO_FACTOR_POLICIES) });
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

/** Users who can manage users, roles or company settings count as admins for the 2-step rule. */
export function isAdminUser(permissions: readonly string[]): boolean {
  return permissions.some((p) => p === '*' || p === 'users.update' || p === 'roles.update' || p === 'settings.update');
}

/** POST /auth/login answers with this instead of the user when a code is still needed. */
export interface TwoFactorChallenge {
  twoFactor: true;
  /** Short-lived pass for POST /auth/login/verify (5 minutes). */
  ticket: string;
}

/** GET /account/2fa */
export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesLeft: number;
  /** The company rule makes it compulsory for this user (cannot be turned off). */
  required: boolean;
}

/** POST /account/2fa/setup: the secret to put in the authenticator app (shown as a QR code). */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

export const roleSchema = z.object({
  name: text(50),
  description: optionalText(255),
  permissions: z.array(z.string().max(100)).default([]),
});
export type RoleInput = z.infer<typeof roleSchema>;

/** Returned by GET /auth/me and POST /auth/login. */
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: { id: number; name: string };
  permissions: string[];
  /** The user's own settings (Settings screen); empty until they choose something. */
  preferences: UserPreferences;
  /** Profile photo (data URL) or null. */
  avatar: string | null;
  /** The company's default font and colour (admin), used where the user has not chosen their own. */
  appearance: CompanyAppearance;
  /** Login safety: what this user has turned on and what they still must do before using the ERP. */
  security: {
    twoFactorEnabled: boolean;
    /** An admin set this password: the user chooses their own first. */
    mustChangePassword: boolean;
    /** The company rule needs 2-step login for this user and it is not set up yet. */
    twoFactorSetupRequired: boolean;
  };
}

import type { CompanyAppearance, UserPreferences } from './preferences';
import { z } from 'zod';
import { optionalEmail, optionalPhone, optionalText, id, text } from './common';

export const loginSchema = z.object({
  username: text(50),
  password: z.string().min(1, 'Required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

const strongPassword = z
  .string()
  .min(8, 'At least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number');

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

export const userCreateSchema = z.object({ ...userBase, password: strongPassword });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object(userBase);
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const resetPasswordSchema = z.object({ newPassword: strongPassword });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
}

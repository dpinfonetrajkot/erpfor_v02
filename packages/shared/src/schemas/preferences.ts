import { z } from 'zod';

/**
 * Personal settings (Settings screen) and the company's default look (admin).
 * Each user's own choice wins over the company default; nothing here changes data, only how the ERP looks.
 */

export const UI_FONTS = [
  { id: 'inter', label: 'Inter', note: 'Clear and easy to read' },
  { id: 'geist', label: 'Geist', note: 'Modern and clean' },
  { id: 'jakarta', label: 'Plus Jakarta Sans', note: 'Friendly and rounded - the default' },
  { id: 'manrope', label: 'Manrope', note: 'Sharp, modern business look' },
  { id: 'plex', label: 'IBM Plex Sans', note: 'Technical, engineering feel' },
  { id: 'dm', label: 'DM Sans', note: 'Clean and geometric' },
  { id: 'nunito', label: 'Nunito Sans', note: 'Soft and relaxed' },
  { id: 'poppins', label: 'Poppins', note: 'Bold and geometric' },
  { id: 'system', label: 'System font', note: "This computer's own font" },
] as const;
export type UiFont = (typeof UI_FONTS)[number]['id'];
const FONT_IDS = UI_FONTS.map((f) => f.id) as [UiFont, ...UiFont[]];

/** Main colour of buttons, links and highlights. Each is dark enough for white text. */
export const UI_ACCENTS = [
  { id: 'blue', label: 'Blue', hex: '#4062c9' },
  { id: 'indigo', label: 'Indigo', hex: '#4f46e5' },
  { id: 'teal', label: 'Teal', hex: '#0f766e' },
  { id: 'emerald', label: 'Emerald', hex: '#047857' },
  { id: 'violet', label: 'Violet', hex: '#7c3aed' },
  { id: 'rose', label: 'Rose', hex: '#be123c' },
  { id: 'orange', label: 'Orange', hex: '#c2410c' },
  { id: 'graphite', label: 'Graphite', hex: '#334155' },
] as const;
export type UiAccent = (typeof UI_ACCENTS)[number]['id'];
const ACCENT_IDS = UI_ACCENTS.map((a) => a.id) as [UiAccent, ...UiAccent[]];

export const UI_TEXT_SIZES = [
  { id: 'sm', label: 'Compact', note: 'More on the screen' },
  { id: 'md', label: 'Default', note: 'Balanced' },
  { id: 'lg', label: 'Large', note: 'Easier to read' },
] as const;
export type UiTextSize = (typeof UI_TEXT_SIZES)[number]['id'];

/** Colours of the round profile picture (initials or icon). */
export const AVATAR_COLORS = ['indigo', 'blue', 'teal', 'emerald', 'amber', 'rose', 'violet', 'slate'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];
/** Icons a profile picture can show instead of initials. */
export const AVATAR_ICONS = ['user', 'hard-hat', 'wrench', 'factory', 'briefcase', 'calculator', 'truck', 'shield', 'flame', 'package', 'users', 'sparkles'] as const;
export type AvatarIcon = (typeof AVATAR_ICONS)[number];

export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  font: z.enum(FONT_IDS).optional(),
  accent: z.enum(ACCENT_IDS).optional(),
  textSize: z.enum(['sm', 'md', 'lg']).optional(),
  /** Screen opened after signing in, e.g. /billing/invoices. */
  startPage: z
    .string()
    .max(100)
    .regex(/^\/[a-z0-9\-/]*$/, 'Choose a screen from the list')
    .optional(),
  /** The side menu starts folded (icons only). */
  menuCollapsed: z.boolean().optional(),
  avatar: z
    .object({
      kind: z.enum(['initials', 'icon', 'photo']),
      color: z.enum(AVATAR_COLORS),
      icon: z.enum(AVATAR_ICONS).optional(),
    })
    .optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/** A profile photo: a small image as a data URL (the browser makes it 192 px square before sending), or null to remove it. */
export const avatarPhotoSchema = z.object({
  photo: z
    .string()
    .max(400_000, 'The photo is too big')
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Not a photo')
    .nullable(),
});
export type AvatarPhotoInput = z.infer<typeof avatarPhotoSchema>;

/** The company's default look for everyone (each user can still choose their own). */
export const companyAppearanceSchema = z.object({
  font: z.enum(FONT_IDS),
  accent: z.enum(ACCENT_IDS),
});
export type CompanyAppearance = z.infer<typeof companyAppearanceSchema>;
export const DEFAULT_APPEARANCE: CompanyAppearance = { font: 'jakarta', accent: 'blue' };

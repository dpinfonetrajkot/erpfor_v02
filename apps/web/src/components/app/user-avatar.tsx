'use client';

import {
  BriefcaseBusiness,
  Calculator,
  Factory,
  Flame,
  HardHat,
  Package,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AvatarColor, AvatarIcon, UserPreferences } from '@bht/shared';
import { cn } from '@/lib/utils';

export const AVATAR_GRADIENT: Record<AvatarColor, string> = {
  indigo: 'from-indigo-500 to-violet-500',
  blue: 'from-sky-500 to-blue-600',
  teal: 'from-teal-500 to-cyan-600',
  emerald: 'from-emerald-500 to-green-600',
  amber: 'from-amber-400 to-orange-500',
  rose: 'from-rose-500 to-pink-600',
  violet: 'from-violet-500 to-fuchsia-500',
  slate: 'from-slate-500 to-slate-700',
};

export const AVATAR_ICON: Record<AvatarIcon, LucideIcon> = {
  user: UserRound,
  'hard-hat': HardHat,
  wrench: Wrench,
  factory: Factory,
  briefcase: BriefcaseBusiness,
  calculator: Calculator,
  truck: Truck,
  shield: ShieldCheck,
  flame: Flame,
  package: Package,
  users: Users,
  sparkles: Sparkles,
};

export function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** The round profile picture: the photo, an icon or the initials, on the colour the user chose. */
export function UserAvatar({
  name,
  photo,
  style,
  className,
}: {
  name: string;
  photo?: string | null;
  style?: UserPreferences['avatar'];
  className?: string;
}) {
  const color = style?.color ?? 'blue';
  if (style?.kind === 'photo' && photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" className={cn('size-8 shrink-0 rounded-full object-cover ring-1 ring-black/5', className)} />;
  }
  const Icon = style?.kind === 'icon' && style.icon ? AVATAR_ICON[style.icon] : null;
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white [&_svg]:size-[55%]',
        AVATAR_GRADIENT[color],
        className,
      )}
      aria-hidden
    >
      {Icon ? <Icon strokeWidth={2} /> : initialsOf(name)}
    </span>
  );
}

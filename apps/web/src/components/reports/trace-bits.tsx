'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { useSession } from '@/components/app/session';

/** A document number that links to its screen when the user may open it. */
export function DocLink({
  href,
  permission,
  children,
  className,
}: {
  href: string;
  permission: string | string[];
  children: React.ReactNode;
  className?: string;
}) {
  const { can } = useSession();
  const ok = (Array.isArray(permission) ? permission : [permission]).some(can);
  const cls = cn('font-mono text-[13px] font-semibold whitespace-nowrap', className);
  return ok ? (
    <Link href={href} className={cn(cls, 'text-primary hover:underline')}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/** Uploaded file (MTC, test report) opened in a new tab. */
export function FileLink({ id, name, note }: { id: number; name: string; note?: string }) {
  return (
    <a
      href={`/api/attachments/${id}/download`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-[13px] text-primary hover:underline"
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
      {note && <span className="shrink-0 text-muted-foreground">· {note}</span>}
    </a>
  );
}

export function Section({
  title,
  description,
  children,
  className,
  flush,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn(flush && 'px-0 pb-0')}>{children}</CardContent>
    </Card>
  );
}

/** Horizontal-scroll table inside a Section with flush content. */
export function FlushTable({
  children,
  minWidth = 640,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="report-table w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

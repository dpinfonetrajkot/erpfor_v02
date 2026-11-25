import { Card } from '@/components/ui/primitives';

/** One card on the Settings page, with an icon, a title and an optional button on the right. */
export function Section({ id, title, description, icon: Icon, children, action }: { id: string; title: string; description: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="space-y-7 px-6 py-6">{children}</div>
    </Card>
  );
}

/** A setting: label and hint on the left, the control on the right (stacked on phones). */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

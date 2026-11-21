'use client';

import { useId, useState } from 'react';
import { Controller, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Label, Switch } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import type { LookupOption } from '@/hooks/use-api';

type Form<T extends FieldValues> = UseFormReturn<T, any, any>;

interface BaseProps<T extends FieldValues> {
  form: Form<T>;
  name: Path<T>;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  className?: string;
}

function errorOf<T extends FieldValues>(form: Form<T>, name: Path<T>): string | undefined {
  const parts = String(name).split('.');
  let node: any = form.formState.errors;
  for (const p of parts) node = node?.[p];
  return node?.message as string | undefined;
}

export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id?: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  inputClassName,
  ...input
}: BaseProps<T> & { inputClassName?: string } & Omit<React.ComponentProps<'input'>, 'name' | 'form'>) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error} className={className}>
      <Input id={id} aria-invalid={!!error} className={inputClassName} {...input} {...form.register(name)} />
    </Field>
  );
}

export function TextareaField<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  ...input
}: BaseProps<T> & Omit<React.ComponentProps<'textarea'>, 'name' | 'form'>) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error} className={className}>
      <Textarea id={id} aria-invalid={!!error} rows={3} {...input} {...form.register(name)} />
    </Field>
  );
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  options,
  placeholder,
  numeric,
}: BaseProps<T> & {
  options: { value: string | number; label: string }[];
  placeholder?: string;
  /** Store the value as a number (ids). */
  numeric?: boolean;
}) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error} className={className}>
      <NativeSelect
        id={id}
        aria-invalid={!!error}
        {...form.register(name, numeric ? { setValueAs: (v) => (v === '' ? undefined : Number(v)) } : undefined)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function SwitchField<T extends FieldValues>({ form, name, label, hint, className }: Omit<BaseProps<T>, 'required'>) {
  const id = useId();
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className={cn('flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5', className)}>
          <div className="flex flex-col gap-1">
            <Label htmlFor={id}>{label}</Label>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

/** Searchable dropdown for long lists (customers, raw materials, items). */
export function ComboboxField<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  options,
  placeholder = 'Select…',
  loading,
}: BaseProps<T> & { options: LookupOption[] | undefined; placeholder?: string; loading?: boolean }) {
  const error = errorOf(form, name);
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Field label={label} required={required} hint={hint} error={error} className={className}>
          <Combobox
            value={field.value as number | undefined}
            onChange={field.onChange}
            options={options}
            placeholder={loading ? 'Loading…' : placeholder}
            invalid={!!error}
          />
        </Field>
      )}
    />
  );
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  invalid,
  clearable = true,
}: {
  value: number | undefined | null;
  onChange: (value: number | undefined) => void;
  options: LookupOption[] | undefined;
  placeholder?: string;
  invalid?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options?.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            'h-9 w-full justify-between px-3 font-normal aria-invalid:border-destructive',
            !selected && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <span className="flex items-center gap-1">
            {clearable && selected && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                }}
                className="rounded p-0.5 hover:bg-muted"
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64">
        <Command>
          <Command.Input placeholder="Type to search…" className="h-10 w-full border-b bg-transparent px-3 text-sm outline-none" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>
            {options?.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label} ${String(o.meta?.code ?? '')}`}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
              >
                <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate">{o.label}</span>
                {typeof o.meta?.code === 'string' && <span className="font-mono text-xs text-muted-foreground">{o.meta.code}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Side panel holding an add / edit form, with a sticky Save bar. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  saving,
  submitLabel = 'Save',
  children,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: (e?: React.BaseSyntheticEvent) => void;
  saving?: boolean;
  submitLabel?: string;
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
          <div className="flex items-center gap-2 border-t bg-muted/30 px-6 py-3">
            {footerExtra}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Two-column grid on wide screens, one column on phones. */
export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 pt-1">
      <legend className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { ACTIONS, DELIVERED_PHASE, MODULE_CATEGORIES, MODULES, roleSchema, type Action, type RoleInput } from '@bht/shared';
import { api } from '@/lib/api';
import { useZodForm } from '@/lib/forms';
import { showApiError, useApiQuery, useDelete, useSave } from '@/hooks/use-api';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';

const ACTION_KEYS = Object.keys(ACTIONS) as Action[];

export default function RolesPage() {
  return (
    <RequirePermission permission="roles.view">
      <Roles />
    </RequirePermission>
  );
}

function Roles() {
  const { can } = useSession();
  const { data: roles, isLoading } = useApiQuery<Role[]>('/roles');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (roles?.length && !roles.some((r) => r.id === selectedId)) {
      setSelectedId(roles.find((r) => !r.isSystem)?.id ?? roles[0].id);
    }
  }, [roles, selectedId]);

  const selected = roles?.find((r) => r.id === selectedId);

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Each user has one role. A role decides which screens and actions the user gets."
        actions={
          can('roles.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New role
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="lg:hidden">
          <NativeSelect value={selectedId ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} aria-label="Role">
            {roles?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.userCount} users)
              </option>
            ))}
          </NativeSelect>
        </div>
        <Card className="hidden h-fit overflow-hidden lg:block">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul className="divide-y">
              {roles?.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50',
                      r.id === selectedId && 'bg-accent text-accent-foreground hover:bg-accent',
                    )}
                    aria-current={r.id === selectedId}
                  >
                    {r.isSystem ? <ShieldCheck className="size-4 text-primary" /> : <span className="size-4" />}
                    <span className="flex-1 truncate font-medium">{r.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3" /> {r.userCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {selected ? <RoleEditor key={selected.id} role={selected} /> : <Skeleton className="h-96" />}
      </div>
      {creating && <NewRoleDialog onClose={(id) => { setCreating(false); if (id) setSelectedId(id); }} />}
    </>
  );
}

function RoleEditor({ role }: { role: Role }) {
  const { can } = useSession();
  const editable = can('roles.update') && !role.isSystem;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [granted, setGranted] = useState<Set<string>>(new Set(role.permissions));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    name !== role.name ||
    description !== (role.description ?? '') ||
    granted.size !== role.permissions.length ||
    role.permissions.some((p) => !granted.has(p));

  const save = useMutation({
    mutationFn: () => api<Role>(`/roles/${role.id}`, { method: 'PUT', body: { name, description, permissions: [...granted] } }),
    onSuccess: () => toast.success(`Role ${name} saved`),
    onError: (err) => showApiError(err),
  });
  const del = useDelete('/roles', 'Role', () => setConfirmDelete(false));

  const byCategory = useMemo(
    () => MODULE_CATEGORIES.map((c) => ({ category: c, modules: MODULES.filter((m) => m.category === c) })).filter((g) => g.modules.length),
    [],
  );

  const toggle = (keys: string[], on: boolean) => {
    setGranted((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };
  const state = (keys: string[]): boolean | 'indeterminate' => {
    const n = keys.filter((k) => granted.has(k)).length;
    return n === 0 ? false : n === keys.length ? true : 'indeterminate';
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[13px] font-medium">Role name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />
          </label>
          <label className="space-y-1.5">
            <span className="text-[13px] font-medium">Description</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} />
          </label>
        </div>
        <div className="flex gap-2">
          {can('roles.delete') && !role.isSystem && (
            <Button variant="outline" onClick={() => setConfirmDelete(true)} aria-label="Delete role">
              <Trash2 />
            </Button>
          )}
          {editable && (
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
              Save changes
            </Button>
          )}
        </div>
      </div>

      {role.isSystem ? (
        <div className="flex items-center gap-3 p-6 text-sm">
          <ShieldCheck className="size-5 text-primary" />
          <div>
            <div className="font-medium">Full access</div>
            <div className="text-muted-foreground">The Admin role always has every permission and cannot be changed or deleted.</div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Module</th>
                {ACTION_KEYS.map((a) => (
                  <th key={a} className="w-[72px] px-2 py-2.5 text-center font-semibold">
                    {ACTIONS[a]}
                  </th>
                ))}
              </tr>
            </thead>
            {byCategory.map((group) => {
              const groupKeys = group.modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`));
              return (
                <tbody key={group.category} className="border-t">
                  <tr className="bg-muted/25">
                    <td colSpan={ACTION_KEYS.length + 1} className="px-4 py-2">
                      <label className="flex items-center gap-2.5 text-[13px] font-semibold">
                        <Checkbox checked={state(groupKeys)} disabled={!editable} onCheckedChange={(c) => toggle(groupKeys, c === true)} aria-label={`All ${group.category} permissions`} />
                        {group.category}
                      </label>
                    </td>
                  </tr>
                  {group.modules.map((m) => {
                    const keys = m.actions.map((a) => `${m.key}.${a}`);
                    return (
                      <tr key={m.key} className="border-t border-border/60 hover:bg-muted/30">
                        <td className="px-4 py-2">
                          <label className="flex items-center gap-2.5">
                            <Checkbox checked={state(keys)} disabled={!editable} onCheckedChange={(c) => toggle(keys, c === true)} aria-label={`All ${m.label} permissions`} />
                            <span>{m.label}</span>
                            {m.phase > DELIVERED_PHASE && <Badge variant="muted">Phase {m.phase}</Badge>}
                          </label>
                        </td>
                        {ACTION_KEYS.map((a) => {
                          const key = `${m.key}.${a}`;
                          const applies = (m.actions as readonly string[]).includes(a);
                          return (
                            <td key={a} className="px-2 py-2 text-center">
                              {applies ? (
                                <Checkbox
                                  checked={granted.has(key)}
                                  disabled={!editable}
                                  onCheckedChange={(c) => toggle([key], c === true)}
                                  aria-label={`${m.label}: ${ACTIONS[a]}`}
                                />
                              ) : (
                                <span className="text-muted-foreground/40">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete role ${role.name}?`}
        description={role.userCount ? `${role.userCount} user(s) still have this role. Move them to another role first.` : 'This cannot be undone.'}
        loading={del.isPending}
        onConfirm={() => del.mutate(role.id)}
      />
    </Card>
  );
}

function NewRoleDialog({ onClose }: { onClose: (id?: number) => void }) {
  const form = useZodForm(roleSchema, { name: '', description: '', permissions: ['dashboard.view'] });
  const save = useSave<RoleInput, Role>({ path: '/roles', form, label: 'Role', onSaved: (r) => onClose(r.id) });
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New role"
      description="Create the role, then tick its permissions."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
    >
      <TextField form={form} name="name" label="Role name" placeholder="Machine Shop" required />
      <TextField form={form} name="description" label="Description" />
    </FormDialog>
  );
}

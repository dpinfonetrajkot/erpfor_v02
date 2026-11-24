'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Lock, LockOpen, Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import { resetPasswordSchema, userCreateSchema, userUpdateSchema, type ResetPasswordInput, type UserCreateInput, type UserUpdateInput } from '@bht/shared';
import { api } from '@/lib/api';
import { fromEntity, useZodForm } from '@/lib/forms';
import { fmtAgo } from '@/lib/format';
import { showApiError, useDelete, useLookups, usePaged, useSave } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenuItem } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { FormGrid, FormSheet, SelectField, SwitchField, TextField } from '@/components/app/form';
import { FormDialog } from '@/components/app/form-dialog';
import { PageHeader } from '@/components/app/page-header';
import { ACTIVE_FILTER_OPTIONS, ActiveBadge, RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { PasswordChecklist } from '@/components/app/password-checklist';

/** Seen within the last 2 minutes. */
const isOnline = (u: User) => !!u.lastSeenAt && Date.now() - new Date(u.lastSeenAt).getTime() < 120_000;
/** Locked right now after too many wrong passwords / codes. */
const isLocked = (u: User) => !!u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();

export default function UsersPage() {
  return (
    <RequirePermission permission="users.view">
      <Users />
    </RequirePermission>
  );
}

function Users() {
  const { can, user: me } = useSession();
  const params = useListParams();
  const { data, isFetching } = usePaged<User>('/users', params.query);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [resetting2fa, setResetting2fa] = useState<User | null>(null);
  const del = useDelete('/users', 'User', () => setDeleting(null));
  const unlock = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}/unlock`, { method: 'POST' }),
    onSuccess: (_r, u) => toast.success(`${u.name} is unlocked`),
    onError: (err) => showApiError(err),
  });
  const reset2fa = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}/reset-2fa`, { method: 'POST' }),
    onSuccess: (_r, u) => {
      toast.success(`2-step login of ${u.name} is off. They can sign in with the password and set it up again.`);
      setResetting2fa(null);
    },
    onError: (err) => showApiError(err),
  });

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        header: 'User',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {row.original.name.slice(0, 2).toUpperCase()}
              {isOnline(row.original) && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" title="Online" />}
            </span>
            <div>
              <div className="font-medium">
                {row.original.name} {row.original.id === me.id && <span className="text-xs text-muted-foreground">(you)</span>}
              </div>
              <div className="text-xs text-muted-foreground">@{row.original.username}</div>
            </div>
          </div>
        ),
      },
      { header: 'Role', id: 'role', cell: ({ row }) => <Badge variant="secondary">{row.original.role.name}</Badge> },
      { header: 'Contact', id: 'contact', cell: ({ row }) => <span className="text-[13px]">{row.original.phone ?? row.original.email ?? '—'}</span> },
      {
        header: 'Last seen',
        accessorKey: 'lastSeenAt',
        meta: { sortKey: 'lastSeenAt' },
        cell: ({ row }) => (isOnline(row.original) ? <span className="text-success">Online now</span> : <span className="text-muted-foreground">{fmtAgo(row.original.lastSeenAt)}</span>),
      },
      { header: 'Status', accessorKey: 'isActive', cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} /> },
      {
        header: 'Login safety',
        id: 'security',
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex flex-wrap gap-1">
              {u.twoFactorEnabledAt ? (
                <Badge variant="success">
                  <ShieldCheck /> 2-step on
                </Badge>
              ) : (
                <Badge variant="muted">2-step off</Badge>
              )}
              {isLocked(u) && (
                <Badge variant="destructive">
                  <Lock /> Locked
                </Badge>
              )}
              {u.mustChangePassword && <Badge variant="warning">New password due</Badge>}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions
            onEdit={can('users.update') ? () => setEditing(row.original) : undefined}
            onDelete={can('users.delete') && row.original.id !== me.id ? () => setDeleting(row.original) : undefined}
          >
            {can('users.update') && (
              <DropdownMenuItem onSelect={() => setResetting(row.original)}>
                <KeyRound /> Reset password
              </DropdownMenuItem>
            )}
            {can('users.update') && isLocked(row.original) && (
              <DropdownMenuItem onSelect={() => unlock.mutate(row.original)}>
                <LockOpen /> Unlock
              </DropdownMenuItem>
            )}
            {can('users.update') && row.original.twoFactorEnabledAt && row.original.id !== me.id && (
              <DropdownMenuItem onSelect={() => setResetting2fa(row.original)}>
                <ShieldOff /> Turn off 2-step login
              </DropdownMenuItem>
            )}
          </RowActions>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, me.id],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="People who can sign in. Disable a user to block access immediately."
        actions={
          can('users.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New user
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search name, username, role…"
        toolbar={<FilterSelect value={params.filters.active} onChange={(v) => params.set({ active: v })} options={ACTIVE_FILTER_OPTIONS} placeholder="All statuses" />}
        onRowClick={can('users.update') ? (u) => setEditing(u) : undefined}
      />
      {editing && <UserSheet user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete user?"
        description={<>@{deleting?.username} will be deleted. If this person has made records, disable the user instead to keep the history.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
      <ConfirmDialog
        open={!!resetting2fa}
        onOpenChange={(o) => !o && setResetting2fa(null)}
        title="Turn off 2-step login?"
        description={
          <>
            For a lost or changed phone. {resetting2fa?.name} is signed out everywhere, signs in again with the password only, and can then set up 2-step login on the new phone.
          </>
        }
        confirmLabel="Turn off"
        loading={reset2fa.isPending}
        onConfirm={() => resetting2fa && reset2fa.mutate(resetting2fa)}
      />
    </>
  );
}

function UserSheet({ user, onClose }: { user: User | null; onClose: () => void }) {
  const lookups = useLookups('roles');
  const roleOptions = (lookups.data?.roles ?? []).map((o) => ({ value: o.value, label: o.label }));
  return user ? (
    <EditUser user={user} roleOptions={roleOptions} onClose={onClose} />
  ) : (
    <CreateUser roleOptions={roleOptions} onClose={onClose} />
  );
}

type RoleOptions = { value: number; label: string }[];

function CreateUser({ roleOptions, onClose }: { roleOptions: RoleOptions; onClose: () => void }) {
  const defaults: z.input<typeof userCreateSchema> = { username: '', name: '', email: '', phone: '', roleId: '' as unknown as number, isActive: true, password: '', mustChangePassword: true };
  const form = useZodForm(userCreateSchema, defaults);
  const save = useSave<UserCreateInput>({ path: '/users', form, label: 'User', onSaved: onClose });
  const [password, username] = form.watch(['password', 'username']);
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="New user" onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="name" label="Full name" required className="sm:col-span-2" />
        <TextField form={form} name="username" label="Username" required autoComplete="off" hint="Used to sign in" />
        <SelectField form={form} name="roleId" label="Role" required numeric placeholder="Select role" options={roleOptions} />
        <TextField form={form} name="phone" label="Phone" inputMode="tel" />
        <TextField form={form} name="email" label="Email" type="email" />
        <TextField form={form} name="password" label="Password" type="password" required autoComplete="new-password" className="sm:col-span-2" />
        <PasswordChecklist password={password ?? ''} username={username} className="sm:col-span-2" />
      </FormGrid>
      <SwitchField form={form} name="mustChangePassword" label="Must choose own password at first sign-in" hint="Recommended: then only the user knows their password." />
      <SwitchField form={form} name="isActive" label="Can sign in" />
    </FormSheet>
  );
}

function EditUser({ user, roleOptions, onClose }: { user: User; roleOptions: RoleOptions; onClose: () => void }) {
  const { user: me } = useSession();
  const defaults: z.input<typeof userUpdateSchema> = { username: '', name: '', email: '', phone: '', roleId: '' as unknown as number, isActive: true };
  const form = useZodForm(userUpdateSchema, fromEntity(defaults, user));
  const save = useSave<UserUpdateInput>({ path: '/users', id: user.id, form, label: 'User', onSaved: onClose });
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title={`Edit ${user.name}`} description={`@${user.username}`} onSubmit={form.handleSubmit((v) => save.mutate(v))} saving={save.isPending}>
      <FormGrid>
        <TextField form={form} name="name" label="Full name" required className="sm:col-span-2" />
        <TextField form={form} name="username" label="Username" required />
        <SelectField form={form} name="roleId" label="Role" required numeric options={roleOptions} />
        <TextField form={form} name="phone" label="Phone" inputMode="tel" />
        <TextField form={form} name="email" label="Email" type="email" />
      </FormGrid>
      {user.id !== me.id && <SwitchField form={form} name="isActive" label="Can sign in" hint="Turning this off signs the user out everywhere at once." />}
    </FormSheet>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const form = useZodForm(resetPasswordSchema, { newPassword: '', mustChangePassword: true });
  const save = useSave<ResetPasswordInput>({ path: `/users/${user.id}/reset-password`, form, label: 'Password', successMessage: `Password of ${user.name} was reset`, onSaved: onClose });
  const newPassword = form.watch('newPassword');
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset password of ${user.name}`}
      description="The user is signed out everywhere, the account is unlocked, and they sign in with the new password."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      saving={save.isPending}
      submitLabel="Reset password"
    >
      <TextField form={form} name="newPassword" label="New password" type="text" autoComplete="off" required hint="Share it privately." />
      <PasswordChecklist password={newPassword ?? ''} username={user.username} />
      <SwitchField form={form} name="mustChangePassword" label="Must choose own password at next sign-in" />
    </FormDialog>
  );
}

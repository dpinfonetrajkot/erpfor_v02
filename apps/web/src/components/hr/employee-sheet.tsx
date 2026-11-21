'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import { departmentSchema, EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES, employeeSchema, GENDER_LABELS, GENDERS, type DepartmentInput, type EmployeeInput } from '@bht/shared';
import { api } from '@/lib/api';
import { fromEntity, useZodForm } from '@/lib/forms';
import { toInputDate } from '@/lib/format';
import { showApiError, useApiQuery, useLookups, useSave } from '@/hooks/use-api';
import type { Department, Employee } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ComboboxField, FormGrid, FormSection, FormSheet, SelectField, SwitchField, TextareaField, TextField } from '@/components/app/form';
import { useSession } from '@/components/app/session';

const defaults: z.input<typeof employeeSchema> = {
  empCode: '',
  name: '',
  gender: 'MALE',
  dateOfBirth: '',
  dateOfJoining: '',
  departmentId: '',
  designation: '',
  phone: '',
  email: '',
  address: '',
  basicSalary: '' as unknown as number,
  ctc: '',
  shiftHours: '8' as unknown as number,
  isPfEligible: false,
  uan: '',
  bankName: '',
  bankAccountNo: '',
  bankIfsc: '',
  status: 'ACTIVE',
  leftOn: '',
};

/** Add / edit an employee. The code is the user number on the biometric machine. */
export function EmployeeSheet({ employee, onClose }: { employee: Employee | null; onClose: (saved?: Employee) => void }) {
  const lookups = useLookups('departments');
  const form = useZodForm(
    employeeSchema,
    employee
      ? { ...fromEntity(defaults, employee), dateOfBirth: toInputDate(employee.dateOfBirth), dateOfJoining: toInputDate(employee.dateOfJoining), leftOn: toInputDate(employee.leftOn) }
      : defaults,
  );
  const status = useWatch({ control: form.control, name: 'status' });
  const save = useSave<EmployeeInput, Employee>({ path: '/employees', id: employee?.id, form, label: 'Employee', onSaved: (e) => onClose(e) });
  const [departments, setDepartments] = useState(false);

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={employee ? `${employee.empCode} · ${employee.name}` : 'New employee'}
        description="The employee code must be the same number as on the biometric machine."
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        saving={save.isPending}
      >
        <FormSection title="Employee">
          <FormGrid>
            <TextField form={form} name="empCode" label="Employee code" required inputClassName="font-mono" hint="Machine user no." />
            <TextField form={form} name="name" label="Full name" required inputClassName="uppercase" />
            <SelectField form={form} name="gender" label="Gender" options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
            <TextField form={form} name="dateOfBirth" label="Date of birth" type="date" />
            <TextField form={form} name="phone" label="Phone" />
            <TextField form={form} name="email" label="E-mail" type="email" />
          </FormGrid>
          <TextareaField form={form} name="address" label="Address" rows={2} />
        </FormSection>
        <FormSection title="Work">
          <FormGrid>
            <div className="flex items-end gap-1.5">
              <ComboboxField form={form} name="departmentId" label="Department" options={lookups.data?.departments} loading={lookups.isLoading} className="flex-1" />
              <Button type="button" variant="outline" size="icon" title="Departments" aria-label="Manage departments" onClick={() => setDepartments(true)}>
                <Plus />
              </Button>
            </div>
            <TextField form={form} name="designation" label="Designation" placeholder="Forging operator" />
            <TextField form={form} name="dateOfJoining" label="Joined on" type="date" />
            <SelectField form={form} name="status" label="Status" options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }))} />
            {status === 'LEFT' && <TextField form={form} name="leftOn" label="Left on" type="date" required />}
          </FormGrid>
        </FormSection>
        <FormSection title="Salary">
          <FormGrid>
            <TextField form={form} name="basicSalary" label="Basic salary (₹ / month)" type="number" min={0} step="0.01" required hint="Paid for 26 working days" />
            <TextField form={form} name="shiftHours" label="Shift hours" type="number" min={1} max={24} step="0.25" required hint="Hours a day; more or less is paid / cut by the hour" />
            <TextField form={form} name="ctc" label="CTC (₹ / year)" type="number" min={0} step="0.01" />
            <TextField form={form} name="uan" label="PF UAN" inputClassName="font-mono" />
          </FormGrid>
          <SwitchField form={form} name="isPfEligible" label="PF is deducted" hint="12% of basic, for the days paid" />
        </FormSection>
        <FormSection title="Bank (for salary transfer)">
          <FormGrid>
            <TextField form={form} name="bankName" label="Bank" />
            <TextField form={form} name="bankAccountNo" label="Account no." inputClassName="font-mono" />
            <TextField form={form} name="bankIfsc" label="IFSC" inputClassName="font-mono uppercase" />
          </FormGrid>
        </FormSection>
      </FormSheet>
      {departments && <DepartmentsDialog onClose={() => setDepartments(false)} />}
    </>
  );
}

/** Add, rename or delete departments. */
export function DepartmentsDialog({ onClose }: { onClose: () => void }) {
  const { can } = useSession();
  const list = useApiQuery<Department[]>('/departments');
  const form = useZodForm(departmentSchema, { name: '' });
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const add = useSave<DepartmentInput>({ path: '/departments', form, label: 'Department', onSaved: () => form.reset({ name: '' }) });
  const rename = useMutation({
    mutationFn: (d: { id: number; name: string }) => api(`/departments/${d.id}`, { method: 'PUT', body: { name: d.name } }),
    onSuccess: () => {
      toast.success('Department renamed');
      setEditing(null);
    },
    onError: (err) => showApiError(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast.success('Department deleted'),
    onError: (err) => showApiError(err),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Departments</DialogTitle>
          <DialogDescription>Used to group employees in attendance and payroll.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {(list.data ?? []).length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No departments yet.</li>}
          {(list.data ?? []).map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === d.id ? (
                <>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" aria-label="Department name" autoFocus />
                  <Button size="sm" onClick={() => rename.mutate({ id: d.id, name })} loading={rename.isPending}>
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium">{d.name}</span>
                  <span className="text-xs text-muted-foreground">{d._count?.employees ?? 0} employee(s)</span>
                  {can('employees.update') && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Rename ${d.name}`} onClick={() => (setEditing(d), setName(d.name))}>
                      <Pencil />
                    </Button>
                  )}
                  {can('employees.delete') && !d._count?.employees && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.name}`} onClick={() => remove.mutate(d.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={form.handleSubmit((v) => add.mutate(v))} className="flex items-start gap-2" noValidate>
          <div className="flex-1">
            <TextField form={form} name="name" label="New department" placeholder="Forging" />
          </div>
          <Button type="submit" className="mt-6" loading={add.isPending}>
            <Plus /> Add
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

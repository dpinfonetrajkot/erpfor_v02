'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Download, Plus } from 'lucide-react';
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES } from '@bht/shared';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { useDelete, useLookups, usePaged } from '@/hooks/use-api';
import { useListParams } from '@/hooks/use-list-params';
import type { Employee } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { DataTable, FilterSelect } from '@/components/app/data-table';
import { PageHeader } from '@/components/app/page-header';
import { RowActions } from '@/components/app/row-actions';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { DepartmentsDialog, EmployeeSheet } from '@/components/hr/employee-sheet';

export default function EmployeesPage() {
  return (
    <RequirePermission permission="employees.view">
      <Employees />
    </RequirePermission>
  );
}

function Employees() {
  const { can } = useSession();
  const router = useRouter();
  const params = useListParams({ filters: { status: 'ACTIVE' } });
  const status = params.filters.status === 'ALL' ? undefined : params.filters.status;
  const { data, isFetching } = usePaged<Employee>('/employees', { ...params.query, status });
  const lookups = useLookups('departments');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState(false);
  const del = useDelete('/employees', 'Employee', () => setDeleting(null));

  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'empCode',
        meta: { sortKey: 'empCode' },
        cell: ({ getValue }) => <span className="font-mono text-[13px] font-semibold">{getValue<string>()}</span>,
      },
      {
        header: 'Name',
        accessorKey: 'name',
        meta: { sortKey: 'name' },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            {row.original.designation && <div className="text-xs text-muted-foreground">{row.original.designation}</div>}
          </div>
        ),
      },
      { header: 'Department', id: 'department', meta: { sortKey: 'department' }, cell: ({ row }) => row.original.department?.name ?? <span className="text-muted-foreground">—</span> },
      { header: 'Joined', accessorKey: 'dateOfJoining', meta: { sortKey: 'dateOfJoining' }, cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue<string | null>())}</span> },
      {
        header: 'Basic',
        accessorKey: 'basicSalary',
        meta: { sortKey: 'basicSalary', align: 'right' },
        cell: ({ row }) => (
          <div className="text-right whitespace-nowrap">
            {fmtMoney(row.original.basicSalary)}
            <div className="text-xs text-muted-foreground">
              {fmtQty(row.original.shiftHours)} h shift{row.original.isPfEligible ? ' · PF' : ''}
            </div>
          </div>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) =>
          row.original.status === 'ACTIVE' ? (
            <Badge variant="success">{EMPLOYEE_STATUS_LABELS.ACTIVE}</Badge>
          ) : (
            <Badge variant="muted">Left {fmtDate(row.original.leftOn)}</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        meta: { className: 'w-12' },
        cell: ({ row }) => (
          <RowActions onEdit={can('employees.update') ? () => setEditing(row.original) : undefined} onDelete={can('employees.delete') ? () => setDeleting(row.original) : undefined} />
        ),
      },
    ],
    [can],
  );
  const exportQuery = new URLSearchParams(Object.entries({ status, departmentId: params.filters.departmentId, search: params.search }).filter((e): e is [string, string] => !!e[1]));

  return (
    <>
      <PageHeader
        title="Employees"
        description="The employee code is the user number on the biometric machine; punches are matched by it."
        actions={
          <>
            <Button variant="outline" onClick={() => setDepartments(true)}>
              <Building2 /> Departments
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/employees/export?${exportQuery.toString()}`}>
                <Download /> Excel (CSV)
              </a>
            </Button>
            {can('employees.create') && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> New employee
              </Button>
            )}
          </>
        }
      />
      <DataTable
        columns={columns}
        data={data?.data}
        total={data?.total}
        loading={isFetching}
        params={params}
        searchPlaceholder="Search code, name, phone, designation…"
        toolbar={
          <>
            <FilterSelect
              value={params.filters.departmentId}
              onChange={(v) => params.set({ departmentId: v })}
              options={(lookups.data?.departments ?? []).map((o) => ({ value: o.value, label: o.label }))}
              placeholder="All departments"
            />
            <FilterSelect
              value={params.filters.status}
              onChange={(v) => params.set({ status: v ?? 'ACTIVE' })}
              options={[...EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] })), { value: 'ALL', label: 'Working + left' }]}
              placeholder="Status"
            />
          </>
        }
        onRowClick={(e) => router.push(`/hr/employees/${e.id}`)}
        empty={{ title: 'No employees', description: 'Add employees with the same code as on the biometric machine, or import them from the old ERP.' }}
      />
      {editing && <EmployeeSheet employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {departments && <DepartmentsDialog onClose={() => setDepartments(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete employee?"
        description={<>{deleting?.name} will be deleted. Someone with attendance, leave, loans or payslips cannot be deleted — mark them as Left instead.</>}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}

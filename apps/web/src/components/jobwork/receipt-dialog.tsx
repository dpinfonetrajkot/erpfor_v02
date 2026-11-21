'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { showApiError } from '@/hooks/use-api';
import type { JobWorkOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/app/form';

interface Row {
  received: string;
  accepted: string;
  heatId: string;
  remarks: string;
}

/** Parts back from the vendor: received, accepted by our QC (into FG stock under the heat), rejected with reason. */
export function ReceiptDialog({ jwo, onClose }: { jwo: JobWorkOrder; onClose: () => void }) {
  const open = jwo.lines.filter((l) => l.quantity - l.receivedQty > 0);
  const heats = jwo.heatsIssued;
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(open.map((l) => [l.id, { received: '', accepted: '', heatId: heats.length === 1 ? String(heats[0].heatId) : '', remarks: '' }])),
  );
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorChallan, setVendorChallan] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const set = (id: number, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });

  const save = useMutation({
    mutationFn: () =>
      api<{ receiptNo: string }>(`/job-work-orders/${jwo.id}/receipts`, {
        method: 'POST',
        body: {
          receiptDate,
          vendorChallan,
          inspectorName,
          lines: open.map((l) => {
            const r = rows[l.id];
            return {
              jobWorkOrderLineId: l.id,
              receivedQty: Number(r.received) || 0,
              acceptedQty: r.accepted === '' ? Number(r.received) || 0 : Number(r.accepted),
              heatId: r.heatId,
              remarks: r.remarks,
            };
          }),
        },
      }),
    onSuccess: (r) => {
      toast.success(`${r.receiptNo} saved; accepted parts are in the FG store`);
      onClose();
    },
    onError: (err) => showApiError(err),
  });

  const totalIn = open.reduce((s, l) => s + (Number(rows[l.id].received) || 0), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive parts · {jwo.jwoNo}</DialogTitle>
          <DialogDescription>
            From {jwo.supplier.name}. Accepted pieces go into the FG store under the heat they were made from; rejected ones stay pending with the vendor.
          </DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-3">
          <Field label="Receipt date" required>
            <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
          </Field>
          <Field label="Vendor challan no.">
            <Input value={vendorChallan} onChange={(e) => setVendorChallan(e.target.value)} />
          </Field>
          <Field label="Inspected by">
            <Input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} />
          </Field>
        </FormGrid>
        <div className="max-h-[50vh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Part</th>
                <th className="w-20 px-2 py-2 text-right">Pending</th>
                <th className="w-24 px-2 py-2 text-right">Received</th>
                <th className="w-24 px-2 py-2 text-right">Accepted</th>
                <th className="w-20 px-2 py-2 text-right">Rejected</th>
                {heats.length > 0 && <th className="w-36 px-2 py-2 text-left">Heat</th>}
              </tr>
            </thead>
            <tbody>
              {open.map((l) => {
                const r = rows[l.id];
                const received = Number(r.received) || 0;
                const accepted = r.accepted === '' ? received : Number(r.accepted) || 0;
                const rejected = Math.max(0, received - accepted);
                return (
                  <tr key={l.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{l.item.code}</div>
                      {rejected > 0 && (
                        <Input
                          value={r.remarks}
                          onChange={(e) => set(l.id, { remarks: e.target.value })}
                          placeholder="Reason for rejection *"
                          className="mt-1.5 h-8 border-destructive/50 text-[13px]"
                          aria-label={`Rejection reason ${l.item.name}`}
                        />
                      )}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right">{fmtQty(l.quantity - l.receivedQty)}</td>
                    <td className="px-2 py-1.5">
                      <Input type="number" min={0} step={1} value={r.received} onChange={(e) => set(l.id, { received: e.target.value })} className="h-8 text-right" aria-label={`Received ${l.item.name}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={r.accepted}
                        placeholder={r.received || '0'}
                        onChange={(e) => set(l.id, { accepted: e.target.value })}
                        className="h-8 text-right"
                        aria-label={`Accepted ${l.item.name}`}
                      />
                    </td>
                    <td className={cn('tabular px-2 py-2.5 text-right', rejected > 0 && 'font-semibold text-destructive')}>{fmtQty(rejected)}</td>
                    {heats.length > 0 && (
                      <td className="px-2 py-1.5">
                        <NativeSelect value={r.heatId} onChange={(e) => set(l.id, { heatId: e.target.value })} className="h-8" aria-label={`Heat ${l.item.name}`}>
                          <option value="">Heat…</option>
                          {heats.map((h) => (
                            <option key={h.heatId} value={h.heatId}>
                              {h.heatNo}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter className="items-center pt-2">
          <span className="mr-auto text-sm text-muted-foreground">{fmtQty(totalIn)} pcs received</span>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={totalIn <= 0}>
            Save receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

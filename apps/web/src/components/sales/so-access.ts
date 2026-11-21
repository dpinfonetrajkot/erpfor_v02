import { APPROVAL_STAGE_PERMISSION, APPROVAL_STAGES } from '@bht/shared';

/** Sales, the three approvers and production planning all work from sales orders. */
export const SO_READERS = ['sales_orders.view', ...APPROVAL_STAGES.map((s) => APPROVAL_STAGE_PERMISSION[s]), 'stock_check.view'];

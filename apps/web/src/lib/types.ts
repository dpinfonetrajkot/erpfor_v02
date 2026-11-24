import type {
  Currency,
  EndConnection,
  GstType,
  HeatStatus,
  PoStatus,
  QcStatus,
  StockLocation,
  MaterialShape,
  ResetPeriod,
  StageType,
  SupplierType,
  ToolStatus,
  ToolType,
  Unit,
  UserPreferences,
} from '@bht/shared';

/** Shapes returned by the API (dates arrive as ISO strings). */

interface Party {
  id: number;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string;
  paymentTermsDays: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Customer extends Party {
  shippingAddress: string | null;
  currency: Currency;
}

export interface Supplier extends Party {
  type: SupplierType;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
}

export interface ProductCategory {
  id: number;
  name: string;
  description: string | null;
  _count: { products: number };
}

export interface PartType {
  id: number;
  name: string;
  hasEndConnection: boolean;
  sortOrder: number;
  _count: { items: number };
}

export interface Product {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  category: { id: number; name: string };
  size: string | null;
  figure: string | null;
  pressureRating: string | null;
  hsnCode: string | null;
  description: string | null;
  isActive: boolean;
  components: { partTypeId: number; quantity: number; partType: { name: string; hasEndConnection: boolean } }[];
  _count: { items: number };
}

export interface Item {
  id: number;
  code: string;
  name: string;
  productId: number;
  partTypeId: number;
  endConnection: EndConnection;
  materialGradeId: number | null;
  rawMaterialId: number | null;
  drawingNo: string | null;
  finishedWeightKg: number | null;
  inputWeightKg: number | null;
  uom: Unit;
  minPrice: number | null;
  hsnCode: string | null;
  description: string | null;
  isActive: boolean;
  product: { id: number; name: string };
  partType: { id: number; name: string };
  materialGrade: { id: number; name: string } | null;
  rawMaterial: { id: number; code: string; size: string; grade: { name: string } } | null;
  stockQty: number;
}

export interface MaterialGrade {
  id: number;
  name: string;
  heatCode: string | null;
  standard: string | null;
  description: string | null;
  isActive: boolean;
  _count: { rawMaterials: number };
}

export interface RawMaterial {
  id: number;
  code: string;
  gradeId: number;
  grade: { id: number; name: string };
  shape: MaterialShape;
  size: string;
  sizeMm: number | null;
  densityKgM3: number | null;
  uom: Unit;
  reorderLevel: number | null;
  isActive: boolean;
  stockQty: number;
  belowReorder: boolean;
  _count: { heats: number };
}

export interface Heat {
  id: number;
  heatNo: string;
  millHeatNo: string | null;
  rawMaterialId: number;
  supplierId: number | null;
  receivedDate: string | null;
  status: HeatStatus;
  remarks: string | null;
  createdAt: string;
  rawMaterial: { id: number; code: string; size: string; grade: { id: number; name: string } };
  supplier: { id: number; name: string } | null;
  stockQty: number;
}

export interface ProcessStage {
  id: number;
  code: string;
  name: string;
  sequence: number;
  type: StageType;
  captureWeights: boolean;
  requiresReport: boolean;
  isMaterialCheck: boolean;
  description: string | null;
  isActive: boolean;
  roles: { id: number; name: string }[];
  roleIds: number[];
}

export interface Tool {
  id: number;
  code: string;
  name: string;
  type: ToolType;
  itemId: number | null;
  item: { id: number; code: string; name: string } | null;
  location: string | null;
  purchaseDate: string | null;
  lifeShots: number | null;
  status: ToolStatus;
  description: string | null;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleId: number;
  role: { id: number; name: string };
  isActive: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  /** An admin set the password; the user chooses their own at the next sign-in. */
  mustChangePassword: boolean;
  /** Locked after too many wrong passwords / codes until this time. */
  lockedUntil: string | null;
  /** 2-step login on since. */
  twoFactorEnabledAt: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export interface Company {
  id: number;
  code: string;
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  gstin: string | null;
  pan: string | null;
  iecCode: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  swiftCode: string | null;
  invoiceTerms: string | null;
  purchaseTerms: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface DocumentSeriesRow {
  code: string;
  name: string;
  template: string;
  resetPeriod: ResetPeriod;
  nextNumber: string;
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  changes: unknown;
  ip: string | null;
  createdAt: string;
  user: { id: number; username: string; name: string } | null;
}

export interface Attachment {
  id: number;
  entity: string;
  entityId: number;
  category: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DashboardSummary {
  counts: {
    customers: number;
    suppliers: number;
    products: number;
    items: number;
    rawMaterials: number;
    activeHeats: number;
    activeUsers: number;
  };
  tasks: {
    prPending: number | null;
    poToApprove: number | null;
    poOpen: number | null;
    grnPendingQc: number | null;
    soFeasibility: number | null;
    soDesign: number | null;
    soProduction: number | null;
    soToPlan: number | null;
    productionRequests: number | null;
    rcAtMyStages: number | null;
    mrToIssue: number | null;
    completionsToMove: number | null;
    jwToPlan: number | null;
    jwMaterialToSend: number | null;
    jwToReceive: number | null;
    toPack: number | null;
    toInvoice: number | null;
    invoicesToIssue: number | null;
    toDispatch: number | null;
    overdueInvoices: number | null;
    leavesToApprove: number | null;
    punchesToFix: number | null;
    unknownCodes: number | null;
    devicesWaiting: number | null;
    safetyDue: number | null;
    payrollToPrepare: number | null;
    payrollLastMonth: string;
    draftPayrolls: number | null;
  };
  stock: { rawMaterialKg: number; finishedGoodsPcs: number };
  /** null = the user may not see that screen */
  charts: {
    orders: { status: string; orders: number }[] | null;
    production: { month: string; made: number; jobWork: number }[] | null;
    rmByGrade: { grade: string; kg: number }[] | null;
  };
  lowStock: { id: number; code: string; grade: string; size: string; stock: number; reorderLevel: number }[];
  recentActivity: { id: number; action: string; summary: string | null; createdAt: string; user: { name: string } | null }[];
  /** null = the user may not see sales orders */
  dueOrders:
    | { id: number; soNo: string; status: string; expectedDelivery: string; totalAmount: number; currency: string; customer: { name: string } }[]
    | null;
  /** open orders with a promised date: on time vs late; null = the user may not see sales orders */
  orderTiming: { onTrack: number; late: number } | null;
  /** people who changed things in the last 7 days, most active first; null = no audit-log permission */
  team: { id: number; name: string; style: UserPreferences['avatar'] | null; changes: number }[] | null;
  /** open route cards by the stage they are at; null = no route-card permission */
  wip: { stage: string; cards: number; pcs: number }[] | null;
  /** first-steps checklist for admins; null for everyone else */
  setup: Record<'company' | 'users' | 'customers' | 'suppliers' | 'products' | 'rawMaterials' | 'employees', boolean> | null;
}

export interface SearchHit {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

// ------------------------------------------------------------------ phase 2

type RawMaterialRef = { id: number; code: string; size: string; uom: Unit; grade: { name: string } };

export interface PurchaseRequisition {
  id: number;
  prNo: string;
  prDate: string;
  rawMaterialId: number;
  rawMaterial: RawMaterialRef;
  quantity: number;
  requiredBy: string | null;
  source: 'MANUAL' | 'MATERIAL_REQUISITION' | 'JOB_WORK' | 'REORDER';
  status: 'PENDING' | 'ORDERED' | 'CANCELLED';
  remarks: string | null;
  createdAt: string;
  purchaseOrderLines: { purchaseOrder: { id: number; poNo: string; status: PoStatus } }[];
}

export interface ReorderSuggestion {
  rawMaterialId: number;
  code: string;
  grade: string;
  size: string;
  stock: number;
  reorderLevel: number;
  shortfall: number;
}

export interface PurchaseOrderRow {
  id: number;
  poNo: string;
  poDate: string;
  status: PoStatus;
  grandTotal: number;
  currency: Currency;
  expectedDelivery: string | null;
  emailedAt: string | null;
  type: 'MATERIAL' | 'JOB_WORK';
  supplier: { id: number; name: string };
  company: { id: number; code: string };
  jobWorkOrder: { id: number; jwoNo: string } | null;
  _count: { lines: number; goodsReceipts: number };
}

export interface PurchaseOrder extends Omit<PurchaseOrderRow, '_count' | 'supplier' | 'company'> {
  companyId: number;
  supplierId: number;
  quotationRef: string | null;
  deliveryAddress: string | null;
  paymentTerms: string | null;
  gstType: GstType;
  subTotal: number;
  discountPercent: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  freight: number;
  roundOff: number;
  terms: string | null;
  notes: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  company: Company;
  supplier: Supplier;
  lines: {
    id: number;
    lineNo: number;
    rawMaterialId: number | null;
    rawMaterial: RawMaterialRef | null;
    itemId: number | null;
    item: { id: number; code: string; name: string } | null;
    purchaseRequisitionId: number | null;
    purchaseRequisition: { id: number; prNo: string } | null;
    description: string | null;
    quantity: number;
    uom: Unit;
    rate: number;
    amount: number;
    receivedQty: number;
  }[];
  goodsReceipts: { id: number; grnNo: string; grnDate: string; status: GrnStatus }[];
}

export type GrnStatus = 'PENDING_QC' | 'COMPLETED';

export interface GoodsReceiptRow {
  id: number;
  grnNo: string;
  grnDate: string;
  status: GrnStatus;
  vehicleNo: string | null;
  supplierChallan: string | null;
  supplier: { id: number; name: string };
  purchaseOrder: { id: number; poNo: string } | null;
  lines: { receivedQty: number; qcStatus: QcStatus; rawMaterial: { size: string; grade: { name: string } } }[];
}

export interface GoodsReceipt {
  id: number;
  grnNo: string;
  grnDate: string;
  status: GrnStatus;
  supplierId: number;
  purchaseOrderId: number | null;
  supplierChallan: string | null;
  supplierInvoice: string | null;
  vehicleNo: string | null;
  remarks: string | null;
  createdAt: string;
  supplier: { id: number; code: string; name: string };
  purchaseOrder: { id: number; poNo: string; status: PoStatus } | null;
  lines: {
    id: number;
    purchaseOrderLineId: number | null;
    rawMaterialId: number;
    rawMaterial: RawMaterialRef & { grade: { id: number; name: string; heatCode: string | null } };
    millHeatNo: string | null;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    qcStatus: QcStatus;
    qcRemarks: string | null;
    inspectedAt: string | null;
    heat: { id: number; heatNo: string } | null;
    purchaseOrderLine: { id: number; lineNo: number; quantity: number; receivedQty: number } | null;
  }[];
}

export interface PoOption {
  id: number;
  poNo: string;
  poDate: string;
  lines: { id: number; lineNo: number; rawMaterialId: number; label: string; uom: Unit; ordered: number; accepted: number; awaitingQc: number; pending: number }[];
}

export interface StockBalanceRow {
  id: number;
  kind: 'RAW_MATERIAL' | 'FINISHED_GOOD';
  location: StockLocation;
  quantity: number;
  rawMaterial: { id: number; code: string; size: string; uom: Unit; grade: { id: number; name: string } } | null;
  item: { id: number; code: string; name: string; uom: Unit } | null;
  heat: { id: number; heatNo: string; millHeatNo: string | null; receivedDate: string | null; status: HeatStatus; supplier: { name: string } | null } | null;
}

export interface LedgerRow {
  id: number;
  date: string;
  kind: 'RAW_MATERIAL' | 'FINISHED_GOOD';
  location: StockLocation;
  qtyIn: number;
  qtyOut: number;
  refType: string;
  refNo: string | null;
  remarks: string | null;
  createdAt: string;
  rawMaterial: { code: string; size: string; grade: { name: string } } | null;
  item: { code: string; name: string } | null;
  heat: { id: number; heatNo: string } | null;
}

// ------------------------------------------------------------------ phase 3

export type SoStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'IN_PRODUCTION' | 'PARTIALLY_DISPATCHED' | 'DISPATCHED' | 'CLOSED' | 'CANCELLED';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED';
export type LineDecision = 'PENDING' | 'INHOUSE' | 'OUTSOURCE' | 'FROM_STOCK';
export type RequestStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';

export interface SalesOrderRow {
  id: number;
  soNo: string;
  soDate: string;
  customerPoNo: string | null;
  expectedDelivery: string | null;
  totalAmount: number;
  currency: Currency;
  status: SoStatus;
  feasibilityStatus: ApprovalState;
  designStatus: ApprovalState;
  productionStatus: ApprovalState;
  customer: { id: number; name: string };
  salesPerson: { id: number; name: string } | null;
  lines: { quantity: number; product: { name: string } }[];
}

export interface SalesOrderLine {
  id: number;
  lineNo: number;
  productId: number;
  product: {
    id: number;
    code: string;
    name: string;
    components: { partTypeId: number; quantity: number; partType: { name: string; hasEndConnection: boolean } }[];
  };
  endConnection: EndConnection;
  service: 'STD' | 'SOUR';
  schedule: string | null;
  materialGradeId: number | null;
  materialGrade: { id: number; name: string } | null;
  quantity: number;
  rate: number;
  amount: number;
  decision: LineDecision;
  dispatchedQty: number;
  remarks: string | null;
  productionRequests: { id: number; requestNo: string; itemId: number; quantity: number; status: RequestStatus }[];
  jobWorkLines: { itemId: number; quantity: number; receivedQty: number; jobWorkOrder: { id: number; jwoNo: string; status: JwoStatus } }[];
}

export interface SalesOrder extends Omit<SalesOrderRow, 'customer' | 'lines'> {
  customerId: number;
  customerPoDate: string | null;
  exchangeRate: number;
  salesPersonId: number | null;
  additionalRequirement: string | null;
  notes: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  customer: {
    id: number;
    code: string;
    name: string;
    currency: Currency;
    gstin: string | null;
    city: string | null;
    country: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
  };
  lines: SalesOrderLine[];
  approvals: {
    id: number;
    stage: 'FEASIBILITY' | 'DESIGN' | 'PRODUCTION';
    decision: ApprovalState;
    remarks: string | null;
    createdAt: string;
    user: { id: number; name: string };
  }[];
}

export interface StockCheckPart {
  partTypeId: number;
  partName: string;
  perSet: number;
  item: { id: number; code: string; name: string } | null;
  needed: number;
  inStock: number;
  requested: number;
  /** Still to come back from job-work vendors. */
  withVendor: number;
  shortage: number;
}

export interface StockCheck {
  salesOrderId: number;
  soNo: string;
  status: SoStatus;
  lines: {
    lineId: number;
    lineNo: number;
    product: { id: number; name: string };
    endConnection: EndConnection;
    service: 'STD' | 'SOUR';
    quantity: number;
    dispatchedQty: number;
    decision: LineDecision;
    setsFromStock: number;
    parts: StockCheckPart[];
  }[];
}

export interface ProductionRequestRow {
  id: number;
  requestNo: string;
  type: 'MAKE_TO_ORDER' | 'MAKE_TO_STOCK';
  quantity: number;
  status: RequestStatus;
  requiredBy: string | null;
  remarks: string | null;
  cancelReason: string | null;
  createdAt: string;
  item: { id: number; code: string; name: string };
  salesOrderLine: {
    id: number;
    lineNo: number;
    salesOrder: { id: number; soNo: string; expectedDelivery: string | null; customer: { name: string } };
  } | null;
  routeCards: { id: number; rcNo: string; status: RcStatus }[];
}

// ------------------------------------------------------------------ phase 4

export type RcStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';
export type OperationStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type MrStatus = 'PENDING' | 'PARTIAL' | 'ISSUED' | 'CANCELLED';

export interface StageInfo {
  id: number;
  code: string;
  name: string;
  type: StageType;
  captureWeights: boolean;
  requiresReport: boolean;
  isMaterialCheck: boolean;
  roles: { role: { id: number; name: string } }[];
}

export interface RouteCardRow {
  id: number;
  rcNo: string;
  rcDate: string;
  plannedQty: number;
  extraQty: number;
  completedQty: number;
  rejectedQty: number;
  expectedDelivery: string | null;
  status: RcStatus;
  item: { id: number; code: string; name: string };
  currentStage: { id: number; name: string } | null;
  productionRequest: { id: number; requestNo: string; type: 'MAKE_TO_ORDER' | 'MAKE_TO_STOCK' } | null;
  salesOrderLine: { salesOrder: { id: number; soNo: string; customer: { name: string } } } | null;
  stagesTotal: number;
  stagesDone: number;
  finalOkQty: number | null;
  materialIssued: boolean;
}

export interface RcOperation {
  id: number;
  sequence: number;
  status: OperationStatus;
  receivedQty: number | null;
  okQty: number | null;
  rejectedQty: number | null;
  rejectionReason: string | null;
  inputWeightKg: number | null;
  outputWeightKg: number | null;
  scrapWeightKg: number | null;
  operatorName: string | null;
  machine: string | null;
  readings: { result?: 'OK' | 'NOT_OK' } | null;
  remarks: string | null;
  completedAt: string | null;
  stage: StageInfo;
  updatedBy: { id: number; name: string } | null;
  reports: number;
  canRecord: boolean;
  lockedReason: string | null;
}

export interface IssuedHeat {
  heatId: number;
  heatNo: string;
  millHeatNo: string | null;
  quantity: number;
}

export interface RouteCard {
  id: number;
  rcNo: string;
  rcDate: string;
  status: RcStatus;
  plannedQty: number;
  extraQty: number;
  completedQty: number;
  rejectedQty: number;
  inputWeightKg: number | null;
  expectedDelivery: string | null;
  remarks: string | null;
  cancelReason: string | null;
  createdAt: string;
  rawMaterialId: number | null;
  item: { id: number; code: string; name: string; endConnection: EndConnection; drawingNo: string | null; partType: { name: string }; product: { id: number; name: string } };
  rawMaterial: { id: number; code: string; size: string; uom: string; grade: { name: string } } | null;
  productionRequest: { id: number; requestNo: string; type: 'MAKE_TO_ORDER' | 'MAKE_TO_STOCK'; quantity: number; status: RequestStatus; requiredBy: string | null; remarks: string | null } | null;
  salesOrderLine: {
    id: number;
    lineNo: number;
    service: 'STD' | 'SOUR';
    schedule: string | null;
    salesOrder: { id: number; soNo: string; customerPoNo: string | null; customer: { id: number; name: string } };
  } | null;
  currentStage: { id: number; name: string } | null;
  createdBy: { id: number; name: string } | null;
  operations: RcOperation[];
  materialRequisitions: {
    id: number;
    mrNo: string;
    mrDate: string;
    requestedQty: number;
    issuedQty: number;
    status: MrStatus;
    remarks: string | null;
    createdBy: { id: number; name: string } | null;
  }[];
  materialIssues: {
    id: number;
    issueDate: string;
    quantity: number;
    remarks: string | null;
    heat: { id: number; heatNo: string; millHeatNo: string | null };
    issuedBy: { id: number; name: string };
    materialRequisition: { id: number; mrNo: string } | null;
  }[];
  completions: {
    id: number;
    slipNo: string;
    okQty: number;
    status: 'PENDING' | 'MOVED_TO_STOCK';
    movedAt: string | null;
    movedBy: { id: number; name: string } | null;
    heats: { heatId: number; quantity: number; heat: { id: number; heatNo: string } }[];
  }[];
  material: { neededKg: number | null; requestedKg: number; issuedKg: number };
  heats: IssuedHeat[];
}

export interface RcDefaults {
  request: {
    id: number;
    requestNo: string;
    type: 'MAKE_TO_ORDER' | 'MAKE_TO_STOCK';
    quantity: number;
    status: RequestStatus;
    requiredBy: string | null;
    remarks: string | null;
    item: { id: number; code: string; name: string };
    salesOrderLine: { salesOrder: { id: number; soNo: string; customer: { name: string } } } | null;
  };
  stages: StageInfo[];
  stageIds: number[];
  stagesFrom: string | null;
  rawMaterialId: number | null;
  inputWeightKg: number | null;
}

export interface MaterialRequestRow {
  id: number;
  mrNo: string;
  mrDate: string;
  requestedQty: number;
  issuedQty: number;
  status: MrStatus;
  remarks: string | null;
  inStoreKg: number;
  routeCard: { id: number; rcNo: string; status: RcStatus; plannedQty: number; extraQty: number; item: { id: number; code: string; name: string } };
  rawMaterial: { id: number; code: string; size: string; uom: string; grade: { name: string } };
  createdBy: { id: number; name: string } | null;
  issues: { id: number; quantity: number; issueDate: string; heat: { id: number; heatNo: string }; issuedBy: { name: string } }[];
  purchaseRequisitions: { id: number; prNo: string; quantity: number; status: string }[];
}

export interface HeatInStore {
  id: number;
  heatNo: string;
  millHeatNo: string | null;
  receivedDate: string | null;
  status: HeatStatus;
  supplier: { name: string } | null;
  quantity: number;
}

export interface CompletionRow {
  id: number;
  slipNo: string;
  okQty: number;
  status: 'PENDING' | 'MOVED_TO_STOCK';
  createdAt: string;
  movedAt: string | null;
  movedBy: { id: number; name: string } | null;
  routeCard: {
    id: number;
    rcNo: string;
    plannedQty: number;
    extraQty: number;
    item: { id: number; code: string; name: string };
    productionRequest: { requestNo: string; type: 'MAKE_TO_ORDER' | 'MAKE_TO_STOCK' } | null;
    salesOrderLine: { salesOrder: { id: number; soNo: string; customer: { name: string } } } | null;
  };
  heats: { heatId: number; quantity: number; heat: { id: number; heatNo: string } }[];
  issuedHeats: IssuedHeat[];
}

// ------------------------------------------------------------------ phase 5

export type JwoStatus = 'OPEN' | 'MATERIAL_ISSUED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';

export interface JobWorkOrderRow {
  id: number;
  jwoNo: string;
  jwoDate: string;
  expectedDate: string | null;
  status: JwoStatus;
  challanNo: string | null;
  supplier: { id: number; name: string };
  salesOrder: { id: number; soNo: string; customer: { name: string } } | null;
  lines: { quantity: number; receivedQty: number; item: { name: string } }[];
  materials: { quantity: number; issuedQty: number; status: MrStatus }[];
  purchaseOrders: { id: number; poNo: string; status: PoStatus }[];
}

export interface JobWorkReceipt {
  id: number;
  receiptNo: string;
  receiptDate: string;
  vendorChallan: string | null;
  inspectorName: string | null;
  remarks: string | null;
  createdBy: { id: number; name: string } | null;
  lines: {
    id: number;
    jobWorkOrderLineId: number;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    remarks: string | null;
    item: { id: number; code: string; name: string };
    heat: { id: number; heatNo: string } | null;
  }[];
}

export interface JobWorkOrder {
  id: number;
  jwoNo: string;
  jwoDate: string;
  expectedDate: string | null;
  status: JwoStatus;
  challanNo: string | null;
  remarks: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  createdAt: string;
  supplierId: number;
  salesOrderId: number | null;
  supplier: { id: number; code: string; name: string; type: SupplierType; gstin: string | null; city: string | null; contactPerson: string | null; phone: string | null; email: string | null };
  salesOrder: { id: number; soNo: string; customerPoNo: string | null; expectedDelivery: string | null; customer: { id: number; name: string } } | null;
  createdBy: { id: number; name: string } | null;
  lines: {
    id: number;
    itemId: number;
    salesOrderLineId: number | null;
    quantity: number;
    receivedQty: number;
    rejectedQty: number;
    rate: number;
    remarks: string | null;
    item: { id: number; code: string; name: string; drawingNo: string | null };
  }[];
  materials: {
    id: number;
    rawMaterialId: number;
    quantity: number;
    issuedQty: number;
    status: MrStatus;
    rawMaterial: { id: number; code: string; size: string; uom: string; grade: { name: string } };
    issues: { id: number; issueDate: string; quantity: number; remarks: string | null; heat: { id: number; heatNo: string; millHeatNo: string | null }; issuedBy: { id: number; name: string } }[];
  }[];
  receipts: JobWorkReceipt[];
  purchaseOrders: { id: number; poNo: string; status: PoStatus; grandTotal: number }[];
  charges: number;
  heatsAtVendor: IssuedHeat[];
  heatsUsed: IssuedHeat[];
  heatsIssued: IssuedHeat[];
}

export interface JwoDefaults {
  salesOrder: { id: number; soNo: string; status: SoStatus; expectedDelivery: string | null; customer: { name: string } };
  lines: { salesOrderLineId: number; product: string; itemId: number; item: { id: number; code: string; name: string }; quantity: number }[];
  materials: { rawMaterialId: number; quantity: number }[];
}

export interface JobWorkMaterialRow {
  id: number;
  rawMaterialId: number;
  quantity: number;
  issuedQty: number;
  status: MrStatus;
  inStoreKg: number;
  rawMaterial: { id: number; code: string; size: string; uom: string; grade: { name: string } };
  jobWorkOrder: { id: number; jwoNo: string; jwoDate: string; status: JwoStatus; supplier: { id: number; name: string } };
}

export interface JobWorkReceiptRow extends JobWorkReceipt {
  jobWorkOrder: { id: number; jwoNo: string; supplier: { name: string } };
}

// ------------------------------------------------------------------ phase 6

export type AssemblyStatus = 'PACKED' | 'INVOICED' | 'DISPATCHED' | 'CANCELLED';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
export type InvoiceType = 'TAX_INVOICE' | 'EXPORT_INVOICE' | 'PROFORMA';
export type PayStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface OrderProgressLine {
  lineId: number;
  lineNo: number;
  product: { id: number; name: string };
  endConnection: EndConnection;
  ordered: number;
  packed: number;
  invoiced: number;
  dispatched: number;
}

export interface PackPlan {
  salesOrder: { id: number; soNo: string; status: SoStatus; customerPoNo: string | null; customer: { name: string } };
  lines: {
    lineId: number;
    lineNo: number;
    product: { id: number; name: string };
    endConnection: EndConnection;
    ordered: number;
    packed: number;
    remaining: number;
    canPack: number;
    parts: {
      partName: string;
      perSet: number;
      item: { id: number; code: string; name: string } | null;
      inStock: number;
      heats: { heatId: number | null; heatNo: string | null; quantity: number }[];
    }[];
  }[];
}

export interface AssemblyRow {
  id: number;
  assemblyNo: string;
  assemblyDate: string;
  status: AssemblyStatus;
  packingType: string | null;
  salesOrder: { id: number; soNo: string; customer: { name: string } };
  lines: { quantity: number; salesOrderLine: { product: { name: string } } }[];
  invoices: { id: number; invoiceNo: string; status: InvoiceStatus }[];
}

export interface Assembly {
  id: number;
  assemblyNo: string;
  assemblyDate: string;
  status: AssemblyStatus;
  packingType: string | null;
  packedBy: string | null;
  packages: number | null;
  grossWeightKg: number | null;
  remarks: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  salesOrder: { id: number; soNo: string; status: SoStatus; customerPoNo: string | null; customer: { id: number; name: string } };
  lines: {
    id: number;
    quantity: number;
    salesOrderLine: { id: number; lineNo: number; quantity: number; rate: number; endConnection: EndConnection; service: 'STD' | 'SOUR'; schedule: string | null; product: { id: number; name: string; hsnCode: string | null } };
  }[];
  consumptions: {
    id: number;
    quantity: number;
    item: { id: number; code: string; name: string; productId: number; partType: { name: string } };
    heat: { id: number; heatNo: string; millHeatNo: string | null } | null;
  }[];
  invoices: { id: number; invoiceNo: string; status: InvoiceStatus; dispatches: { id: number; dispatchNo: string; cancelledAt: string | null }[] }[];
}

export interface InvoiceRow {
  id: number;
  invoiceNo: string;
  type: InvoiceType;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  currency: Currency;
  grandTotal: number;
  amountPaid: number;
  paymentStatus: PayStatus;
  billingName: string;
  customer: { id: number; name: string };
  company: { id: number; code: string };
  salesOrder: { id: number; soNo: string } | null;
  dispatches: { id: number; dispatchNo: string }[];
}

export interface Invoice extends Omit<InvoiceRow, 'company' | 'dispatches'> {
  companyId: number;
  customerId: number;
  exchangeRate: number;
  customerPoNo: string | null;
  customerPoDate: string | null;
  billingAddress: string | null;
  billingGstin: string | null;
  shippingName: string | null;
  shippingAddress: string | null;
  shippingGstin: string | null;
  placeOfSupply: string | null;
  gstType: GstType;
  taxRate: number;
  discountPercent: number;
  freight: number;
  transporter: string | null;
  vehicleNo: string | null;
  subTotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  terms: string | null;
  notes: string | null;
  issuedAt: string | null;
  emailedAt: string | null;
  cancelReason: string | null;
  company: Company;
  customer: { id: number; code: string; name: string; email: string | null; contactPerson: string | null; phone: string | null; country: string };
  assembly: { id: number; assemblyNo: string; status: AssemblyStatus; packages: number | null; grossWeightKg: number | null } | null;
  createdBy: { id: number; name: string } | null;
  lines: { id: number; lineNo: number; salesOrderLineId: number | null; description: string; hsnCode: string | null; quantity: number; uom: Unit; rate: number; taxRate: number; amount: number }[];
  dispatches: { id: number; dispatchNo: string; dispatchDate: string; transporter: string | null; lrNo: string | null; vehicleNo: string | null; cancelledAt: string | null }[];
  payments: PaymentRow[];
}

export interface DispatchRow {
  id: number;
  dispatchNo: string;
  dispatchDate: string;
  challanNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  loadedBy: string | null;
  packages: number | null;
  grossWeightKg: number | null;
  remarks: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  salesOrder: { id: number; soNo: string; customer: { name: string } };
  invoice: { id: number; invoiceNo: string } | null;
  lines: { quantity: number; salesOrderLine: { product: { name: string } } }[];
}

export interface PaymentRow {
  id: number;
  paymentNo: string;
  paymentDate: string;
  direction: 'RECEIPT' | 'PAYMENT';
  amount: number;
  mode: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'OTHER';
  reference: string | null;
  remarks: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  customer?: { id: number; name: string } | null;
  supplier?: { id: number; name: string } | null;
  invoice?: { id: number; invoiceNo: string; currency: Currency } | null;
  purchaseOrder?: { id: number; poNo: string; currency: Currency } | null;
  createdBy: { id?: number; name: string } | null;
}

export interface OutstandingRow {
  kind: 'invoice' | 'purchase_order';
  id: number;
  number: string;
  type?: 'MATERIAL' | 'JOB_WORK';
  date: string;
  dueDate: string | null;
  party: { id: number; name: string };
  currency: Currency;
  total: number;
  paid: number;
  balance: number;
  overdueDays: number;
}

// ---------------------------------------------------------------- Phase 7: traceability & reports

interface ItemRef {
  id: number;
  code: string;
  name: string;
}
interface FileRef {
  id: number;
  name: string;
}
interface OrderRef {
  id: number;
  soNo: string;
  soDate: string;
  status: SoStatus;
  customerPoNo: string | null;
  customer: { id: number; name: string };
}

export interface TraceSearchResult {
  heats: { id: number; heatNo: string; millHeatNo: string | null; grade: string; size: string; supplier: string | null; receivedDate: string | null }[];
  orders: (OrderRef & { matched: string })[];
}

export interface HeatTrace {
  heat: {
    id: number;
    heatNo: string;
    millHeatNo: string | null;
    status: HeatStatus;
    receivedDate: string | null;
    remarks: string | null;
    material: { id: number; code: string; grade: string; size: string };
    supplier: string | null;
  };
  summary: { receivedKg: number; toProductionKg: number; toJobWorkKg: number; inStoreKg: number; partsMade: number; partsPacked: number; partsInStore: number; customers: string[] };
  receipts: {
    grnId: number;
    grnNo: string;
    grnDate: string;
    supplier: string;
    supplierInvoice: string | null;
    po: { id: number; poNo: string } | null;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    qcStatus: QcStatus;
    qcRemarks: string | null;
  }[];
  movements: { id: number; date: string; type: string; refNo: string | null; location: StockLocation; in: number; out: number; remarks: string | null }[];
  routeCards: {
    id: number;
    rcNo: string;
    rcDate: string;
    status: RcStatus;
    item: ItemRef;
    kg: number;
    plannedQty: number;
    extraQty: number;
    completedQty: number;
    rejectedQty: number;
    order: OrderRef | null;
    reports: (FileRef & { stage: string })[];
  }[];
  jobWork: {
    id: number;
    jwoNo: string;
    jwoDate: string;
    status: JwoStatus;
    supplier: string;
    kg: number;
    received: { item: ItemRef; receiptNo: string; receiptDate: string; receivedQty: number; acceptedQty: number; rejectedQty: number }[];
  }[];
  parts: { item: ItemRef; made: number; packed: number; inStore: number; madeOn: string[] }[];
  deliveries: {
    assembly: { id: number; assemblyNo: string; assemblyDate: string; status: AssemblyStatus };
    order: { id: number; soNo: string; customerPoNo: string | null };
    customer: { id: number; name: string };
    parts: { item: ItemRef; quantity: number }[];
    invoices: { id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus }[];
    dispatches: { id: number; dispatchNo: string; dispatchDate: string; transporter: string | null; lrNo: string | null; vehicleNo: string | null }[];
  }[];
  documents: (FileRef & { on: string })[];
}

export interface OrderTrace {
  order: { id: number; soNo: string; soDate: string; status: SoStatus; customerPoNo: string | null; customerPoDate: string | null; expectedDelivery: string | null; customer: { id: number; name: string } };
  lines: { id: number; product: string; spec: string; quantity: number; decision: string; packed: number; dispatched: number }[];
  heats: {
    id: number;
    heatNo: string;
    millHeatNo: string | null;
    grade: string;
    size: string;
    supplier: string | null;
    grn: { id: number; grnNo: string; grnDate: string } | null;
    po: { id: number; poNo: string } | null;
    qcStatus: QcStatus | null;
    parts: { item: ItemRef; quantity: number }[];
    documents: FileRef[];
  }[];
  packing: {
    id: number;
    assemblyNo: string;
    assemblyDate: string;
    status: AssemblyStatus;
    sets: { product: string; quantity: number }[];
    parts: { item: ItemRef; heatNo: string | null; millHeatNo: string | null; quantity: number; madeOn: string[] }[];
    invoices: { id: number; invoiceNo: string }[];
  }[];
  routeCards: {
    id: number;
    rcNo: string;
    rcDate: string;
    status: RcStatus;
    item: ItemRef;
    plannedQty: number;
    extraQty: number;
    completedQty: number;
    rejectedQty: number;
    heats: { heatNo: string; millHeatNo: string | null; kg: number }[];
    stages: {
      name: string;
      type: StageType;
      status: OperationStatus;
      okQty: number | null;
      rejectedQty: number | null;
      reason: string | null;
      remarks: string | null;
      completedAt: string | null;
      by: string | null;
      reports: FileRef[];
    }[];
  }[];
  jobWork: {
    id: number;
    jwoNo: string;
    jwoDate: string;
    status: JwoStatus;
    supplier: string;
    materials: { heatNo: string; millHeatNo: string | null; kg: number }[];
    received: { receiptNo: string; receiptDate: string; item: ItemRef; heatNo: string | null; receivedQty: number; acceptedQty: number; rejectedQty: number }[];
    reports: FileRef[];
  }[];
  invoices: { id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus; currency: Currency; grandTotal: number }[];
  dispatches: { id: number; dispatchNo: string; dispatchDate: string; transporter: string | null; lrNo: string | null; vehicleNo: string | null; invoiceNo: string | null; cancelled: boolean }[];
}

export interface StockMovementReport {
  from: string;
  to: string;
  kind: 'RAW_MATERIAL' | 'FINISHED_GOOD';
  location: StockLocation | null;
  rows: { id: number; code: string; name: string; uom: Unit; heat: { id: number; heatNo: string; millHeatNo: string | null } | null; opening: number; in: number; out: number; closing: number }[];
  totals: { opening: number; in: number; out: number; closing: number };
}

export interface ProductionReport {
  from: string;
  to: string;
  summary: { cardsStarted: number; cardsFinished: number; finishedOk: number; rejected: number; rejectionRate: number; jobWorkAccepted: number };
  byStage: { stage: string; received: number; ok: number; rejected: number; rate: number }[];
  byReason: { reason: string; rejected: number; cards: string[] }[];
  byItem: { item: ItemRef; finishedOk: number; rejected: number; rate: number }[];
  jobWork: { vendor: string; received: number; accepted: number; rejected: number; rate: number }[];
  months: { month: string; finishedOk: number; rejected: number; jobWorkAccepted: number }[];
  rejections: { date: string; rcId: number; rcNo: string; item: ItemRef; stage: string; received: number; rejected: number; reason: string | null; by: string | null }[];
}

export interface PendingOrdersReport {
  rows: {
    lineId: number;
    order: { id: number; soNo: string; soDate: string; status: SoStatus; customerPoNo: string | null };
    customer: { id: number; name: string };
    product: string;
    spec: string;
    decision: 'PENDING' | 'INHOUSE' | 'OUTSOURCE' | 'FROM_STOCK';
    ordered: number;
    packed: number;
    dispatched: number;
    pending: number;
    dueDate: string | null;
    overdueDays: number;
    currency: Currency;
    value: number;
    valueInr: number;
  }[];
  summary: { orders: number; lines: number; pendingSets: number; valueInr: number; overdueLines: number; overdueValueInr: number };
}

export interface SalesRegisterRow {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  type: 'TAX_INVOICE' | 'EXPORT_INVOICE' | 'PROFORMA';
  status: InvoiceStatus;
  company: string;
  customer: { id: number; name: string };
  billingName: string;
  gstin: string | null;
  placeOfSupply: string | null;
  gstType: GstType;
  currency: Currency;
  exchangeRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: number;
  inr: { taxable: number; gst: number; total: number; paid: number };
}
export type SalesReport =
  | { view: 'register'; rows: SalesRegisterRow[]; totals: { invoices: number; cancelled: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; paid: number } }
  | {
      view: 'customer';
      rows: { customer: { id: number; name: string }; invoices: number; taxable: number; gst: number; total: number; paid: number; balance: number }[];
      totals: { invoices: number; taxable: number; gst: number; total: number; paid: number; balance: number };
    }
  | { view: 'product'; rows: { product: string; productId: number | null; quantity: number; uom: Unit; value: number; invoices: number }[]; totals: { quantity: number; value: number } }
  | {
      view: 'month';
      rows: { month: string; invoices: number; taxable: number; gst: number; total: number; received: number }[];
      totals: { invoices: number; taxable: number; gst: number; total: number; received: number };
    };

interface PurchaseTotals {
  orders: number;
  taxable: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
}
export type PurchaseReport =
  | {
      view: 'register';
      rows: {
        id: number;
        poNo: string;
        poDate: string;
        type: 'MATERIAL' | 'JOB_WORK';
        status: PoStatus;
        company: string;
        supplier: { id: number; name: string };
        gstin: string | null;
        gstType: GstType;
        currency: Currency;
        taxable: number;
        tax: number;
        total: number;
        paid: number;
        balance: number;
        paymentStatus: PayStatus;
        receivedPercent: number;
      }[];
      totals: PurchaseTotals;
    }
  | { view: 'supplier'; rows: { supplier: { id: number; name: string }; orders: number; taxable: number; tax: number; total: number; paid: number; balance: number }[]; totals: PurchaseTotals };

export type AgeingBucketKey = 'notDue' | 'd30' | 'd60' | 'd90' | 'd90plus';
export interface AgeingReport {
  direction: 'RECEIPT' | 'PAYMENT';
  parties: {
    party: { id: number; name: string };
    buckets: Record<AgeingBucketKey, number>;
    total: number;
    maxOverdueDays: number;
    documents: {
      kind: 'invoice' | 'purchase_order';
      id: number;
      number: string;
      date: string;
      dueDate: string | null;
      currency: Currency;
      balance: number;
      balanceInr: number;
      overdueDays: number;
      bucket: AgeingBucketKey;
    }[];
  }[];
  totals: Record<AgeingBucketKey, number> & { total: number; documents: number };
}

export interface BusinessDashboard {
  fy: string;
  sales: { thisMonth: number; lastMonth: number; fyToDate: number };
  receivedThisMonth: number;
  receivable: { total: number; overdue: number; documents: number };
  payable: { total: number; overdue: number; documents: number };
  receivableAgeing: { key: string; label: string; amount: number }[];
  months: { month: string; sales: number; received: number }[];
  topCustomers: { customer: { id: number; name: string }; total: number }[];
  /** the last 30 days, oldest first (invoice totals with GST) */
  days: { date: string; sales: number }[];
}

// ---------------------------------------------------------------- Phase 8: HR & payroll

interface EmpRef {
  id: number;
  empCode: string;
  name: string;
}

export interface Department {
  id: number;
  name: string;
  _count?: { employees: number };
}

export interface Employee {
  id: number;
  empCode: string;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: string | null;
  dateOfJoining: string | null;
  departmentId: number | null;
  department: { id: number; name: string } | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  basicSalary: number;
  ctc: number | null;
  shiftHours: number;
  isPfEligible: boolean;
  uan: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  status: 'ACTIVE' | 'LEFT';
  leftOn: string | null;
}

export interface EmployeeDetail extends Employee {
  leaveYear: number;
  leaveBalances: { year: number; casual: number; sick: number; earned: number }[];
  leaveUsed: Partial<Record<'CL' | 'SL' | 'EL' | 'LWP', number>>;
  loans: Loan[];
  payslips: { id: number; netSalary: number; payableDays: number; payrollRun: { month: string; status: 'DRAFT' | 'FINALIZED' | 'PAID' } }[];
  assets: { id: number; code: string; name: string; status: string; assignDate: string | null }[];
}

export type DayStatus = '' | 'P' | 'M' | 'A' | 'S' | 'SW' | 'CL' | 'SL' | 'EL' | 'LWP';

export interface AttendanceMonth {
  month: string;
  dates: string[];
  locked: string[];
  rows: {
    employee: EmpRef & { designation: string | null; department: string | null };
    shiftHours: number;
    presentDays: number;
    sundaysWorked: number;
    paidLeaveDays: number;
    lwpDays: number;
    absentDays: number;
    hoursWorked: number;
    expectedHours: number;
    hourDifference: number;
    missingPunchDays: number;
    status: Record<string, DayStatus>;
  }[];
}

export interface AttendanceDay {
  date: string;
  isSunday: boolean;
  locked: boolean;
  rows: {
    employee: EmpRef & { designation: string | null; department: string | null };
    shiftHours: number;
    punches: string[];
    hoursWorked: number;
    missingPunch: boolean;
    source: 'DEVICE' | 'MANUAL' | 'IMPORT' | null;
    remarks: string | null;
    leave: { type: 'CL' | 'SL' | 'EL' | 'LWP'; isHalfDay: boolean } | null;
  }[];
}

export interface AttendancePreview {
  rows: { line: number; empCode: string; name: string; date: string; punches: string[]; machineHours: number | null; employee: EmpRef | null; status: 'READY' | 'UNKNOWN' | 'LOCKED' }[];
  skipped: number;
  ready: number;
  unknown: number;
  locked: number;
}

export interface BiometricDevice {
  id: number;
  serialNo: string;
  name: string | null;
  isApproved: boolean;
  lastSeenAt: string | null;
  lastPunchAt: string | null;
  lastIp: string | null;
}

export interface LeaveRequest {
  id: number;
  employee: EmpRef;
  type: 'CL' | 'SL' | 'EL' | 'LWP';
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  adminRemark: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface LeaveKind {
  allowed: number;
  used: number;
  waiting: number;
  left: number;
}
export interface LeaveBalanceRow {
  employee: EmpRef;
  CL: LeaveKind;
  SL: LeaveKind;
  EL: LeaveKind;
  LWP: { used: number; waiting: number };
}

export interface Loan {
  id: number;
  employee: EmpRef;
  type: 'ADVANCE' | 'PERSONAL_LOAN';
  amount: number;
  emiAmount: number;
  balance: number;
  startMonth: string;
  disbursementMode: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'OTHER';
  disbursementRef: string | null;
  reason: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  createdAt: string;
}

export interface LoanDetail extends Loan {
  repayments: { id: number; date: string; amount: number; mode: Loan['disbursementMode'] | null; remarks: string | null; payslip: { id: number; payrollRun: { month: string } } | null }[];
}

export interface Payslip {
  id: number;
  employee: EmpRef & { designation: string | null; department: { name: string } | null; bankAccountNo: string | null };
  basicSalary: number;
  shiftHours: number;
  isPfEligible: boolean;
  presentDays: number;
  paidLeaveDays: number;
  payableDays: number;
  absentDays: number;
  sundaysWorked: number;
  hoursWorked: number;
  expectedHours: number;
  hourDifference: number;
  baseEarning: number;
  hourAdjustment: number;
  grossEarning: number;
  pfDeduction: number;
  loanDeduction: number;
  otherAdjustment: number;
  adjustmentNote: string | null;
  roundOff: number;
  netSalary: number;
}

export interface PayrollMonth {
  month: string;
  run: { id: number; month: string; monthDays: number; pfPercent: number; status: 'DRAFT' | 'FINALIZED' | 'PAID'; finalizedAt: string | null; paidAt: string | null; paymentRef: string | null; createdAt: string } | null;
  candidates?: number;
  payslips?: Payslip[];
  totals?: { employees: number; gross: number; pf: number; loans: number; other: number; net: number };
  settings: { monthDays: number; pfPercent: number };
}

export interface PayrollRunRow {
  id: number;
  month: string;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  employees: number;
  gross: number;
  net: number;
}

export interface CompanyAsset {
  id: number;
  code: string;
  name: string;
  category: string | null;
  department: string | null;
  employeeId: number | null;
  employee: EmpRef | null;
  status: 'IN_USE' | 'IN_STORE' | 'UNDER_REPAIR' | 'SCRAPPED';
  assignDate: string | null;
  returnDate: string | null;
  warrantyDate: string | null;
  remarks: string | null;
}

export interface SafetyAsset {
  id: number;
  code: string;
  name: string;
  locationZone: string | null;
  typeCapacity: string | null;
  installationDate: string | null;
  lastInspectionDate: string | null;
  nextDueDate: string | null;
  lastServiceDate: string | null;
  inspectionIntervalDays: number | null;
  vendorAgency: string | null;
  status: 'OK' | 'FAULTY' | 'OUT_OF_SERVICE';
  remarks: string | null;
}

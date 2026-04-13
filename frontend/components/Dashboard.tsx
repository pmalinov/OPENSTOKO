'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { API_URL, api } from '@/lib/api';
import { Lang, dashboardTexts, helpSectionsByLang, texts } from '@/lib/i18n';
import { APP_VERSION } from '@/lib/version';

type Product = {
  id: number;
  name: string;
  brand_name: string;
  supplier_name?: string | null;
  category: string;
  description: string;
  product_comment: string;
  technical_specs: string;
  photo_url: string | null;
  internal_sku: string;
  factory_barcode: string;
  store_barcode: string | null;
  warehouse_location: string;
  purchase_price: number;
  sell_price: number;
  min_sell_price: number;
  min_threshold: number;
  compatibility_group: string | null;
  compatibility_group_code: string | null;
  current_stock: number;
  inventory_health: 'critical' | 'warning' | 'healthy' | string;
};

type Movement = {
  id: number;
  movement_type: string;
  product_id: number;
  created_by_user_id: number;
  serial_number: string | null;
  qty: number;
  created_at: string;
};

type User = {
  id: number;
  username: string;
  full_name: string;
  role: 'admin' | 'operator';
  is_active: boolean;
};

type Category = {
  id: number;
  name: string;
  unit: string;
  is_active: boolean;
};

type AuditLog = {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  old_value: string;
  new_value: string;
  username: string;
  ip_address: string;
  created_at: string;
};

type CashierItem = {
  product_id: number;
  name: string;
  code: string;
  qty: number;
  unit_price: number;
  available: number;
};

type RecentSaleItem = {
  movement_id: number;
  product_id: number;
  product_name: string;
  product_category?: string;
  product_barcode?: string;
  serial_number: string | null;
  unit_price: number;
  qty: number;
};

type RecentSale = {
  sale_ref: string;
  customer_name: string;
  comment: string;
  created_at: string;
  operator_username: string;
  movement_ids: number[];
  total_qty: number;
  total_amount: number;
  items: RecentSaleItem[];
  can_refund: boolean;
  movement_count: number;
  refund_request_status?: 'pending' | 'approved' | 'rejected' | null;
  refund_lock_reason?: 'missing_serial' | 'already_refunded' | 'pending_request' | 'approved_request' | null;
};

type ThresholdSuggestion = {
  id: number;
  product_id: number;
  product_name: string;
  current_min_threshold: number;
  suggested_min_threshold: number;
  confidence: number;
  model_version: string;
  reason_json: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | string;
  created_at: string;
};

type RefundRequest = {
  id: number;
  sale_ref: string;
  movement_ids: number[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  requested_by_username: string;
  reviewed_by_username: string | null;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
};

type BusinessSummary = {
  period: string;
  start_date: string;
  end_date: string;
  purchased_qty: number;
  purchased_amount: number;
  sold_qty: number;
  sold_amount: number;
  flow_balance: number;
  inventory_units: number;
  inventory_value_purchase: number;
  total_products: number;
  total_categories: number;
  generated_at: string;
};

type DossierComment = {
  id: number;
  comment: string;
  serial_number: string | null;
  created_at: string;
  username: string;
};

type DossierData = {
  product: {
    id: number;
    name: string;
    brand_name?: string;
    supplier_name?: string | null;
    category: string;
    factory_barcode: string;
    store_barcode: string | null;
    internal_sku: string;
    warehouse_location: string;
    sell_price: number;
    min_sell_price: number;
    purchase_price: number;
    product_comment: string;
    technical_specs: string;
    photo_url: string | null;
    min_threshold: number;
    compatibility_group?: string | null;
    compatibility_group_code: string | null;
  };
  stock: {
    in_stock_qty: number;
    current_serial: { serial_number: string; status: string } | null;
    inventory_health: 'critical' | 'warning' | 'healthy' | string;
  };
  substitutes: Array<{
    product_id: number;
    name: string;
    sku: string;
    barcode: string;
    sell_price: number;
    current_stock: number;
    rank: number;
    note: string;
  }>;
  comments: DossierComment[];
  last_sale: {
    created_at: string;
    serial_number: string | null;
    customer_name: string | null;
    unit_price: number;
  } | null;
  last_movement: {
    created_at: string;
    movement_type: string;
    serial_number: string | null;
    comment: string;
  } | null;
};

type OperatorSearchResult = {
  product_id: number;
  name: string;
  brand_name: string;
  category: string;
  sku: string;
  internal_sku: string;
  factory_barcode: string;
  store_barcode: string | null;
  barcode: string;
  current_stock: number;
  sold_qty: number;
  sell_price: number;
  min_threshold: number;
  inventory_health: 'critical' | 'warning' | 'healthy' | string;
  compatibility_group: string | null;
};

type TabKey = 'cashier' | 'products' | 'movements' | 'defects' | 'inventory' | 'bi' | 'reports' | 'history' | 'refunds' | 'help' | 'about' | 'admin';

const tabOrder: TabKey[] = ['cashier', 'products', 'inventory', 'bi', 'reports', 'history', 'refunds', 'help', 'about', 'admin'];
const DONATION_URL = 'https://revolut.me/plameniraz';
const DONATION_REMINDER_DAYS = 30;

function Tip({ text }: { text: string }) {
  return (
    <span className="tip-wrap" tabIndex={0} aria-label={text} title={text}>
      <span className="tip" title={text}>?</span>
      <span className="tip-popup">{text}</span>
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <Tip text={hint} />
      </span>
      {children}
    </label>
  );
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return value;
  }
}
function resolveMediaUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const apiRoot = API_URL.replace(/\/api\/?$/, '');
  return `${apiRoot}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function formatAuditSummary(row: AuditLog, lang: Lang): string {
  const newValue = parseMaybeJson(row.new_value);
  const asObj = typeof newValue === 'object' && newValue !== null ? (newValue as Record<string, unknown>) : null;

  if (lang === 'en') {
    if (row.entity === 'product' && row.action === 'create' && asObj) {
      return `Product \"${String(asObj.name || '')}\" was created (SKU: ${String(asObj.internal_sku || asObj.sku || '-')}).`;
    }
    if (row.entity === 'stock_movement' && asObj) {
      return `Movement \"${row.action}\" for product ${String(asObj.product_name || asObj.product_id || '-')}, SN: ${String(asObj.serial_number || '-')}.`;
    }
    if (row.entity === 'auth' && row.action === 'login') return 'Successful login.';
    if (row.entity === 'auth' && row.action === 'unauthorized_login') return 'Failed login attempt.';
    return `${row.entity} / ${row.action}`;
  }

  if (lang === 'it') {
    if (row.entity === 'product' && row.action === 'create' && asObj) {
      return `Prodotto \"${String(asObj.name || '')}\" creato (SKU: ${String(asObj.internal_sku || asObj.sku || '-')}).`;
    }
    if (row.entity === 'stock_movement' && asObj) {
      return `Movimento \"${row.action}\" per prodotto ${String(asObj.product_name || asObj.product_id || '-')}, SN: ${String(asObj.serial_number || '-')}.`;
    }
    if (row.entity === 'auth' && row.action === 'login') return 'Accesso riuscito.';
    if (row.entity === 'auth' && row.action === 'unauthorized_login') return 'Tentativo di accesso non riuscito.';
    return `${row.entity} / ${row.action}`;
  }

  if (row.entity === 'product' && row.action === 'create' && asObj) {
    return `Създаден продукт \"${String(asObj.name || '')}\" (SKU: ${String(asObj.internal_sku || asObj.sku || '-')}).`;
  }
  if (row.entity === 'stock_movement' && asObj) {
    return `Движение \"${row.action}\" за продукт ${String(asObj.product_name || asObj.product_id || '-')}, SN: ${String(asObj.serial_number || '-')}.`;
  }
  if (row.entity === 'auth' && row.action === 'login') return 'Успешен вход в системата.';
  if (row.entity === 'auth' && row.action === 'unauthorized_login') return 'Неуспешен опит за вход.';
  return `${row.entity} / ${row.action}`;
}

export default function Dashboard({ token, lang, onLogout }: { token: string; lang: Lang; onLogout: () => void }) {
  const t = texts[lang];
  const td = dashboardTexts[lang];

  const L = (bg: string, en: string, it?: string) => (lang === 'bg' ? bg : lang === 'it' ? (it || en) : en);
  const walkInLabel = td.k001;

  const [activeTab, setActiveTab] = useState<TabKey>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(15);
  const [sessionTimeoutInput, setSessionTimeoutInput] = useState('15');
  const [me, setMe] = useState<User | null>(null);

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showDonationBanner, setShowDonationBanner] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [productComment, setProductComment] = useState('');
  const [productSpecs, setProductSpecs] = useState('');
  const [minThresholdInput, setMinThresholdInput] = useState('');
  const [compatibilityGroupInput, setCompatibilityGroupInput] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [thresholdDraft, setThresholdDraft] = useState<Record<number, string>>({});
  const [inventoryHealthFilter, setInventoryHealthFilter] = useState<'all' | 'critical' | 'warning' | 'healthy'>('all');
  const [inventoryHealthSearch, setInventoryHealthSearch] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [minSellPrice, setMinSellPrice] = useState('');
  const [movementSearch, setMovementSearch] = useState('');
  const [availableSerials, setAvailableSerials] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [cashierCustomer, setCashierCustomer] = useState(walkInLabel);
  const [cashierComment, setCashierComment] = useState('');
  const [cashierCart, setCashierCart] = useState<CashierItem[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [refundRequestReasons, setRefundRequestReasons] = useState<Record<string, string>>({});
  const [refundReviewNotes, setRefundReviewNotes] = useState<Record<number, string>>({});
  const [lastSoldSerials, setLastSoldSerials] = useState<string[]>([]);
  const [operatorSnapshot, setOperatorSnapshot] = useState<DossierData | null>(null);
  const [operatorAction, setOperatorAction] = useState<'' | 'input' | 'output'>('');
  const [operatorSearchMode, setOperatorSearchMode] = useState<'barcode' | 'code' | 'name' | 'category' | 'hierarchical'>('barcode');
  const [operatorNameQuery, setOperatorNameQuery] = useState('');
  const [operatorCategory, setOperatorCategory] = useState('');
  const [operatorNameResults, setOperatorNameResults] = useState<OperatorSearchResult[]>([]);
  const [operatorSearchLoading, setOperatorSearchLoading] = useState(false);
  const [operatorQty, setOperatorQty] = useState('');

  const [dossierCode, setDossierCode] = useState('');
  const [dossierData, setDossierData] = useState<DossierData | null>(null);
  const [dossierComment, setDossierComment] = useState('');
  const [dossierAdminSell, setDossierAdminSell] = useState('');
  const [dossierAdminMin, setDossierAdminMin] = useState('');

  const [intakeModelCode, setIntakeModelCode] = useState('');
  const [intakeProduct, setIntakeProduct] = useState<Product | null>(null);
  const [intakeQty, setIntakeQty] = useState('10');
  const [intakeTarget, setIntakeTarget] = useState(0);
  const [intakeSerialInput, setIntakeSerialInput] = useState('');
  const [intakeSerials, setIntakeSerials] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [barcode, setBarcode] = useState('');
  const [storeBarcode, setStoreBarcode] = useState('');
  const [internalSkuInput, setInternalSkuInput] = useState('');
  const [location, setLocation] = useState('');
  const [initialStockQty, setInitialStockQty] = useState('0');
  const [newCategoryInline, setNewCategoryInline] = useState('');

  const [mType, setMType] = useState('input');
  const [mProductId, setMProductId] = useState('');
  const [mSerial, setMSerial] = useState('SN-001');
  const [mCustomer, setMCustomer] = useState('');
  const [mPrice, setMPrice] = useState('120');
  const [mComment, setMComment] = useState('');

  const [quickInputQty, setQuickInputQty] = useState('10');
  const [quickInputPrefix, setQuickInputPrefix] = useState('');

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkSerials, setBulkSerials] = useState('SN-1001\nSN-1002');

  const [reconcileProductId, setReconcileProductId] = useState('');
  const [reconcileSerials, setReconcileSerials] = useState('');
  const [reconcileComment, setReconcileComment] = useState(td.k003);
  const [reconcileResult, setReconcileResult] = useState<{ missing: string[]; unexpected: string[]; auto_adjusted: number } | null>(null);

  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [dataMgmtImportFile, setDataMgmtImportFile] = useState<File | null>(null);
  const [dataMgmtPeriod, setDataMgmtPeriod] = useState<'current_month' | 'last_month' | 'this_year' | 'last_12_months' | 'custom'>('current_month');
  const [dataMgmtStartDate, setDataMgmtStartDate] = useState('');
  const [dataMgmtEndDate, setDataMgmtEndDate] = useState('');

  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [tmData, setTmData] = useState<any[]>([]);
  const [velocityData, setVelocityData] = useState<any[]>([]);
  const [abcData, setAbcData] = useState<any[]>([]);
  const [warrantySerial, setWarrantySerial] = useState('');
  const [warrantyData, setWarrantyData] = useState<any>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'operator'>('operator');
  const [newPassword, setNewPassword] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState<Record<number, string>>({});

  const [newCategoryName, setNewCategoryName] = useState(td.k005);
  const [newCategoryUnit, setNewCategoryUnit] = useState('pcs');
  const [renameCategoryId, setRenameCategoryId] = useState('');
  const [renameCategoryName, setRenameCategoryName] = useState('');
  const [renameCategoryUnit, setRenameCategoryUnit] = useState('pcs');

  const [historyEntity, setHistoryEntity] = useState('');
  const [historyEntityId, setHistoryEntityId] = useState('');
  const [historyUsername, setHistoryUsername] = useState('');
  const [historySerial, setHistorySerial] = useState('');
  const [historyWarrantyData, setHistoryWarrantyData] = useState<any>(null);
  const [businessSummary, setBusinessSummary] = useState<BusinessSummary | null>(null);
  const [summaryPeriod, setSummaryPeriod] = useState<'current_month' | 'last_month' | 'this_year' | 'last_12_months' | 'custom'>('current_month');
  const [summaryStartDate, setSummaryStartDate] = useState('');
  const [summaryEndDate, setSummaryEndDate] = useState('');
  const [thresholdSuggestions, setThresholdSuggestions] = useState<ThresholdSuggestion[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<AuditLog | null>(null);
  const [selectedProduct360, setSelectedProduct360] = useState<Product | null>(null);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [adminEditName, setAdminEditName] = useState('');
  const [adminEditLookup, setAdminEditLookup] = useState('');
  const [adminEditCategory, setAdminEditCategory] = useState('');
  const [adminEditBrand, setAdminEditBrand] = useState('');
  const [adminEditSupplier, setAdminEditSupplier] = useState('');
  const [adminEditInternalSku, setAdminEditInternalSku] = useState('');
  const [adminEditFactoryBarcode, setAdminEditFactoryBarcode] = useState('');
  const [adminEditStoreBarcode, setAdminEditStoreBarcode] = useState('');
  const [adminEditLocation, setAdminEditLocation] = useState('');
  const [adminEditCompatibility, setAdminEditCompatibility] = useState('');
  const [adminEditComment, setAdminEditComment] = useState('');
  const [adminEditSpecs, setAdminEditSpecs] = useState('');
  const [adminEditPhotoUrl, setAdminEditPhotoUrl] = useState('');
  const [adminEditPurchase, setAdminEditPurchase] = useState('');
  const [adminEditSell, setAdminEditSell] = useState('');
  const [adminEditMinSell, setAdminEditMinSell] = useState('');
  const [adminEditThreshold, setAdminEditThreshold] = useState('');
  const isAdmin = me?.role === 'admin';
  const isOperator = me?.role === 'operator';

  useEffect(() => {
    if (isAdmin && categories.length === 0 && category !== '__new__') {
      setCategory('__new__');
    }
  }, [isAdmin, categories.length, category]);
  const exitCashierTab: TabKey = isAdmin ? 'about' : 'cashier';
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const operatorTopRef = useRef<HTMLDivElement | null>(null);
  const adminEditRef = useRef<HTMLDivElement | null>(null);
  const homeInitializedRef = useRef(false);
  const cashierDraftLoadedRef = useRef(false);
  const lastActivityAtRef = useRef<number>(Date.now());

  const visibleTabs = useMemo(() => {
    if (isAdmin) return tabOrder;
    return ['cashier', 'help', 'about'] as TabKey[];
  }, [isAdmin]);

  const sortedCategoryNames = useMemo(
    () => [...categories.map((c) => c.name)].sort((a, b) => a.localeCompare(b)),
    [categories],
  );
  const skuPreviewPrefix = useMemo(() => {
    const src = (category === '__new__' ? newCategoryInline : category) || 'GEN';
    const letters = src.toUpperCase().replace(/[^A-Z]/g, '');
    return (letters.slice(0, 3) || 'GEN');
  }, [category, newCategoryInline]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.brand_name || ''} ${p.supplier_name || ''} ${p.internal_sku} ${p.factory_barcode} ${p.store_barcode || ''} ${p.category} ${p.product_comment || ""} ${p.technical_specs || ""}`.toLowerCase().includes(q));
  }, [products, productSearch]);

  const filteredMovementProducts = useMemo(() => {
    const q = movementSearch.trim().toLowerCase();
    if (!q) return products;
    const matched = products.filter((p) => `${p.name} ${p.internal_sku} ${p.factory_barcode} ${p.category}`.toLowerCase().includes(q));
    return matched.sort((a, b) => {
      const rank = (p: Product) => {
        const fb = (p.factory_barcode || '').trim().toLowerCase();
        const sku = (p.internal_sku || '').trim().toLowerCase();
        const nameNorm = (p.name || '').trim().toLowerCase();
        if (fb === q) return 0;
        if (sku === q) return 1;
        if (nameNorm === q) return 2;
        if (nameNorm.startsWith(q)) return 3;
        return 4;
      };
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name) || a.id - b.id;
    });
  }, [products, movementSearch]);

  const inventoryHealthRows = useMemo(() => {
    const rows = products.map((p) => ({
      id: p.id,
      name: p.name,
      brand_name: p.brand_name || '',
      category: p.category,
      sku: p.internal_sku || '',
      factory_barcode: p.factory_barcode || '',
      store_barcode: p.store_barcode || '',
      location: p.warehouse_location,
      current_stock: Number(p.current_stock || 0),
      min_threshold: Number(p.min_threshold || 0),
      health: p.inventory_health || 'healthy',
    }));
    const byHealth = inventoryHealthFilter === 'all' ? rows : rows.filter((r) => r.health === inventoryHealthFilter);
    const q = inventoryHealthSearch.trim().toLowerCase();
    const filtered = !q
      ? byHealth
      : byHealth.filter((r) =>
          `${r.id} ${r.name} ${r.brand_name} ${r.category} ${r.sku} ${r.factory_barcode} ${r.store_barcode} ${r.location}`
            .toLowerCase()
            .includes(q),
        );
    const weight: Record<string, number> = { critical: 0, warning: 1, healthy: 2 };
    return filtered.sort((a, b) => (weight[a.health] ?? 9) - (weight[b.health] ?? 9) || a.current_stock - b.current_stock || a.name.localeCompare(b.name));
  }, [products, inventoryHealthFilter, inventoryHealthSearch]);

  const inventoryHealthTotals = useMemo(() => {
    const totals = { critical: 0, warning: 0, healthy: 0 };
    for (const p of products) {
      const health = (p.inventory_health || 'healthy') as 'critical' | 'warning' | 'healthy';
      if (health === 'critical' || health === 'warning' || health === 'healthy') {
        totals[health] += 1;
      }
    }
    return totals;
  }, [products]);
  const pendingRefundCount = useMemo(
    () => refundRequests.filter((r) => r.status === 'pending').length,
    [refundRequests],
  );

  const stockByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of movements) {
      const qty = Number(m.qty || 0);
      let delta = 0;
      if (m.movement_type === 'input' || m.movement_type === 'adjustment') delta = qty;
      if (m.movement_type === 'output' || m.movement_type === 'defect') delta = -qty;
      map.set(m.product_id, (map.get(m.product_id) || 0) + delta);
    }
    return map;
  }, [movements]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const recentInputs = useMemo(
    () =>
      movements
        .filter((m) => m.movement_type === 'input' && Number(m.qty || 0) > 0)
        .sort((a, b) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || (b.id - a.id))
        .slice(0, 10),
    [movements],
  );

  const operatorQtyNum = Number(operatorQty);
  const isOperatorQtyValid = Number.isInteger(operatorQtyNum) && operatorQtyNum > 0;
  const isOperatorIntakeReady = Boolean(operatorSnapshot && operatorAction === 'input' && operatorQty.trim() && isOperatorQtyValid);
  const operatorSellPrice = operatorSnapshot
    ? Number((products.find((p) => p.id === operatorSnapshot.product.id)?.sell_price) ?? operatorSnapshot.product.sell_price ?? 0)
    : 0;
  const isOperatorListMode = operatorAction === 'output' && operatorSearchMode !== 'barcode';
  const cartTotals = useMemo(() => {
    return cashierCart.reduce(
      (acc, item) => {
        const qty = Number(item.qty || 0);
        const lineTotal = qty * Number(item.unit_price || 0);
        acc.totalQty += qty;
        acc.totalAmount += lineTotal;
        return acc;
      },
      { totalQty: 0, totalAmount: 0 },
    );
  }, [cashierCart]);
  const cartDiagnostics = useMemo(() => {
    return cashierCart.map((line) => {
      const product = products.find((p) => p.id === line.product_id);
      const stock = Number(product?.current_stock ?? line.available ?? 0);
      const threshold = Number(product?.min_threshold ?? 0);
      const remaining = stock - Number(line.qty || 0);
      const oversell = remaining < 0;
      const belowThreshold = !oversell && remaining <= threshold;
      return {
        product_id: line.product_id,
        stock,
        threshold,
        remaining,
        oversell,
        belowThreshold,
      };
    });
  }, [cashierCart, products]);
  const cartDiagByProductId = useMemo(
    () => new Map(cartDiagnostics.map((row) => [row.product_id, row])),
    [cartDiagnostics],
  );
  const cartHasOversell = useMemo(
    () => cartDiagnostics.some((row) => row.oversell),
    [cartDiagnostics],
  );

  const healthLabel = (v: string) => {
    if (v === 'critical') return L('Критично', 'Critical', 'Critico');
    if (v === 'warning') return L('Предупреждение', 'Warning', 'Avviso');
    return L('Нормално', 'Healthy', 'Buono');
  };

  const refundStatusMeta = (sale: RecentSale): { label: string; tone: string } => {
    if (sale.refund_request_status === 'pending') {
      return { label: L('Чака одобрение', 'Pending approval', 'In attesa approvazione'), tone: 'pending' };
    }
    if (sale.refund_request_status === 'approved') {
      return { label: L('Сторно одобрено', 'Refund approved', 'Storno approvato'), tone: 'approved' };
    }
    if (sale.refund_request_status === 'rejected') {
      return { label: L('Отказано сторно', 'Refund rejected', 'Storno rifiutato'), tone: 'rejected' };
    }
    if (sale.can_refund) {
      return { label: L('Готово за заявка', 'Ready for request', 'Pronto per richiesta'), tone: 'ready' };
    }
    if (sale.refund_lock_reason === 'already_refunded') {
      return {
        label: L(
          'Вече сторнирано (върнато в склада)',
          'Already refunded (returned to stock)',
          'Gia stornato (reso a magazzino)',
        ),
        tone: 'locked',
      };
    }
    if (sale.refund_lock_reason === 'missing_serial') {
      return { label: L('Заключено: липсва SN', 'Locked: missing SN', 'Bloccato: SN mancante'), tone: 'locked' };
    }
    return { label: td.k077, tone: 'locked' };
  };

  const tabLabel = (tab: TabKey) => {
    if (tab === 'cashier') return L('Оператор', 'Operator', 'Operatore');
    if (tab === 'products') return L('Добавяне на продукти', 'Product Setup', 'Configurazione prodotti');
    if (tab === 'refunds') return L('Сторно одобрения', 'Refund Approvals', 'Approvazioni storno');
    return t[tab];
  };

  const handleError = (e: unknown) => {
    setStatus('');
    if (e instanceof Error) {
      setError(toFriendlyError(e.message));
      return;
    }
    setError(td.k006);
  };

  const withStatus = (text: string) => {
    setError('');
    setStatus(text);
  };

  const withLoading = async (key: string, fn: () => Promise<void>) => {
    if (loadingActions[key]) return;
    setLoadingActions((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
    } catch (e) {
      handleError(e);
    } finally {
      setLoadingActions((prev) => ({ ...prev, [key]: false }));
    }
  };

  const rememberDonationPrompt = () => {
    if (!me?.id) return;
    localStorage.setItem(`openstoko_donation_last_prompt_at_${me.id}`, String(Date.now()));
  };

  const openDonationModal = () => {
    setShowDonationModal(true);
  };

  const maybeLaterDonation = () => {
    rememberDonationPrompt();
    setShowDonationBanner(false);
    setShowDonationModal(false);
  };

  const supportWithCoffee = () => {
    window.open(DONATION_URL, '_blank', 'noopener,noreferrer');
    rememberDonationPrompt();
    setShowDonationBanner(false);
    setShowDonationModal(false);
    withStatus(L('Благодарим за подкрепата!', 'Thank you for your support!', 'Grazie per il supporto!'));
  };

  const serialSummaryText = (serials: string[]) => {
    if (!serials.length) return L('няма SN', 'no SN', 'nessun SN');
    const shown = serials.slice(0, 10).join(', ');
    const rest = serials.length - 10;
    if (rest > 0) {
      return `${shown} ${L(`... (+${rest} още)`, `... (+${rest} more)`, `... (+${rest} altri)`)}`;
    }
    return shown;
  };

  const helpSections = helpSectionsByLang[lang];
  const helpSectionsByRole = useMemo(() => {
    const adminKeywords = ['админ', 'admin'];
    const operatorKeywords = ['оператор', 'operator', 'operatore'];
    const hasKeyword = (title: string, keywords: string[]) => keywords.some((k) => title.toLowerCase().includes(k));

    const admin = helpSections.filter((s) => hasKeyword(s.title, adminKeywords));
    const operator = helpSections.filter((s) => hasKeyword(s.title, operatorKeywords));
    const shared = helpSections.filter((s) => !hasKeyword(s.title, adminKeywords) && !hasKeyword(s.title, operatorKeywords));

    return {
      admin: admin.length ? admin : helpSections,
      operator: operator.length ? operator : helpSections,
      shared,
    };
  }, [helpSections]);

  const toFriendlyError = (message: string) => {
    if (message.includes('PRICE_BELOW_MIN')) {
      return L(`Цена под минималната. ${message}`, `Price below minimum. ${message}`, `Prezzo sotto il minimo. ${message}`);
    }
    if (message.includes('OUT_OF_STOCK')) {
      return L(`Няма достатъчна наличност. ${message}`, `Insufficient stock. ${message}`, `Stock insufficiente. ${message}`);
    }
    if (message.includes('SN_CONFLICT')) {
      return L(`Конфликт със сериен номер. ${message}`, `Serial number conflict. ${message}`, `Conflitto numero seriale. ${message}`);
    }
    if (message.includes('SN_NOT_AVAILABLE')) {
      return L('Серийният номер не е наличен в склада.', 'Serial number is not available in stock.', 'Il numero seriale non e disponibile in magazzino.');
    }
    if (message.includes('FACTORY_BARCODE_EXISTS')) {
      return L('Фабричният баркод вече съществува.', 'Factory barcode already exists.', 'Il barcode fabbrica esiste gia.');
    }
    if (message.includes('STORE_BARCODE_EXISTS')) {
      return L('Вътрешният баркод вече съществува.', 'Store barcode already exists.', 'Il barcode interno esiste gia.');
    }
    if (message.includes('INTERNAL_SKU_EXISTS')) {
      return L('Вътрешният код (SKU) вече съществува.', 'Internal code (SKU) already exists.', 'Il codice interno (SKU) esiste gia.');
    }
    if (message.includes('INVALID_QTY')) return td.k007;
    return message;
  };

  const focusScanInput = () => {
    setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  const scrollToOperatorTop = () => {
    setTimeout(() => {
      operatorTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  };

  const handleExitFromOperator = () => {
    if (isAdmin) {
      setActiveTab(exitCashierTab);
      return;
    }
    setOperatorAction('');
    setOperatorSnapshot(null);
    setOperatorQty('1');
    setScanInput('');
    setError('');
    setStatus(L('Избор на режим. Изберете Приемане или Изписване.', 'Choose mode. Select Intake or Output.', 'Scelta modalita. Seleziona Carico o Scarico.'));
    focusScanInput();
  };

  const download = async (path: string, fileName: string) => {
    const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const printFromApi = async (path: string, fallbackFileName: string) => {
    const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const win = window.open(href, '_blank', 'noopener,noreferrer');
    if (!win) {
      const a = document.createElement('a');
      a.href = href;
      a.download = fallbackFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      withStatus(L('Браузърът блокира прозореца за печат. Файлът е изтеглен.', 'Popup blocked by browser. File was downloaded.', 'Popup bloccato dal browser. File scaricato.'));
      return;
    }
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // no-op: some browsers/PDF viewers block direct print
      }
    }, 700);
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  };

  const printWarrantyLabel = async (serial: string) => {
    const sn = serial.trim();
    if (!sn) return;
    await download(`/movements/warranty-label/${encodeURIComponent(sn)}`, `warranty_${sn}.pdf`);
  };

  const loadAvailableSerials = async (productId: string) => {
    if (!productId) {
      setAvailableSerials([]);
      return;
    }
    const data = await api<{ serial_numbers: string[] }>(`/movements/available-serials/${productId}`, {}, token);
    setAvailableSerials(data.serial_numbers || []);
  };

  const refreshMainData = async () => {
    const [p, m, current, c] = await Promise.all([
      api<Product[]>('/products', {}, token),
      api<Movement[]>('/movements', {}, token),
      api<User>('/auth/me', {}, token),
      api<Category[]>('/products/categories', {}, token)
    ]);

    setProducts(p);
    setMovements(m);
    setMe(current);
    setCategories(c);
    setThresholdDraft((prev) => {
      const next = { ...prev };
      for (const row of p) {
        if (!(row.id in next)) next[row.id] = String(row.min_threshold ?? 0);
      }
      return next;
    });

    const firstProductId = p[0] ? String(p[0].id) : '';
    const firstCategory = c[0]?.name || '';
    const defaultCategory = firstCategory || (current.role === 'admin' ? '__new__' : '');

    if (!mProductId) setMProductId(firstProductId);
    if (!bulkProductId) setBulkProductId(firstProductId);
    if (!reconcileProductId) setReconcileProductId(firstProductId);
    if (!category) setCategory(defaultCategory);
    if (!renameCategoryId && c[0]) {
      setRenameCategoryId(String(c[0].id));
      setRenameCategoryName(c[0].name);
      setRenameCategoryUnit(c[0].unit);
    }
  };

  const refreshUsers = async () => {
    if (me?.role !== 'admin') return;
    setUsers(await api<User[]>('/users', {}, token));
  };

  const loadSessionPolicy = async () => {
    const row = await api<{ session_timeout_minutes: number }>('/auth/session-policy', {}, token);
    const minutes = Math.max(1, Number(row.session_timeout_minutes || 15));
    setSessionTimeoutMinutes(minutes);
    if (me?.role === 'admin') {
      setSessionTimeoutInput(String(minutes));
    }
  };

  const loadAudit = async (overrides?: { entity?: string; entityId?: string; username?: string; serial?: string }) => {
    if (me?.role !== 'admin') return;
    const params = new URLSearchParams();
    params.set('limit', '300');
    const entityValue = (overrides?.entity ?? historyEntity).trim();
    const entityIdValue = (overrides?.entityId ?? historyEntityId).trim();
    const usernameValue = (overrides?.username ?? historyUsername).trim();
    const serialValue = (overrides?.serial ?? historySerial).trim();
    if (entityValue) params.set('entity', entityValue);
    if (entityIdValue) params.set('entity_id', entityIdValue);
    if (usernameValue) params.set('username', usernameValue);
    if (serialValue) params.set('serial_number', serialValue);
    setAuditLogs(await api<AuditLog[]>(`/admin/audit-logs?${params.toString()}`, {}, token));
  };

  const loadRecentSales = async () => {
    if (me?.role !== 'admin') return;
    setRecentSalesLoading(true);
    try {
      const rows = await api<RecentSale[]>('/movements/recent-sales?limit=10', {}, token);
      setRecentSales(rows);
    } finally {
      setRecentSalesLoading(false);
    }
  };

  const loadThresholdSuggestions = async () => {
    if (me?.role !== 'admin') return;
    const rows = await api<ThresholdSuggestion[]>('/products/threshold-suggestions?status=pending&limit=50', {}, token);
    setThresholdSuggestions(rows);
  };

  const loadRefundRequests = async () => {
    if (me?.role !== 'admin') return;
    const rows = await api<RefundRequest[]>('/movements/refund-requests?status=pending&limit=200', {}, token);
    setRefundRequests(rows);
  };

  const loadBusinessSummary = async () => {
    if (me?.role !== 'admin') return;
    const params = new URLSearchParams();
    params.set('period', summaryPeriod);
    if (summaryPeriod === 'custom') {
      if (!summaryStartDate || !summaryEndDate) {
        setError(L('При custom период попълни и двете дати.', 'For custom period, fill both dates.', 'Per periodo custom, inserisci entrambe le date.'));
        return;
      }
      params.set('start_date', summaryStartDate);
      params.set('end_date', summaryEndDate);
    }
    const row = await api<BusinessSummary>(`/bi/business-summary?${params.toString()}`, {}, token);
    setBusinessSummary(row);
  };

  useEffect(() => {
    refreshMainData().catch(handleError);
  }, []);

  useEffect(() => {
    refreshUsers().catch(() => undefined);
    loadAudit().catch(() => undefined);
    loadSessionPolicy().catch(() => undefined);
    loadThresholdSuggestions().catch(() => undefined);
    loadRefundRequests().catch(() => undefined);
  }, [me?.role]);

  useEffect(() => {
    if (!me || homeInitializedRef.current) return;
    setActiveTab(me.role === 'operator' ? 'cashier' : 'about');
    homeInitializedRef.current = true;
  }, [me]);

  useEffect(() => {
    if (!me?.id) return;
    if (me.role !== 'admin') {
      setShowDonationBanner(false);
      setShowDonationModal(false);
      return;
    }
    const key = `openstoko_donation_last_prompt_at_${me.id}`;
    const legacyKey = 'openstoko_donation_last_prompt_at';
    const ownRaw = localStorage.getItem(key);
    const raw = ownRaw || localStorage.getItem(legacyKey);
    if (!ownRaw && raw) {
      localStorage.setItem(key, raw);
      localStorage.removeItem(legacyKey);
    }
    if (!raw) {
      setShowDonationBanner(true);
      return;
    }
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) {
      localStorage.removeItem(key);
      localStorage.removeItem(legacyKey);
      setShowDonationBanner(true);
      return;
    }
    const elapsedDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    setShowDonationBanner(elapsedDays >= DONATION_REMINDER_DAYS);
  }, [me?.id, me?.role]);

  useEffect(() => {
    if (isOperator && !visibleTabs.includes(activeTab)) {
      setActiveTab('cashier');
    }
    if (isAdmin && !visibleTabs.includes(activeTab)) {
      setActiveTab('about');
    }
  }, [isOperator, isAdmin, activeTab, visibleTabs]);

  useEffect(() => {
    if (activeTab === 'cashier') focusScanInput();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'cashier') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOperatorAction('');
        setOperatorQty('1');
        setOperatorSnapshot(null);
        setScanInput('');
        withStatus(L('Избор на режим. Изберете Приемане или Изписване.', 'Choose mode. Select Intake or Output.', 'Scelta modalita. Seleziona Carico o Scarico.'));
        focusScanInput();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, lang]);

  useEffect(() => {
    if (activeTab === 'cashier') return;
    setOperatorAction('');
    setOperatorQty('');
    setOperatorSnapshot(null);
    setScanInput('');

  }, [activeTab]);

  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    const markActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    const onActivityEvents: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    onActivityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));

    const timer = window.setInterval(() => {
      const timeoutMs = Math.max(1, sessionTimeoutMinutes) * 60 * 1000;
      if (Date.now() - lastActivityAtRef.current >= timeoutMs) {
        window.clearInterval(timer);
        window.alert(L('Сесията изтече поради неактивност.', 'Session expired due to inactivity.', 'Sessione scaduta per inattivita.'));
        onLogout();
      }
    }, 10000);

    return () => {
      window.clearInterval(timer);
      onActivityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
    };
  }, [sessionTimeoutMinutes, onLogout, lang]);

  useEffect(() => {
    loadAvailableSerials(mProductId).catch(() => undefined);
  }, [mProductId]);

  useEffect(() => {
    const q = movementSearch.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) =>
      p.factory_barcode.trim().toLowerCase() === q ||
      p.internal_sku.trim().toLowerCase() === q ||
      p.name.trim().toLowerCase() === q
    );
    if (exact) {
      const id = String(exact.id);
      if (id !== mProductId) setMProductId(id);
    }
  }, [movementSearch, products, mProductId]);

  useEffect(() => {
    if (activeTab === 'cashier' && isAdmin) {
      loadRecentSales().catch(() => undefined);
    }
    if (activeTab === 'refunds' && isAdmin) {
      loadRefundRequests().catch(() => undefined);
    }
    if (activeTab === 'admin' && isAdmin && summaryPeriod !== 'custom') {
      loadBusinessSummary().catch(() => undefined);
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'admin') return;
    if (summaryPeriod === 'custom') return;
    loadBusinessSummary().catch(() => undefined);
  }, [summaryPeriod, isAdmin, activeTab]);

  useEffect(() => {
    if (!me?.id || cashierDraftLoadedRef.current) return;
    const key = `openstoko_cashier_draft_${me.id}`;
    const legacyKey = `smartstock_cashier_draft_${me.id}`;
    const raw = localStorage.getItem(key) || localStorage.getItem(legacyKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.cart)) setCashierCart(parsed.cart);
        if (typeof parsed?.customer === 'string') setCashierCustomer(parsed.customer || walkInLabel);
        if (typeof parsed?.comment === 'string') setCashierComment(parsed.comment);
        localStorage.setItem(key, raw);
        localStorage.removeItem(legacyKey);
      } catch {
        localStorage.removeItem(key);
        localStorage.removeItem(legacyKey);
      }
    }
    cashierDraftLoadedRef.current = true;
  }, [me?.id]);

  useEffect(() => {
    if (!me?.id || !cashierDraftLoadedRef.current) return;
    const key = `openstoko_cashier_draft_${me.id}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        customer: cashierCustomer,
        comment: cashierComment,
        cart: cashierCart,
      }),
    );
  }, [me?.id, cashierCustomer, cashierComment, cashierCart]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  const lookupDossier = async () => {
    const code = dossierCode.trim();
    if (!code) {
      setError(L('Сканирайте баркод/SN/вътрешен код.', 'Scan barcode/SN/internal code.', 'Scansiona barcode/SN/codice interno.'));
      return;
    }
    try {
      const data = await api<DossierData>(`/products/dossier?code=${encodeURIComponent(code)}`, {}, token);
      setDossierData(data);
      setDossierAdminSell(String(Number(data.product.sell_price || 0)));
      setDossierAdminMin(String(Number(data.product.min_sell_price || 0)));
      withStatus(L('Заредено досие на продукта.', 'Product dossier loaded.', 'Dossier prodotto caricato.'));
    } catch (e) {
      handleError(e);
    }
  };

  const openDossierByProductId = async (productId: number) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    try {
      const code = product.internal_sku || product.factory_barcode;
      const data = await api<DossierData>(`/products/dossier?code=${encodeURIComponent(code)}`, {}, token);
      setDossierCode(code);
      setDossierData(data);
      setDossierAdminSell(String(Number(data.product.sell_price || 0)));
      setDossierAdminMin(String(Number(data.product.min_sell_price || 0)));
      setActiveTab('products');
      if (isAdmin) {
        startAdminEdit(product);
      }
      withStatus(L('Отворен е екранът за редакция на продукта.', 'Product edit screen opened.', 'Schermata modifica prodotto aperta.'));
    } catch (e) {
      handleError(e);
    }
  };

  const addDossierComment = async () => {
    if (!dossierData) return;
    const text = dossierComment.trim();
    if (!text) {
      setError(L('Коментарът е празен.', 'Comment is empty.', 'Il commento e vuoto.'));
      return;
    }
    try {
      await api('/products/dossier/comment', {
        method: 'POST',
        body: JSON.stringify({
          product_id: dossierData.product.id,
          serial_number: dossierData.stock.current_serial?.serial_number || null,
          comment: text,
        }),
      }, token);
      setDossierComment('');
      await lookupDossier();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const saveDossierPricing = async () => {
    if (!dossierData || !isAdmin) return;
    try {
      await api(`/products/${dossierData.product.id}/admin-pricing`, {
        method: 'POST',
        body: JSON.stringify({
          sell_price: Number(dossierAdminSell || dossierData.product.sell_price),
          min_sell_price: Number(dossierAdminMin || dossierData.product.min_sell_price),
        }),
      }, token);
      withStatus(L('Админ цените са обновени.', 'Admin pricing updated.', 'Prezzi admin aggiornati.'));
      await refreshMainData();
      await lookupDossier();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const startIntakeSession = () => {
    const code = intakeModelCode.trim().toLowerCase();
    if (!code) {
      setError(L('Сканирайте баркод/вътрешен код на модел.', 'Scan model barcode/internal code.', 'Scansiona barcode/codice interno del modello.'));
      return;
    }
    const product = products.find((p) =>
      p.factory_barcode.trim().toLowerCase() === code || p.internal_sku.trim().toLowerCase() === code,
    );
    if (!product) {
      setError(L('Моделът не е намерен.', 'Model not found.', 'Modello non trovato.'));
      return;
    }
    const target = Number(intakeQty || '0');
    if (!Number.isInteger(target) || target <= 0) {
      setError(L('Количеството трябва да е цяло число > 0.', 'Quantity must be integer > 0.', 'La quantita deve essere intera > 0.'));
      return;
    }
    setIntakeProduct(product);
    setIntakeTarget(target);
    setIntakeSerials([]);
    setIntakeSerialInput('');
    withStatus(L('Режимът за серийно сканиране е стартиран.', 'Serial scan mode started.', 'Modalita scansione seriali avviata.'));
  };

  const addIntakeSerial = () => {
    const sn = intakeSerialInput.trim();
    if (!sn) return;
    if (intakeSerials.includes(sn)) {
      setError(L('Дублиран сериен номер.', 'Duplicate serial number.', 'Numero seriale duplicato.'));
      return;
    }
    if (intakeTarget > 0 && intakeSerials.length >= intakeTarget) {
      setError(L('Достигнат е зададеният брой.', 'Target quantity already reached.', 'Quantita target gia raggiunta.'));
      return;
    }
    setIntakeSerials((prev) => [...prev, sn]);
    setIntakeSerialInput('');
  };

  const finalizeIntake = async () => {
    if (!intakeProduct) {
      setError(L('Няма избран модел за заприхождаване.', 'No model selected for intake.', 'Nessun modello selezionato per il carico.'));
      return;
    }
    if (intakeSerials.length !== intakeTarget) {
      setError(L(`Очаквани ${intakeTarget}, сканирани ${intakeSerials.length}.`, `Expected ${intakeTarget}, scanned ${intakeSerials.length}.`, `Attesi ${intakeTarget}, scansionati ${intakeSerials.length}.`));
      return;
    }
    try {
      await api('/movements/input-bulk', {
        method: 'POST',
        body: JSON.stringify({
          product_id: intakeProduct.id,
          serial_numbers: intakeSerials,
          comment: L('Магическо заприхождаване (серийно сканиране)', 'Smart intake (serial scan)', 'Carico smart (scansione seriali)'),
        }),
      }, token);
      withStatus(L('Заприхождаването е завършено успешно.', 'Stock intake completed successfully.', 'Carico completato con successo.'));
      setIntakeProduct(null);
      setIntakeTarget(0);
      setIntakeSerials([]);
      setIntakeSerialInput('');
      await refreshMainData();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const createProduct = async () => {
    try {
      const productName = name.trim();
      const barcodeValue = barcode.trim();
      const locationValue = location.trim();
      const useInlineCategory = category === '__new__' || (isAdmin && categories.length === 0);
      const categoryValue = useInlineCategory ? newCategoryInline.trim() : category.trim();
      const purchase = Number(purchasePrice || '0');
      const sell = Number(sellPrice || '0');
      const minSell = Number(minSellPrice || '0');
      const initialQtyNum = Number(initialStockQty || '0');
      const minThresholdNum = Number(minThresholdInput || '0');

      const missing: string[] = [];
      if (!productName) missing.push(L('Име', 'Name', 'Nome'));
      if (!categoryValue) missing.push(L('Категория', 'Category', 'Categoria'));
      if (!barcodeValue) missing.push(L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica'));
      if (!locationValue) missing.push(L('Локация', 'Location', 'Posizione'));
      if (!purchasePrice.trim()) missing.push(L('Покупна цена', 'Purchase price', 'Prezzo acquisto'));
      if (!sellPrice.trim()) missing.push(L('Продажна цена', 'Sell price', 'Prezzo vendita'));
      if (!minSellPrice.trim()) missing.push(L('Минимална продажна цена', 'Minimum sell price', 'Prezzo minimo vendita'));
      if (!minThresholdInput.trim()) missing.push(L('Минимален складов праг', 'Minimum stock threshold', 'Soglia minima magazzino'));

      if (missing.length > 0) {
        setError(
          L(
            `Липсват задължителни полета: ${missing.join(', ')}.`,
            `Missing required fields: ${missing.join(', ')}.`,
            `Campi obbligatori mancanti: ${missing.join(', ')}.`,
          ),
        );
        return;
      }

      if (Number.isNaN(purchase) || Number.isNaN(sell) || Number.isNaN(minSell)) {
        setError(L('Цените трябва да са валидни числа.', 'Prices must be valid numbers.', 'I prezzi devono essere numeri validi.'));
        return;
      }
      if (minSell > sell) {
        setError(L('Минималната цена не може да е по-висока от продажната.', 'Minimum sell price cannot exceed sell price.', 'Il prezzo minimo non puo essere maggiore del prezzo di vendita.'));
        return;
      }
      if (!Number.isInteger(initialQtyNum) || initialQtyNum < 0) {
        setError(L('Началното количество трябва да е цяло число >= 0.', 'Initial quantity must be integer >= 0.', 'La quantita iniziale deve essere intera >= 0.'));
        return;
      }

      if (!Number.isInteger(minThresholdNum) || minThresholdNum < 0) {
        setError(L('Минималният праг трябва да е цяло число >= 0.', 'Minimum threshold must be integer >= 0.', 'La soglia minima deve essere intera >= 0.'));
        return;
      }

      let finalCategory = category;
      if (useInlineCategory) {
        if (!isAdmin) {
          setError(td.k008);
          return;
        }
        finalCategory = newCategoryInline.trim();
        if (!finalCategory) {
          setError(td.k009);
          return;
        }
        await api('/products/categories', { method: 'POST', body: JSON.stringify({ name: finalCategory, unit: 'pcs' }) }, token);
      }

      let resolvedPhotoUrl = photoUrl.trim() || null;
      if (photoFile) {
        const form = new FormData();
        form.append('file', photoFile);
        const upload = await api<{ photo_url: string }>('/products/upload-photo', { method: 'POST', body: form }, token);
        resolvedPhotoUrl = upload.photo_url;
      }

      const created = await api<Product>('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: productName,
          category: finalCategory,
          factory_barcode: barcodeValue,
          store_barcode: storeBarcode.trim() || null,
          internal_sku: internalSkuInput.trim() || null,
          product_comment: productComment.trim(),
          technical_specs: productSpecs.trim(),
          description: productComment.trim(),
          supplier_name: supplierName.trim() || null,
          photo_url: resolvedPhotoUrl,
          warehouse_location: locationValue,
          purchase_price: purchase,
          sell_price: sell,
          min_sell_price: minSell,
          min_threshold: minThresholdNum,
          compatibility_group_code: compatibilityGroupInput.trim() || null,
        }),
      }, token);

      if (initialQtyNum > 0) {
        await api('/movements/input-generate', {
          method: 'POST',
          body: JSON.stringify({
            product_id: created.id,
            qty: initialQtyNum,
            serial_prefix: null,
            comment: L('Начално заприхождаване при създаване на продукт', 'Initial stock intake on product creation', 'Carico iniziale alla creazione prodotto'),
          }),
        }, token);
      }

      withStatus(td.k010);
      setName('');
      setBarcode('');
      setStoreBarcode('');
      setInternalSkuInput('');
      setLocation('');
      setPurchasePrice('');
      setSellPrice('');
      setMinSellPrice('');
      setProductComment('');
      setProductSpecs('');
      setSupplierName('');
      setPhotoUrl('');
      setPhotoFile(null);
      setPhotoInputKey((v) => v + 1);
      setInitialStockQty('0');
      setMinThresholdInput('');
      setCompatibilityGroupInput('');
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const createInlineCategory = async () => {
    if (!isAdmin) {
      setError(td.k008);
      return;
    }
    const name = newCategoryInline.trim();
    if (!name) {
      setError(td.k009);
      return;
    }
    try {
      await api('/products/categories', {
        method: 'POST',
        body: JSON.stringify({ name, unit: 'pcs' }),
      }, token);
      await refreshMainData();
      setCategory(name);
      setNewCategoryInline('');
      withStatus(L('Категорията е създадена.', 'Category created.', 'Categoria creata.'));
    } catch (e) {
      handleError(e);
    }
  };

  const importProductsExcel = async () => {
    if (!excelFile) {
      setError(td.k011);
      return;
    }
    try {
      const form = new FormData();
      form.append('file', excelFile);
      await api('/products/import-excel', { method: 'POST', body: form }, token);
      withStatus(td.k012);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const importProductsExcelDataMgmt = async () => {
    if (!dataMgmtImportFile) {
      setError(td.k011);
      return;
    }
    try {
      const form = new FormData();
      form.append('file', dataMgmtImportFile);
      await api('/products/import-excel', { method: 'POST', body: form }, token);
      withStatus(td.k012);
      setDataMgmtImportFile(null);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const downloadBusinessSummaryReport = async () => {
    const params = new URLSearchParams();
    params.set('period', dataMgmtPeriod);
    if (dataMgmtPeriod === 'custom') {
      if (!dataMgmtStartDate || !dataMgmtEndDate) {
        setError(L('Избери и начална, и крайна дата.', 'Select both start and end date.', 'Seleziona sia data inizio che data fine.'));
        return;
      }
      params.set('start_date', dataMgmtStartDate);
      params.set('end_date', dataMgmtEndDate);
    }
    await download(`/reports/business-summary.xlsx?${params.toString()}`, `business_summary_${dataMgmtPeriod}.xlsx`);
  };

  const createMovement = async (forcedType?: string) => {
    const movementType = forcedType || mType;
    try {
      await api('/movements', {
        method: 'POST',
        body: JSON.stringify({
          movement_type: movementType,
          product_id: Number(mProductId),
          serial_number: mSerial || null,
          qty: 1,
          unit_price: Number(mPrice || '0'),
          customer_name: mCustomer || null,
          comment: mComment
        })
      }, token);
      if (movementType === 'output' && mSerial.trim()) {
        setLastSoldSerials([mSerial.trim()]);
      } else {
        setLastSoldSerials([]);
      }
      withStatus(td.k013);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(mProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const quickInputGenerate = async () => {
    try {
      const res = await api<{ created: number }>('/movements/input-generate', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(mProductId),
          qty: Number(quickInputQty),
          serial_prefix: quickInputPrefix || null,
          comment: td.k015
        })
      }, token);
      setLastSoldSerials([]);
      withStatus(L(`Автоматичният вход е завършен. Създадени ${res.created} серийни номера.`, `Automatic stock input completed. Created ${res.created} serial numbers.`, `Carico automatico completato. Creati ${res.created} numeri seriali.`));
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(mProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const submitBulkInput = async () => {
    const serials = bulkSerials.split('\n').map((v) => v.trim()).filter(Boolean);
    if (!serials.length) {
      setError(td.k016);
      return;
    }
    try {
      await api('/movements/input-bulk', {
        method: 'POST',
        body: JSON.stringify({ product_id: Number(bulkProductId), serial_numbers: serials, comment: td.k017 })
      }, token);
      withStatus(td.k018);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const loadReconcileTemplate = async () => {
    if (!reconcileProductId) {
      setError(L('Изберете продукт за инвентаризация.', 'Select product for inventory.', 'Seleziona prodotto per inventario.'));
      return;
    }
    try {
      const data = await api<{ serial_numbers: string[] }>(`/movements/available-serials/${reconcileProductId}`, {}, token);
      setReconcileSerials((data.serial_numbers || []).join('\n'));
      withStatus(L('Заредени са текущите серийни номера от системата.', 'Loaded current serial numbers from system.', 'Caricati i seriali correnti dal sistema.'));
    } catch (e) {
      handleError(e);
    }
  };

  const submitReconcile = async () => {
    if (!reconcileProductId) {
      setError(L('Изберете продукт за инвентаризация.', 'Select product for inventory.', 'Seleziona prodotto per inventario.'));
      return;
    }
    const serials = reconcileSerials.split('\n').map((v) => v.trim()).filter(Boolean);
    if (!serials.length) {
      setError(L('Въведете поне един сериен номер за сверяване.', 'Enter at least one serial number for reconcile.', 'Inserisci almeno un seriale per la riconciliazione.'));
      return;
    }
    try {
      const result = await api<{ missing: string[]; unexpected: string[]; auto_adjusted: number }>('/movements/inventory-reconcile', {
        method: 'POST',
        body: JSON.stringify({ product_id: Number(reconcileProductId), serial_numbers_found: serials, comment: reconcileComment })
      }, token);
      setReconcileResult(result);
      withStatus(td.k019);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const loadTimeMachine = async () => {
    try {
      setTmData(await api<any[]>(`/bi/time-machine?month=${month}`, {}, token));
      withStatus(td.k020);
    } catch (e) {
      handleError(e);
    }
  };

  const loadVelocity = async () => {
    try {
      setVelocityData(await api<any[]>('/bi/velocity', {}, token));
      withStatus(td.k021);
    } catch (e) {
      handleError(e);
    }
  };

  const loadABC = async () => {
    try {
      setAbcData(await api<any[]>('/bi/abc', {}, token));
      withStatus(td.k022);
    } catch (e) {
      handleError(e);
    }
  };

  const loadWarranty = async () => {
    try {
      setWarrantyData(await api<any>(`/bi/warranty/${encodeURIComponent(warrantySerial)}`, {}, token));
      withStatus(td.k023);
    } catch (e) {
      handleError(e);
    }
  };

  const loadHistoryWarranty = async () => {
    const serial = historySerial.trim();
    if (!serial) {
      setError(L('Въведи сериен номер за гаранционна проверка.', 'Enter a serial number for warranty check.', 'Inserisci un numero seriale per il controllo garanzia.'));
      return;
    }
    try {
      setHistoryWarrantyData(await api<any>(`/bi/warranty/${encodeURIComponent(serial)}`, {}, token));
      withStatus(L('Гаранционната проверка е заредена.', 'Warranty check loaded.', 'Controllo garanzia caricato.'));
    } catch (e) {
      handleError(e);
    }
  };

  const createUser = async () => {
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername, full_name: newFullName, role: newRole, password: newPassword })
      }, token);
      withStatus(td.k024);
      await refreshUsers();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const resetUserPassword = async (userId: number) => {
    try {
      const pwd = (resetPasswordValue[userId] || '').trim();
      if (pwd.length < 6) {
        setError(td.k025);
        return;
      }
      await api(`/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password: pwd }) }, token);
      withStatus(td.k026);
      setResetPasswordValue((prev) => ({ ...prev, [userId]: '' }));
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };


  const saveSessionTimeoutPolicy = async () => {
    const minutes = Number(sessionTimeoutInput || '0');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setError(L('Въведете валидни минути (1-1440).', 'Enter valid minutes (1-1440).', 'Inserisci minuti validi (1-1440).'));
      return;
    }
    try {
      const row = await api<{ session_timeout_minutes: number }>('/admin/session-policy', {
        method: 'PUT',
        body: JSON.stringify({ session_timeout_minutes: minutes }),
      }, token);
      setSessionTimeoutMinutes(Number(row.session_timeout_minutes));
      setSessionTimeoutInput(String(row.session_timeout_minutes));
      withStatus(L('Политиката за auto-logout е обновена.', 'Auto-logout policy updated.', 'Policy auto-logout aggiornata.'));
      await loadAudit().catch(() => undefined);
    } catch (e) {
      handleError(e);
    }
  };
  const createCategory = async () => {
    try {
      await api('/products/categories', { method: 'POST', body: JSON.stringify({ name: newCategoryName, unit: newCategoryUnit }) }, token);
      withStatus(td.k027);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const updateCategory = async () => {
    try {
      await api(`/products/categories/${renameCategoryId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: renameCategoryName, unit: renameCategoryUnit })
      }, token);
      withStatus(td.k028);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const deleteCategory = async () => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await api(`/products/categories/${renameCategoryId}`, { method: 'DELETE' }, token);
      withStatus(td.k029);
      await refreshMainData();
      await loadAudit();
      await loadAvailableSerials(reconcileProductId);
    } catch (e) {
      handleError(e);
    }
  };

  const reviewThresholdSuggestion = async (suggestionId: number, action: 'approve' | 'reject') => {
    if (!isAdmin) return;
    try {
      await api(`/products/threshold-suggestions/${suggestionId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }, token);
      withStatus(action === 'approve'
        ? L('Предложението е одобрено.', 'Suggestion approved.', 'Suggerimento approvato.')
        : L('Предложението е отхвърлено.', 'Suggestion rejected.', 'Suggerimento rifiutato.'));
      await refreshMainData();
      await loadThresholdSuggestions();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const saveMinThreshold = async (product: Product) => {
    if (!isAdmin) return;
    const raw = (thresholdDraft[product.id] ?? String(product.min_threshold ?? 0)).trim();
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 0) {
      setError(L('Прагът трябва да е цяло число >= 0.', 'Threshold must be integer >= 0.', 'La soglia deve essere intera >= 0.'));
      return;
    }
    try {
      await api(`/products/${product.id}/min-threshold`, {
        method: 'PUT',
        body: JSON.stringify({ min_threshold: next }),
      }, token);
      withStatus(L('Минималният праг е обновен.', 'Minimum threshold updated.', 'Soglia minima aggiornata.'));
      await refreshMainData();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const startAdminEdit = (product: Product) => {
    setEditingProductId(product.id);
    setAdminEditName(product.name || '');
    setAdminEditCategory(product.category || '');
    setAdminEditBrand(product.brand_name || 'Generic');
    setAdminEditSupplier(product.supplier_name || '');
    setAdminEditInternalSku(product.internal_sku || '');
    setAdminEditFactoryBarcode(product.factory_barcode || '');
    setAdminEditStoreBarcode(product.store_barcode || '');
    setAdminEditLocation(product.warehouse_location || '');
    setAdminEditCompatibility(product.compatibility_group || product.compatibility_group_code || '');
    setAdminEditComment(product.product_comment || product.description || '');
    setAdminEditSpecs(product.technical_specs || '');
    setAdminEditPhotoUrl(product.photo_url || '');
    setAdminEditPurchase(String(Number(product.purchase_price || 0)));
    setAdminEditSell(String(Number(product.sell_price || 0)));
    setAdminEditMinSell(String(Number(product.min_sell_price || 0)));
    setAdminEditThreshold(String(Number(product.min_threshold || 0)));
    withStatus(L(`Отворена редакция за: ${product.name}`, `Edit opened for: ${product.name}`, `Modifica aperta per: ${product.name}`));
    setTimeout(() => {
      adminEditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const openProduct360 = (product: Product) => {
    setSelectedProduct360(product);
  };

  const saveAdminEdit = async () => {
    if (!isAdmin || !editingProductId) return;
    const purchase = Number(adminEditPurchase || '0');
    const sell = Number(adminEditSell || '0');
    const minSell = Number(adminEditMinSell || '0');
    const threshold = Number(adminEditThreshold || '0');

    if (!adminEditName.trim()) {
      setError(L('Името е задължително.', 'Name is required.', 'Il nome e obbligatorio.'));
      return;
    }
    if (!adminEditCategory.trim()) {
      setError(L('Категорията е задължителна.', 'Category is required.', 'La categoria e obbligatoria.'));
      return;
    }
    if (!adminEditInternalSku.trim()) {
      setError(L('Вътрешният код (SKU) е задължителен.', 'Internal code (SKU) is required.', 'Il codice interno (SKU) e obbligatorio.'));
      return;
    }
    if (!adminEditFactoryBarcode.trim()) {
      setError(L('Фабричният баркод е задължителен.', 'Factory barcode is required.', 'Il barcode fabbrica e obbligatorio.'));
      return;
    }
    if (!adminEditLocation.trim()) {
      setError(L('Локацията е задължителна.', 'Location is required.', 'La posizione e obbligatoria.'));
      return;
    }
    if ([purchase, sell, minSell, threshold].some((v) => Number.isNaN(v))) {
      setError(L('Невалидни числа в админ редакцията.', 'Invalid numeric values in admin edit.', 'Valori numerici non validi nella modifica admin.'));
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0) {
      setError(L('Мин. праг трябва да е цяло число >= 0.', 'Min threshold must be integer >= 0.', 'La soglia minima deve essere intera >= 0.'));
      return;
    }
    if (minSell > sell) {
      setError(L('Минималната цена не може да е по-висока от продажната.', 'Minimum sell price cannot exceed sell price.', 'Il prezzo minimo non puo superare il prezzo di vendita.'));
      return;
    }

    try {
      await api(`/products/${editingProductId}/admin-edit`, {
        method: 'PUT',
        body: JSON.stringify({
          name: adminEditName.trim(),
          category: adminEditCategory.trim(),
          brand_name: adminEditBrand.trim() || 'Generic',
          supplier_name: adminEditSupplier.trim() || null,
          internal_sku: adminEditInternalSku.trim(),
          factory_barcode: adminEditFactoryBarcode.trim(),
          store_barcode: adminEditStoreBarcode.trim() || null,
          warehouse_location: adminEditLocation.trim(),
          compatibility_group: adminEditCompatibility.trim() || null,
          product_comment: adminEditComment.trim(),
          technical_specs: adminEditSpecs.trim(),
          photo_url: adminEditPhotoUrl.trim() || null,
          purchase_price: purchase,
          sell_price: sell,
          min_sell_price: minSell,
          min_threshold: threshold,
        }),
      }, token);
      withStatus(L('Админ редакцията е запазена.', 'Admin edit saved.', 'Modifica admin salvata.'));
      setEditingProductId(null);
      await refreshMainData();
      await loadAudit();
    } catch (e) {
      handleError(e);
    }
  };

  const loadAdminEditByLookup = () => {
    if (!isAdmin) return;
    const q = adminEditLookup.trim().toLowerCase();
    if (!q) {
      setError(L('Въведи код, баркод или име за търсене.', 'Enter code, barcode, or name to search.', 'Inserisci codice, barcode o nome da cercare.'));
      return;
    }

    const exact = productLookup.get(q)
      || products.find((p) => (p.name || '').trim().toLowerCase() === q);
    const fuzzy = products.find((p) => (p.name || '').toLowerCase().includes(q));
    const found = exact || fuzzy;

    if (!found) {
      setError(L('Няма намерен продукт по този ключ.', 'No product found for this key.', 'Nessun prodotto trovato con questa chiave.'));
      return;
    }

    startAdminEdit(found);
  };

  const oldParsed = selectedAudit ? parseMaybeJson(selectedAudit.old_value) : null;
  const newParsed = selectedAudit ? parseMaybeJson(selectedAudit.new_value) : null;
  const onHistoryFilterEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    withLoading('history-load-audit', loadAudit);
  };
  const product360Movements = useMemo(() => {
    if (!selectedProduct360) return [] as Movement[];
    return movements
      .filter((m) => Number(m.product_id) === Number(selectedProduct360.id))
      .sort((a, b) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || (b.id - a.id))
      .slice(0, 10);
  }, [movements, selectedProduct360]);
  const formatMoney = (value: number) => Number(value || 0).toFixed(2);

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.factory_barcode.trim().toLowerCase(), p);
      if (p.store_barcode) map.set(p.store_barcode.trim().toLowerCase(), p);
      map.set(p.internal_sku.trim().toLowerCase(), p);
    }
    return map;
  }, [products]);

  const addToCart = (product: Product, qty: number, maxStock?: number) => {
    const safeQty = Number(qty || 0);
    if (!Number.isInteger(safeQty) || safeQty <= 0) {
      setError(L('Количество за добавяне трябва да е цяло число > 0.', 'Add quantity must be integer > 0.', 'La quantita da aggiungere deve essere intera > 0.'));
      return;
    }
    const currentLine = cashierCart.find((line) => line.product_id === product.id);
    const currentQty = Number(currentLine?.qty || 0);
    const stockCap = Number(maxStock ?? product.current_stock ?? 0);
    if (currentQty + safeQty > stockCap) {
      setError(
        L(
          `Недостатъчна наличност. В количка: ${currentQty}, добавяне: ${safeQty}, налични: ${stockCap}.`,
          `Insufficient stock. In cart: ${currentQty}, adding: ${safeQty}, available: ${stockCap}.`,
          `Stock insufficiente. Nel carrello: ${currentQty}, aggiunta: ${safeQty}, disponibili: ${stockCap}.`,
        ),
      );
      return;
    }
    setCashierCart((prev) => {
      const idx = prev.findIndex((i) => i.product_id === product.id);
      if (idx === -1) {
        return [
          ...prev,
          {
            product_id: product.id,
            name: product.name,
            code: product.factory_barcode,
            qty: safeQty,
            unit_price: Number(product.sell_price || 0),
            available: stockCap,
          },
        ];
      }
      return prev.map((item, i) => (
        i === idx
          ? { ...item, qty: item.qty + safeQty, available: stockCap, unit_price: Number(product.sell_price || item.unit_price || 0) }
          : item
      ));
    });
  };

  const removeFromCart = (productId: number) => {
    setCashierCart((prev) => prev.filter((line) => line.product_id !== productId));
  };

  const clearCartDraft = () => {
    setCashierCart([]);
    setCashierComment('');
    setLastSoldSerials([]);
    withStatus(L('Черновата на продажбата е изчистена.', 'Sale draft cleared.', 'Bozza vendita pulita.'));
    focusScanInput();
  };

  const handleScanEnter = async () => {
    const rawCode = scanInput.trim();
    const code = rawCode.toLowerCase();
    if (!code) {
      setError(L('Сканирайте код на продукт.', 'Scan a product code.', 'Scansiona un codice prodotto.'));
      focusScanInput();
      return;
    }

    try {
      const dossier = await api<DossierData>(`/products/dossier?code=${encodeURIComponent(rawCode)}`, {}, token);
      setOperatorSnapshot(dossier);

      const product = products.find((p) => p.id === dossier.product.id) || productLookup.get(code);
      if (!product) {
        setError(td.k030);
        setScanInput('');
        return;
      }

      setMProductId(String(product.id));
      const stock = await api<{ available_qty: number; serial_numbers: string[] }>(`/movements/available-serials/${product.id}`, {}, token);
      setAvailableSerials(stock.serial_numbers || []);

      withStatus(L('Продуктът е зареден. Изберете действие и количество.', 'Product loaded. Choose action and quantity.', 'Prodotto caricato. Scegli azione e quantita.'));
      setScanInput('');
    } catch (e) {
      handleError(e);
    } finally {
      focusScanInput();
    }
  };

  const searchOperatorByName = async () => {
    const q = operatorSearchMode === 'category' ? operatorCategory.trim() : operatorNameQuery.trim();
    if (!q) {
      setError(
        operatorSearchMode === 'category'
          ? L('Изберете категория.', 'Select category.', 'Seleziona categoria.')
          : L('Въведете име, SKU или марка.', 'Enter name, SKU or brand.', 'Inserisci nome, SKU o marca.'),
      );
      return;
    }
    setOperatorSearchLoading(true);
    try {
      const rows = await api<OperatorSearchResult[]>(
        `/products/operator-search?q=${encodeURIComponent(q)}&limit=30&mode=${encodeURIComponent(operatorSearchMode)}`,
        {},
        token,
      );
      setOperatorNameResults(rows);
      if (!rows.length) {
        withStatus(L('Няма резултати за това търсене.', 'No results for this search.', 'Nessun risultato per questa ricerca.'));
      }
    } catch (e) {
      handleError(e);
    } finally {
      setOperatorSearchLoading(false);
    }
  };

  useEffect(() => {
    if (operatorSearchMode === 'category' && !operatorCategory && sortedCategoryNames.length) {
      setOperatorCategory(sortedCategoryNames[0]);
    }
  }, [operatorSearchMode, operatorCategory, sortedCategoryNames]);

  const selectOperatorProduct = async (productId: number, forceTopDetails = true) => {
    try {
      if (forceTopDetails && operatorSearchMode !== 'barcode') {
        setOperatorSearchMode('barcode');
      }
      const dossier = await api<DossierData>(`/products/${productId}/operator-card`, {}, token);
      setOperatorSnapshot(dossier);
      setMProductId(String(productId));
      const stock = await api<{ available_qty: number; serial_numbers: string[] }>(`/movements/available-serials/${productId}`, {}, token);
      setAvailableSerials(stock.serial_numbers || []);
      withStatus(L('Продуктът е избран.', 'Product selected.', 'Prodotto selezionato.'));
      scrollToOperatorTop();
      focusScanInput();
    } catch (e) {
      handleError(e);
    }
  };

  const addOperatorSelectionToCart = () => {
    if (!operatorSnapshot || operatorAction !== 'output') {
      setError(L('Първо изберете продукт за продажба.', 'Select a product for sale first.', 'Seleziona prima un prodotto per la vendita.'));
      return;
    }
    if (!operatorQty.trim() || !isOperatorQtyValid) {
      setError(L('Въведете валидно количество.', 'Enter a valid quantity.', 'Inserisci una quantita valida.'));
      return;
    }
    const product = products.find((p) => p.id === operatorSnapshot.product.id);
    if (!product) {
      setError(L('Продуктът не е намерен.', 'Product not found.', 'Prodotto non trovato.'));
      return;
    }
    const qty = operatorQtyNum;
    addToCart(product, qty, Number(operatorSnapshot.stock.in_stock_qty || 0));
    setOperatorQty('1');
    setScanInput('');
    withStatus(
      L(
        `Добавени ${qty} бр. в черновата за продажба.`,
        `Added ${qty} units to the sale draft.`,
        `Aggiunte ${qty} unita alla bozza vendita.`,
      ),
    );
    focusScanInput();
  };

  const signalThresholdToAdmin = async () => {
    if (!operatorSnapshot) return;
    const note = window.prompt(
      L('Кратка бележка до админа (по избор):', 'Short note to admin (optional):', 'Nota breve per admin (opzionale):'),
      '',
    ) || '';
    try {
      await api(`/products/${operatorSnapshot.product.id}/signal-threshold`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }, token);
      withStatus(L('Изпратен е сигнал към админ.', 'Signal sent to admin.', 'Segnalazione inviata all admin.'));
      await loadAudit().catch(() => undefined);
    } catch (e) {
      handleError(e);
    }
  };

  const executeOperatorAction = async () => {
    if (!operatorSnapshot) {
      setError(L('Първо сканирайте продукт.', 'Scan a product first.', 'Scansiona prima un prodotto.'));
      focusScanInput();
      return;
    }
    if (!operatorAction) {
      setError(L('Изберете действие: Добави стока или Продай стока.', 'Select action: Add Stock or Sell Stock.', 'Scegli azione: Carico o Vendita.'));
      return;
    }
    if (!operatorQty.trim()) {
      setError(L('Въведете количество.', 'Enter quantity.', 'Inserisci quantita.'));
      return;
    }
    if (!isOperatorQtyValid) {
      setError(L('Количеството трябва да е цяло число > 0.', 'Quantity must be an integer > 0.', 'La quantita deve essere un numero intero > 0.'));
      return;
    }

    const qty = operatorQtyNum;

    if (operatorAction === 'output') {
      setError(L('За продажба използвайте "Добави в продажбата" и после "Потвърди продажбата".', 'For sale use "Add to sale draft" and then "Confirm sale".', 'Per la vendita usa "Aggiungi alla bozza" e poi "Conferma vendita".'));
      focusScanInput();
      return;
    }

    try {
      const res = await api<{ created: number }>('/movements/input-generate', {
        method: 'POST',
        body: JSON.stringify({
          product_id: operatorSnapshot.product.id,
          qty,
          serial_prefix: null,
          comment: L('Оператор: добавяне на стока', 'Operator: stock intake', 'Operatore: carico merce'),
        }),
      }, token);
      setLastSoldSerials([]);
      withStatus(L(`Добавени ${res.created} бр. към склада.`, `Added ${res.created} units to stock.`, `Aggiunte ${res.created} unita a magazzino.`));

      setOperatorQty('1');
      await refreshMainData();
      await loadAudit();
      const refreshed = await api<DossierData>(`/products/dossier?code=${encodeURIComponent(operatorSnapshot.product.factory_barcode)}`, {}, token);
      setOperatorSnapshot(refreshed);
      await loadAvailableSerials(String(operatorSnapshot.product.id));
    } catch (e) {
      handleError(e);
    } finally {
      focusScanInput();
    }
  };

  const checkoutCart = async () => {
    if (!cashierCart.length) {
      setError(td.k031);
      focusScanInput();
      return;
    }
    const oversold = cartDiagnostics.filter((row) => row.oversell);
    if (oversold.length) {
      setError(
        L(
          'Има артикули с количество над наличността. Коригирайте черновата преди потвърждение.',
          'Some items exceed current stock. Fix the draft before checkout.',
          'Alcuni articoli superano lo stock corrente. Correggi la bozza prima del checkout.',
        ),
      );
      focusScanInput();
      return;
    }
    try {
      const result = await api<{ sale_ref?: string; created: number; serial_numbers?: string[] }>('/movements/checkout', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: cashierCustomer || walkInLabel,
          comment: cashierComment || td.k032,
          items: cashierCart.map((i) => ({
            product_id: i.product_id,
            qty: i.qty,
            unit_price: i.unit_price
          }))
        })
      }, token);
      setLastSoldSerials(result.serial_numbers || []);
      setCashierCart([]);
      setCashierComment('');
      setOperatorSnapshot(null);
      setScanInput('');
      withStatus(
        result.sale_ref
          ? L(
              `Плащането е завършено. Референция: ${result.sale_ref}. SN: ${serialSummaryText(result.serial_numbers || [])}`,
              `Checkout completed. Reference: ${result.sale_ref}. SN: ${serialSummaryText(result.serial_numbers || [])}`,
              `Pagamento completato. Riferimento: ${result.sale_ref}. SN: ${serialSummaryText(result.serial_numbers || [])}`,
            )
          : td.k033,
      );
      await refreshMainData();
      await loadAudit();
      await loadRecentSales().catch(() => undefined);
    } catch (e) {
      handleError(e);
    } finally {
      focusScanInput();
    }
  };

  const createRefundRequest = async (sale: RecentSale) => {
    if (!confirm(L(`Да се заяви ли сторно за продажба ${sale.sale_ref}?`, `Create refund request for sale ${sale.sale_ref}?`, `Creare richiesta storno per la vendita ${sale.sale_ref}?`))) {
      focusScanInput();
      return;
    }
    try {
      await api<{ ok: boolean; request_id: number }>('/movements/refund-requests', {
        method: 'POST',
        body: JSON.stringify({
          sale_ref: sale.sale_ref,
          movement_ids: sale.movement_ids,
          reason: (refundRequestReasons[sale.sale_ref] || '').trim(),
        }),
      }, token);
      withStatus(L('Заявката за сторно е изпратена за одобрение.', 'Refund request sent for approval.', 'Richiesta storno inviata per approvazione.'));
      setRefundRequestReasons((prev) => ({ ...prev, [sale.sale_ref]: '' }));
      await loadAudit();
      await loadRecentSales();
      await loadRefundRequests();
    } catch (e) {
      handleError(e);
    } finally {
      focusScanInput();
    }
  };

  const reviewRefundRequest = async (requestId: number, action: 'approve' | 'reject') => {
    try {
      const note = (refundReviewNotes[requestId] || '').trim();
      await api(`/movements/refund-requests/${requestId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      }, token);
      withStatus(
        action === 'approve'
          ? L('Заявката е одобрена и сторното е изпълнено.', 'Request approved and refund executed.', 'Richiesta approvata e storno eseguito.')
          : L('Заявката е отхвърлена.', 'Request rejected.', 'Richiesta rifiutata.'),
      );
      setRefundReviewNotes((prev) => ({ ...prev, [requestId]: '' }));
      await refreshMainData();
      await loadAudit();
      await loadRecentSales();
      await loadRefundRequests();
    } catch (e) {
      handleError(e);
    }
  };

  return (
    <>
      <div className={`layout ${activeTab === 'cashier' ? 'cashier-layout' : ''} ${isAdmin ? 'role-admin' : 'role-operator'} ${activeTab === 'cashier' ? (operatorAction ? 'operator-screen-' + operatorAction : 'operator-screen-none') : ''}`}>
        <aside className="sidebar card">
          <div>
            <h3>{t.title}</h3>
            <div className="muted">{me ? `${me.full_name} (${me.role === 'admin' ? td.k034 : td.k035})` : '...'}</div>
          </div>
          <nav className="menu">
            {visibleTabs.map((tab) => {
              const hasPendingRefunds = tab === 'refunds' && pendingRefundCount > 0;
              return (
                <button
                  key={tab}
                  className={`menu-btn ${activeTab === tab ? 'active' : ''} ${hasPendingRefunds ? 'menu-btn-pending' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tabLabel(tab)}{hasPendingRefunds ? ` (${pendingRefundCount})` : ''}
                </button>
              );
            })}
          </nav>
          <button className="danger-btn" onClick={onLogout}>{t.logout}</button>
        </aside>

        <section className="content">
          <div className="card">
            <div className="topbar">
              <h2>{tabLabel(activeTab)}</h2>
              <div className="inline-actions">
                {activeTab === 'cashier' && (
                  <button onClick={handleExitFromOperator}>{t.backFromCashier}</button>
                )}
                <button className="support-icon-btn" onClick={openDonationModal} title={L('Почерпи разработчика едно кафе!', 'Buy the developer a coffee!', 'Offri un caffè allo sviluppatore!')} aria-label={L('Почерпи разработчика едно кафе!', 'Buy the developer a coffee!', 'Offri un caffè allo sviluppatore!')}>
                  ☕
                </button>
                <button onClick={() => setActiveTab('help')}>{t.help}</button>
                <button onClick={() => refreshMainData().catch(handleError)}>{t.refresh}</button>
                <button className="danger-btn inline-danger" onClick={onLogout}>{t.logout}</button>
              </div>
            </div>
            {showDonationBanner && (
              <div className="donation-banner">
                <span>{L('Почерпи разработчика едно кафе!', 'Buy the developer a coffee!', 'Offri un caffè allo sviluppatore!')}</span>
                <div className="inline-actions">
                  <button onClick={openDonationModal}>{L('Подкрепи проекта', 'Support project', 'Supporta il progetto')}</button>
                  <button className="donation-later-btn" onClick={maybeLaterDonation}>{L('Скрий', 'Hide', 'Nascondi')}</button>
                </div>
              </div>
            )}
            {status && (
              <div className="ok-msg" role="status" aria-live="polite">
                <span>{status}</span>
                <button className="msg-close" onClick={() => setStatus('')}>{t.dismiss}</button>
              </div>
            )}
            {activeTab === 'cashier' && lastSoldSerials.length > 0 && (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="topbar" style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 700 }}>
                    {L('Екран за печат на гаранционни етикети', 'Warranty label print screen', 'Schermata stampa etichette garanzia')}
                  </div>
                  <div className="inline-actions">
                    <button onClick={() => Promise.all(lastSoldSerials.map((sn) => printWarrantyLabel(sn))).catch(handleError)}>
                      {L('Принт всички', 'Print all', 'Stampa tutti')}
                    </button>
                    <button onClick={() => setLastSoldSerials([])}>
                      {L('Скрий', 'Hide', 'Nascondi')}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {lastSoldSerials.map((sn) => (
                    <button key={sn} onClick={() => printWarrantyLabel(sn).catch(handleError)}>
                      {L('Принт гаранция', 'Print warranty', 'Stampa garanzia')}: {sn}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="msg" role="alert" aria-live="assertive">
                <span>{error}</span>
                <button className="msg-close" onClick={() => setError('')}>{t.dismiss}</button>
              </div>
            )}
          </div>

          {activeTab === 'products' && (
            <>
              <div className="card">
                <h3>{t.createProduct}</h3>
                <div className="grid">
                  <Field label={`${td.k036} *`} hint={td.k037}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                  <Field label={`${td.k038} *`} hint={td.k039}>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      {isAdmin && <option value="__new__">{td.k040}</option>}
                    </select>
                  </Field>
                  {isAdmin && (category === '__new__' || categories.length === 0) && (
                    <Field label={td.k041} hint={td.k042}>
                      <div className="inline-actions">
                        <input value={newCategoryInline} onChange={(e) => setNewCategoryInline(e.target.value)} />
                        <button
                          style={{ width: 'auto' }}
                          onClick={() => withLoading('create-inline-category', createInlineCategory)}
                          disabled={loadingActions['create-inline-category']}
                        >
                          {loadingActions['create-inline-category']
                            ? L('Създаване...', 'Creating...', 'Creazione...')
                            : L('Създай категория', 'Create category', 'Crea categoria')}
                        </button>
                      </div>
                      {categories.length === 0 && (
                        <div className="muted" style={{ marginTop: 6 }}>
                          {L(
                            'Няма създадени категории. Въведи име тук и натисни "Създай категория".',
                            'No categories exist yet. Type a name here and click "Create category".',
                            'Non ci sono ancora categorie. Inserisci un nome e clicca "Crea categoria".',
                          )}
                        </div>
                      )}
                    </Field>
                  )}
                  <Field
                    label={`${td.k043} *`}
                    hint={L(
                      'EAN/UPC на модела (задължителен). Това НЕ е сериен номер на единична бройка.',
                      'Model EAN/UPC (required). This is NOT a unit serial number.',
                      'EAN/UPC del modello (obbligatorio). NON e il seriale della singola unita.',
                    )}
                  >
                    <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                  </Field>
                  <Field label={L('Вътрешен код (авто по подразбиране)', 'Internal SKU (auto by default)', 'SKU interno (auto predefinito)')} hint={L('Остави празно за автоматичен код по категория: ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-ID. Попълни само ако имаш стар вътрешен код.', 'Leave empty for auto code by category: ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-ID. Fill only if you already have a legacy internal code.', 'Lascia vuoto per codice automatico per categoria: ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-ID. Compila solo se hai un codice interno legacy.')}>
                    <input value={internalSkuInput} onChange={(e) => setInternalSkuInput(e.target.value)} placeholder={L('напр. ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-00001', 'e.g. ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-00001', 'es. ' + skuPreviewPrefix + '-' + new Date().getUTCFullYear() + '-00001')} />
                  </Field>
                  <Field label={L('Вътрешен баркод', 'Store barcode', 'Barcode interno')} hint={L('Вътрешен баркод на магазина (по избор).', 'Internal store barcode (optional).', 'Barcode interno negozio (opzionale).')}><input value={storeBarcode} onChange={(e) => setStoreBarcode(e.target.value)} /></Field>
                  <Field label={L('Доставчик (по избор)', 'Supplier (optional)', 'Fornitore (opzionale)')} hint={L('Име на доставчика за този продукт.', 'Supplier name for this product.', 'Nome fornitore per questo prodotto.')}><input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></Field>
                  <Field label={`${td.k044} *`} hint={td.k045}><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
                  <Field label={L('Начално количество', 'Initial quantity', 'Quantita iniziale')} hint={L('Колко бройки да се заприхождават веднага (авто SN).', 'How many units to intake immediately (auto serials).', 'Quante unita caricare subito (seriali auto).')}><input value={initialStockQty} onChange={(e) => setInitialStockQty(e.target.value)} /></Field>
                  <Field label={L('Покупна цена *', 'Purchase price *', 'Prezzo acquisto *')} hint={L('Нетна цена на доставка.', 'Cost price for incoming stock.', 'Prezzo di costo per il carico.')}><input value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} /></Field>
                  <Field label={L('Продажна цена *', 'Sell price *', 'Prezzo vendita *')} hint={L('Стандартна цена за продажба.', 'Default selling price.', 'Prezzo standard di vendita.')}><input value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></Field>
                  <Field label={L('Минимална продажна цена *', 'Minimum sell price *', 'Prezzo minimo vendita *')} hint={L('Под тази цена продажбата се отказва.', 'Sale is rejected below this price.', 'La vendita viene rifiutata sotto questo prezzo.')}><input value={minSellPrice} onChange={(e) => setMinSellPrice(e.target.value)} /></Field>
                  <Field label={L('Минимален складов праг *', 'Minimum stock threshold *', 'Soglia minima magazzino *')} hint={L('Критично ниво за сигнал при ниска наличност.', 'Critical level for low stock alert.', 'Livello critico per avviso scorte basse.')}><input value={minThresholdInput} onChange={(e) => setMinThresholdInput(e.target.value)} /></Field>
                  <Field label={L('Код за съвместимост (по избор)', 'Compatibility code (optional)', 'Codice compatibilita (opzionale)')} hint={L('Еднакъв код за продукти-заместители.', 'Shared code for substitute products.', 'Codice condiviso per prodotti sostitutivi.')}><input value={compatibilityGroupInput} onChange={(e) => setCompatibilityGroupInput(e.target.value)} placeholder={L('напр. BRK-BMW-01', 'e.g. BRK-BMW-01', 'es. BRK-BMW-01')} /></Field>
                  <Field label={L('Коментар за продукта', 'Product comment', 'Commento prodotto')} hint={L('Вътрешна бележка за екипа.', 'Internal note for your team.', 'Nota interna per il team.')}><textarea className="txt" value={productComment} onChange={(e) => setProductComment(e.target.value)} /></Field>
                  <Field label={L('Технически характеристики', 'Technical specifications', 'Specifiche tecniche')} hint={L('Памет, интерфейси, размери, мощност и др.', 'Memory, interfaces, dimensions, power, etc.', 'Memoria, interfacce, dimensioni, potenza, ecc.')}><textarea className="txt" value={productSpecs} onChange={(e) => setProductSpecs(e.target.value)} /></Field>
                  <Field label={L("Снимка (файл)", "Image (file)", "Immagine (file)")} hint={L("Качи JPG/PNG/WEBP до 5MB.", "Upload JPG/PNG/WEBP up to 5MB.", "Carica JPG/PNG/WEBP fino a 5MB.")}><input key={photoInputKey} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} /></Field>
                  <Field label={L("Снимка (URL, по избор)", "Image URL (optional)", "URL immagine (opzionale)")} hint={L("Резервен вариант, ако няма файл.", "Fallback option if no file is selected.", "Opzione alternativa se non selezioni file.")}><input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." /></Field>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => withLoading('create-product', createProduct)} disabled={loadingActions['create-product']}>
                    {loadingActions['create-product'] ? L('Създаване...', 'Creating...', 'Creazione...') : t.createProduct}
                  </button>
                </div>
              </div>

              {isAdmin && (
                <div className="card">
                  <h3>{t.importExcel}</h3>
                  <div className="grid">
                    <Field label={td.k046} hint={td.k047}><input type="file" accept=".xlsx,.xls" onChange={(e) => setExcelFile(e.target.files?.[0] || null)} /></Field>
                    <div className="align-end"><button onClick={importProductsExcel}>{t.importExcel}</button></div>
                  </div>
                </div>
              )}

              <div className="card">
                <h3>{t.products}</h3>
                <Field label={`${t.search}: ${td.k048}`} hint={td.k049}><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} /></Field>
                <div className="table-wrap products-table-wrap">
                  <table className="products-table">
                    <thead><tr><th>ID</th><th>{td.k050}</th><th>{td.k038}</th><th>{L('Доставчик', 'Supplier', 'Fornitore')}</th><th>SKU</th><th>{L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')}</th><th>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}</th><th>{L('Локация', 'Location', 'Posizione')}</th><th>{L('Наличност', 'Stock', 'Disponibilita')}</th><th>{L('Мин. праг', 'Min threshold', 'Soglia min')}</th><th>{L('Състояние', 'Health', 'Stato')}</th><th>{L('Продажна', 'Sell', 'Vendita')}</th><th>{L('Мин. продажна', 'Min sell', 'Min vendita')}</th><th>{L('Снимка', 'Image', 'Immagine')}</th><th>{L('Коментар / Спецификации', 'Comment / Specs', 'Commento / Specifiche')}</th>{isAdmin && <th>{t.actions}</th>}</tr></thead>
                    <tbody>
                      {filteredProducts.map((p) => {
                        const comment = (p.product_comment || p.description || '').trim();
                        const specs = (p.technical_specs || '').trim();
                        const detailsText = [comment, specs].filter(Boolean).join(' | ');
                        return (
                          <tr key={p.id} className={editingProductId === p.id ? 'is-editing' : ''}>
                            <td>{p.id}</td>
                            <td>{p.name}</td>
                            <td>{p.category}</td>
                            <td>{p.supplier_name || '-'}</td>
                            <td>{p.internal_sku}</td>
                            <td>{p.factory_barcode}</td>
                            <td>{p.store_barcode || '-'}</td>
                            <td>{p.warehouse_location}</td>
                            <td>{Number(p.current_stock || 0)}</td>
                            <td>
                              {isAdmin ? (
                                <div className="inline-actions">
                                  <input
                                    style={{ width: 84 }}
                                    value={thresholdDraft[p.id] ?? String(p.min_threshold ?? 0)}
                                    onChange={(e) => setThresholdDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                  />
                                  <button
                                    onClick={() => withLoading(`save-threshold-${p.id}`, () => saveMinThreshold(p))}
                                    disabled={loadingActions[`save-threshold-${p.id}`]}
                                  >
                                    {loadingActions[`save-threshold-${p.id}`] ? L('Запис...', 'Saving...', 'Salvataggio...') : L('Запази', 'Save', 'Salva')}
                                  </button>
                                </div>
                              ) : (
                                <strong>{Number(p.min_threshold || 0)}</strong>
                              )}
                            </td>
                            <td><span className={`badge-${p.inventory_health || 'healthy'}`}>{healthLabel(p.inventory_health || 'healthy')}</span></td>
                            <td>{Number(p.sell_price || 0).toFixed(2)}</td>
                            <td>{Number(p.min_sell_price || 0).toFixed(2)}</td>
                            <td>{p.photo_url ? <a href={resolveMediaUrl(p.photo_url)} target="_blank" rel="noreferrer">{L('Отвори', 'Open', 'Apri')}</a> : '-'}</td>
                            <td title={detailsText || '-'}>{detailsText || '-'}</td>
                            {isAdmin && (
                              <td>
                                <div className="inline-actions">
                                  <button onClick={() => openProduct360(p)}>{L('Product 360', 'Product 360', 'Product 360')}</button>
                                  <button onClick={() => startAdminEdit(p)}>{L('Редакция', 'Edit', 'Modifica')}</button>
                                  <button onClick={() => download(`/products/${p.id}/barcode.png`, `barcode_${p.internal_sku}.png`)}>{td.k051}</button>
                                  <button onClick={() => download(`/products/${p.id}/label.pdf`, `label_${p.internal_sku}.pdf`)}>{td.k052}</button>
                                  <button onClick={() => printFromApi(`/products/${p.id}/label.pdf`, `label_${p.internal_sku}.pdf`).catch(handleError)}>
                                    {L('Принт етикет', 'Print label', 'Stampa etichetta')}
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {isAdmin && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <h3>{L('Намери продукт за редакция', 'Find product for edit', 'Trova prodotto da modificare')}</h3>
                    <div className="grid">
                      <Field
                        label={L('Код/Баркод/Име', 'Code/Barcode/Name', 'Codice/Barcode/Nome')}
                        hint={L(
                          'Въведи фабричен баркод, вътрешен баркод, SKU или име и натисни Enter/Зареди.',
                          'Enter factory barcode, store barcode, SKU, or name and press Enter/Load.',
                          'Inserisci barcode fabbrica, barcode interno, SKU o nome e premi Invio/Carica.',
                        )}
                      >
                        <input
                          value={adminEditLookup}
                          onChange={(e) => setAdminEditLookup(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              loadAdminEditByLookup();
                            }
                          }}
                          placeholder={L('напр. 3802..., SUP-..., Име продукт', 'e.g. 3802..., SUP-..., Product name', 'es. 3802..., SUP-..., Nome prodotto')}
                        />
                      </Field>
                      <div className="align-end">
                        <button onClick={loadAdminEditByLookup}>{L('Зареди за редакция', 'Load for edit', 'Carica per modifica')}</button>
                      </div>
                    </div>
                    {editingProductId && (
                      <div className="muted" style={{ marginTop: 8 }}>
                        {L('Зареден продукт ID:', 'Loaded product ID:', 'Prodotto caricato ID:')} {editingProductId}
                      </div>
                    )}
                  </div>
                )}
                {isAdmin && editingProductId && (
                  <div ref={adminEditRef} className="card admin-edit-panel" style={{ marginTop: 12 }}>
                    <h3>{L('Админ редакция на продукт', 'Admin Product Edit', 'Modifica prodotto admin')}</h3>
                    <div className="muted" style={{ marginBottom: 8 }}>
                      {L(
                        'Може да променяте всички продуктови параметри. Серийните номера (SN) не се редактират тук.',
                        'You can edit all product parameters. Serial numbers (SN) are not editable here.',
                        'Puoi modificare tutti i parametri prodotto. I numeri seriali (SN) non sono modificabili qui.',
                      )}
                    </div>
                    <div className="grid">
                      <Field label={L('Име', 'Name', 'Nome')} hint={L('Официално име на продукта.', 'Official product name.', 'Nome ufficiale del prodotto.')}>
                        <input value={adminEditName} onChange={(e) => setAdminEditName(e.target.value)} />
                      </Field>
                      <Field label={L('Категория', 'Category', 'Categoria')} hint={L('Категория за търсене и отчети.', 'Category for search and reports.', 'Categoria per ricerca e report.')}>
                        <input value={adminEditCategory} onChange={(e) => setAdminEditCategory(e.target.value)} />
                      </Field>
                      <Field label={L('Марка', 'Brand', 'Marca')} hint={L('Производител/марка.', 'Manufacturer/brand.', 'Produttore/marca.')}>
                        <input value={adminEditBrand} onChange={(e) => setAdminEditBrand(e.target.value)} />
                      </Field>
                      <Field label={L('Доставчик', 'Supplier', 'Fornitore')} hint={L('Основен доставчик (по избор).', 'Primary supplier (optional).', 'Fornitore principale (opzionale).')}>
                        <input value={adminEditSupplier} onChange={(e) => setAdminEditSupplier(e.target.value)} />
                      </Field>
                      <Field label={L('Вътрешен код (SKU)', 'Internal code (SKU)', 'Codice interno (SKU)')} hint={L('Уникален вътрешен код.', 'Unique internal code.', 'Codice interno univoco.')}>
                        <input value={adminEditInternalSku} onChange={(e) => setAdminEditInternalSku(e.target.value)} />
                      </Field>
                      <Field label={L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')} hint={L('Уникален фабричен баркод.', 'Unique factory barcode.', 'Barcode fabbrica univoco.')}>
                        <input value={adminEditFactoryBarcode} onChange={(e) => setAdminEditFactoryBarcode(e.target.value)} />
                      </Field>
                      <Field label={L('Вътрешен баркод', 'Store barcode', 'Barcode interno')} hint={L('По избор. Ако се използва, трябва да е уникален.', 'Optional. If used, must be unique.', 'Opzionale. Se usato, deve essere univoco.')}>
                        <input value={adminEditStoreBarcode} onChange={(e) => setAdminEditStoreBarcode(e.target.value)} />
                      </Field>
                      <Field label={L('Локация', 'Location', 'Posizione')} hint={L('Текуща складова позиция.', 'Current warehouse location.', 'Posizione attuale in magazzino.')}>
                        <input value={adminEditLocation} onChange={(e) => setAdminEditLocation(e.target.value)} />
                      </Field>
                      <Field label={L('Compatibility Group', 'Compatibility Group', 'Gruppo compatibilita')} hint={L('Код за заместители между марки.', 'Cross-brand substitute code.', 'Codice sostituti tra marche.')}>
                        <input value={adminEditCompatibility} onChange={(e) => setAdminEditCompatibility(e.target.value)} />
                      </Field>
                      <Field label={L('Коментар', 'Comment', 'Commento')} hint={L('Вътрешна бележка за продукта.', 'Internal note for the product.', 'Nota interna per il prodotto.')}>
                        <textarea className="txt" value={adminEditComment} onChange={(e) => setAdminEditComment(e.target.value)} />
                      </Field>
                      <Field label={L('Технически спецификации', 'Technical specifications', 'Specifiche tecniche')} hint={L('Модел, размери, параметри и др.', 'Model, dimensions, parameters, etc.', 'Modello, dimensioni, parametri, ecc.')}>
                        <textarea className="txt" value={adminEditSpecs} onChange={(e) => setAdminEditSpecs(e.target.value)} />
                      </Field>
                      <Field label={L('Снимка URL', 'Photo URL', 'URL foto')} hint={L('По избор. Линк към снимка на продукта.', 'Optional. Link to product photo.', 'Opzionale. Link alla foto del prodotto.')}>
                        <input value={adminEditPhotoUrl} onChange={(e) => setAdminEditPhotoUrl(e.target.value)} placeholder="https://..." />
                      </Field>
                      <Field label={L('Покупна цена', 'Purchase price', 'Prezzo acquisto')} hint={L('Себестойност.', 'Cost price.', 'Prezzo di costo.')}>
                        <input value={adminEditPurchase} onChange={(e) => setAdminEditPurchase(e.target.value)} />
                      </Field>
                      <Field label={L('Продажна цена', 'Sell price', 'Prezzo vendita')} hint={L('Стандартна продажна цена.', 'Standard selling price.', 'Prezzo standard di vendita.')}>
                        <input value={adminEditSell} onChange={(e) => setAdminEditSell(e.target.value)} />
                      </Field>
                      <Field label={L('Мин. продажна', 'Min sell price', 'Prezzo minimo vendita')} hint={L('Долен лимит за продажба.', 'Lowest allowed sell price.', 'Limite minimo di vendita.')}>
                        <input value={adminEditMinSell} onChange={(e) => setAdminEditMinSell(e.target.value)} />
                      </Field>
                      <Field label={L('Мин. праг', 'Min threshold', 'Soglia min')} hint={L('Критичен праг за наличност.', 'Critical stock threshold.', 'Soglia critica stock.')}>
                        <input value={adminEditThreshold} onChange={(e) => setAdminEditThreshold(e.target.value)} />
                      </Field>
                    </div>
                    <div className="inline-actions" style={{ marginTop: 10 }}>
                      <button onClick={() => withLoading('admin-edit-product', saveAdminEdit)} disabled={loadingActions['admin-edit-product']}>
                        {loadingActions['admin-edit-product'] ? L('Запис...', 'Saving...', 'Salvataggio...') : L('Запази редакцията', 'Save Edit', 'Salva modifica')}
                      </button>
                      <button className="danger-btn inline-danger" onClick={() => setEditingProductId(null)}>
                        {L('Затвори', 'Close', 'Chiudi')}
                      </button>
                    </div>
                  </div>
                )}
              </div>


              {isAdmin && (
                <>
                  <div className="card">
                    <h3>{L('Управление на категории', 'Category Management', 'Gestione categorie')}</h3>
                    <div className="grid">
                      <Field label={td.k130} hint={td.k131}><input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /></Field>
                      <Field label={td.k132} hint={td.k133}><select value={newCategoryUnit} onChange={(e) => setNewCategoryUnit(e.target.value)}><option value="pcs">{td.k134}</option><option value="kg">{td.k135}</option><option value="l">{td.k136}</option></select></Field>
                      <div className="align-end"><button onClick={createCategory}>{td.k137}</button></div>
                    </div>
                  </div>
                  <div className="card">
                    <h3>{td.k138}</h3>
                    <div className="grid">
                      <Field label={td.k038} hint={td.k139}>
                        <select
                          value={renameCategoryId}
                          onChange={(e) => {
                            setRenameCategoryId(e.target.value);
                            const c = categories.find((item) => String(item.id) === e.target.value);
                            if (c) {
                              setRenameCategoryName(c.name);
                              setRenameCategoryUnit(c.unit);
                            }
                          }}
                        >
                          {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                        </select>
                      </Field>
                      <Field label={td.k130} hint={td.k140}><input value={renameCategoryName} onChange={(e) => setRenameCategoryName(e.target.value)} /></Field>
                      <Field label={td.k132} hint={td.k141}><select value={renameCategoryUnit} onChange={(e) => setRenameCategoryUnit(e.target.value)}><option value="pcs">{td.k134}</option><option value="kg">{td.k135}</option><option value="l">{td.k136}</option></select></Field>
                    </div>
                    <div className="inline-actions" style={{ marginTop: 10 }}>
                      <button onClick={updateCategory}>{td.k142}</button>
                      <button className="danger-btn inline-danger" onClick={deleteCategory}>{td.k143}</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'cashier' && (
            <div ref={operatorTopRef} className={'card operator-mode ' + (operatorAction ? 'operator-mode-' + operatorAction : 'operator-mode-none')}>
              <h3>{td.k053}</h3>

              {!operatorAction && (
                <div className="operator-mode-chooser">
                  <button
                    className="operator-mode-tile operator-mode-tile-input"
                    onClick={() => {
                      setOperatorAction('input');
                      setOperatorSnapshot(null);
                      setOperatorSearchMode('barcode');
                      setOperatorNameQuery('');
                      setOperatorNameResults([]);
                      setOperatorQty('1');
                      setScanInput('');
                      setCashierCustomer('');
                      setCashierComment('');
                      withStatus(L('Режим: Приемане в склада. Сканирайте продукт.', 'Mode: Stock Intake. Scan a product.', 'Modalita: Carico magazzino. Scansiona prodotto.'));
                      focusScanInput();
                    }}
                  >
                    <strong>{L('📥 Приемане в склада', '📥 Stock Intake', '📥 Carico magazzino')}</strong>
                  </button>
                  <button
                    className="operator-mode-tile operator-mode-tile-output"
                    onClick={() => {
                      setOperatorAction('output');
                      setOperatorSnapshot(null);
                      setOperatorSearchMode('barcode');
                      setOperatorNameQuery('');
                      setOperatorNameResults([]);
                      setOperatorQty('1');
                      setScanInput('');
                      setCashierCustomer(walkInLabel);
                      setCashierComment('');
                      withStatus(L('Режим: Изписване от склада. Сканирайте продукт.', 'Mode: Stock Output. Scan a product.', 'Modalita: Scarico magazzino. Scansiona prodotto.'));
                      focusScanInput();
                    }}
                  >
                    <strong>{L('📤 Изписване от склада', '📤 Stock Output', '📤 Scarico magazzino')}</strong>
                  </button>
                </div>
              )}

              {operatorAction && (
                <>
                  <div className="operator-mode-head">
                    <div className={'operator-mode-badge ' + (operatorAction === 'input' ? 'is-input' : 'is-output')}>
                      {operatorAction === 'input'
                        ? L('Режим: Приемане', 'Mode: Intake', 'Modalita: Carico')
                        : L('Режим: Изписване', 'Mode: Output', 'Modalita: Scarico')}
                    </div>
                    {me && <div className="muted" style={{ marginTop: 4, fontSize: '0.9em' }}>{L('Оператор: ', 'Operator: ', 'Operatore: ')}{me.username}</div>}
                    <button
                      onClick={() => {
                        setOperatorAction('');
                        setOperatorSnapshot(null);
                        setOperatorSearchMode('barcode');
                        setOperatorNameQuery('');
                        setOperatorNameResults([]);
                        setOperatorQty('1');
                        setScanInput('');
                        setCashierCustomer('');
                        setCashierComment('');
                        withStatus(L('Избор на режим. Изберете Приемане или Изписване.', 'Choose mode. Select Intake or Output.', 'Scelta modalita. Seleziona Carico o Scarico.'));
                        focusScanInput();
                      }}
                    >
                      {L('Смени режим', 'Change Mode', 'Cambia modalita')}
                    </button>
                  </div>

                  {operatorAction === 'output' && (
                    <div className="card" style={{ marginTop: 12 }}>
                      <div className="topbar" style={{ marginBottom: 8 }}>
                        <h3>{L('Чернова на продажба', 'Sale Draft', 'Bozza vendita')}</h3>
                        <div style={{ fontWeight: 700 }}>
                          {L('Крайна сума', 'Grand Total', 'Totale')}: {cartTotals.totalAmount.toFixed(2)}
                        </div>
                      </div>
                      <div className="grid" style={{ marginBottom: 12 }}>
                        <Field label={td.k056} hint={td.k057}>
                          <input
                            value={cashierCustomer}
                            onChange={(e) => setCashierCustomer(e.target.value)}
                            placeholder={L('клиент (по избор)', 'customer (optional)', 'cliente (opzionale)')}
                          />
                        </Field>
                        <Field label={td.k058} hint={td.k059}>
                          <input value={cashierComment} onChange={(e) => setCashierComment(e.target.value)} />
                        </Field>
                      </div>
                      {cashierCart.length === 0 ? (
                        <div className="muted">
                          {L('Няма добавени артикули. Сканирай/избери продукт и натисни "Добави в продажбата".', 'No items in draft. Scan/select product and click "Add to sale draft".', 'Nessun articolo in bozza. Scansiona/seleziona prodotto e premi "Aggiungi alla bozza".')}
                        </div>
                      ) : (
                        <>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>{L('Артикул', 'Item', 'Articolo')}</th>
                                  <th>{L('Баркод', 'Barcode', 'Barcode')}</th>
                                  <th>{L('Налични', 'Available', 'Disponibili')}</th>
                                  <th>{L('Кол.', 'Qty', 'Qt')}</th>
                                  <th>{L('Ед. цена', 'Unit price', 'Prezzo unit')}</th>
                                  <th>{L('Сума', 'Subtotal', 'Subtotale')}</th>
                                  <th>{L('След продажба', 'After sale', 'Dopo vendita')}</th>
                                  <th>{t.actions}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cashierCart.map((line) => (
                                  <tr key={line.product_id}>
                                    <td>{line.name}</td>
                                    <td>{line.code || '-'}</td>
                                    <td>{line.available}</td>
                                    <td>{line.qty}</td>
                                    <td>{Number(line.unit_price || 0).toFixed(2)}</td>
                                    <td>{(Number(line.qty || 0) * Number(line.unit_price || 0)).toFixed(2)}</td>
                                    <td>
                                      {(() => {
                                        const diag = cartDiagByProductId.get(line.product_id);
                                        if (!diag) return '-';
                                        if (diag.oversell) {
                                          return (
                                            <span className="badge-critical">
                                              {L('Над наличността', 'Over stock', 'Oltre lo stock')}
                                            </span>
                                          );
                                        }
                                        if (diag.belowThreshold) {
                                          return (
                                            <span className="badge-warning">
                                              {L(`Остатък ${diag.remaining} (праг ${diag.threshold})`, `Remain ${diag.remaining} (threshold ${diag.threshold})`, `Residuo ${diag.remaining} (soglia ${diag.threshold})`)}
                                            </span>
                                          );
                                        }
                                        return (
                                          <span className="badge-healthy">
                                            {L(`Остатък ${diag.remaining}`, `Remain ${diag.remaining}`, `Residuo ${diag.remaining}`)}
                                          </span>
                                        );
                                      })()}
                                    </td>
                                    <td>
                                      <button className="danger-btn inline-danger" onClick={() => removeFromCart(line.product_id)}>
                                        {L('Премахни', 'Remove', 'Rimuovi')}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ marginTop: 8, fontWeight: 700 }}>
                            {L('Общо артикули', 'Total items', 'Totale articoli')}: {cartTotals.totalQty} | {L('Крайна сума', 'Grand Total', 'Totale')}: {cartTotals.totalAmount.toFixed(2)}
                          </div>
                          {cartHasOversell && (
                            <div className="operator-warning operator-warning-output" style={{ marginTop: 8 }}>
                              {L('Има редове с надвишена наличност. Checkout е блокиран, докато не ги премахнете.', 'There are rows with oversold quantity. Checkout is blocked until they are removed.', 'Ci sono righe con quantita oltre stock. Il checkout e bloccato finche non le rimuovi.')}
                            </div>
                          )}
                          <div className="inline-actions" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
                            <button
                              onClick={() => withLoading('operator-checkout', checkoutCart)}
                              disabled={!cashierCart.length || cartHasOversell || loadingActions['operator-checkout']}
                            >
                              {loadingActions['operator-checkout']
                                ? L('Обработка...', 'Processing...', 'Elaborazione...')
                                : L('🛒 Потвърди продажбата', '🛒 Confirm sale', '🛒 Conferma vendita')}
                            </button>
                            <button
                              className="danger-btn inline-danger"
                              onClick={clearCartDraft}
                              disabled={!cashierCart.length}
                            >
                              {L('Нова продажба', 'New sale', 'Nuova vendita')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="grid">
                    {operatorAction === 'output' && (
                      <Field label={L('Начин на търсене', 'Search mode', 'Modalita ricerca')} hint={L('Изберете търсене по баркод, вътрешен код, име или категория.', 'Choose search by barcode, internal code, name or category.', 'Scegli ricerca per barcode, codice interno, nome o categoria.')}>
                        <select
                          value={operatorSearchMode}
                          onChange={(e) => {
                            const mode = e.target.value as 'barcode' | 'code' | 'name' | 'category' | 'hierarchical';
                            setOperatorSearchMode(mode);
                            setOperatorSnapshot(null);
                            setScanInput('');
                            setOperatorCategory('');
                            setOperatorNameResults([]);
                          }}
                        >
                          <option value="barcode">{L('Търси по баркод', 'Search by barcode', 'Cerca per barcode')}</option>
                          <option value="code">{L('Търси по вътрешен код', 'Search by internal code', 'Cerca per codice interno')}</option>
                          <option value="name">{L('Търси по име', 'Search by name', 'Cerca per nome')}</option>
                          <option value="category">{L('Търси по категория', 'Search by category', 'Cerca per categoria')}</option>
                          <option value="hierarchical">{L('Категория -> Продукт', 'Category -> Product', 'Categoria -> Prodotto')}</option>
                        </select>
                      </Field>
                    )}
                    {operatorAction === 'input' || operatorSearchMode === 'barcode' ? (
                      <Field label={td.k054} hint={td.k055}>
                        <input
                          ref={scanInputRef}
                          value={scanInput}
                          onChange={(e) => setScanInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleScanEnter().catch(handleError);
                            }
                          }}
                        />
                      </Field>
                    ) : operatorSearchMode === 'category' ? (
                      <Field label={L('Категория', 'Category', 'Categoria')} hint={L('Изберете категория, после Търси.', 'Select category, then Search.', 'Seleziona categoria, poi Cerca.')}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <select value={operatorCategory} onChange={(e) => setOperatorCategory(e.target.value)}>
                            {sortedCategoryNames.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                          <button onClick={() => searchOperatorByName().catch(handleError)} disabled={operatorSearchLoading}>
                            {operatorSearchLoading ? L('Търси...', 'Searching...', 'Ricerca...') : L('Търси', 'Search', 'Cerca')}
                          </button>
                        </div>
                      </Field>
                    ) : operatorSearchMode === 'hierarchical' ? (
                      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                        <Field label={L('1. Категория', '1. Category', '1. Categoria')} hint="">
                          <select
                            value={operatorCategory}
                            onChange={(e) => {
                              setOperatorCategory(e.target.value);
                              setOperatorNameQuery('');
                            }}
                          >
                            <option value="">{L('-- Избери --', '-- Select --', '-- Seleziona --')}</option>
                            {sortedCategoryNames.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={L('2. Продукт', '2. Product', '2. Prodotto')} hint={L('Пиши за филтър', 'Type to filter', 'Scrivi per filtrare')}>
                          <input
                            list="hierarchical-products-list"
                            value={operatorNameQuery}
                            onChange={(e) => setOperatorNameQuery(e.target.value)}
                            placeholder={L('Име или код...', 'Name or code...', 'Nome o codice...')}
                            disabled={!operatorCategory}
                          />
                          <datalist id="hierarchical-products-list">
                            {products
                              .filter((p) => p.category === operatorCategory)
                              .map((p) => (
                                <option key={p.id} value={`${p.name} [${p.internal_sku}]`}>
                                  {L('Нал:', 'Stock:', 'Stock:')} {p.current_stock}
                                </option>
                              ))}
                          </datalist>
                        </Field>
                        <button onClick={() => {
                           const val = operatorNameQuery.trim();
                           const p = products.find((x) => `${x.name} [${x.internal_sku}]` === val && x.category === operatorCategory);
                           if (p) selectOperatorProduct(p.id);
                           else setError(L('Продуктът не е избран от списъка.', 'Product not selected from list.', 'Prodotto non selezionato dalla lista.'));
                        }} disabled={!operatorCategory || !operatorNameQuery} style={{ marginBottom: 4 }}>{L('Избери', 'Select', 'Seleziona')}</button>
                      </div>
                    ) : (
                      <Field label={L('Търсене', 'Search', 'Ricerca')} hint={L('Според избрания режим: име/код/категория.', 'Uses selected mode: name/code/category.', 'Usa la modalita selezionata: nome/codice/categoria.')}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            value={operatorNameQuery}
                            onChange={(e) => setOperatorNameQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                searchOperatorByName().catch(handleError);
                              }
                            }}
                          />
                          <button onClick={() => searchOperatorByName().catch(handleError)} disabled={operatorSearchLoading}>
                            {operatorSearchLoading ? L('Търси...', 'Searching...', 'Ricerca...') : L('Търси', 'Search', 'Cerca')}
                          </button>
                        </div>
                      </Field>
                    )}
                  </div>
                  {operatorAction === 'output' && operatorSearchMode !== 'barcode' && (
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>{L('Име', 'Name', 'Nome')}</th>
                            <th>{L('Марка', 'Brand', 'Marca')}</th>
                            <th>{L('Вътрешен код', 'Internal code', 'Codice interno')}</th>
                            <th>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}</th>
                            <th>{L('Наличност', 'Stock', 'Disponibilita')}</th>
                            <th>{L('Продадени', 'Sold', 'Venduti')}</th>
                            <th>{L('Мин. праг', 'Min threshold', 'Soglia min')}</th>
                            <th>{L('Статус', 'Health', 'Stato')}</th>
                            <th>{t.actions}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operatorNameResults.length === 0 ? (
                            <tr><td colSpan={9} className="muted">{L('Няма резултати.', 'No results.', 'Nessun risultato.')}</td></tr>
                          ) : (
                            operatorNameResults.flatMap((r) => ([
                                <tr
                                  key={`row-${r.product_id}`}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => selectOperatorProduct(r.product_id).catch(handleError)}
                                  title={L('Клик за избор и детайл', 'Click to select and view details', 'Clicca per selezionare e vedere dettagli')}
                                >
                                  <td>{r.name}</td>
                                  <td>{r.brand_name}</td>
                                  <td>{r.internal_sku || r.sku}</td>
                                  <td>{r.store_barcode || '-'}</td>
                                  <td>{r.current_stock}</td>
                                  <td>{r.sold_qty || 0}</td>
                                  <td>{r.min_threshold}</td>
                                  <td><span className={`badge-${r.inventory_health}`}>{healthLabel(r.inventory_health)}</span></td>
                                  <td>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        selectOperatorProduct(r.product_id).catch(handleError);
                                      }}
                                    >
                                      {L('Избери', 'Select', 'Seleziona')}
                                    </button>
                                  </td>
                                </tr>
                                ,
                                operatorSnapshot?.product.id === r.product_id ? (
                                  <tr key={`detail-${r.product_id}`}>
                                    <td colSpan={9}>
                                      <div className="card" style={{ margin: '8px 0' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'start' }}>
                                          <div>
                                            {operatorSnapshot.product.photo_url ? (
                                              <img
                                                src={resolveMediaUrl(operatorSnapshot.product.photo_url)}
                                                alt={operatorSnapshot.product.name}
                                                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #d7e2df' }}
                                              />
                                            ) : (
                                              <div className="muted">{L('Няма снимка', 'No image', 'Nessuna immagine')}</div>
                                            )}
                                          </div>
                                          <div>
                                            <div><strong>{operatorSnapshot.product.name}</strong> ({operatorSnapshot.product.internal_sku})</div>
                                            <div className="muted">{operatorSnapshot.product.category} | {operatorSnapshot.product.warehouse_location}</div>
                                            <div>{L('Доставчик', 'Supplier', 'Fornitore')}: <strong>{operatorSnapshot.product.supplier_name || '-'}</strong></div>
                                            <div>{L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')}: <strong>{operatorSnapshot.product.factory_barcode}</strong></div>
                                            <div>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}: <strong>{operatorSnapshot.product.store_barcode || '-'}</strong></div>
                                            <div>{L('Наличност', 'Stock', 'Disponibilita')}: <strong>{operatorSnapshot.stock.in_stock_qty}</strong></div>
                                            <div>{L('Мин. праг', 'Min threshold', 'Soglia min')}: <strong>{Number(operatorSnapshot.product.min_threshold || 0)}</strong></div>
                                            <div>{L('Състояние', 'Health', 'Stato')}: <strong>{healthLabel(operatorSnapshot.stock.inventory_health || 'healthy')}</strong></div>
                                            <div className="operator-sale-price-label">{L('Продажна цена', 'Sell Price', 'Prezzo di vendita')}</div>
                                            <div className="operator-sale-price">{operatorSellPrice.toFixed(2)}</div>
                                            {operatorSnapshot.substitutes?.length > 0 && (
                                              <div style={{ marginTop: 8 }}>
                                                <strong>{L('Алтернативи', 'Alternatives', 'Alternative')}</strong>
                                                <div className="table-wrap" style={{ marginTop: 6 }}>
                                                  <table>
                                                    <thead>
                                                      <tr>
                                                        <th>{L('Име', 'Name', 'Nome')}</th>
                                                        <th>SKU</th>
                                                        <th>{L('Баркод', 'Barcode', 'Barcode')}</th>
                                                        <th>{L('Цена', 'Price', 'Prezzo')}</th>
                                                        <th>{L('Наличност', 'Stock', 'Disponibilita')}</th>
                                                        <th>{t.actions}</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {operatorSnapshot.substitutes.slice(0, 6).map((s) => (
                                                        <tr
                                                          key={s.product_id}
                                                          style={{ cursor: 'pointer' }}
                                                          onClick={() => selectOperatorProduct(s.product_id, true).catch(handleError)}
                                                          title={L('Клик за детайл на заместителя', 'Click for substitute details', 'Clicca per i dettagli del sostituto')}
                                                        >
                                                          <td>{s.name}</td>
                                                          <td>{s.sku}</td>
                                                          <td>{s.barcode || '-'}</td>
                                                          <td>{Number(s.sell_price || 0).toFixed(2)}</td>
                                                          <td>{s.current_stock}</td>
                                                          <td>
                                                            <button
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                selectOperatorProduct(s.product_id, true).catch(handleError);
                                                              }}
                                                            >
                                                              {L('Отвори', 'Open', 'Apri')}
                                                            </button>
                                                          </td>
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                ) : null,
                            ]))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                </>
              )}
              {operatorSnapshot && !isOperatorListMode && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="grid">
                    <div>
                      {operatorSnapshot.product.photo_url ? (
                        <img src={resolveMediaUrl(operatorSnapshot.product.photo_url)} alt={operatorSnapshot.product.name} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #d7e2df' }} />
                      ) : (
                        <div className="muted">{L('Няма снимка', 'No image', 'Nessuna immagine')}</div>
                      )}
                    </div>
                    <div>
                      <div><strong>{operatorSnapshot.product.name}</strong> ({operatorSnapshot.product.internal_sku})</div>
                      <div className="muted">{operatorSnapshot.product.category} | {operatorSnapshot.product.warehouse_location}</div>
                      <div>{L('Доставчик', 'Supplier', 'Fornitore')}: <strong>{operatorSnapshot.product.supplier_name || '-'}</strong></div>
                      <div>{L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')}: <strong>{operatorSnapshot.product.factory_barcode}</strong></div>
                      <div>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}: <strong>{operatorSnapshot.product.store_barcode || '-'}</strong></div>
                      <div>{L('Наличност', 'Stock', 'Disponibilita')}: <strong>{operatorSnapshot.stock.in_stock_qty}</strong></div>
                      <div>{L('Мин. праг', 'Min threshold', 'Soglia min')}: <strong>{Number(operatorSnapshot.product.min_threshold || 0)}</strong></div>
                      <div>{L('Състояние', 'Health', 'Stato')}: <strong>{healthLabel(operatorSnapshot.stock.inventory_health || 'healthy')}</strong></div>
                      {!isAdmin && (
                        <div style={{ marginTop: 6 }}>
                          <button onClick={() => signalThresholdToAdmin().catch(handleError)}>
                            {L('Сигнал към админ', 'Signal admin', 'Segnala admin')}
                          </button>
                        </div>
                      )}

                      {operatorAction === 'input' ? (
                        <div className="operator-warning operator-warning-input">
                          {operatorSnapshot.stock.in_stock_qty > 0
                            ? L('Предупреждение: Моделът вече има наличност в склада.', 'Warning: This model already has stock in warehouse.', 'Avviso: Questo modello ha gia disponibilita in magazzino.')
                            : L('Ново заприхождаване: ще бъдат създадени нови серийни номера.', 'New intake: new serial numbers will be generated.', 'Nuovo carico: verranno generati nuovi numeri seriali.')}
                        </div>
                      ) : (
                        <>
                          <div className="operator-sale-price-label">{L('Продажна цена', 'Sell Price', 'Prezzo di vendita')}</div>
                          <div className="operator-sale-price">{operatorSellPrice.toFixed(2)}</div>
                          {operatorSnapshot.stock.in_stock_qty <= 0 && (
                            <div className="operator-warning operator-warning-output">
                              {L('Блокирана операция: Артикулът липсва в склада.', 'Blocked operation: item is out of stock.', 'Operazione bloccata: articolo non disponibile in magazzino.')}
                            </div>
                          )}
                        </>
                      )}

                      <div>{L('Последна продажба', 'Last sale', 'Ultima vendita')}: <strong>{operatorSnapshot.last_sale ? new Date(operatorSnapshot.last_sale.created_at).toLocaleString() : L('няма', 'none', 'nessuna')}</strong></div>
                      <div>{L('Последно движение', 'Last movement', 'Ultimo movimento')}: <strong>{operatorSnapshot.last_movement ? `${operatorSnapshot.last_movement.movement_type} / ${new Date(operatorSnapshot.last_movement.created_at).toLocaleString()}` : L('няма', 'none', 'nessuna')}</strong></div>
                      <div className="muted">{operatorSnapshot.product.product_comment || '-'}</div>
                      <div className="muted">{operatorSnapshot.product.technical_specs || '-'}</div>
                      {operatorSnapshot.substitutes?.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <strong>{L('Алтернативи', 'Alternatives', 'Alternative')}</strong>
                          <div className="table-wrap" style={{ marginTop: 6 }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>{L('Име', 'Name', 'Nome')}</th>
                                  <th>SKU</th>
                                  <th>{L('Баркод', 'Barcode', 'Barcode')}</th>
                                  <th>{L('Цена', 'Price', 'Prezzo')}</th>
                                  <th>{L('Наличност', 'Stock', 'Disponibilita')}</th>
                                  <th>{t.actions}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {operatorSnapshot.substitutes.slice(0, 8).map((s) => (
                                  <tr
                                    key={s.product_id}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => selectOperatorProduct(s.product_id, true).catch(handleError)}
                                    title={L('Клик за детайл на заместителя', 'Click for substitute details', 'Clicca per i dettagli del sostituto')}
                                  >
                                    <td>{s.name}</td>
                                    <td>{s.sku}</td>
                                    <td>{s.barcode || '-'}</td>
                                    <td>{Number(s.sell_price || 0).toFixed(2)}</td>
                                    <td>{s.current_stock}</td>
                                    <td>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          selectOperatorProduct(s.product_id, true).catch(handleError);
                                        }}
                                      >
                                        {L('Отвори', 'Open', 'Apri')}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <Field label={L('Количество', 'Quantity', 'Quantita')} hint={L('Брой за действие', 'Action quantity', 'Quantita azione')}>
                            <input
                              type="number"
                              min="1"
                              style={{ width: 100 }}
                              value={operatorQty}
                              onChange={(e) => setOperatorQty(e.target.value)}
                            />
                          </Field>
                          {operatorAction === 'input' ? (
                            <button onClick={() => withLoading('operator-action', executeOperatorAction)} disabled={!isOperatorIntakeReady || loadingActions['operator-action']} style={{ height: 38, marginBottom: 4 }}>
                              {loadingActions['operator-action'] ? L('Обработка...', 'Processing...', 'Elaborazione...') : L('✅ Потвърди вход', '✅ Confirm Intake', '✅ Conferma carico')}
                            </button>
                          ) : (
                            <button
                              onClick={addOperatorSelectionToCart}
                              disabled={!operatorSnapshot || !operatorQty.trim() || !isOperatorQtyValid}
                              style={{ height: 38, marginBottom: 4 }}
                            >
                              {L('Добави в продажбата', 'Add to sale draft', 'Aggiungi alla bozza vendita')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginTop: 12 }}>
                <div className="muted">{L('Опростен режим: 1) Сканирай продукт 2) Избери действие 3) Въведи количество 4) Натисни "Изпълни действие".', 'Simple mode: 1) Scan product 2) Choose action 3) Enter quantity 4) Click "Execute Action".', 'Modalita semplice: 1) Scansiona prodotto 2) Scegli azione 3) Inserisci quantita 4) Premi "Esegui azione".')}</div>
              </div>
              <div className="inline-actions" style={{ marginTop: 12 }}>
                <button onClick={handleExitFromOperator}>{t.backFromCashier}</button>
              </div>

              {isAdmin && operatorAction === 'output' && (
                <div style={{ marginTop: 18 }}>
                  <div className="topbar" style={{ marginBottom: 8 }}>
                    <h3>{td.k067}</h3>
                    <button onClick={() => loadRecentSales().catch(handleError)}>{td.k068}</button>
                  </div>
                  {recentSalesLoading ? (
                    <div className="muted">{td.k069}</div>
                  ) : recentSales.length === 0 ? (
                    <div className="muted">{td.k070}</div>
                  ) : (
                    <div className="table-wrap">
                      <table className="recent-sales-table">
                        <thead>
                          <tr>
                            <th>{L('Артикул', 'Item', 'Articolo')}</th>
                            <th>{td.k072}</th>
                            <th>{td.k056}</th>
                            <th>{td.k073}</th>
                            <th>{td.k062}</th>
                            <th>{td.k074}</th>
                            <th>{t.actions}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentSales.map((sale) => (
                            <tr key={sale.sale_ref}>
                              <td>
                                <div className="sale-identity-list">
                                  {sale.items.slice(0, 2).map((item) => (
                                    <div key={`meta-${item.movement_id}`} className="sale-identity-item">
                                      <div className="sale-identity-name">{item.product_name}</div>
                                      <div className="sale-identity-meta">
                                        {(item.product_category || '-') + ' | ' + (item.product_barcode || '-')}
                                      </div>
                                    </div>
                                  ))}
                                  <div className="sale-info-box">
                                    {sale.items[0] && (
                                      <button
                                        className="sale-info-btn"
                                        onClick={() => openDossierByProductId(sale.items[0].product_id).catch(handleError)}
                                      >
                                        {L('Отвори досие', 'Open dossier', 'Apri dossier')}
                                      </button>
                                    )}
                                    <div className="sale-info-ref">#{sale.sale_ref}</div>
                                  </div>
                                </div>
                              </td>
                              <td>{new Date(sale.created_at).toLocaleString()}</td>
                              <td>{sale.customer_name}</td>
                              <td>{sale.operator_username}</td>
                              <td>{sale.total_qty}</td>
                              <td>{sale.total_amount.toFixed(2)}</td>
                              <td>
                                <div className="refund-action-box">
                                  <input
                                    className="refund-reason-input"
                                    placeholder={L('Причина (по избор)', 'Reason (optional)', 'Motivo (opzionale)')}
                                    value={refundRequestReasons[sale.sale_ref] || ''}
                                    onChange={(e) => setRefundRequestReasons((prev) => ({ ...prev, [sale.sale_ref]: e.target.value }))}
                                  />
                                  <button
                                    className="danger-btn inline-danger refund-request-btn"
                                    onClick={() => withLoading(`refund-request-${sale.sale_ref}`, () => createRefundRequest(sale))}
                                    disabled={!sale.can_refund || loadingActions[`refund-request-${sale.sale_ref}`]}
                                  >
                                    {loadingActions[`refund-request-${sale.sale_ref}`]
                                      ? L('Изпращане...', 'Sending...', 'Invio...')
                                      : L('Заяви сторно', 'Request refund', 'Richiedi storno')}
                                  </button>
                                </div>
                                <div className="refund-inline-note">
                                  {refundStatusMeta(sale).label}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && operatorAction === 'input' && (
                <div style={{ marginTop: 18 }}>
                  <div className="topbar" style={{ marginBottom: 8 }}>
                    <h3>{L('Последни приемания (Админ)', 'Recent intakes (Admin)', 'Ultimi carichi (Admin)')}</h3>
                    <button onClick={() => withLoading('recent-inputs-refresh', refreshMainData)} disabled={loadingActions['recent-inputs-refresh']}>
                      {loadingActions['recent-inputs-refresh'] ? L('Обновяване...', 'Refreshing...', 'Aggiornamento...') : t.refresh}
                    </button>
                  </div>
                  {recentInputs.length === 0 ? (
                    <div className="muted">{L('Няма последни приемания.', 'No recent intakes found.', 'Nessun carico recente trovato.')}</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{L('Артикул', 'Item', 'Articolo')}</th>
                            <th>{td.k072}</th>
                            <th>{td.k062}</th>
                            <th>{L('Сериен номер', 'Serial number', 'Numero seriale')}</th>
                            <th>{L('Въведено от', 'Entered by', 'Inserito da')}</th>
                            <th>{L('Движение ID', 'Movement ID', 'Movimento ID')}</th>
                            <th>{L('Инфо', 'Info', 'Info')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentInputs.map((m) => {
                            const p = productById.get(Number(m.product_id));
                            const creator = userById.get(Number(m.created_by_user_id));
                            return (
                              <tr key={m.id}>
                                <td>{p ? `${p.name} (${p.internal_sku})` : `#${m.product_id}`}</td>
                                <td>{new Date(m.created_at).toLocaleString()}</td>
                                <td>{m.qty}</td>
                                <td>{m.serial_number || '-'}</td>
                                <td>{creator?.username || `user-${m.created_by_user_id}`}</td>
                                <td>{m.id}</td>
                                <td>
                                  {p ? (
                                    <button onClick={() => openDossierByProductId(p.id).catch(handleError)}>
                                      {L('Отвори досие', 'Open dossier', 'Apri dossier')}
                                    </button>
                                  ) : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'inventory' && (
            <>
              <div className="card">
                <h3>{L('Inventory Health', 'Inventory Health', 'Salute inventario')}</h3>
                <div className="inline-actions" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  <span className="badge-critical">{L('Критично', 'Critical', 'Critico')}: {inventoryHealthTotals.critical}</span>
                  <span className="badge-warning">{L('Предупреждение', 'Warning', 'Avviso')}: {inventoryHealthTotals.warning}</span>
                  <span className="badge-healthy">{L('Нормално', 'Healthy', 'Buono')}: {inventoryHealthTotals.healthy}</span>
                </div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  {L('Критично: наличност <= праг | Предупреждение: наличност <= праг x 1.2 | Нормално: над warning зоната.', 'Critical: stock <= threshold | Warning: stock <= threshold x 1.2 | Healthy: above warning range.', 'Critico: stock <= soglia | Avviso: stock <= soglia x 1.2 | Buono: sopra la soglia di avviso.')}
                </div>
                <div className="inline-actions" style={{ marginBottom: 8 }}>
                  <button onClick={() => setInventoryHealthFilter('all')}>{L('Всички', 'All', 'Tutti')}</button>
                  <button onClick={() => setInventoryHealthFilter('critical')}>{L('Критично', 'Critical', 'Critico')}</button>
                  <button onClick={() => setInventoryHealthFilter('warning')}>{L('Предупреждение', 'Warning', 'Avviso')}</button>
                  <button onClick={() => setInventoryHealthFilter('healthy')}>{L('Нормално', 'Healthy', 'Buono')}</button>
                </div>
                <div className="grid" style={{ marginBottom: 8 }}>
                  <Field
                    label={L('Търсене в инвентаризация', 'Inventory search', 'Ricerca inventario')}
                    hint={L(
                      'Търси по име, марка, SKU, фабричен/вътрешен баркод, категория и локация.',
                      'Search by name, brand, SKU, factory/store barcode, category and location.',
                      'Cerca per nome, marca, SKU, barcode fabbrica/interno, categoria e posizione.',
                    )}
                  >
                    <input value={inventoryHealthSearch} onChange={(e) => setInventoryHealthSearch(e.target.value)} />
                  </Field>
                </div>
                <div className="table-wrap inventory-table-wrap">
                  <table className="inventory-table">
                    <thead><tr><th>ID</th><th>{L('Име', 'Name', 'Nome')}</th><th>{L('Марка', 'Brand', 'Marca')}</th><th>{L('Категория', 'Category', 'Categoria')}</th><th>SKU</th><th>{L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')}</th><th>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}</th><th>{L('Локация', 'Location', 'Posizione')}</th><th>{L('Наличност', 'Stock', 'Disponibilita')}</th><th>{L('Мин. праг', 'Min threshold', 'Soglia min')}</th><th>{L('Състояние', 'Health', 'Stato')}</th><th>{L('Инфо', 'Info', 'Info')}</th></tr></thead>
                    <tbody>
                      {inventoryHealthRows.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="muted">
                            {L('Няма резултати за това търсене.', 'No results for this search.', 'Nessun risultato per questa ricerca.')}
                          </td>
                        </tr>
                      ) : (
                        inventoryHealthRows.map((r) => (
                          <tr key={r.id}>
                            <td>{r.id}</td>
                            <td>{r.name}</td>
                            <td>{r.brand_name || '-'}</td>
                            <td>{r.category}</td>
                            <td>{r.sku || '-'}</td>
                            <td>{r.factory_barcode || '-'}</td>
                            <td>{r.store_barcode || '-'}</td>
                            <td>{r.location}</td>
                            <td>{r.current_stock}</td>
                            <td>{r.min_threshold}</td>
                            <td><span className={`badge-${r.health}`}>{healthLabel(r.health)}</span></td>
                            <td>
                              <button onClick={() => openDossierByProductId(r.id).catch(handleError)}>
                                {L('Досие', 'Dossier', 'Dossier')}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            <div className="card">
              <h3>{t.reconcile}</h3>
              <div className="grid">
                <Field label={td.k060} hint={td.k117}><select value={reconcileProductId} onChange={(e) => { setReconcileProductId(e.target.value); setReconcileResult(null); }}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label={td.k118} hint={td.k119}><textarea className="txt" value={reconcileSerials} onChange={(e) => setReconcileSerials(e.target.value)} /></Field>
                <Field label={td.k058} hint={td.k120}><input value={reconcileComment} onChange={(e) => setReconcileComment(e.target.value)} /></Field>
              </div>
              <div className="inline-actions" style={{ marginTop: 10 }}>
                <button onClick={loadReconcileTemplate}>{L('Зареди системните SN', 'Load system SN', 'Carica SN di sistema')}</button>
                <button onClick={submitReconcile}>{t.reconcile}</button>
              </div>
              {reconcileResult && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="muted">{L('Резултат от сверяване', 'Reconcile result', 'Risultato riconciliazione')}</div>
                  <div>{L('Липсващи', 'Missing', 'Mancanti')}: <strong>{reconcileResult.missing.length}</strong></div>
                  <div>{L('Неочаквани', 'Unexpected', 'Inattesi')}: <strong>{reconcileResult.unexpected.length}</strong></div>
                  <div>{L('Авто-корекции', 'Auto adjustments', 'Rettifiche automatiche')}: <strong>{reconcileResult.auto_adjusted}</strong></div>
                  {(reconcileResult.missing.length > 0 || reconcileResult.unexpected.length > 0) && (
                    <pre className="pre" style={{ marginTop: 8 }}>{JSON.stringify({ missing: reconcileResult.missing.slice(0, 50), unexpected: reconcileResult.unexpected.slice(0, 50) }, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
            </>
          )}

          {activeTab === 'bi' && (
            <>
              <div className="card">
                <h3>{t.bi}</h3>
                <div className="grid">
                  <Field label={td.k121} hint={td.k122}><select value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }).map((_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}</select></Field>
                  <div className="align-end"><button onClick={loadTimeMachine}>{td.k123}</button></div>
                  <div className="align-end"><button onClick={loadVelocity}>{td.k124}</button></div>
                  <div className="align-end"><button onClick={loadABC}>ABC</button></div>
                </div>
                <div className="grid" style={{ marginTop: 10 }}>
                  <Field label={td.k104} hint={td.k125}><input value={warrantySerial} onChange={(e) => setWarrantySerial(e.target.value)} /></Field>
                  <div className="align-end"><button onClick={loadWarranty}>{t.warrantyCheck}</button></div>
                </div>
              </div>
              <div className="card"><pre className="pre">{JSON.stringify({ timeMachine: tmData, velocity: velocityData, abc: abcData, warranty: warrantyData }, null, 2)}</pre></div>
            </>
          )}

          {activeTab === 'reports' && (
            <>
              <div className="card">
                <h3>{t.reports}</h3>
                <div className="muted" style={{ marginBottom: 8 }}>
                  {L(
                    'Импорт/експорт за миграция от Excel, пълни архиви и периодични бизнес справки.',
                    'Import/export for Excel migration, full backups, and period business summaries.',
                    'Import/export per migrazione da Excel, backup completi e riepiloghi business per periodo.',
                  )}
                </div>
                <div className="grid">
                  <Field
                    label={L('Bulk Import (Excel)', 'Bulk Import (Excel)', 'Import massivo (Excel)')}
                    hint={L(
                      'Качи xlsx/xls с много продукти наведнъж.',
                      'Upload xlsx/xls with many products at once.',
                      'Carica xlsx/xls con molti prodotti in una volta.',
                    )}
                  >
                    <input type="file" accept=".xlsx,.xls" onChange={(e) => setDataMgmtImportFile(e.target.files?.[0] || null)} />
                  </Field>
                  <div className="align-end">
                    <button onClick={() => withLoading('dm-import', importProductsExcelDataMgmt)} disabled={loadingActions['dm-import']}>
                      {loadingActions['dm-import'] ? L('Импорт...', 'Importing...', 'Importazione...') : t.importExcel}
                    </button>
                  </div>
                  <div className="align-end">
                    <button onClick={() => download('/reports/import-template.xlsx', 'openstoko_import_template.xlsx')}>
                      {L('Шаблон за импорт', 'Download import template', 'Scarica template import')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>{L('Бизнес отчет (Excel)', 'Business Summary (Excel)', 'Riepilogo business (Excel)')}</h3>
                <div className="grid">
                  <Field label={L('Период', 'Period', 'Periodo')} hint={L('Избери период за отчета.', 'Select report period.', 'Seleziona il periodo del report.')}>
                    <select
                      value={dataMgmtPeriod}
                      onChange={(e) => setDataMgmtPeriod(e.target.value as 'current_month' | 'last_month' | 'this_year' | 'last_12_months' | 'custom')}
                    >
                      <option value="current_month">{L('Текущ месец', 'Current month', 'Mese corrente')}</option>
                      <option value="last_month">{L('Минал месец', 'Last month', 'Mese scorso')}</option>
                      <option value="this_year">{L('Текуща година', 'This year', 'Anno corrente')}</option>
                      <option value="last_12_months">{L('Последни 12 месеца', 'Last 12 months', 'Ultimi 12 mesi')}</option>
                      <option value="custom">{L('Период по избор', 'Custom range', 'Intervallo personalizzato')}</option>
                    </select>
                  </Field>
                  {dataMgmtPeriod === 'custom' && (
                    <>
                      <Field label={L('От дата', 'From date', 'Data inizio')} hint="YYYY-MM-DD">
                        <input type="date" value={dataMgmtStartDate} onChange={(e) => setDataMgmtStartDate(e.target.value)} />
                      </Field>
                      <Field label={L('До дата', 'To date', 'Data fine')} hint="YYYY-MM-DD">
                        <input type="date" value={dataMgmtEndDate} onChange={(e) => setDataMgmtEndDate(e.target.value)} />
                      </Field>
                    </>
                  )}
                  <div className="align-end">
                    <button onClick={() => withLoading('dm-business-summary', downloadBusinessSummaryReport)} disabled={loadingActions['dm-business-summary']}>
                      {loadingActions['dm-business-summary'] ? L('Генериране...', 'Generating...', 'Generazione...') : L('Експорт бизнес отчет', 'Export business summary', 'Esporta riepilogo business')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>{L('Пълен архив (Excel)', 'Full Backup (Excel)', 'Backup completo (Excel)')}</h3>
                <div className="grid">
                  <button onClick={() => withLoading('dm-full-backup', () => download('/reports/full-backup.xlsx', 'openstoko_full_backup.xlsx'))} disabled={loadingActions['dm-full-backup']}>
                    {loadingActions['dm-full-backup'] ? L('Генериране...', 'Generating...', 'Generazione...') : L('Експорт пълен архив', 'Export full backup', 'Esporta backup completo')}
                  </button>
                </div>
              </div>

              <div className="card">
                <h3>{L('Legacy експорти', 'Legacy exports', 'Export legacy')}</h3>
                <div className="grid">
                  <button onClick={() => download('/reports/products.xlsx', 'products.xlsx')}>{td.k126}</button>
                  <button onClick={() => download('/reports/movements.xlsx', 'movements.xlsx')}>{td.k127}</button>
                  <button onClick={() => download('/reports/audit.xlsx', 'audit.xlsx')}>{td.k128}</button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'history' && isAdmin && (
            <>
              <div className="card">
                <h3>{td.k144}</h3>
                <div className="grid">
                  <Field label={td.k145} hint={L('product, category, stock_movement, auth, user.', 'product, category, stock_movement, auth, user.', 'product, category, stock_movement, auth, user.')}><input value={historyEntity} onChange={(e) => setHistoryEntity(e.target.value)} onKeyDown={onHistoryFilterEnter} /></Field>
                  <Field label={L('ID на обект', 'Entity ID', 'ID entita')} hint={L('Напр. product id, user id, sale ref.', 'For example product id, user id, sale ref.', 'Ad esempio product id, user id, sale ref.')}>
                    <input value={historyEntityId} onChange={(e) => setHistoryEntityId(e.target.value)} onKeyDown={onHistoryFilterEnter} />
                  </Field>
                  <Field label={td.k146} hint={td.k147}><input value={historyUsername} onChange={(e) => setHistoryUsername(e.target.value)} onKeyDown={onHistoryFilterEnter} /></Field>
                  <Field
                    label={L('Сериен номер', 'Serial number', 'Numero seriale')}
                    hint={L('Филтър по SN в одит логовете и гаранционна проверка.', 'Filter by SN in audit logs and run warranty check.', 'Filtra per SN nei log audit ed esegui controllo garanzia.')}
                  >
                    <input value={historySerial} onChange={(e) => setHistorySerial(e.target.value)} onKeyDown={onHistoryFilterEnter} />
                  </Field>
                  <div className="align-end">
                    <button onClick={() => withLoading('history-load-audit', loadAudit)} disabled={loadingActions['history-load-audit']}>
                      {loadingActions['history-load-audit'] ? L('Зареждане...', 'Loading...', 'Caricamento...') : td.k148}
                    </button>
                  </div>
                  <div className="align-end">
                    <button onClick={() => withLoading('history-load-warranty', loadHistoryWarranty)} disabled={loadingActions['history-load-warranty']}>
                      {loadingActions['history-load-warranty'] ? L('Проверка...', 'Checking...', 'Verifica...') : L('Провери гаранция', 'Check warranty', 'Controlla garanzia')}
                    </button>
                  </div>
                  <div className="align-end">
                    <button
                      className="danger-btn inline-danger"
                      onClick={() => withLoading('history-clear-and-load', async () => {
                        setHistoryEntity('');
                        setHistoryEntityId('');
                        setHistoryUsername('');
                        setHistorySerial('');
                        setHistoryWarrantyData(null);
                        await loadAudit({ entity: '', entityId: '', username: '', serial: '' });
                        withStatus(L('Филтрите са изчистени.', 'Filters cleared.', 'Filtri puliti.'));
                      })}
                    >
                      {L('Изчисти филтрите', 'Clear filters', 'Pulisci filtri')}
                    </button>
                  </div>
                </div>
              </div>
              {historyWarrantyData && (
                <div className="card">
                  <h3>{L('Гаранция по сериен номер', 'Warranty by serial number', 'Garanzia per numero seriale')}</h3>
                  <div className="audit-grid">
                    <div><strong>{L('Сериен номер', 'Serial number', 'Numero seriale')}:</strong> {String(historyWarrantyData.serial_number || '-')}</div>
                    <div><strong>{L('Статус', 'Status', 'Stato')}:</strong> {String(historyWarrantyData.status || '-')}</div>
                    <div><strong>{L('Продаден на', 'Sold to', 'Venduto a')}:</strong> {String(historyWarrantyData.sold_to || '-')}</div>
                    <div><strong>{L('Продаден на дата', 'Sold at', 'Venduto il')}:</strong> {historyWarrantyData.sold_at ? new Date(historyWarrantyData.sold_at).toLocaleString() : '-'}</div>
                    <div><strong>{L('Валидна до', 'Valid until', 'Valida fino al')}:</strong> {historyWarrantyData.warranty_valid_until ? new Date(historyWarrantyData.warranty_valid_until).toLocaleString() : '-'}</div>
                    <div><strong>{L('Активна', 'Active', 'Attiva')}:</strong> {historyWarrantyData.warranty_active ? L('Да', 'Yes', 'Si') : L('Не', 'No', 'No')}</div>
                  </div>
                  <div className="inline-actions" style={{ marginTop: 10 }}>
                    <button
                      onClick={() => printWarrantyLabel(String(historyWarrantyData.serial_number || ''))}
                      disabled={!historyWarrantyData.serial_number}
                    >
                      {L('Принт гаранция', 'Print warranty', 'Stampa garanzia')}
                    </button>
                  </div>
                </div>
              )}
              <div className="card">
                <h3>{t.history}</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>ID</th><th>{td.k145}</th><th>{td.k149}</th><th>{td.k146}</th><th>{td.k072}</th><th>{td.k150}</th><th>{t.actions}</th></tr></thead>
                    <tbody>
                      {auditLogs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.id}</td><td>{row.entity}</td><td>{row.action}</td><td>{row.username}</td><td>{new Date(row.created_at).toLocaleString()}</td><td>{formatAuditSummary(row, lang)}</td>
                          <td><button onClick={() => setSelectedAudit(row)}>{td.k151}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'refunds' && isAdmin && (
            <div className="card">
              <div className="topbar">
                <h3>{L('Сторно одобрения (чакащи)', 'Refund approvals (pending)', 'Approvazioni storno (in attesa)')}</h3>
                <button onClick={() => loadRefundRequests().catch(handleError)}>{L('Обнови', 'Refresh', 'Aggiorna')}</button>
              </div>
              {refundRequests.length === 0 ? (
                <div className="muted">{L('Няма чакащи заявки за сторно.', 'No pending refund requests.', 'Nessuna richiesta storno in attesa.')}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{L('Референция', 'Reference', 'Riferimento')}</th>
                        <th>{L('Заявил', 'Requested by', 'Richiesto da')}</th>
                        <th>{L('Дата', 'Date', 'Data')}</th>
                        <th>{L('Причина', 'Reason', 'Motivo')}</th>
                        <th>{L('Движения', 'Movements', 'Movimenti')}</th>
                        <th>{L('Бележка за решение', 'Decision note', 'Nota decisione')}</th>
                        <th>{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refundRequests.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>{r.sale_ref}</td>
                          <td>{r.requested_by_username}</td>
                          <td>{new Date(r.created_at).toLocaleString()}</td>
                          <td>{r.reason || '-'}</td>
                          <td>{(r.movement_ids || []).join(', ') || '-'}</td>
                          <td>
                            <input
                              value={refundReviewNotes[r.id] || ''}
                              onChange={(e) => setRefundReviewNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder={L('Бележка (по избор)', 'Note (optional)', 'Nota (opzionale)')}
                            />
                          </td>
                          <td>
                            <div className="inline-actions">
                              <button
                                onClick={() => withLoading(`refund-review-${r.id}`, () => reviewRefundRequest(r.id, 'approve'))}
                                disabled={loadingActions[`refund-review-${r.id}`]}
                              >
                                {loadingActions[`refund-review-${r.id}`] ? L('Обработка...', 'Processing...', 'Elaborazione...') : L('Одобри', 'Approve', 'Approva')}
                              </button>
                              <button
                                className="danger-btn inline-danger"
                                onClick={() => withLoading(`refund-review-${r.id}`, () => reviewRefundRequest(r.id, 'reject'))}
                                disabled={loadingActions[`refund-review-${r.id}`]}
                              >
                                {L('Откажи', 'Reject', 'Rifiuta')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'help' && (
            <div className="card">
              <h3>{td.k152}</h3>
              <h4>{isAdmin ? L('Инструкции за администратор', 'Administrator instructions', 'Istruzioni per amministratore') : L('Инструкции за оператор', 'Operator instructions', 'Istruzioni per operatore')}</h4>
              {(isAdmin ? helpSectionsByRole.admin : helpSectionsByRole.operator).map((section) => (
                  <div className="help-section" key={section.title}>
                    <h4>{section.title}</h4>
                    <ol>
                      {section.items.map((item, idx) => (
                        <li key={`${section.title}-${idx}`}>{item}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              {helpSectionsByRole.shared.length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>{L('Общи инструкции', 'Shared instructions', 'Istruzioni comuni')}</h4>
                  {helpSectionsByRole.shared.map((section) => (
                    <div className="help-section" key={section.title}>
                      <h4>{section.title}</h4>
                      <ol>
                        {section.items.map((item, idx) => (
                          <li key={`${section.title}-${idx}`}>{item}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </>
              )}
              <div className="help-section" style={{ marginTop: 16 }}>
                <h4>{L('Контакт и поддръжка', 'Contact and support', 'Contatto e supporto')}</h4>
                <div className="inline-actions">
                  <a className="link-btn" href="mailto:p.m.malinov@gmail.com">{L('Имейл', 'Email', 'Email')}</a>
                  <a
                    className="link-btn"
                    href="https://www.linkedin.com/in/plamen-malinov-883139105"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {L('LinkedIn профил', 'LinkedIn profile', 'Profilo LinkedIn')}
                  </a>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="card">
              <h3>{td.k164} <span className="muted" style={{ fontWeight: 400 }}>v{APP_VERSION}</span></h3>
              <div className="help-section">
                <p>{td.k165}</p>
              </div>
              <div className="audit-grid">
                <div><strong>{td.k167}</strong> MIT</div>
                <div><strong>{td.k168}</strong> Next.js / React</div>
                <div><strong>{td.k169}</strong> FastAPI / Python</div>
              </div>
              <div className="inline-actions" style={{ marginTop: 10 }}>
                <a className="link-btn" href="/LICENSE.txt" target="_blank" rel="noreferrer">{td.k170}</a>
                <a className="link-btn" href="mailto:p.m.malinov@gmail.com">{td.k171}</a>
                <a
                  className="link-btn"
                  href="https://www.linkedin.com/in/plamen-malinov-883139105"
                  target="_blank"
                  rel="noreferrer"
                >
                  {L('LinkedIn профил', 'LinkedIn profile', 'Profilo LinkedIn')}
                </a>
                <a className="link-btn" href={DONATION_URL} target="_blank" rel="noreferrer">{td.k172}</a>
              </div>
              <div className="muted" style={{ marginTop: 10 }}>{td.k173}</div>
            </div>
          )}

          {activeTab === 'admin' && isAdmin && (
            <>
              <div className="card">
                <h3>{t.createUser}</h3>
                <div className="grid">
                  <Field label={td.k174} hint={td.k175}><input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="off" /></Field>
                  <Field label={td.k176} hint={td.k177}><input value={newFullName} onChange={(e) => setNewFullName(e.target.value)} autoComplete="off" /></Field>
                  <Field label={td.k178} hint={L('admin/operator.', 'admin/operator.', 'admin/operator.')}><select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'operator')}><option value="operator">{td.k035}</option><option value="admin">{td.k034}</option></select></Field>
                  <Field label={td.k179} hint={td.k180}><input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" autoComplete="new-password" /></Field>
                </div>
                <div style={{ marginTop: 10 }}><button onClick={createUser}>{t.createUser}</button></div>
              </div>
              <div className="card">
                <h3>{L('Сигурност на сесията', 'Session Security', 'Sicurezza sessione')}</h3>
                <div className="grid">
                  <Field label={L('Auto-logout (минути)', 'Auto-logout (minutes)', 'Auto-logout (minuti)')} hint={L('След колко минути неактивност да се излиза автоматично.', 'After how many idle minutes users are logged out automatically.', 'Dopo quanti minuti di inattivita l\'utente esce automaticamente.') }>
                    <input value={sessionTimeoutInput} onChange={(e) => setSessionTimeoutInput(e.target.value)} />
                  </Field>
                  <div className="align-end"><button onClick={saveSessionTimeoutPolicy}>{L('Запази политика', 'Save Policy', 'Salva policy')}</button></div>
                </div>
                <div className="muted">{L('Важи за всички потребители. Диапазон: 1-1440 минути.', 'Applies to all users. Range: 1-1440 minutes.', 'Valido per tutti gli utenti. Intervallo: 1-1440 minuti.')}</div>
              </div>
              <div className="card">
                <div className="topbar">
                  <h3>{L('Бизнес отчет', 'Business Summary', 'Riepilogo business')}</h3>
                  <button onClick={() => withLoading('admin-business-summary', loadBusinessSummary)} disabled={loadingActions['admin-business-summary']}>
                    {loadingActions['admin-business-summary'] ? L('Зареждане...', 'Loading...', 'Caricamento...') : L('Обнови отчета', 'Refresh summary', 'Aggiorna riepilogo')}
                  </button>
                </div>
                <div className="grid">
                  <Field label={L('Период', 'Period', 'Periodo')} hint={L('Избери готов период или custom от/до.', 'Select a preset period or custom from/to.', 'Seleziona periodo predefinito o custom da/a.')}>
                    <select
                      value={summaryPeriod}
                      onChange={(e) => setSummaryPeriod(e.target.value as 'current_month' | 'last_month' | 'this_year' | 'last_12_months' | 'custom')}
                    >
                      <option value="current_month">{L('Текущ месец', 'Current month', 'Mese corrente')}</option>
                      <option value="last_month">{L('Минал месец', 'Last month', 'Mese scorso')}</option>
                      <option value="this_year">{L('Текуща година', 'This year', 'Anno corrente')}</option>
                      <option value="last_12_months">{L('Последни 12 месеца', 'Last 12 months', 'Ultimi 12 mesi')}</option>
                      <option value="custom">{L('Период по избор', 'Custom range', 'Intervallo personalizzato')}</option>
                    </select>
                  </Field>
                  {summaryPeriod === 'custom' && (
                    <>
                      <Field label={L('От дата', 'From date', 'Data inizio')} hint="YYYY-MM-DD">
                        <input type="date" value={summaryStartDate} onChange={(e) => setSummaryStartDate(e.target.value)} />
                      </Field>
                      <Field label={L('До дата', 'To date', 'Data fine')} hint="YYYY-MM-DD">
                        <input type="date" value={summaryEndDate} onChange={(e) => setSummaryEndDate(e.target.value)} />
                      </Field>
                    </>
                  )}
                </div>
                {businessSummary && (
                  <>
                    <div className="audit-grid" style={{ marginTop: 12 }}>
                      <div><strong>{L('Период', 'Period', 'Periodo')}:</strong> {businessSummary.start_date} {' -> '} {businessSummary.end_date}</div>
                      <div><strong>{L('Купени (бр.)', 'Purchased (qty)', 'Acquistati (qta)')}:</strong> {businessSummary.purchased_qty}</div>
                      <div><strong>{L('Купени (стойност)', 'Purchased (value)', 'Acquistati (valore)')}:</strong> {formatMoney(businessSummary.purchased_amount)}</div>
                      <div><strong>{L('Продадени (бр.)', 'Sold (qty)', 'Venduti (qta)')}:</strong> {businessSummary.sold_qty}</div>
                      <div><strong>{L('Продадени (стойност)', 'Sold (value)', 'Venduti (valore)')}:</strong> {formatMoney(businessSummary.sold_amount)}</div>
                      <div><strong>{L('Баланс поток', 'Flow balance', 'Bilancio flusso')}:</strong> {formatMoney(businessSummary.flow_balance)}</div>
                      <div><strong>{L('Налични бройки в склада', 'Units currently in stock', 'Unita attualmente in stock')}:</strong> {businessSummary.inventory_units}</div>
                      <div><strong>{L('Стойност на наличността (по покупни)', 'Inventory value (purchase cost)', 'Valore stock (costo acquisto)')}:</strong> {formatMoney(businessSummary.inventory_value_purchase)}</div>
                      <div><strong>{L('Общо продукти', 'Total products', 'Prodotti totali')}:</strong> {businessSummary.total_products}</div>
                      <div><strong>{L('Общо категории', 'Total categories', 'Categorie totali')}:</strong> {businessSummary.total_categories}</div>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      {L(
                        'Отчетът се зарежда автоматично всеки път при влизане в Админ (за текущ месец), без да натискаш бутон.',
                        'This report auto-loads every time you open Admin (current month), without pressing a button.',
                        'Questo report si carica automaticamente ogni volta che apri Admin (mese corrente), senza premere pulsanti.',
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="card">
                <div className="topbar">
                  <h3>{L('Threshold Suggestions (AI)', 'Threshold Suggestions (AI)', 'Suggerimenti soglia (AI)')}</h3>
                  <button onClick={() => loadThresholdSuggestions().catch(handleError)}>{L('Обнови', 'Refresh', 'Aggiorna')}</button>
                </div>
                {thresholdSuggestions.length === 0 ? (
                  <div className="muted">{L('Няма чакащи предложения.', 'No pending suggestions.', 'Nessun suggerimento in attesa.')}</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>ID</th><th>{L('Продукт', 'Product', 'Prodotto')}</th><th>{L('Текущ праг', 'Current threshold', 'Soglia corrente')}</th><th>{L('Предложен', 'Suggested', 'Suggerita')}</th><th>{L('Увереност', 'Confidence', 'Confidenza')}</th><th>{t.actions}</th></tr></thead>
                      <tbody>
                        {thresholdSuggestions.map((s) => (
                          <tr key={s.id}>
                            <td>{s.id}</td><td>{s.product_name}</td><td>{s.current_min_threshold}</td><td>{s.suggested_min_threshold}</td><td>{Math.round((s.confidence || 0) * 100)}%</td>
                            <td>
                              <div className="inline-actions">
                                <button onClick={() => reviewThresholdSuggestion(s.id, 'approve')}>{L('Одобри', 'Approve', 'Approva')}</button>
                                <button className="danger-btn inline-danger" onClick={() => reviewThresholdSuggestion(s.id, 'reject')}>{L('Отхвърли', 'Reject', 'Rifiuta')}</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card">
                <h3>{td.k181}</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>ID</th><th>{td.k146}</th><th>{td.k050}</th><th>{td.k178}</th><th>{td.k182}</th><th>{t.actions}</th></tr></thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.id}</td><td>{u.username}</td><td>{u.full_name}</td><td>{u.role}</td>
                          <td><input value={resetPasswordValue[u.id] || ''} onChange={(e) => setResetPasswordValue((prev) => ({ ...prev, [u.id]: e.target.value }))} placeholder={td.k183} type="password" autoComplete="new-password" /></td>
                          <td><button onClick={() => resetUserPassword(u.id)}>{td.k184}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {showDonationModal && (
        <div className="audit-modal-backdrop" onClick={maybeLaterDonation}>
          <div className="donation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h3>{L('Почерпи разработчика едно кафе!', 'Buy the developer a coffee!', 'Offri un caffè allo sviluppatore!')}</h3>
              <button onClick={maybeLaterDonation}>{td.k186}</button>
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>
              {L(
                'Харесва ли ти OPENSTOKO? Почерпи разработчика с едно кафе, за да продължат ъпдейтите.',
                'Enjoying OPENSTOKO? Buy the developer a coffee to keep updates coming.',
                'Ti piace OPENSTOKO? Offri un caffe allo sviluppatore per continuare con gli aggiornamenti.',
              )}
            </div>
            <div className="inline-actions">
              <button onClick={supportWithCoffee}>{L('Купи кафе', 'Buy a Coffee', 'Offri un caffe')}</button>
              <button className="donation-later-btn" onClick={maybeLaterDonation}>{L('Може би по-късно', 'Maybe Later', 'Magari dopo')}</button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {L('Revolut: @plameniraz', 'Revolut: @plameniraz', 'Revolut: @plameniraz')}
            </div>
          </div>
        </div>
      )}

      {selectedAudit && (
        <div className="audit-modal-backdrop" onClick={() => setSelectedAudit(null)}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h3>{td.k185} #{selectedAudit.id}</h3>
              <button onClick={() => setSelectedAudit(null)}>{td.k186}</button>
            </div>
            <div className="audit-grid">
              <div><strong>{td.k187}</strong> {selectedAudit.entity}</div>
              <div><strong>{td.k188}</strong> {selectedAudit.action}</div>
              <div><strong>{td.k189}</strong> {selectedAudit.username}</div>
              <div><strong>{L('IP:', 'IP:', 'IP:')}</strong> {selectedAudit.ip_address}</div>
              <div><strong>{td.k190}</strong> {selectedAudit.entity_id}</div>
              <div><strong>{td.k191}</strong> {new Date(selectedAudit.created_at).toLocaleString()}</div>
            </div>
            <div className="help-section"><strong>{td.k192}</strong> {formatAuditSummary(selectedAudit, lang)}</div>
            <div className="audit-columns">
              <div><h4>{td.k193}</h4><pre className="pre">{JSON.stringify(oldParsed, null, 2)}</pre></div>
              <div><h4>{td.k194}</h4><pre className="pre">{JSON.stringify(newParsed, null, 2)}</pre></div>
            </div>
          </div>
        </div>
      )}

      {selectedProduct360 && (
        <div className="audit-modal-backdrop" onClick={() => setSelectedProduct360(null)}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h3>{L('Product 360', 'Product 360', 'Product 360')} #{selectedProduct360.id}</h3>
              <button onClick={() => setSelectedProduct360(null)}>{td.k186}</button>
            </div>

            <div className="audit-grid">
              <div><strong>{L('Име', 'Name', 'Nome')}:</strong> {selectedProduct360.name}</div>
              <div><strong>{L('Категория', 'Category', 'Categoria')}:</strong> {selectedProduct360.category}</div>
              <div><strong>{L('Марка', 'Brand', 'Marca')}:</strong> {selectedProduct360.brand_name || '-'}</div>
              <div><strong>{L('Доставчик', 'Supplier', 'Fornitore')}:</strong> {selectedProduct360.supplier_name || '-'}</div>
              <div><strong>SKU:</strong> {selectedProduct360.internal_sku}</div>
              <div><strong>{L('Фабричен баркод', 'Factory barcode', 'Barcode fabbrica')}:</strong> {selectedProduct360.factory_barcode}</div>
              <div><strong>{L('Вътрешен баркод', 'Store barcode', 'Barcode interno')}:</strong> {selectedProduct360.store_barcode || '-'}</div>
              <div><strong>{L('Локация', 'Location', 'Posizione')}:</strong> {selectedProduct360.warehouse_location}</div>
              <div><strong>{L('Наличност', 'Stock', 'Disponibilita')}:</strong> {Number(selectedProduct360.current_stock || 0)}</div>
              <div><strong>{L('Мин. праг', 'Min threshold', 'Soglia min')}:</strong> {Number(selectedProduct360.min_threshold || 0)}</div>
              <div><strong>{L('Състояние', 'Health', 'Stato')}:</strong> {healthLabel(selectedProduct360.inventory_health || 'healthy')}</div>
              <div><strong>{L('Compatibility Group', 'Compatibility Group', 'Gruppo compatibilita')}:</strong> {selectedProduct360.compatibility_group || selectedProduct360.compatibility_group_code || '-'}</div>
              <div><strong>{L('Покупна цена', 'Purchase price', 'Prezzo acquisto')}:</strong> {Number(selectedProduct360.purchase_price || 0).toFixed(2)}</div>
              <div><strong>{L('Продажна цена', 'Sell price', 'Prezzo vendita')}:</strong> {Number(selectedProduct360.sell_price || 0).toFixed(2)}</div>
              <div><strong>{L('Мин. продажна', 'Min sell price', 'Prezzo minimo vendita')}:</strong> {Number(selectedProduct360.min_sell_price || 0).toFixed(2)}</div>
            </div>

            <div className="help-section">
              <strong>{L('Коментар', 'Comment', 'Commento')}:</strong>
              <div className="muted">{(selectedProduct360.product_comment || selectedProduct360.description || '-')}</div>
            </div>
            <div className="help-section">
              <strong>{L('Технически спецификации', 'Technical specs', 'Specifiche tecniche')}:</strong>
              <div className="muted">{selectedProduct360.technical_specs || '-'}</div>
            </div>
            {selectedProduct360.photo_url && (
              <div className="help-section">
                <strong>{L('Снимка', 'Image', 'Immagine')}:</strong>
                <div style={{ marginTop: 8 }}>
                  <img
                    src={resolveMediaUrl(selectedProduct360.photo_url)}
                    alt={selectedProduct360.name}
                    style={{ width: 180, height: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid #d7e2df' }}
                  />
                </div>
              </div>
            )}

            <div className="help-section">
              <strong>{L('Последни движения', 'Last movements', 'Ultimi movimenti')}:</strong>
              {product360Movements.length === 0 ? (
                <div className="muted">{L('Няма движения за този продукт.', 'No movements for this product.', 'Nessun movimento per questo prodotto.')}</div>
              ) : (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{L('Тип', 'Type', 'Tipo')}</th>
                        <th>{L('Сериен номер', 'Serial number', 'Numero seriale')}</th>
                        <th>{L('Количество', 'Quantity', 'Quantita')}</th>
                        <th>{L('Дата', 'Date', 'Data')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product360Movements.map((m) => (
                        <tr key={m.id}>
                          <td>{m.id}</td>
                          <td>{m.movement_type}</td>
                          <td>{m.serial_number || '-'}</td>
                          <td>{m.qty}</td>
                          <td>{new Date(m.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="inline-actions" style={{ marginTop: 10 }}>
              <button
                onClick={() => {
                  startAdminEdit(selectedProduct360);
                  setSelectedProduct360(null);
                }}
              >
                {L('Редакция', 'Edit', 'Modifica')}
              </button>
              <button onClick={() => download(`/products/${selectedProduct360.id}/barcode.png`, `barcode_${selectedProduct360.internal_sku}.png`)}>
                {td.k051}
              </button>
              <button onClick={() => download(`/products/${selectedProduct360.id}/label.pdf`, `label_${selectedProduct360.internal_sku}.pdf`)}>
                {td.k052}
              </button>
              <button onClick={() => printFromApi(`/products/${selectedProduct360.id}/label.pdf`, `label_${selectedProduct360.internal_sku}.pdf`).catch(handleError)}>
                {L('Принт етикет', 'Print label', 'Stampa etichetta')}
              </button>
              <button
                onClick={() => {
                  const entityId = String(selectedProduct360.id);
                  setHistoryEntity('product');
                  setHistoryEntityId(entityId);
                  setHistoryUsername('');
                  setHistorySerial('');
                  setActiveTab('history');
                  setSelectedProduct360(null);
                  withLoading('history-load-audit', () => loadAudit({ entity: 'product', entityId, username: '', serial: '' }));
                }}
              >
                {L('Одит за продукта', 'Product audit', 'Audit prodotto')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

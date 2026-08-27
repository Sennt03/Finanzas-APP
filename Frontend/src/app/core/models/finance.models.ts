export type CategoryKind = 'expense' | 'savings' | 'credit';
export type AccountType = 'transactional' | 'savings';
export type SavingsMovementType = 'deposit' | 'withdrawal';
export type ExtraType = 'expense' | 'income';
export type PaymentMethod = 'cash' | 'credit';

export interface LsAccount {
    _id: string;
    name: string;
    type: AccountType;
    initialBalance: number;
    balance: number;
    availableBalance: number;
    pendingLoansTotal: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface LsTemplateItem {
    _id?: string;
    name: string;
    amount: number;
    paymentMethod?: PaymentMethod;
    cardId?: string | null;
}

export interface LsTemplateCategory {
    _id?: string;
    name: string;
    kind: CategoryKind;
    totalAmount: number;
    flexible?: boolean;
    protected?: boolean;
    items: LsTemplateItem[];
}

// Fase 1: tarjeta de crédito
export interface LsCard {
    _id: string;
    name: string;
    bank: string;
    creditLimit: number;
    cutoffDay: number;
    paymentDay: number;
    color: string;
    active: boolean;
    isDefault?: boolean;
    // Añadidos por el backend en el listado:
    used?: number;
    available?: number;
    createdAt?: string;
}

export interface LsBudgetTemplate {
    _id?: string;
    userId?: string;
    defaultSalary: number;
    cutoffDay: number;
    categories: LsTemplateCategory[];
}

export interface LsStatementItem {
    _id?: string;
    name: string;
    budgetedAmount: number;
    isPaid: boolean;
    paidAmount: number;
    paidAt: string | null;
    paymentMethod?: PaymentMethod;
    purchaseId?: string;
    cuotaId?: string;
    subType?: 'tdc' | 'diferido';
    isShared?: boolean;
    borrowerName?: string;
    paidByBorrower?: number;
    convertedToLoan?: boolean;
    // Fase 1/2 (cuotas de la categoría virtual de tarjeta):
    cardId?: string | null;
    categoryName?: string;
    budgetMode?: 'retain' | 'defer';
    budgetYear?: number;
    budgetMonth?: number;
    billedLater?: boolean;
}

export interface LsExternalCreditItem {
    itemId: string;
    categoryId: string;
    name: string;
    amount: number;
    categoryName: string;
    cardId: string | null;
    isPaid: boolean;
}

// Fase 2: compra de tarjeta asignada a una categoría, mostrada como línea dentro de ella.
export interface LsCreditBudgetItem {
    purchaseId: string;
    cuotaId: string;
    name: string;
    amount: number;
    categoryName: string;
    cardId: string | null;
    isPaid: boolean;
    billYear: number;
    billMonth: number;
    billedLater: boolean;
    subType: 'tdc' | 'diferido';
}

export interface LsStatementCategory {
    _id?: string;
    name: string;
    kind: CategoryKind;
    totalAmount: number;
    flexible?: boolean;
    protected?: boolean;
    fromExtraIncome?: boolean;
    items: LsStatementItem[];
    isVirtual?: boolean;
    isAvance?: boolean;
    groupKey?: 'tdc' | 'diferidos';
    categoryPaid?: boolean;
    categoryPaidAt?: string | null;
    externalCreditItems?: LsExternalCreditItem[];
    totalAll?: number;
    // Fase 2/3: calculado por el backend en buildEnrichedStatement.
    categoryBudget?: number;
    spent?: number;
    remaining?: number;
    creditConsumed?: number;
    creditBudgetItems?: LsCreditBudgetItem[];
}

export interface LsStatementExtra {
    _id?: string;
    name: string;
    amount: number;
    type: ExtraType;
    categoryName: string;
    linkedSavingsId?: string | null;
    savingsDepositId?: string | null;
    date: string;
}

export interface LsCardBreakdown {
    cardId: string | null;
    name: string;
    color: string;
    bank: string;
    creditLimit: number;
    used: number;
    available: number;
    total: number;
    mine: number;
    others: number;
}

export interface LsStatementSummary {
    totalBudgeted: number;
    totalPaid: number;
    totalExtras: number;
    totalExtrasIncome: number;
    remainingSalary: number;
    availableBalance: number;
    availableToBudget: number;
    pendingLoansTotal: number;
    // Fase 2/3
    puedoGastar: number;
    flexibleCount: number;
    unbudgeted: number;
    avance: number;
    presupuestoExcedido: number;
    sinCategoria: { budget: number; income: number; expense: number; savings: number; allocated: number; spent: number; remaining: number; salaryAvailable: number; extraAvailable: number; loanIncome: number; cardConsumed: number };
    apartado: number;
    retainedFromPrev: number;
    disponibleReal: number;
    porPagar: number;
    cardsBreakdown: LsCardBreakdown[];
    savings: {
        monthDeposits: number;
        monthWithdrawals: number;
    };
    creditCard: {
        total: number;
        paid: number;
        pending: number;
        groupPaid: boolean;
        tdcShare: number;
        diferidosShare: number;
        itemsShare: number;
        sharedShare: number;
        ownShare: number;
    };
}

export interface LsClosingOverspent {
    name: string;
    budget: number;
    spent: number;
    over: number;
}

export interface LsClosing {
    closedAt: string | null;
    savingsStart: number;
    savingsEnd: number;
    netSavings: number;
    apartadoCarried: number;
    overspent: LsClosingOverspent[];
}

export interface LsMonthlyStatement {
    _id: string;
    year: number;
    month: number;
    salary: number;
    categories: LsStatementCategory[];
    extras: LsStatementExtra[];
    summary: LsStatementSummary;
    closing?: LsClosing | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface LsSavingsMovement {
    _id: string;
    accountId: string;
    type: SavingsMovementType;
    amount: number;
    description: string;
    monthlyStatementId: string | null;
    itemRef?: { categoryId?: string; itemId?: string };
    date: string;
    createdAt?: string;
}

export interface LsCuota {
    _id: string;
    year: number;
    month: number;
    amount: number;
    isPaid: boolean;
    paidAmount: number;
    paidAt: string | null;
    paidByBorrower?: number;
    paidByBorrowerAt?: string | null;
    convertedToLoan?: boolean;
}

export interface LsCreditPurchase {
    _id: string;
    name: string;
    totalAmount: number;
    purchaseDate: string;
    installments: number;
    cutoffDayUsed: number;
    cardId?: string | null;
    categoryName?: string;
    budgetMode?: 'retain' | 'defer';
    cuotas: LsCuota[];
    isShared?: boolean;
    borrowerName?: string;
    createdAt?: string;
}

export const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export type LoanStatus = 'pending' | 'paid' | 'transferred';

export type LoanTransferType = 'savings' | 'debt';

export interface LsLoanHistoryEntry {
    type: 'lent' | 'transferred' | 'paid' | 'partial_payment' | 'repaid_savings' | 'transfer_reverted';
    date: string;
    toStatementId?: string;
    fromStatementId?: string;
    savingsMovementId?: string;
    transferType?: LoanTransferType;
    amount?: number;
}

export interface LsLoanStatementRef {
    year: number;
    month: number;
}

export interface LsLoan {
    _id: string;
    borrowerName: string;
    amount: number;
    paidAmount: number;
    lentDate: string;
    originStatementId: string;
    currentStatementId: string;
    status: LoanStatus;
    paidAt: string | null;
    history: LsLoanHistoryEntry[];
    fromSavings: boolean;
    savingsWithdrawalId: string | null;
    paidBackToSavings: boolean;
    savingsDepositId: string | null;
    fromCard: boolean;
    cardPurchaseId: string | null;
    transferType: LoanTransferType | null;
    transferredToLoanId: string | null;
    transferredFromLoanId: string | null;
    transferDeferred: boolean;
    originStatement: LsLoanStatementRef | null;
    currentStatement: LsLoanStatementRef | null;
    createdAt?: string;
}

export interface LsActivityLog {
    _id: string;
    year: number;
    month: number;
    action: string;
    description: string;
    amount: number | null;
    metadata: Record<string, unknown>;
    deletable?: boolean;
    createdAt: string;
}

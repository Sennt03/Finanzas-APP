export type CategoryKind = 'expense' | 'savings' | 'credit';
export type AccountType = 'transactional' | 'savings';
export type SavingsMovementType = 'deposit' | 'withdrawal';
export type ExtraType = 'expense' | 'income';

export interface LsAccount {
    _id: string;
    name: string;
    type: AccountType;
    initialBalance: number;
    balance: number;
    availableBalance: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface LsTemplateItem {
    _id?: string;
    name: string;
    amount: number;
}

export interface LsTemplateCategory {
    _id?: string;
    name: string;
    kind: CategoryKind;
    items: LsTemplateItem[];
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
    purchaseId?: string;
    cuotaId?: string;
    subType?: 'tdc' | 'diferido';
}

export interface LsStatementCategory {
    _id?: string;
    name: string;
    kind: CategoryKind;
    items: LsStatementItem[];
    isVirtual?: boolean;
    groupKey?: 'tdc' | 'diferidos';
    categoryPaid?: boolean;
    categoryPaidAt?: string | null;
}

export interface LsStatementExtra {
    _id?: string;
    name: string;
    amount: number;
    type: ExtraType;
    categoryName: string;
    date: string;
}

export interface LsStatementSummary {
    totalBudgeted: number;
    totalPaid: number;
    totalExtras: number;
    totalExtrasIncome: number;
    remainingSalary: number;
    availableBalance: number;
    availableToBudget: number;
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
    };
}

export interface LsMonthlyStatement {
    _id: string;
    year: number;
    month: number;
    salary: number;
    categories: LsStatementCategory[];
    extras: LsStatementExtra[];
    summary: LsStatementSummary;
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
}

export interface LsCreditPurchase {
    _id: string;
    name: string;
    totalAmount: number;
    purchaseDate: string;
    installments: number;
    cutoffDayUsed: number;
    cuotas: LsCuota[];
    createdAt?: string;
}

export const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

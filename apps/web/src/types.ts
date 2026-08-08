export type Paise = number
export type EntityId = string | number

export type SetupAccountKind = 'bank' | 'cash' | 'wallet' | 'credit_card'

export interface AccountSetupInput {
  name: string
  kind: SetupAccountKind
  opening_balance_paise: Paise
  credit_limit_paise: Paise | null
  statement_day: number | null
  payment_due_day: number | null
}

export interface LedgerAccount {
  id?: EntityId
  name: string
  kind: SetupAccountKind | 'other'
}

export interface CaptureAccount extends LedgerAccount {
  id: EntityId
}

export type CaptureCategoryKind = 'expense' | 'income' | 'both'

export interface CaptureCategory {
  id: EntityId
  name: string
  kind: CaptureCategoryKind
}

export interface CaptureContext {
  accounts: CaptureAccount[]
  categories: CaptureCategory[]
}

export interface UserProfile {
  displayName: string
  householdName: string
  members: HouseholdMember[]
  isDemo: boolean
}

export interface HouseholdMember {
  id: string
  name: string
}

export interface MemberBalance extends HouseholdMember {
  balancePaise: Paise
  status: string
}

export interface TransactionSplit {
  memberId: string
  memberName: string
  amountPaise: Paise
}

export type TransactionKind = 'debit' | 'credit' | 'transfer'

export interface Transaction {
  id: string
  kind: TransactionKind
  amountPaise: Paise
  personalSharePaise: Paise
  merchant: string
  category: string
  account: string
  sourceAccountId?: EntityId
  destinationAccount?: string
  destinationAccountId?: EntityId
  occurredAt: string
  note?: string
  memberSplits: TransactionSplit[]
  status: 'confirmed'
}

export interface TransactionDraft {
  kind: TransactionKind
  amountPaise: Paise
  merchant: string
  category: string
  account: string
  sourceAccountId?: EntityId
  destinationAccount?: string
  destinationAccountId?: EntityId
  occurredAt: string
  note: string
  memberSplits: TransactionSplit[]
  confidence: 'high' | 'review'
  warnings?: string[]
  sourceText: string
  platform?: string
  subcategory?: string
  categorySuggestion?: TransactionCategorySuggestion
  metadata?: TransactionMetadata
  tags?: TransactionTag[]
}

export type MetadataSource = 'user_explicit' | 'household_rule' | 'safe_catalog' | 'model_suggested' | 'user_corrected'
export type MetadataReviewStatus = 'needs_review' | 'reviewed'

export interface MetadataEvidence {
  source: MetadataSource
  confidence: number
  reviewStatus: MetadataReviewStatus
}

export interface TransactionAttribute extends MetadataEvidence {
  key: 'meal_occasion' | 'order_channel'
  value: string
}

export interface TransactionTag extends MetadataEvidence {
  name: string
  normalizedName: string
  selected: boolean
}

export interface TransactionCategorySuggestion {
  source: MetadataSource
  confidence: number
  reason: string
}

export interface TransactionMetadata {
  version: 1
  evidence: Partial<Record<'amount' | 'merchant' | 'platform' | 'category' | 'subcategory' | 'occurred_on', MetadataEvidence>>
  attributes: TransactionAttribute[]
}

export interface CaptureChoice {
  id: string
  label: string
  answer: string
}

export interface CaptureClarification {
  outcome: 'clarification'
  sourceText: string
  understood: {
    amountPaise?: Paise
    kind?: 'expense' | 'income' | 'transfer'
    merchant?: string
    category?: string
    occurredOn?: string
  }
  missingField: 'amount_paise' | 'kind' | 'description' | 'source_account_id' | 'destination_account_id' | 'category_id' | 'member_ids' | 'occurred_on'
  question: string
  explanation: string
  choices: CaptureChoice[]
  warnings: string[]
  parserSource: string
}

export type CaptureResult = TransactionDraft | CaptureClarification

export interface MonthlyPoint {
  month: string
  incomePaise: Paise
  spendPaise: Paise
}

export interface Dashboard {
  availablePaise: Paise
  incomePaise: Paise
  spendPaise: Paise
  sharedBalancePaise: Paise
  memberBalances: MemberBalance[]
  monthly: MonthlyPoint[]
  recentTransactions: Transaction[]
}

export type AssistantWidget =
  | { type: 'metric'; title: string; value: string; detail?: string }
  | { type: 'bar_chart' | 'line_chart'; title: string; data: Array<{ label: string; value: number }> }
  | { type: 'table'; title: string; columns: string[]; rows: string[][] }
  | { type: 'clarification'; question: string; options: string[] }

export interface AssistantReply {
  message: string
  widgets: AssistantWidget[]
  provider: string
}

export interface AssistantRuntimeStatus {
  configured: boolean
  provider: string
  model: string | null
  available: boolean
  dataPolicy: 'sample_only' | 'private_approved'
  personalDataEnabled: boolean
  isDemo: boolean
}

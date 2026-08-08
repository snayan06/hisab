import { demoDashboard, demoTransactions } from '../data/demo'
import type { AccountSetupInput, AssistantReply, AssistantRuntimeStatus, AssistantWidget, CaptureAccount, CaptureCategory, CaptureClarification, CaptureContext, CaptureResult, Dashboard, HouseholdMember, LedgerAccount, MemberBalance, MonthlyPoint, Transaction, TransactionDraft, UserProfile } from '../types'
import { parseCaptureLocally } from './capture'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
const TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 250
const TRANSIENT_STATUSES = new Set([502, 503, 504])
export const APPROVED_ASSISTANT_MESSAGES = {
  summary: 'Here is your current account overview.',
  spending: 'Here is your spending overview.',
  income: 'Here is your income overview.',
  cashflow: 'Here is your cash-flow overview.',
  shared: 'Here are your shared balances.',
  transactions: 'Here is your recent ledger activity.',
  clarification: 'I need a little more detail to answer that.',
  unsupported: 'I can only help with read-only ledger questions.'
} as const
type AssistantIntent = keyof typeof APPROVED_ASSISTANT_MESSAGES
const ASSISTANT_PROVIDERS = new Set(['gemini', 'ollama'])
const RETRYABLE_POST_PATHS = new Set([
  '/api/v1/drafts/parse',
  '/api/v1/assistant/chat'
])

type AccessTokenProvider = () => Promise<string | null>
let accessTokenProvider: AccessTokenProvider = async () => null

export function configureApiAccessTokenProvider(provider: AccessTokenProvider): void {
  accessTokenProvider = provider
}

type JsonObject = Record<string, unknown>

export type RecoveryBundle = JsonObject

export interface RecoverySummary {
  sha256: string
  householdName: string
  eligible: boolean
  blocker: string | null
  counts: {
    members: number
    accounts: number
    categories: number
    transactions: number
    splits: number
    transfers: number
    settlements: number
    merchantRules: number
    auditEvents: number
  }
}

export interface RecoveryRestoreResult {
  householdId: string
  restored: boolean
  idempotentReplay: boolean
  sha256: string
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export class CaptureDraftUnavailableError extends Error {
  readonly sourceText: string

  constructor(sourceText: string, options?: ErrorOptions) {
    super('Automatic interpretation is temporarily unavailable.', options)
    this.name = 'CaptureDraftUnavailableError'
    this.sourceText = sourceText
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('Demo mode')
  const accessToken = await accessTokenProvider()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const method = (init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD' || Boolean(headers['Idempotency-Key']) || RETRYABLE_POST_PATHS.has(path)
  const attempts = canRetry ? 2 : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      })
      if (!response.ok) {
        if (attempt + 1 < attempts && TRANSIENT_STATUSES.has(response.status)) {
          await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS))
          continue
        }
        let detail = ''
        try {
          const body = await response.clone().json() as JsonObject
          detail = safeText(body.detail, '', 240)
        } catch {
          // Non-JSON provider errors use the stable fallback below.
        }
        throw new ApiError(response.status, detail || `API request failed (${response.status})`)
      }
      return await response.json() as T
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError'
      const networkFailure = error instanceof TypeError
      if (attempt + 1 < attempts && (timedOut || networkFailure)) {
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
      if (timedOut) throw new ApiError(408, 'Artha took too long to respond. Please try again.')
      if (networkFailure) throw new ApiError(503, 'Artha could not reach the API. Check your connection and try again.')
      throw error
    } finally {
      window.clearTimeout(timer)
    }
  }

  throw new ApiError(503, 'Artha could not reach the API. Please try again.')
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function safeText(value: unknown, fallback = '', maxLength = 500): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

function formatAssistantPaise(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100)
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAssistantIntent(value: string): value is AssistantIntent {
  return Object.hasOwn(APPROVED_ASSISTANT_MESSAGES, value)
}

function hasExactKeys(value: JsonObject, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key))
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength && Boolean(value.trim())
}

function isSafePaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function parseAssistantWidget(raw: unknown): AssistantWidget | null {
  if (!isJsonObject(raw) || typeof raw.type !== 'string') return null

  if (raw.type === 'metric') {
    if (
      !hasExactKeys(raw, ['type', 'title', 'value_paise', 'caption', 'tone'], ['type', 'title', 'value_paise'])
      || !isBoundedText(raw.title, 80)
      || !isSafePaise(raw.value_paise)
      || (raw.caption !== undefined && raw.caption !== null && (typeof raw.caption !== 'string' || raw.caption.length > 160))
      || (raw.tone !== undefined && raw.tone !== 'neutral' && raw.tone !== 'positive' && raw.tone !== 'warning')
    ) return null
    return {
      type: 'metric',
      title: raw.title,
      value: formatAssistantPaise(raw.value_paise),
      detail: typeof raw.caption === 'string' && raw.caption.length > 0 ? raw.caption : undefined
    }
  }

  if (raw.type === 'chart') {
    if (
      !hasExactKeys(raw, ['type', 'title', 'chart_type', 'points'], ['type', 'title', 'chart_type', 'points'])
      || !isBoundedText(raw.title, 80)
      || (raw.chart_type !== 'bar' && raw.chart_type !== 'line')
      || !Array.isArray(raw.points)
      || raw.points.length < 1
      || raw.points.length > 12
    ) return null
    const points = raw.points.flatMap((point) => {
      if (
        !isJsonObject(point)
        || !hasExactKeys(point, ['label', 'value_paise'], ['label', 'value_paise'])
        || !isBoundedText(point.label, 40)
        || !isSafePaise(point.value_paise)
      ) return []
      return [{ label: point.label, value: point.value_paise / 100 }]
    })
    if (points.length !== raw.points.length) return null
    return { type: raw.chart_type === 'line' ? 'line_chart' : 'bar_chart', title: raw.title, data: points }
  }

  if (raw.type === 'table') {
    if (
      !hasExactKeys(raw, ['type', 'title', 'rows'], ['type', 'title', 'rows'])
      || !isBoundedText(raw.title, 80)
      || !Array.isArray(raw.rows)
      || raw.rows.length < 1
      || raw.rows.length > 20
    ) return null
    const rows = raw.rows.flatMap((row) => {
      if (
        !isJsonObject(row)
        || !hasExactKeys(row, ['label', 'amount_paise', 'date', 'kind'], ['label', 'amount_paise'])
        || !isBoundedText(row.label, 80)
        || !isSafePaise(row.amount_paise)
        || (row.date !== undefined && row.date !== null && (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)))
        || (row.kind !== undefined && row.kind !== null && row.kind !== 'expense' && row.kind !== 'income' && row.kind !== 'transfer' && row.kind !== 'settlement')
      ) return []
      return [[row.label, formatAssistantPaise(row.amount_paise), typeof row.date === 'string' ? row.date : '—']]
    })
    if (rows.length !== raw.rows.length) return null
    return { type: 'table', title: raw.title, columns: ['Item', 'Amount', 'Date'], rows }
  }

  if (raw.type === 'clarification') {
    if (
      !hasExactKeys(raw, ['type', 'question', 'choices'], ['type', 'question'])
      || !isBoundedText(raw.question, 240)
      || (raw.choices !== undefined && !Array.isArray(raw.choices))
    ) return null
    const choices = raw.choices ?? []
    if (choices.length > 4 || choices.some((choice) => !isBoundedText(choice, 80))) return null
    return { type: 'clarification', question: raw.question, options: choices }
  }

  return null
}

function entityId(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return undefined
}

function apiEntityId(value: string): string | number {
  return /^\d+$/.test(value) ? Number(value) : value
}

function mapSplits(raw: unknown, memberNames: Map<string, string>): Transaction['memberSplits'] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const split = item as JsonObject
    const rawMemberId = entityId(split.member_id)
    if (rawMemberId === undefined) return []
    const memberId = String(rawMemberId)
    return [{ memberId, memberName: memberNames.get(memberId) ?? 'Household member', amountPaise: numberValue(split.amount_paise) }]
  })
}

function mapTransaction(raw: JsonObject, accountNames: Map<string, string> = new Map(), memberNames: Map<string, string> = new Map()): Transaction {
  const apiKind = stringValue(raw.kind, 'expense')
  const amountPaise = numberValue(raw.amount_paise ?? raw.amountPaise)
  const memberSplits = mapSplits(raw.splits, memberNames)
  const memberTotalPaise = memberSplits.reduce((sum, split) => sum + split.amountPaise, 0)
  return {
    id: typeof raw.id === 'number' ? String(raw.id) : stringValue(raw.id, crypto.randomUUID()),
    kind: apiKind === 'transfer' ? 'transfer' : apiKind === 'income' || apiKind === 'credit' ? 'credit' : 'debit',
    amountPaise,
    personalSharePaise: numberValue(raw.personal_share_paise ?? raw.personalSharePaise, amountPaise - memberTotalPaise),
    merchant: stringValue(raw.description ?? raw.merchant, 'Transaction'),
    category: stringValue(raw.category, 'Other'),
    account: stringValue(raw.account_name ?? raw.account, accountNames.get(String(entityId(raw.source_account_id) ?? '')) ?? (raw.source_account_id ? 'Primary account' : 'Account')),
    sourceAccountId: entityId(raw.source_account_id),
    destinationAccount: stringValue(raw.destination_account_name, accountNames.get(String(entityId(raw.destination_account_id) ?? '')) ?? '') || undefined,
    destinationAccountId: entityId(raw.destination_account_id),
    occurredAt: stringValue(raw.occurred_at ?? raw.occurredAt, new Date().toISOString()).slice(0, 10),
    note: typeof (raw.notes ?? raw.note) === 'string' ? String(raw.notes ?? raw.note) : undefined,
    memberSplits,
    status: 'confirmed'
  }
}

const METADATA_SOURCES = new Set([
  'user_explicit', 'household_rule', 'safe_catalog', 'model_suggested', 'user_corrected'
])
const METADATA_EVIDENCE_FIELDS = new Set([
  'amount', 'merchant', 'platform', 'category', 'subcategory', 'occurred_on'
])

function mapMetadataEvidence(raw: unknown): NonNullable<TransactionDraft['metadata']>['evidence'][string & keyof NonNullable<TransactionDraft['metadata']>['evidence']] | null {
  if (
    !isJsonObject(raw)
    || !hasExactKeys(raw, ['source', 'confidence', 'review_status'], ['source', 'confidence', 'review_status'])
    || typeof raw.source !== 'string'
    || !METADATA_SOURCES.has(raw.source)
    || typeof raw.confidence !== 'number'
    || raw.confidence < 0
    || raw.confidence > 1
    || (raw.review_status !== 'needs_review' && raw.review_status !== 'reviewed')
  ) return null
  return {
    source: raw.source as 'user_explicit',
    confidence: raw.confidence,
    reviewStatus: raw.review_status
  }
}

function mapDraftMetadata(raw: JsonObject): Pick<TransactionDraft, 'platform' | 'subcategory' | 'categorySuggestion' | 'metadata' | 'tags'> {
  const platform = raw.platform === null || raw.platform === undefined ? undefined : safeText(raw.platform, '', 100) || undefined
  const subcategory = raw.subcategory === null || raw.subcategory === undefined ? undefined : safeText(raw.subcategory, '', 80) || undefined

  let categorySuggestion: TransactionDraft['categorySuggestion']
  if (raw.category_suggestion !== null && raw.category_suggestion !== undefined) {
    const suggestion = raw.category_suggestion
    if (
      !isJsonObject(suggestion)
      || !hasExactKeys(suggestion, ['source', 'confidence', 'reason'], ['source', 'confidence', 'reason'])
      || typeof suggestion.source !== 'string'
      || !METADATA_SOURCES.has(suggestion.source)
      || typeof suggestion.confidence !== 'number'
      || suggestion.confidence < 0
      || suggestion.confidence > 1
      || !isBoundedText(suggestion.reason, 160)
    ) throw new Error('Capture metadata suggestion was invalid')
    categorySuggestion = {
      source: suggestion.source as 'safe_catalog',
      confidence: suggestion.confidence,
      reason: suggestion.reason
    }
  }

  let metadata: TransactionDraft['metadata']
  if (raw.metadata !== null && raw.metadata !== undefined) {
    if (
      !isJsonObject(raw.metadata)
      || !hasExactKeys(raw.metadata, ['version', 'evidence', 'attributes'], ['version', 'evidence', 'attributes'])
      || raw.metadata.version !== 1
      || !isJsonObject(raw.metadata.evidence)
      || !Array.isArray(raw.metadata.attributes)
      || raw.metadata.attributes.length > 8
    ) throw new Error('Capture metadata was invalid')
    const evidence: NonNullable<TransactionDraft['metadata']>['evidence'] = {}
    for (const [field, value] of Object.entries(raw.metadata.evidence)) {
      if (!METADATA_EVIDENCE_FIELDS.has(field) || !isJsonObject(value)) {
        throw new Error('Capture metadata evidence was invalid')
      }
      const mapped = mapMetadataEvidence({
        source: value.source,
        confidence: value.confidence,
        review_status: value.review_status
      })
      if (!mapped) throw new Error('Capture metadata evidence was invalid')
      evidence[field as keyof typeof evidence] = mapped
    }
    const attributes = raw.metadata.attributes.map((value) => {
      if (
        !isJsonObject(value)
        || !hasExactKeys(value, ['key', 'value', 'source', 'confidence', 'review_status'], ['key', 'value', 'source', 'confidence', 'review_status'])
        || (value.key !== 'meal_occasion' && value.key !== 'order_channel')
        || !isBoundedText(value.value, 80)
      ) throw new Error('Capture metadata attribute was invalid')
      const mapped = mapMetadataEvidence({
        source: value.source,
        confidence: value.confidence,
        review_status: value.review_status
      })
      if (!mapped) throw new Error('Capture metadata attribute was invalid')
      return { key: value.key as 'meal_occasion' | 'order_channel', value: value.value, ...mapped }
    })
    metadata = { version: 1, evidence, attributes }
  }

  const rawTags = raw.tag_suggestions ?? []
  if (!Array.isArray(rawTags) || rawTags.length > 8) throw new Error('Capture tags were invalid')
  const tags = rawTags.map((value) => {
    if (
      !isJsonObject(value)
      || !hasExactKeys(value, ['name', 'normalized_name', 'source', 'confidence', 'review_status'], ['name', 'normalized_name', 'source', 'confidence', 'review_status'])
      || !isBoundedText(value.name, 60)
      || !isBoundedText(value.normalized_name, 60)
    ) throw new Error('Capture tag was invalid')
    const mapped = mapMetadataEvidence({
      source: value.source,
      confidence: value.confidence,
      review_status: value.review_status
    })
    if (!mapped) throw new Error('Capture tag was invalid')
    return { name: value.name, normalizedName: value.normalized_name, selected: true, ...mapped }
  })
  return { platform, subcategory, categorySuggestion, metadata, tags }
}

function mapDraft(raw: JsonObject, text: string, memberNames: Map<string, string>, confidence?: unknown, warnings?: unknown): TransactionDraft {
  const amountPaise = numberValue(raw.amount_paise ?? raw.amountPaise)
  const apiKind = stringValue(raw.kind, 'expense')
  const warningList = Array.isArray(warnings)
    ? warnings.slice(0, 5).map((warning) => safeText(warning, '', 160)).filter(Boolean)
    : []
  return {
    kind: apiKind === 'transfer' ? 'transfer' : apiKind === 'income' || apiKind === 'credit' ? 'credit' : 'debit',
    amountPaise,
    merchant: stringValue(raw.description ?? raw.merchant, 'New transaction'),
    category: stringValue(raw.category, 'Other'),
    account: stringValue(raw.account_name ?? raw.account, 'HDFC UPI'),
    sourceAccountId: entityId(raw.source_account_id),
    destinationAccount: stringValue(raw.destination_account_name, '') || undefined,
    destinationAccountId: entityId(raw.destination_account_id),
    occurredAt: stringValue(raw.occurred_at ?? raw.occurredAt, new Date().toISOString()).slice(0, 10),
    note: stringValue(raw.notes ?? raw.note, ''),
    memberSplits: mapSplits(raw.splits, memberNames),
    confidence: warningList.length === 0 && (confidence === 'high' || (typeof confidence === 'number' && confidence >= 0.8)) ? 'high' : 'review',
    warnings: warningList,
    sourceText: text,
    ...mapDraftMetadata(raw)
  }
}

const CAPTURE_MISSING_FIELDS = new Set([
  'amount_paise', 'kind', 'description', 'source_account_id',
  'destination_account_id', 'category_id', 'member_ids', 'occurred_on'
])

function mapCaptureClarification(raw: JsonObject): CaptureClarification | null {
  if (
    !hasExactKeys(
      raw,
      ['outcome', 'source_text', 'understood', 'missing_field', 'question', 'explanation', 'choices', 'warnings', 'parser_source'],
      ['outcome', 'source_text', 'understood', 'missing_field', 'question', 'explanation', 'choices', 'warnings', 'parser_source']
    )
    || raw.outcome !== 'clarification'
    || !isBoundedText(raw.source_text, 500)
    || typeof raw.missing_field !== 'string'
    || !CAPTURE_MISSING_FIELDS.has(raw.missing_field)
    || !isBoundedText(raw.question, 240)
    || !isBoundedText(raw.explanation, 240)
    || !isBoundedText(raw.parser_source, 120)
    || !isJsonObject(raw.understood)
    || !Array.isArray(raw.choices)
    || raw.choices.length > 20
    || !Array.isArray(raw.warnings)
    || raw.warnings.length > 5
  ) return null

  const understood = raw.understood
  if (
    !hasExactKeys(understood, ['amount_paise', 'kind', 'merchant', 'category', 'occurred_on'], [])
    || (understood.amount_paise !== undefined && (!isSafePaise(understood.amount_paise) || understood.amount_paise <= 0))
    || (understood.kind !== undefined && understood.kind !== 'expense' && understood.kind !== 'income' && understood.kind !== 'transfer')
    || (understood.merchant !== undefined && !isBoundedText(understood.merchant, 160))
    || (understood.category !== undefined && !isBoundedText(understood.category, 80))
    || (understood.occurred_on !== undefined && (typeof understood.occurred_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(understood.occurred_on)))
  ) return null

  const choices = raw.choices.flatMap((value) => {
    if (
      !isJsonObject(value)
      || !hasExactKeys(value, ['id', 'label', 'answer'], ['id', 'label', 'answer'])
      || !isBoundedText(value.id, 80)
      || !isBoundedText(value.label, 100)
      || !isBoundedText(value.answer, 160)
    ) return []
    return [{ id: value.id, label: value.label, answer: value.answer }]
  })
  if (choices.length !== raw.choices.length) return null
  const warnings = raw.warnings.flatMap((value) => isBoundedText(value, 160) ? [value] : [])
  if (warnings.length !== raw.warnings.length) return null

  return {
    outcome: 'clarification',
    sourceText: raw.source_text,
    understood: {
      amountPaise: understood.amount_paise as number | undefined,
      kind: understood.kind as 'expense' | 'income' | 'transfer' | undefined,
      merchant: understood.merchant as string | undefined,
      category: understood.category as string | undefined,
      occurredOn: understood.occurred_on as string | undefined
    },
    missingField: raw.missing_field as CaptureClarification['missingField'],
    question: raw.question,
    explanation: raw.explanation,
    choices,
    warnings,
    parserSource: raw.parser_source
  }
}

export function isCaptureClarification(result: CaptureResult): result is CaptureClarification {
  return 'outcome' in result && result.outcome === 'clarification'
}

function toApiDraft(draft: TransactionDraft): JsonObject {
  const memberTotalPaise = draft.memberSplits.reduce((sum, split) => sum + split.amountPaise, 0)
  const reviewedEvidence = draft.metadata
    ? Object.entries(draft.metadata.evidence).filter(([field]) => (
        (field !== 'platform' || Boolean(draft.platform?.trim()))
        && (field !== 'subcategory' || Boolean(draft.subcategory?.trim()))
      ))
    : []
  const reviewedMetadata = draft.metadata ? {
    version: 1,
    evidence: Object.fromEntries(reviewedEvidence.map(([field, evidence]) => [field, {
      source: 'user_corrected',
      confidence: evidence?.confidence,
      review_status: 'reviewed'
    }])),
    attributes: draft.metadata.attributes.filter((attribute) => (
      attribute.value.trim()
      && (attribute.key !== 'order_channel' || Boolean(draft.platform?.trim()))
    )).map((attribute) => ({
      key: attribute.key,
      value: attribute.value,
      source: 'user_corrected',
      confidence: attribute.confidence,
      review_status: 'reviewed'
    }))
  } : undefined
  return {
    kind: draft.kind === 'transfer' ? 'transfer' : draft.kind === 'credit' ? 'income' : 'expense',
    amount_paise: draft.amountPaise,
    description: draft.merchant,
    category: draft.category,
    paid_by_member_id: null,
    personal_share_paise: draft.amountPaise - memberTotalPaise,
    splits: draft.memberSplits.map((split) => ({ member_id: apiEntityId(split.memberId), amount_paise: split.amountPaise })),
    occurred_at: `${draft.occurredAt}T12:00:00Z`,
    notes: draft.note || null,
    source_account_id: draft.sourceAccountId,
    destination_account_id: draft.destinationAccountId ?? null,
    platform: draft.kind === 'debit' ? draft.platform ?? null : null,
    subcategory: draft.kind === 'debit' ? draft.subcategory ?? null : null,
    metadata: draft.kind === 'debit' ? reviewedMetadata ?? null : null,
    tags: draft.kind === 'debit' ? (draft.tags ?? []).filter((tag) => tag.selected).map((tag) => ({
      name: tag.name,
      normalized_name: tag.normalizedName,
      source: 'user_corrected',
      confidence: tag.confidence,
      review_status: 'reviewed'
    })) : []
  }
}

function accountNameMap(raw: unknown): Map<string, string> {
  const rows = Array.isArray(raw) ? raw : []
  return new Map(rows.flatMap((item) => {
    const account = item as JsonObject
    const id = entityId(account.id)
    return id !== undefined ? [[String(id), stringValue(account.name, 'Account')] as const] : []
  }))
}

function memberNameMap(raw: unknown): Map<string, string> {
  const rows = Array.isArray(raw) ? raw : []
  return new Map(rows.flatMap((item) => {
    const member = item as JsonObject
    const id = member.id ?? member.member_id
    const normalizedId = entityId(id)
    return normalizedId !== undefined ? [[String(normalizedId), stringValue(member.name ?? member.member_name, 'Household member')] as const] : []
  }))
}

function mapMembers(raw: unknown): HouseholdMember[] {
  return [...memberNameMap(raw)].map(([id, name]) => ({ id: String(id), name }))
}

function monthlyFromTransactions(rows: JsonObject[]): MonthlyPoint[] {
  const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short' })
  const now = new Date()
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const matching = rows.filter((row) => stringValue(row.occurred_at, '').startsWith(key))
    return {
      month: monthFormat.format(date),
      incomePaise: matching.filter((row) => row.kind === 'income').reduce((sum, row) => sum + numberValue(row.personal_share_paise), 0),
      spendPaise: matching.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + numberValue(row.personal_share_paise), 0)
    }
  })
}

export async function bootstrapDemo(): Promise<void> {
  if (!API_URL) return
  await request('/api/v1/demo/bootstrap', { method: 'POST' })
}

export async function setupOnboarding(accounts: AccountSetupInput[], members: Array<{ name: string }>, displayName = 'You', householdName = 'My household'): Promise<HouseholdMember[]> {
  const response = await request<JsonObject>('/api/v1/onboarding/setup', {
    method: 'POST',
    body: JSON.stringify({ accounts, members, display_name: displayName, household_name: householdName })
  })
  return mapMembers(response.members)
}

export async function isOnboardingComplete(): Promise<boolean> {
  if (DEMO_MODE) return true
  try {
    await request<unknown>('/api/v1/accounts')
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return false
    throw error
  }
}

export async function getMembers(): Promise<HouseholdMember[]> {
  return mapMembers(await request<unknown>('/api/v1/members'))
}

export async function getUserProfile(): Promise<UserProfile> {
  const raw = await request<JsonObject>('/api/v1/profile')
  return {
    displayName: stringValue(raw.display_name, 'You'),
    householdName: stringValue(raw.household_name, 'My household'),
    members: mapMembers(raw.members),
    isDemo: raw.is_demo === true
  }
}

function mapRecoverySummary(raw: JsonObject): RecoverySummary {
  return {
    sha256: stringValue(raw.sha256, ''),
    householdName: stringValue(raw.household_name, 'Restored household'),
    eligible: raw.eligible === true,
    blocker: typeof raw.blocker === 'string' ? safeText(raw.blocker, '', 240) : null,
    counts: {
      members: numberValue(raw.members),
      accounts: numberValue(raw.accounts),
      categories: numberValue(raw.categories),
      transactions: numberValue(raw.transactions),
      splits: numberValue(raw.splits),
      transfers: numberValue(raw.transfers),
      settlements: numberValue(raw.settlements),
      merchantRules: numberValue(raw.merchant_rules),
      auditEvents: numberValue(raw.audit_events)
    }
  }
}

export async function getRecoveryExport(): Promise<RecoveryBundle> {
  const bundle = await request<unknown>('/api/v1/recovery/export')
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('Artha returned an invalid recovery bundle.')
  return bundle as RecoveryBundle
}

export async function previewRecoveryBundle(bundle: RecoveryBundle): Promise<RecoverySummary> {
  const response = await request<JsonObject>('/api/v1/recovery/preview', {
    method: 'POST',
    body: JSON.stringify(bundle)
  })
  return mapRecoverySummary(response)
}

export async function restoreRecoveryBundle(bundle: RecoveryBundle, idempotencyKey: string = crypto.randomUUID()): Promise<RecoveryRestoreResult> {
  const response = await request<JsonObject>('/api/v1/recovery/restore', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(bundle)
  })
  return {
    householdId: stringValue(response.household_id, ''),
    restored: response.restored === true,
    idempotentReplay: response.idempotent_replay === true,
    sha256: stringValue(response.sha256, '')
  }
}

export async function getAccounts(): Promise<LedgerAccount[]> {
  try {
    const raw = await request<unknown>('/api/v1/accounts')
    const rows = Array.isArray(raw) ? raw : Array.isArray((raw as JsonObject)?.items) ? (raw as JsonObject).items as unknown[] : []
    return rows.flatMap((item) => {
      const account = item as JsonObject
      const id = entityId(account.id)
      if (!id) return []
      const rawKind = stringValue(account.kind ?? account.type, 'bank')
      const kind: LedgerAccount['kind'] = rawKind === 'cash' || rawKind === 'wallet' || rawKind === 'credit_card' ? rawKind : 'bank'
      return [{ id, name: stringValue(account.name, 'Account'), kind }]
    })
  } catch (error) {
    if (!DEMO_MODE) throw error
    return [
      { id: 'demo-hdfc-upi', name: 'HDFC UPI', kind: 'bank' },
      { id: 'demo-icici-bank', name: 'ICICI Bank', kind: 'bank' },
      { id: 'demo-hdfc-card', name: 'HDFC Card', kind: 'credit_card' }
    ]
  }
}

function mapCaptureContext(raw: unknown): CaptureContext {
  if (!isJsonObject(raw) || !Array.isArray(raw.accounts) || !Array.isArray(raw.categories)) {
    throw new Error('Capture context response was invalid.')
  }
  const accounts: CaptureAccount[] = []
  for (const item of raw.accounts) {
    if (!isJsonObject(item) || !hasExactKeys(item, ['id', 'name', 'kind'], ['id', 'name', 'kind'])) {
      throw new Error('Capture context response was invalid.')
    }
    const id = entityId(item.id)
    const kind = item.kind
    if (
      id === undefined
      || !isBoundedText(item.name, 100)
      || (kind !== 'bank' && kind !== 'cash' && kind !== 'wallet' && kind !== 'credit_card' && kind !== 'other')
    ) {
      throw new Error('Capture context response was invalid.')
    }
    accounts.push({ id, name: item.name, kind })
  }
  const categories: CaptureCategory[] = []
  for (const item of raw.categories) {
    if (!isJsonObject(item) || !hasExactKeys(item, ['id', 'name', 'kind'], ['id', 'name', 'kind'])) {
      throw new Error('Capture context response was invalid.')
    }
    const id = entityId(item.id)
    const kind = item.kind
    if (
      id === undefined
      || !isBoundedText(item.name, 80)
      || (kind !== 'expense' && kind !== 'income' && kind !== 'both')
    ) {
      throw new Error('Capture context response was invalid.')
    }
    categories.push({ id, name: item.name, kind })
  }
  return { accounts, categories }
}

export async function getCaptureContext(): Promise<CaptureContext> {
  try {
    return mapCaptureContext(await request<unknown>('/api/v1/capture-context'))
  } catch (error) {
    if (!DEMO_MODE) throw error
    return {
      accounts: [
        { id: 'demo-hdfc-upi', name: 'HDFC UPI', kind: 'bank' },
        { id: 'demo-icici-bank', name: 'ICICI Bank', kind: 'bank' },
        { id: 'demo-hdfc-card', name: 'HDFC Card', kind: 'credit_card' }
      ],
      categories: [
        { id: 'demo-groceries', name: 'Groceries', kind: 'expense' },
        { id: 'demo-food-dining', name: 'Food & Dining', kind: 'expense' },
        { id: 'demo-housing', name: 'Housing', kind: 'expense' },
        { id: 'demo-transport', name: 'Transport', kind: 'expense' },
        { id: 'demo-shopping', name: 'Shopping', kind: 'expense' },
        { id: 'demo-salary', name: 'Salary', kind: 'income' },
        { id: 'demo-other', name: 'Other', kind: 'both' }
      ]
    }
  }
}

export async function chatAssistant(message: string): Promise<AssistantReply> {
  const response = await request<JsonObject>('/api/v1/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({ message })
  })
  if (
    !hasExactKeys(response, ['provider', 'model', 'mode', 'result'], ['provider', 'model', 'mode', 'result'])
    || response.mode !== 'model'
    || !ASSISTANT_PROVIDERS.has(String(response.provider))
    || !isBoundedText(response.model, 80)
    || !isJsonObject(response.result)
    || !hasExactKeys(response.result, ['message', 'intent', 'widgets'], ['message', 'intent', 'widgets'])
  ) {
    throw new Error('Assistant response was invalid.')
  }
  const result = response.result
  const rawWidgets = result.widgets
  const rawMessage = result.message
  const intent = safeText(result.intent)
  if (
    !isAssistantIntent(intent)
    || !Array.isArray(rawWidgets)
    || rawWidgets.length < 1
    || rawWidgets.length > 5
    || typeof rawMessage !== 'string'
    || rawMessage !== APPROVED_ASSISTANT_MESSAGES[intent]
  ) {
    throw new Error('Assistant response was invalid.')
  }
  const assistantMessage = rawMessage
  const widgets = rawWidgets.map(parseAssistantWidget)
  if (widgets.some((widget) => widget === null)) throw new Error('Assistant response was invalid.')
  const provider = response.provider as 'gemini' | 'ollama'
  const model = response.model as string
  return {
    message: assistantMessage,
    widgets: widgets as AssistantWidget[],
    provider: `${provider} · ${model}`
  }
}

export async function getAssistantStatus(): Promise<AssistantRuntimeStatus> {
  const raw = await request<JsonObject>('/api/v1/assistant/status')
  const dataPolicy = raw.data_policy === 'private_approved' ? 'private_approved' : 'sample_only'
  return {
    configured: raw.configured === true,
    provider: stringValue(raw.provider, 'disabled'),
    model: typeof raw.model === 'string' && raw.model ? safeText(raw.model, '', 120) : null,
    available: raw.available === true,
    dataPolicy,
    personalDataEnabled: raw.personal_data_enabled === true,
    isDemo: raw.is_demo === true
  }
}

export async function getDashboard(): Promise<{ data: Dashboard; demo: boolean }> {
  try {
    const raw = await request<JsonObject>('/api/v1/dashboard')
    const recentRaw = Array.isArray(raw.recent_transactions ?? raw.recentTransactions) ? (raw.recent_transactions ?? raw.recentTransactions) as JsonObject[] : []
    const names = accountNameMap(raw.accounts)
    const membersRaw = Array.isArray(raw.member_balances) ? raw.member_balances : []
    const memberNames = memberNameMap(membersRaw)
    const memberBalances: MemberBalance[] = membersRaw.map((item) => {
      const balance = item as JsonObject
      const id = String(entityId(balance.member_id) ?? '')
      return { id, name: stringValue(balance.member_name, memberNames.get(id) ?? 'Household member'), balancePaise: numberValue(balance.balance_paise), status: stringValue(balance.status, '') }
    })
    const monthlyRaw = Array.isArray(raw.monthly) ? raw.monthly : []
    const monthly: MonthlyPoint[] = monthlyRaw.map((item) => {
      const point = item as JsonObject
      return {
        month: stringValue(point.month, ''),
        incomePaise: numberValue(point.income_paise ?? point.incomePaise),
        spendPaise: numberValue(point.spend_paise ?? point.spendPaise)
      }
    })
    return {
      data: {
        availablePaise: numberValue(raw.total_balance_paise ?? raw.available_paise ?? raw.availablePaise),
        incomePaise: numberValue(raw.income_paise ?? raw.incomePaise),
        spendPaise: numberValue(raw.spend_paise ?? raw.spendPaise),
        sharedBalancePaise: memberBalances.reduce((sum, balance) => sum + balance.balancePaise, 0),
        memberBalances,
        monthly: monthly.length ? monthly : monthlyFromTransactions(recentRaw),
        recentTransactions: recentRaw.map((item) => mapTransaction(item, names, memberNames))
      },
      demo: false
    }
  } catch (error) {
    if (!DEMO_MODE) throw error
    return { data: demoDashboard, demo: true }
  }
}

export async function getTransactions(): Promise<{ data: Transaction[]; demo: boolean }> {
  try {
    const [raw, accounts, members] = await Promise.all([
      request<unknown>('/api/v1/transactions'),
      request<unknown>('/api/v1/accounts'),
      request<unknown>('/api/v1/members')
    ])
    const rows = Array.isArray(raw) ? raw : Array.isArray((raw as JsonObject)?.items) ? (raw as JsonObject).items as unknown[] : []
    const names = accountNameMap(accounts)
    const memberNames = memberNameMap(members)
    return { data: rows.map((item) => mapTransaction(item as JsonObject, names, memberNames)), demo: false }
  } catch (error) {
    if (!DEMO_MODE) throw error
    return { data: demoTransactions, demo: true }
  }
}

export async function parseDraft(text: string, membersForFallback: HouseholdMember[] = []): Promise<{ data: CaptureResult; demo: boolean }> {
  try {
    const [response, accounts, members] = await Promise.all([
      request<JsonObject>('/api/v1/drafts/parse', {
        method: 'POST',
        body: JSON.stringify({ text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      }),
      request<unknown>('/api/v1/accounts'),
      request<unknown>('/api/v1/members')
    ])
    if (response.outcome === 'clarification') {
      const clarification = mapCaptureClarification(response)
      if (!clarification) throw new Error('Capture clarification was invalid')
      return { data: clarification, demo: false }
    }
    const rawDraft = (response.draft ?? response) as JsonObject
    const memberNames = memberNameMap(members)
    const draft = mapDraft(rawDraft, text, memberNames, response.confidence, response.warnings)
    const names = accountNameMap(accounts)
    return {
      data: {
        ...draft,
        account: draft.sourceAccountId !== undefined ? names.get(String(draft.sourceAccountId)) ?? draft.account : draft.account
      },
      demo: false
    }
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error
    if (DEMO_MODE) return { data: parseCaptureLocally(text, membersForFallback), demo: true }
    throw new CaptureDraftUnavailableError(text, { cause: error })
  }
}

export async function confirmDraft(draft: TransactionDraft, idempotencyKey: string = crypto.randomUUID()): Promise<Transaction> {
  try {
    const raw = await request<JsonObject>('/api/v1/transactions/confirm', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(toApiDraft(draft))
    })
    return {
      ...mapTransaction(raw),
      account: draft.account,
      destinationAccount: draft.destinationAccount,
      destinationAccountId: draft.destinationAccountId,
      memberSplits: draft.memberSplits
    }
  } catch (error) {
    if (API_URL && (error instanceof ApiError || !DEMO_MODE)) throw error
    return {
      id: `demo-${Date.now()}`,
      kind: draft.kind,
      amountPaise: draft.amountPaise,
      personalSharePaise: draft.amountPaise - draft.memberSplits.reduce((sum, split) => sum + split.amountPaise, 0),
      merchant: draft.merchant,
      category: draft.category,
      account: draft.account,
      sourceAccountId: draft.sourceAccountId,
      destinationAccount: draft.destinationAccount,
      destinationAccountId: draft.destinationAccountId,
      occurredAt: draft.occurredAt,
      note: draft.note || undefined,
      memberSplits: draft.memberSplits,
      status: 'confirmed'
    }
  }
}

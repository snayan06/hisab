import { ArrowLeft, Check, ChevronRight, Info, RotateCcw, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card } from '../components/ui'
import { CaptureClarificationCard } from '../components/CaptureClarificationCard'
import { TransactionMetadataReview } from '../components/TransactionMetadataReview'
import { CaptureDraftUnavailableError, getCaptureContext, isCaptureClarification, parseDraft } from '../lib/api'
import { formatMoney, rupeesToPaise } from '../lib/money'
import { localDateOffset } from '../lib/date'
import { useRouter } from '../lib/router'
import type { CaptureCategory, CaptureChoice, CaptureClarification, CaptureContext, HouseholdMember, LedgerAccount, Transaction, TransactionDraft, TransactionKind } from '../types'

export function QuickAddPage({ onConfirm, members }: { onConfirm: (draft: TransactionDraft, idempotencyKey?: string) => Promise<Transaction>; members: HouseholdMember[] }) {
  const { state, navigate, back } = useRouter()
  const initialCapture = (state as { capture?: string } | null)?.capture ?? ''
  const [capture, setCapture] = useState(initialCapture)
  const [draft, setDraft] = useState<TransactionDraft | null>(null)
  const [clarification, setClarification] = useState<CaptureClarification | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseStatusIndex, setParseStatusIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<Transaction | null>(null)
  const [error, setError] = useState('')
  const [usedFallback, setUsedFallback] = useState(false)
  const [context, setContext] = useState<CaptureContext | null>(null)
  const [contextStatus, setContextStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [contextError, setContextError] = useState('')
  const contextRef = useRef<CaptureContext | null>(null)
  const parseGeneration = useRef(0)
  const confirmationAttempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  const manualRecoveryFocusPending = useRef(false)
  const starterPrompts = [members[0] ? `Paid 850 for dinner yesterday, split with ${members[0].name}` : 'Paid 850 for dinner yesterday', 'Received 45,000 salary today in ICICI Bank', 'Spent 320 on Uber from HDFC Card']

  useEffect(() => {
    void loadContext()
  }, [])

  useEffect(() => {
    if (initialCapture) void makeDraft(initialCapture)
    // The initial route state is intentionally parsed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (success || (!capture.trim() && !draft)) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [capture, draft, success])

  useEffect(() => {
    if (!draft || !manualRecoveryFocusPending.current) return
    reviewHeadingRef.current?.focus()
    manualRecoveryFocusPending.current = false
  }, [draft])

  useEffect(() => {
    if (!parsing) {
      setParseStatusIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setParseStatusIndex((current) => Math.min(current + 1, 2))
    }, 650)
    return () => window.clearInterval(timer)
  }, [parsing])

  async function makeDraft(text = capture) {
    if (!text.trim()) return
    const generation = ++parseGeneration.current
    setParsing(true)
    setError('')
    try {
      const response = await parseDraft(text, members)
      if (generation !== parseGeneration.current) return
      if (isCaptureClarification(response.data)) {
        setDraft(null)
        setClarification(response.data)
        setUsedFallback(false)
        return
      }
      setClarification(null)
      setDraft(groundDraft(response.data, contextRef.current))
      setUsedFallback(response.demo)
    } catch (caught) {
      if (generation !== parseGeneration.current) return
      if (caught instanceof CaptureDraftUnavailableError) {
        manualRecoveryFocusPending.current = true
        startManualEntry(caught.sourceText)
        setError(`${caught.message} Your text is still here; enter the remaining details below. Nothing was saved.`)
      } else {
        setError(userFacingFailure(caught, 'We could not read that. Try including an amount and what it was for.'))
      }
    } finally {
      if (generation === parseGeneration.current) setParsing(false)
    }
  }

  async function confirm() {
    if (!draft || !canConfirmDraft(draft, contextRef.current, contextStatus)) return
    setSaving(true)
    setError('')
    try {
      const fingerprint = JSON.stringify(draft)
      if (confirmationAttempt.current?.fingerprint !== fingerprint) {
        confirmationAttempt.current = { fingerprint, key: crypto.randomUUID() }
      }
      const transaction = await onConfirm(draft, confirmationAttempt.current.key)
      setSuccess(transaction)
    } catch (caught) {
      setError(userFacingFailure(caught, 'This draft was not saved. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  function restart() {
    invalidatePendingParse()
    setCapture('')
    setDraft(null)
    setClarification(null)
    setSuccess(null)
    confirmationAttempt.current = null
    setError('')
  }

  function startManualEntry(sourceText = '') {
    invalidatePendingParse()
    const loadedContext = contextRef.current
    const firstAccount = loadedContext?.accounts[0]
    const firstCategory = categoriesForKind(loadedContext, 'debit')[0]
    setDraft({ kind: 'debit', amountPaise: 0, merchant: '', category: firstCategory?.name ?? '', account: firstAccount?.name ?? '', sourceAccountId: firstAccount?.id, occurredAt: localDateOffset(0), note: '', memberSplits: [], confidence: 'review', sourceText })
    setClarification(null)
    setUsedFallback(false)
    setError('')
  }

  async function loadContext() {
    setContextStatus('loading')
    setContextError('')
    try {
      const loadedContext = await getCaptureContext()
      contextRef.current = loadedContext
      setContext(loadedContext)
      setDraft((current) => current ? groundDraft(current, loadedContext) : current)
      setContextStatus('ready')
    } catch {
      contextRef.current = null
      setContext(null)
      setContextStatus('error')
      setContextError('Accounts and categories are unavailable. Confirmation is disabled until they load successfully.')
    }
  }

  function changeKind(kind: TransactionKind) {
    invalidatePendingParse()
    setDraft((current) => {
      if (!current) return current
      const loadedContext = contextRef.current
      const source = accountForId(loadedContext, current.sourceAccountId) ?? loadedContext?.accounts[0]
      if (kind === 'transfer') {
        return {
          ...current,
          kind,
          category: 'Transfer',
          account: source?.name ?? '',
          sourceAccountId: source?.id,
          destinationAccount: undefined,
          destinationAccountId: undefined,
          memberSplits: [],
          platform: undefined,
          subcategory: undefined,
          categorySuggestion: undefined,
          metadata: undefined,
          tags: undefined
        }
      }
      const categories = categoriesForKind(loadedContext, kind)
      const category = matchingCategory(categories, current.category) ?? categories[0]
      return {
        ...current,
        kind,
        category: category?.name ?? '',
        account: source?.name ?? '',
        sourceAccountId: source?.id,
        destinationAccount: undefined,
        destinationAccountId: undefined,
        memberSplits: kind === 'credit' ? [] : current.memberSplits,
        ...(kind === 'credit' ? {
          platform: undefined,
          subcategory: undefined,
          categorySuggestion: undefined,
          metadata: undefined,
          tags: undefined
        } : {})
      }
    })
  }

  function leaveDraft() {
    if ((capture.trim() || draft) && !window.confirm('Discard this unsaved transaction draft?')) return
    back()
  }

  function invalidatePendingParse() {
    parseGeneration.current += 1
    setParsing(false)
  }

  function editDraft(nextDraft: TransactionDraft) {
    invalidatePendingParse()
    setDraft(nextDraft)
  }

  function chooseClarification(choice: CaptureChoice) {
    if (!clarification || parsing) return
    const continuedText = `${clarification.sourceText}; ${choice.answer}`
    setCapture(continuedText)
    setClarification(null)
    void makeDraft(continuedText)
  }

  if (success) {
    return (
      <div className="mx-auto max-w-xl pt-8 sm:pt-16">
        <Card className="p-6 text-center sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-moss-100 text-moss-800"><Check className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" /></div>
          <Badge tone="green"><span className="mr-1">●</span> Confirmed</Badge>
          <h1 className="font-display mt-4 text-2xl font-bold tracking-[-0.04em]">Added to your Artha</h1>
          <p className="font-display mt-3 text-4xl font-bold tracking-[-0.05em]">{formatMoney(success.amountPaise)}</p>
          <p className="mt-2 text-sm text-[#718078] tone-muted">{success.merchant} · {success.account}</p>
          {success.memberSplits.length > 0 && <div className="mt-4 flex flex-wrap justify-center gap-2">{success.memberSplits.map((split) => <p key={split.memberId} className="inline-flex items-center gap-1.5 rounded-xl bg-moss-50 px-3 py-2 text-xs font-semibold text-moss-800"><UsersRound className="h-4 w-4" aria-hidden="true" /> {split.memberName}: {formatMoney(split.amountPaise)}</p>)}</div>}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button variant="secondary" onClick={restart} icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}>Add another</Button>
            <Button onClick={() => navigate('/')}>Back home <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </Card>
      </div>
    )
  }

  const accounts = context?.accounts ?? []
  const categoryOptions = draft ? categoriesForKind(context, draft.kind) : []
  const selectedCategory = draft ? matchingCategory(categoryOptions, draft.category) : undefined
  const confirmationDisabled = !draft || !canConfirmDraft(draft, context, contextStatus)
  const confirmationBlocker = draft ? confirmationBlockerFor(draft, context, contextStatus) : ''
  const showsMetadataReview = Boolean(
    draft?.kind === 'debit'
    && (draft.metadata || draft.platform || draft.subcategory || draft.categorySuggestion || draft.tags?.length)
  )
  const parseStatuses = [
    'Reading the amount, date and description…',
    'Matching your accounts, category and shared context…',
    'Preparing a review you can edit before anything is saved…'
  ]

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={leaveDraft} className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl py-2 pr-3 text-sm font-semibold text-[#66736d] tone-muted transition hover:text-moss-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-moss-700"><Sparkles className="h-4 w-4" aria-hidden="true" /> Quick add</div>
        <h1 className="font-display mt-2 text-balance text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Tell us what happened.</h1>
        <p className="mt-2 text-sm text-[#718078] tone-muted">Write naturally. You’ll review every detail before it is saved.</p>
      </div>

      <div role="note" aria-label="AI-assisted capture" className="mb-4 rounded-2xl border border-moss-200 bg-moss-50 px-4 py-3 text-xs leading-5 text-moss-900 dark:border-night-border dark:bg-night-raised dark:text-night-ink"><strong>AI-assisted.</strong> Artha sends this text to the configured AI provider to prepare a reviewable result. Nothing is written to your ledger until you confirm. <a href="/settings" className="font-semibold underline underline-offset-2">Settings</a> has details.</div>

      <Card className="p-4 sm:p-5">
        <label htmlFor="capture" className="text-xs font-bold uppercase tracking-[0.12em] text-[#78847e] tone-muted">Your message</label>
        <textarea id="capture" name="transaction-capture" autoComplete="off" rows={3} value={capture} onChange={(event) => { invalidatePendingParse(); setCapture(event.target.value) }} onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); if (!capture.trim() || parsing) return; void makeDraft() }} placeholder={`${members[0] ? `Paid 1,840 for groceries yesterday, split with ${members[0].name}` : 'Paid 1,840 for groceries yesterday'}…`} className="mt-2 w-full resize-none rounded-2xl border border-line bg-[#fafbf9] p-4 text-base leading-6 outline-none transition placeholder:text-[#a0aaa4] tone-subtle focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100 dark:bg-night-input" />
        <p className="mt-2 text-xs text-[#7b8781] tone-muted">Enter to continue · Shift+Enter for a new line.</p>
        <div className="mt-3 grid gap-2 sm:flex"><Button className="w-full sm:w-auto" disabled={!capture.trim()} loading={parsing} onClick={() => void makeDraft()}>Create review draft <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button><Button variant="secondary" className="w-full sm:w-auto" onClick={() => startManualEntry()}>Enter details manually</Button></div>
        {!draft && !clarification && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a958f] tone-subtle">Try an example</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {starterPrompts.map((prompt) => <button key={prompt} onClick={() => { setCapture(prompt); void makeDraft(prompt) }} className="min-h-11 shrink-0 rounded-full border border-line bg-white px-3 py-2 text-xs text-[#5d6a64] tone-muted transition hover:border-moss-300 hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400">{prompt}</button>)}
            </div>
          </div>
        )}
      </Card>

      {parsing && <p role="status" aria-live="polite" className="mt-4 rounded-2xl border border-moss-200 bg-moss-50 px-4 py-3 text-sm text-moss-900 dark:border-night-border dark:bg-night-raised dark:text-night-ink">✨ {parseStatuses[parseStatusIndex]}</p>}

      {contextStatus === 'loading' && <p role="status" aria-live="polite" className="mt-4 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-[#66736d] tone-muted">Loading accounts and categories…</p>}
      {contextStatus === 'error' && <div role="alert" aria-live="assertive" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><p>{contextError}</p><Button variant="secondary" className="mt-3" onClick={() => void loadContext()}>Try again</Button></div>}

      {error && <div role="alert" aria-live="polite" className="mt-4 break-words rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {clarification && (
        <CaptureClarificationCard
          clarification={clarification}
          busy={parsing}
          onChoose={chooseClarification}
          onManual={() => startManualEntry(clarification.sourceText)}
        />
      )}

      {draft && (
        <section className="mt-5" aria-labelledby="review-heading">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#88938d] tone-subtle">Unsaved draft</p>
              <h2 ref={reviewHeadingRef} id="review-heading" tabIndex={-1} className="font-display mt-1 text-xl font-bold">Review the details</h2>
            </div>
            <Badge tone={draft.confidence === 'high' ? 'green' : 'amber'}>{draft.confidence === 'high' ? 'Looks good' : 'Needs review'}</Badge>
          </div>

          <Card className="overflow-hidden">
            <div className="bg-moss-50 p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-moss-700">{draft.kind === 'transfer' ? 'Money transferred' : draft.kind === 'credit' ? 'Money received' : 'Money spent'}</p>
              <div className="mt-2 flex items-center justify-center text-4xl font-bold tracking-[-0.05em]">
                <span className="mr-1 text-2xl text-moss-700">₹</span>
                <input name="amount-rupees" aria-label="Amount in rupees" type="number" inputMode="decimal" autoComplete="off" min="0" step="0.01" value={draft.amountPaise ? draft.amountPaise / 100 : ''} onChange={(event) => { const amountPaise = rupeesToPaise(Number(event.target.value) || 0); editDraft({ ...draft, amountPaise, memberSplits: equalSplits(amountPaise, draft.memberSplits.map((split) => split.memberId), members) }) }} className="min-h-11 w-40 border-0 bg-transparent text-center outline-none focus-visible:ring-2 focus-visible:ring-moss-400" />
              </div>
            </div>

            <div className="grid gap-x-4 p-5 sm:grid-cols-2">
              <fieldset className="mb-4 sm:col-span-2">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">Transaction type</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {([['Expense', 'debit'], ['Income', 'credit'], ['Transfer', 'transfer']] as const).map(([label, kind]) => <label key={kind} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-semibold transition ${draft.kind === kind ? 'border-moss-700 bg-moss-100 text-moss-900' : 'border-line bg-white text-[#68756e] tone-muted'}`}><input className="sr-only" type="radio" name="transaction-type" value={kind} checked={draft.kind === kind} onChange={() => changeKind(kind)} />{label}</label>)}
                </div>
              </fieldset>
              {!showsMetadataReview && <DraftField label="Description" value={draft.merchant} required maxLength={240} onChange={(value) => editDraft({ ...draft, merchant: value })} />}
              {draft.kind === 'transfer'
                ? <ReadOnlyField label="Category" value="Transfer" />
                : <CategoryField categories={categoryOptions} selected={selectedCategory} onChange={(category) => editDraft({
                    ...draft,
                    category: category.name,
                    categorySuggestion: undefined,
                    metadata: draft.metadata ? {
                      ...draft.metadata,
                      evidence: {
                        ...draft.metadata.evidence,
                        category: {
                          source: 'user_corrected',
                          confidence: 1,
                          reviewStatus: 'needs_review'
                        }
                      }
                    } : draft.metadata
                  })} />}
              <AccountField label={draft.kind === 'transfer' ? 'Transfer from' : draft.kind === 'credit' ? 'Received in' : 'Paid from'} ariaLabel={draft.kind === 'transfer' ? 'Transfer from account' : draft.kind === 'credit' ? 'Received in account' : 'Paid from account'} accounts={accounts} selectedId={draft.sourceAccountId} onChange={(account) => editDraft({ ...draft, account: account.name, sourceAccountId: account.id })} />
              {draft.kind === 'transfer' && <AccountField label="Transfer to" ariaLabel="Transfer to account" accounts={accounts} selectedId={draft.destinationAccountId} onChange={(account) => editDraft({ ...draft, destinationAccount: account.name, destinationAccountId: account.id })} />}
              <DateField value={draft.occurredAt} onChange={(value) => editDraft({ ...draft, occurredAt: value })} />
              {draft.kind === 'transfer' && (!draft.destinationAccountId || sameEntityId(draft.destinationAccountId, draft.sourceAccountId)) && <p className="mb-4 text-xs text-amber-800 sm:col-span-2">Choose a destination account that is different from the source.</p>}
            </div>

            {showsMetadataReview && <TransactionMetadataReview draft={draft} onChange={editDraft} />}

            {draft.kind === 'debit' && members.length > 0 && <div className="mx-5 mb-5 rounded-2xl border border-moss-200 bg-moss-50 p-4">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-moss-800"><UsersRound className="h-4 w-4" aria-hidden="true" /></span><span><span className="block text-sm font-semibold">Share this expense</span><span className="mt-0.5 block text-xs text-[#748079] tone-muted">Choose anyone involved. Shares are equal in V1.</span></span></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">{members.map((member) => { const checked = draft.memberSplits.some((split) => split.memberId === member.id); return <label key={member.id} className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl border border-moss-200 bg-white px-3 text-sm font-semibold"><span className="truncate">{member.name}</span><input type="checkbox" aria-label={`Share with ${member.name}`} checked={checked} onChange={(event) => { const selected = event.target.checked ? [...draft.memberSplits.map((split) => split.memberId), member.id] : draft.memberSplits.map((split) => split.memberId).filter((id) => id !== member.id); editDraft({ ...draft, memberSplits: equalSplits(draft.amountPaise, selected, members) }) }} className="h-5 w-5 accent-moss-800" /></label> })}</div>
              {draft.memberSplits.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-moss-200 pt-4 text-center text-xs">
                  <div><p className="text-[#7a867f] tone-muted">Account moves</p><p className="mt-1 font-bold">−{formatMoney(draft.amountPaise)}</p></div>
                  <div><p className="text-[#7a867f] tone-muted">Your share</p><p className="mt-1 font-bold">{formatMoney(draft.amountPaise - draft.memberSplits.reduce((sum, split) => sum + split.amountPaise, 0))}</p></div>
                  <div><p className="text-[#7a867f] tone-muted">Family share</p><p className="mt-1 font-bold text-moss-800">{formatMoney(draft.memberSplits.reduce((sum, split) => sum + split.amountPaise, 0))}</p></div>
                </div>
              )}
            </div>}

            <div className="border-t border-line bg-[#fbfcfa] p-5 dark:bg-night-raised">
              <div className="mb-4 flex items-start gap-2 text-xs text-[#6f7b75] tone-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-moss-700" aria-hidden="true" /><p><strong className="text-ink">Nothing has been saved yet.</strong> Confirm only after these details look right.{usedFallback && ' Parsed safely on this device while the API is unavailable.'}</p></div>
              {confirmationBlocker && <p role="status" aria-live="polite" className="mb-3 text-xs text-amber-800">{confirmationBlocker}</p>}
              <Button onClick={() => void confirm()} loading={saving} disabled={confirmationDisabled} className="w-full" icon={<Check className="h-4 w-4" aria-hidden="true" />}>Confirm and add transaction</Button>
            </div>
          </Card>
          {draft.confidence === 'review' && <div className="mt-3 flex items-start gap-2 text-xs text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><p>One or more fields need review. Please check them carefully.</p>{draft.warnings && draft.warnings.length > 0 && <ul className="mt-1 list-disc pl-4">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div></div>}
        </section>
      )}
    </div>
  )
}

function userFacingFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && /Artha (?:took too long|could not reach the API)/i.test(error.message)) {
    return `${error.message} Nothing was saved.`
  }
  if (error instanceof Error && error.message && !/^API request failed/i.test(error.message)) {
    return error.message
  }
  return fallback
}

function equalSplits(amountPaise: number, selectedIds: string[], members: HouseholdMember[]): TransactionDraft['memberSplits'] {
  const uniqueIds = [...new Set(selectedIds)]
  const sharePaise = uniqueIds.length ? Math.floor(amountPaise / (uniqueIds.length + 1)) : 0
  return uniqueIds.flatMap((memberId) => {
    const member = members.find((item) => item.id === memberId)
    return member ? [{ memberId, memberName: member.name, amountPaise: sharePaise }] : []
  })
}

function accountForId(context: CaptureContext | null, id: TransactionDraft['sourceAccountId']): CaptureContext['accounts'][number] | undefined {
  if (id === undefined) return undefined
  return context?.accounts.find((account) => sameEntityId(account.id, id))
}

function categoriesForKind(context: CaptureContext | null, kind: TransactionKind): CaptureCategory[] {
  if (!context || kind === 'transfer') return []
  const direction = kind === 'credit' ? 'income' : 'expense'
  return context.categories.filter((category) => category.kind === direction || category.kind === 'both')
}

function matchingCategory(categories: CaptureCategory[], name: string): CaptureCategory | undefined {
  const normalized = name.trim().toLocaleLowerCase()
  return categories.find((category) => category.name.toLocaleLowerCase() === normalized)
}

function sameEntityId(left: TransactionDraft['sourceAccountId'], right: TransactionDraft['sourceAccountId']): boolean {
  return left !== undefined && right !== undefined && String(left) === String(right)
}

function groundDraft(draft: TransactionDraft, context: CaptureContext | null): TransactionDraft {
  if (!context) return draft
  const source = accountForId(context, draft.sourceAccountId)
    ?? (draft.sourceAccountId === undefined ? context.accounts[0] : undefined)
  const destination = accountForId(context, draft.destinationAccountId)
  if (draft.kind === 'transfer') {
    return {
      ...draft,
      category: 'Transfer',
      account: source?.name ?? draft.account,
      sourceAccountId: source?.id ?? draft.sourceAccountId,
      destinationAccount: destination?.name ?? draft.destinationAccount,
      memberSplits: []
    }
  }
  const category = matchingCategory(categoriesForKind(context, draft.kind), draft.category)
    ?? (!draft.category ? categoriesForKind(context, draft.kind)[0] : undefined)
  return {
    ...draft,
    account: source?.name ?? draft.account,
    sourceAccountId: source?.id ?? draft.sourceAccountId,
    category: category?.name ?? draft.category
  }
}

function canConfirmDraft(
  draft: TransactionDraft,
  context: CaptureContext | null,
  contextStatus: 'loading' | 'ready' | 'error'
): boolean {
  if (contextStatus !== 'ready' || !context) return false
  if (draft.amountPaise <= 0 || !draft.merchant.trim() || draft.merchant.length > 240) return false
  if (!isValidTransactionDate(draft.occurredAt)) return false
  if (!accountForId(context, draft.sourceAccountId)) return false
  if (draft.kind === 'transfer') {
    return draft.category === 'Transfer'
      && draft.memberSplits.length === 0
      && Boolean(accountForId(context, draft.destinationAccountId))
      && !sameEntityId(draft.sourceAccountId, draft.destinationAccountId)
  }
  if (draft.kind === 'credit' && draft.memberSplits.length > 0) return false
  return Boolean(matchingCategory(categoriesForKind(context, draft.kind), draft.category))
}

function confirmationBlockerFor(
  draft: TransactionDraft,
  context: CaptureContext | null,
  contextStatus: 'loading' | 'ready' | 'error'
): string {
  if (contextStatus === 'loading') return 'Confirmation is disabled while accounts and categories load.'
  if (contextStatus === 'error' || !context) return 'Confirmation is disabled until accounts and categories are available.'
  if (draft.amountPaise <= 0) return 'Enter an amount greater than zero.'
  if (!draft.merchant.trim()) return 'Enter a description.'
  if (draft.merchant.length > 240) return 'Description must be 240 characters or fewer.'
  if (!isValidTransactionDate(draft.occurredAt)) return 'Enter a valid transaction date.'
  if (!accountForId(context, draft.sourceAccountId)) return 'Choose an active source account.'
  if (draft.kind === 'transfer') {
    if (!accountForId(context, draft.destinationAccountId) || sameEntityId(draft.sourceAccountId, draft.destinationAccountId)) {
      return 'Choose a different active destination account.'
    }
    return ''
  }
  if (!matchingCategory(categoriesForKind(context, draft.kind), draft.category)) {
    return 'Choose a category available for this transaction type.'
  }
  return ''
}

function isValidTransactionDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function DraftField({ label, value, type = 'text', required = false, maxLength, onChange }: { label: string; value: string; type?: string; required?: boolean; maxLength?: number; onChange: (value: string) => void }) {
  return (
    <label className="mb-4 block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">{label}</span>
      <input name={`draft-${label.toLowerCase().replaceAll(' ', '-')}`} autoComplete="off" type={type} required={required} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold outline-none focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100" />
    </label>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="mb-4"><span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">{label}</span><p className="mt-1.5 flex min-h-11 items-center rounded-xl border border-line bg-[#f5f7f2] px-3 text-sm font-semibold">{value}</p></div>
}

function CategoryField({ categories, selected, onChange }: { categories: CaptureCategory[]; selected?: CaptureCategory; onChange: (category: CaptureCategory) => void }) {
  return (
    <label className="mb-4 block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">Category</span>
      <select name="draft-category" aria-label="Category" autoComplete="off" value={selected?.name ?? ''} onChange={(event) => { const category = categories.find((item) => item.name === event.target.value); if (category) onChange(category) }} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold outline-none focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100">
        {!selected && <option value="" disabled>Select a category</option>}
        {categories.map((category) => <option key={String(category.id)} value={category.name}>{category.name}</option>)}
      </select>
    </label>
  )
}

function AccountField({ label, ariaLabel, accounts, selectedId, onChange }: { label: string; ariaLabel: string; accounts: LedgerAccount[]; selectedId?: LedgerAccount['id']; onChange: (account: LedgerAccount) => void }) {
  const selectedIndex = accounts.findIndex((account) => sameEntityId(account.id, selectedId))
  return (
    <label className="mb-4 block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">{label}</span>
      <select name={ariaLabel.toLowerCase().replaceAll(' ', '-')} aria-label={ariaLabel} autoComplete="off" value={selectedIndex >= 0 ? String(selectedIndex) : ''} onChange={(event) => { const account = accounts[Number(event.target.value)]; if (account) onChange(account) }} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold outline-none focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100">
        {selectedIndex < 0 && <option value="" disabled>Select an account</option>}
        {accounts.map((account, index) => <option key={`${account.id ?? 'demo'}-${account.name}-${index}`} value={String(index)}>{account.name}</option>)}
      </select>
    </label>
  )
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const today = localDateOffset(0)
  const yesterday = localDateOffset(-1)
  return (
    <div className="mb-4">
      <label className="block"><span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#87928c] tone-subtle">Date</span><input name="transaction-date" aria-label="Transaction date" autoComplete="off" type="date" required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold outline-none focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100" /></label>
      <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => onChange(today)} aria-pressed={value === today} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 ${value === today ? 'border-moss-700 bg-moss-100 text-moss-900' : 'border-line bg-white text-[#68756e] tone-muted hover:bg-moss-50'}`}>Today</button><button type="button" onClick={() => onChange(yesterday)} aria-pressed={value === yesterday} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 ${value === yesterday ? 'border-moss-700 bg-moss-100 text-moss-900' : 'border-line bg-white text-[#68756e] tone-muted hover:bg-moss-50'}`}>Yesterday</button></div>
    </div>
  )
}

import { ArrowLeft, ArrowRight, Check, CreditCard, Landmark, Plus, ShieldCheck, Sparkles, Trash2, UsersRound, WalletCards } from 'lucide-react'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card } from '../components/ui'
import { RecoveryRestorePanel } from '../components/RecoveryPanel'
import { ThemeControl } from '../components/ThemeControl'
import { formatMoney, rupeesToPaise } from '../lib/money'
import type { AccountSetupInput, SetupAccountKind, UserProfile } from '../types'

interface MoneyRow {
  id: number
  name: string
  kind: Exclude<SetupAccountKind, 'credit_card'>
  balance: string
}

interface CardRow {
  id: number
  name: string
  outstanding: string
  limit: string
  statementDay: string
  paymentDueDay: string
}

interface MemberRow { id: number; name: string }

let nextRowId = 1
const newMoneyRow = (): MoneyRow => ({ id: nextRowId++, name: '', kind: 'bank', balance: '' })
const newCardRow = (): CardRow => ({ id: nextRowId++, name: '', outstanding: '', limit: '', statementDay: '', paymentDueDay: '' })
const newMemberRow = (): MemberRow => ({ id: nextRowId++, name: '' })

export function OnboardingPage({ onSave, onExploreDemo, onRestored, allowDemo = true }: { onSave: (accounts: AccountSetupInput[], profile: UserProfile) => Promise<void>; onExploreDemo: (profile: UserProfile) => Promise<void>; onRestored?: () => Promise<void>; allowDemo?: boolean }) {
  const [step, setStep] = useState<'accounts' | 'review'>('accounts')
  const [moneyRows, setMoneyRows] = useState<MoneyRow[]>(() => [newMoneyRow()])
  const [cardRows, setCardRows] = useState<CardRow[]>([])
  const [displayName, setDisplayName] = useState('You')
  const [householdName, setHouseholdName] = useState('My household')
  const [memberRows, setMemberRows] = useState<MemberRow[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const preparedAccounts = useMemo<AccountSetupInput[]>(() => [
    ...moneyRows.map((row) => ({
      name: row.name.trim(),
      kind: row.kind,
      opening_balance_paise: rupeesToPaise(Number(row.balance) || 0),
      credit_limit_paise: null,
      statement_day: null,
      payment_due_day: null
    })),
    ...cardRows.map((row) => ({
      name: row.name.trim(),
      kind: 'credit_card' as const,
      opening_balance_paise: -Math.abs(rupeesToPaise(Number(row.outstanding) || 0)),
      credit_limit_paise: rupeesToPaise(Number(row.limit) || 0),
      statement_day: row.statementDay ? Number(row.statementDay) : null,
      payment_due_day: row.paymentDueDay ? Number(row.paymentDueDay) : null
    }))
  ], [cardRows, moneyRows])

  const availablePaise = preparedAccounts.filter((account) => account.kind !== 'credit_card').reduce((sum, account) => sum + account.opening_balance_paise, 0)
  const outstandingPaise = Math.abs(preparedAccounts.filter((account) => account.kind === 'credit_card').reduce((sum, account) => sum + account.opening_balance_paise, 0))

  function validate(): boolean {
    if (!moneyRows.length) {
      setError('Add at least one bank, cash, or wallet account.')
      return false
    }
    const accountNames = [...moneyRows, ...cardRows].map((row) => row.name.trim().toLowerCase()).filter(Boolean)
    if (new Set(accountNames).size !== accountNames.length) {
      setError('Give every account and card a unique name.')
      return false
    }
    if (moneyRows.some((row) => !row.name.trim() || !isSupportedMoney(row.balance) || Number(row.balance) < 0)) {
      setError('Give every money account a name and a current balance of zero or more.')
      return false
    }
    if (cardRows.some((row) => !row.name.trim() || !isSupportedMoney(row.outstanding) || !isSupportedMoney(row.limit) || Number(row.outstanding) < 0 || Number(row.limit) <= 0)) {
      setError('Give every card a name, current outstanding, and credit limit.')
      return false
    }
    if (cardRows.some((row) => Number(row.outstanding) > Number(row.limit))) {
      setError('A card’s outstanding amount cannot be higher than its credit limit.')
      return false
    }
    if (cardRows.some((row) => [row.statementDay, row.paymentDueDay].some((day) => day !== '' && (Number(day) < 1 || Number(day) > 31 || !Number.isInteger(Number(day)))))) {
      setError('Statement and payment due days must be whole numbers from 1 to 31.')
      return false
    }
    if (memberRows.some((member) => !member.name.trim()) || new Set(memberRows.map((member) => member.name.trim().toLowerCase())).size !== memberRows.length) {
      setError('Give each family member a unique name, or remove the empty row.')
      return false
    }
    setError('')
    return true
  }

  function continueToReview() {
    if (validate()) setStep('review')
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    setError('')
    try {
      await onSave(preparedAccounts, { displayName: displayName.trim() || 'You', householdName: householdName.trim() || 'My household', members: memberRows.map((member) => ({ id: `draft-${member.id}`, name: member.name.trim() })), isDemo: false })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup could not be saved. Try again or explore the sample demo.')
    } finally {
      setSaving(false)
    }
  }

  async function exploreDemo() {
    setDemoLoading(true)
    setError('')
    try {
      await onExploreDemo({ displayName: displayName.trim() || 'You', householdName: householdName.trim() || 'My household', members: memberRows.map((member) => ({ id: `draft-${member.id}`, name: member.name.trim() })).filter((member) => member.name), isDemo: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The demo could not be prepared. Please try again.')
    } finally {
      setDemoLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas px-4 pb-12 pt-5 text-ink sm:px-6 sm:pt-10">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between">
          <div className="flex min-h-11 items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-moss-900 font-display text-xl font-bold text-white dark:bg-[#27604e]">H</span>
            <div><p className="font-display text-lg font-bold leading-none">Artha</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#839089] tone-subtle">Private ledger</p></div>
          </div>
          <div className="flex items-center gap-2"><ThemeControl /><Badge tone="green">Step {step === 'accounts' ? '1' : '2'} of 2</Badge></div>
        </header>

        {step === 'accounts' ? (
          <>
            <div className="mt-10 sm:mt-14">
              <div className="flex items-center gap-2 text-sm font-semibold text-moss-700"><Sparkles className="h-4 w-4" aria-hidden="true" /> Let’s set up your starting point</div>
              <h1 className="font-display mt-3 text-balance text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Where does your money live?</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#6e7b74] tone-muted">Add today’s balances. Artha stores them as opening entries, then keeps the total updated from confirmed transactions.</p>
            </div>

            {onRestored && <div className="mt-7"><RecoveryRestorePanel onRestored={onRestored} /></div>}

            {onRestored && <div className="my-7 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#819088] tone-subtle"><span className="h-px flex-1 bg-line" />or create a new ledger<span className="h-px flex-1 bg-line" /></div>}

            <Card className={`${onRestored ? '' : 'mt-7'} p-4 sm:p-5`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <SetupField label="Your display name" ariaLabel="Your display name" placeholder="You" value={displayName} onChange={setDisplayName} />
                <SetupField label="Household name" ariaLabel="Household name" placeholder="My household" value={householdName} onChange={setHouseholdName} />
              </div>
              <p className="mt-3 text-xs leading-5 text-[#748079] tone-muted">These names are saved with your private ledger and return after you sign in.</p>
            </Card>

            <section className="mt-7" aria-labelledby="members-heading">
              <div className="mb-3 flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h2 id="members-heading" className="font-display text-lg font-bold">Family members</h2><Badge>Optional</Badge></div><p className="mt-1 text-xs text-[#77837d] tone-muted">Add anyone you regularly split expenses with.</p></div><Button variant="secondary" className="shrink-0 px-3" onClick={() => setMemberRows((rows) => [...rows, newMemberRow()])} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add</Button></div>
              {memberRows.length === 0 ? <button onClick={() => setMemberRows([newMemberRow()])} className="flex min-h-20 w-full items-center gap-3 rounded-[22px] border border-dashed border-moss-300 bg-moss-50/50 px-4 text-left transition hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 dark:border-night-border dark:bg-night-raised"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-moss-800"><UsersRound className="h-5 w-5" aria-hidden="true" /></span><span><span className="block text-sm font-semibold">Add a family member</span><span className="mt-1 block text-xs text-[#748079] tone-muted">You can also keep Artha completely personal.</span></span></button> : <div className="space-y-3">{memberRows.map((member, index) => <Card key={member.id} className="flex items-end gap-3 p-4"><div className="min-w-0 flex-1"><SetupField label={`Member ${index + 1}`} ariaLabel={`Family member ${index + 1} name`} placeholder="Name" value={member.name} onChange={(name) => setMemberRows((rows) => rows.map((item) => item.id === member.id ? { ...item, name } : item))} /></div><button onClick={() => setMemberRows((rows) => rows.filter((item) => item.id !== member.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#84908a] tone-subtle hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400" aria-label={`Remove family member ${index + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></Card>)}</div>}
            </section>

            <section className="mt-7" aria-labelledby="money-accounts-heading">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div><h2 id="money-accounts-heading" className="font-display text-lg font-bold">Money accounts</h2><p className="mt-1 text-xs text-[#77837d] tone-muted">Add at least one bank, cash, or wallet.</p></div>
                <Button variant="secondary" className="shrink-0 px-3" onClick={() => setMoneyRows((rows) => [...rows, newMoneyRow()])} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add</Button>
              </div>
              <div className="space-y-3">
                {moneyRows.map((row, index) => (
                  <Card key={row.id} className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-moss-100 text-moss-800 sm:grid"><Landmark className="h-5 w-5" aria-hidden="true" /></div>
                      <div className="min-w-0 flex-1 space-y-3 sm:grid sm:grid-cols-[1.2fr_.8fr_1fr] sm:gap-3 sm:space-y-0">
                        <SetupField label="Account name" ariaLabel={`Money account ${index + 1} name`} placeholder="e.g. HDFC UPI" value={row.name} onChange={(name) => setMoneyRows((rows) => rows.map((item) => item.id === row.id ? { ...item, name } : item))} />
                        <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7c8882] tone-muted">Type</span><select name={`money-account-${index + 1}-type`} autoComplete="off" aria-label={`Money account ${index + 1} type`} value={row.kind} onChange={(event) => setMoneyRows((rows) => rows.map((item) => item.id === row.id ? { ...item, kind: event.target.value as MoneyRow['kind'] } : item))} className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold outline-none focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100"><option value="bank">Bank</option><option value="cash">Cash</option><option value="wallet">Wallet</option></select></label>
                        <SetupField label="Current balance" ariaLabel={`Money account ${index + 1} current balance`} prefix="₹" inputMode="decimal" placeholder="0" value={row.balance} onChange={(balance) => setMoneyRows((rows) => rows.map((item) => item.id === row.id ? { ...item, balance } : item))} />
                      </div>
                      {moneyRows.length > 1 && <button onClick={() => setMoneyRows((rows) => rows.filter((item) => item.id !== row.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#84908a] tone-subtle hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400" aria-label={`Remove money account ${index + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="cards-heading">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div><div className="flex items-center gap-2"><h2 id="cards-heading" className="font-display text-lg font-bold">Credit cards</h2><Badge>Optional</Badge></div><p className="mt-1 text-xs text-[#77837d] tone-muted">Track what you owe without counting card payments twice.</p></div>
                <Button variant="secondary" className="shrink-0 px-3" onClick={() => setCardRows((rows) => [...rows, newCardRow()])} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add</Button>
              </div>
              {cardRows.length === 0 ? (
                <button onClick={() => setCardRows([newCardRow()])} className="flex min-h-20 w-full items-center gap-3 rounded-[22px] border border-dashed border-moss-300 bg-moss-50/50 px-4 text-left transition hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 dark:border-night-border dark:bg-night-raised">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-moss-800"><CreditCard className="h-5 w-5" aria-hidden="true" /></span><span><span className="block text-sm font-semibold">Add a credit card</span><span className="mt-1 block text-xs text-[#748079] tone-muted">Outstanding is stored as a liability.</span></span>
                </button>
              ) : (
                <div className="space-y-3">
                  {cardRows.map((row, index) => (
                    <Card key={row.id} className="p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                          <SetupField label="Card name" ariaLabel={`Credit card ${index + 1} name`} placeholder="e.g. HDFC Millennia" value={row.name} onChange={(name) => setCardRows((rows) => rows.map((item) => item.id === row.id ? { ...item, name } : item))} />
                          <SetupField label="Outstanding" ariaLabel={`Credit card ${index + 1} outstanding`} prefix="₹" inputMode="decimal" placeholder="0" value={row.outstanding} onChange={(outstanding) => setCardRows((rows) => rows.map((item) => item.id === row.id ? { ...item, outstanding } : item))} />
                          <SetupField label="Credit limit" ariaLabel={`Credit card ${index + 1} credit limit`} prefix="₹" inputMode="decimal" placeholder="0" value={row.limit} onChange={(limit) => setCardRows((rows) => rows.map((item) => item.id === row.id ? { ...item, limit } : item))} />
                          <div className="grid grid-cols-2 gap-3">
                            <SetupField label="Statement day" ariaLabel={`Credit card ${index + 1} statement day`} inputMode="numeric" placeholder="Optional" value={row.statementDay} onChange={(statementDay) => setCardRows((rows) => rows.map((item) => item.id === row.id ? { ...item, statementDay } : item))} />
                            <SetupField label="Due day" ariaLabel={`Credit card ${index + 1} payment due day`} inputMode="numeric" placeholder="Optional" value={row.paymentDueDay} onChange={(paymentDueDay) => setCardRows((rows) => rows.map((item) => item.id === row.id ? { ...item, paymentDueDay } : item))} />
                          </div>
                        </div>
                        <button onClick={() => setCardRows((rows) => rows.filter((item) => item.id !== row.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#84908a] tone-subtle hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400" aria-label={`Remove credit card ${index + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {error && <ErrorMessage message={error} focusRef={errorRef} />}
            <div className={`mt-8 grid gap-3 sm:items-center ${allowDemo ? 'sm:grid-cols-[1fr_auto]' : 'sm:justify-end'}`}>
              {allowDemo && <Button variant="ghost" loading={demoLoading} onClick={() => void exploreDemo()} className="order-2 sm:order-1 sm:justify-self-start">Explore sample demo</Button>}
              <Button onClick={continueToReview} className="order-1 sm:order-2 sm:px-7">Review setup <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            {allowDemo && <p className="mt-3 text-center text-[11px] text-[#87928c] tone-subtle sm:text-right">Sample data can be cleared whenever you are ready.</p>}
          </>
        ) : (
          <div className="mt-10 sm:mt-14">
            <button onClick={() => { setStep('accounts'); setError('') }} className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-[#66736d] tone-muted transition hover:text-moss-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Edit accounts</button>
            <div className="mt-4"><p className="text-sm font-semibold text-moss-700">Almost ready</p><h1 className="font-display mt-2 text-balance text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Review your starting balances.</h1><p className="mt-3 text-sm leading-6 text-[#6e7b74] tone-muted">These become your ledger’s opening entries. Credit-card outstanding is shown as money owed.</p></div>

            <Card className="mt-7 p-4"><p className="text-xs text-[#748079] tone-muted">Household</p><p className="mt-1 font-semibold">{householdName.trim() || 'My household'}</p><p className="mt-1 text-xs text-[#748079] tone-muted">{memberRows.length ? memberRows.map((member) => member.name).join(', ') : 'Personal ledger · no shared members'}</p></Card>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Card className="p-4 sm:p-5"><p className="text-xs text-[#748079] tone-muted">Available money</p><p className="font-display mt-2 text-2xl font-bold tracking-[-0.04em] text-moss-900">{formatMoney(availablePaise)}</p></Card>
              <Card className="p-4 sm:p-5"><p className="text-xs text-[#748079] tone-muted">Card outstanding</p><p className="font-display mt-2 text-2xl font-bold tracking-[-0.04em]">{formatMoney(outstandingPaise)}</p></Card>
            </div>

            <Card className="mt-5 overflow-hidden">
              <div className="border-b border-line bg-[#fbfcfa] px-5 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#7b8781] tone-muted dark:bg-night-raised">{preparedAccounts.length} {preparedAccounts.length === 1 ? 'account' : 'accounts'}</div>
              <div className="divide-y divide-line px-5">
                {preparedAccounts.map((account, index) => (
                  <div key={`${account.kind}-${account.name}-${index}`} className="flex items-center gap-3 py-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-moss-100 text-moss-800">{account.kind === 'credit_card' ? <CreditCard className="h-5 w-5" aria-hidden="true" /> : <WalletCards className="h-5 w-5" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{account.name}</p><p className="mt-1 text-xs capitalize text-[#7b8781] tone-muted">{account.kind.replace('_', ' ')}</p></div>
                    <div className="text-right"><p className={`text-sm font-bold ${account.opening_balance_paise < 0 ? 'text-[#8a4d43] tone-subtle tone-danger' : 'text-moss-800'}`}>{formatMoney(account.opening_balance_paise)}</p>{account.credit_limit_paise !== null && <p className="mt-1 text-[11px] text-[#7b8781] tone-muted">Limit {formatMoney(account.credit_limit_paise)}</p>}{account.statement_day && <p className="mt-1 text-[11px] text-[#7b8781] tone-muted">Statement {account.statement_day} · due {account.payment_due_day ?? '—'}</p>}</div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="mt-5 flex items-start gap-2 rounded-2xl border border-moss-200 bg-moss-50 p-4 text-xs leading-5 text-[#637069] tone-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-moss-700" aria-hidden="true" /><p>Artha stores money in integer paise and never posts a transaction from natural language until you explicitly confirm it.</p></div>
            {error && <ErrorMessage message={error} focusRef={errorRef} />}
            <Button onClick={() => void save()} loading={saving} className="mt-6 w-full" icon={<Check className="h-4 w-4" aria-hidden="true" />}>Save setup and open Artha</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function isSupportedMoney(value: string): boolean {
  if (value.trim() === '') return false
  const rupees = Number(value)
  return Number.isFinite(rupees) && Number.isSafeInteger(Math.round(rupees * 100))
}

function SetupField({ label, ariaLabel, prefix, ...inputProps }: { label: string; ariaLabel: string; prefix?: string; value: string; placeholder: string; inputMode?: 'decimal' | 'numeric'; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7c8882] tone-muted">{label}</span>
      <span className="relative block">{prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#68756e] tone-muted">{prefix}</span>}<input name={ariaLabel.toLowerCase().replaceAll(' ', '-')} aria-label={ariaLabel} autoComplete="off" inputMode={inputProps.inputMode} value={inputProps.value} placeholder={`${inputProps.placeholder}…`} min="0" max={inputProps.inputMode === 'numeric' ? '31' : undefined} step={inputProps.inputMode === 'decimal' ? '0.01' : '1'} type={inputProps.inputMode ? 'number' : 'text'} onChange={(event) => inputProps.onChange(event.target.value)} className={`min-h-11 w-full min-w-0 rounded-xl border border-line bg-white pr-3 text-sm font-semibold outline-none transition focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100 ${prefix ? 'pl-7' : 'pl-3'}`} /></span>
    </label>
  )
}

function ErrorMessage({ message, focusRef }: { message: string; focusRef: RefObject<HTMLDivElement | null> }) {
  return <div ref={focusRef} tabIndex={-1} role="alert" aria-live="polite" className="mt-5 break-words rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 outline-none focus-visible:ring-2 focus-visible:ring-red-400">{message}</div>
}

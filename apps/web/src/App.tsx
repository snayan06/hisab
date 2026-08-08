/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react'
import { Shell } from './components/Shell'
import { demoDashboard, demoTransactions } from './data/demo'
import { ApiError, bootstrapDemo, confirmDraft, getDashboard, getMembers, getTransactions, getUserProfile, isOnboardingComplete, setupOnboarding } from './lib/api'
import { isDemoMode, useAuth } from './lib/auth'
import { useRouter } from './lib/router'
import { HomePage } from './pages/HomePage'
import { OnboardingPage } from './pages/OnboardingPage'
import { LoginPage, SessionLoadingPage } from './pages/LoginPage'
import { QuickAddPage } from './pages/QuickAddPage'
import { SharedPage } from './pages/SharedPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AssistantPage } from './pages/AssistantPage'
import { SettingsPage } from './pages/SettingsPage'
import type { AccountSetupInput, Dashboard, Transaction, TransactionDraft, UserProfile } from './types'

const SETUP_KEY = 'artha.setup.complete'
const PROFILE_KEY = 'artha.profile'
const defaultProfile: UserProfile = { displayName: 'You', householdName: 'My household', members: [], isDemo: false }
const emptyDashboard: Dashboard = {
  availablePaise: 0,
  incomePaise: 0,
  spendPaise: 0,
  sharedBalancePaise: 0,
  memberBalances: [],
  monthly: [],
  recentTransactions: []
}

export function applyConfirmedTransaction(current: Dashboard, transaction: Transaction): Dashboard {
  const sharedDeltaPaise = transaction.memberSplits.reduce((sum, split) => sum + split.amountPaise, 0)
  const occurredAt = new Date(`${transaction.occurredAt}T12:00:00`)
  const transactionMonth = Number.isNaN(occurredAt.getTime())
    ? null
    : new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(occurredAt)

  return {
    ...current,
    availablePaise: current.availablePaise + (transaction.kind === 'transfer' ? 0 : transaction.kind === 'credit' ? transaction.amountPaise : -transaction.amountPaise),
    incomePaise: current.incomePaise + (transaction.kind === 'credit' ? transaction.amountPaise : 0),
    spendPaise: current.spendPaise + (transaction.kind === 'debit' ? transaction.personalSharePaise : 0),
    sharedBalancePaise: current.sharedBalancePaise + sharedDeltaPaise,
    memberBalances: current.memberBalances.map((balance) => {
      const memberDeltaPaise = transaction.memberSplits
        .filter((split) => split.memberId === balance.id)
        .reduce((sum, split) => sum + split.amountPaise, 0)
      const balancePaise = balance.balancePaise + memberDeltaPaise
      return {
        ...balance,
        balancePaise,
        status: balancePaise > 0 ? 'owes you' : balancePaise < 0 ? 'you owe' : 'settled'
      }
    }),
    monthly: current.monthly.map((point) => point.month === transactionMonth ? {
      ...point,
      incomePaise: point.incomePaise + (transaction.kind === 'credit' ? transaction.amountPaise : 0),
      spendPaise: point.spendPaise + (transaction.kind === 'debit' ? transaction.personalSharePaise : 0)
    } : point),
    recentTransactions: [transaction, ...current.recentTransactions].slice(0, 4)
  }
}

export type LedgerLoadIssue = {
  title: string
  message: string
  retryLabel: string
  signOutLabel: string
}

export function ledgerLoadIssue(error: unknown, phase: 'setup' | 'ledger'): LedgerLoadIssue {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: 'Your session needs refreshing',
        message: 'Your ledger is safe, but this sign-in is no longer valid. Sign in again to continue.',
        retryLabel: 'Try session again',
        signOutLabel: 'Sign in again'
      }
    }
    if (error.status === 403) {
      return {
        title: 'This ledger is not available to this account',
        message: 'Artha could not verify access to this household. Sign in with the account that owns it.',
        retryLabel: 'Check again',
        signOutLabel: 'Use another account'
      }
    }
    if (error.status === 404 || error.status === 501) {
      return {
        title: 'Artha is finishing an update',
        message: 'A ledger service is not ready yet. Your data is safe and no demo balances are being shown.',
        retryLabel: 'Try again',
        signOutLabel: 'Sign out'
      }
    }
    if ([408, 429, 502, 503, 504].includes(error.status)) {
      return {
        title: 'Artha is taking longer than expected',
        message: 'The connection or ledger service is temporarily unavailable. Your data is safe; wait a moment and retry.',
        retryLabel: 'Retry connection',
        signOutLabel: 'Sign out'
      }
    }
  }

  return {
    title: phase === 'setup' ? 'We could not verify your setup' : 'Your ledger is temporarily unavailable',
    message: phase === 'setup'
      ? 'Artha could not verify your household setup. No setup changes were made. Check the connection and try again.'
      : 'Artha could not load your ledger. No demo balances are being shown. Check the connection and try again.',
    retryLabel: 'Try again',
    signOutLabel: 'Sign out'
  }
}

function loadProfile(profileKey: string): UserProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(profileKey) ?? '{}') as Partial<UserProfile>
    return {
      displayName: parsed.displayName?.trim() || defaultProfile.displayName,
      householdName: parsed.householdName?.trim() || defaultProfile.householdName,
      members: Array.isArray(parsed.members) ? parsed.members.filter((member) => member && typeof member.id === 'string' && typeof member.name === 'string') : [],
      isDemo: parsed.isDemo === true
    }
  } catch {
    return defaultProfile
  }
}

export function isDemoExperience(localDemo: boolean, profile: UserProfile): boolean {
  return localDemo || profile.isDemo
}

function persistSetup(profile: UserProfile, profileKey: string, setupKey: string) {
  localStorage.setItem(profileKey, JSON.stringify(profile))
  localStorage.setItem(setupKey, 'true')
}

export default function App() {
  const auth = useAuth()
  if (auth.status === 'loading') return <SessionLoadingPage />
  if (auth.status === 'unauthenticated' || auth.status === 'error') {
    return <LoginPage configurationError={auth.status === 'error' ? auth.error : null} recovery={auth.recovery} onSendLink={auth.signInWithMagicLink} onPasswordSignIn={auth.signInWithPassword} />
  }
  const userKey = auth.user?.id
  return <LedgerApp key={userKey ?? 'demo'} userKey={userKey} userEmail={auth.user?.email} onSignOut={auth.status === 'authenticated' ? auth.signOut : undefined} />
}

function LedgerApp({ userKey, userEmail, onSignOut }: { userKey?: string; userEmail?: string; onSignOut?: () => Promise<void> }) {
  const { path } = useRouter()
  const localDemo = isDemoMode()
  const setupKey = userKey ? `${SETUP_KEY}.${userKey}` : SETUP_KEY
  const profileKey = userKey ? `${PROFILE_KEY}.${userKey}` : PROFILE_KEY
  const [setupComplete, setSetupComplete] = useState(() => localDemo && localStorage.getItem(setupKey) === 'true')
  const [checkingSetup, setCheckingSetup] = useState(!localDemo)
  const [setupIssue, setSetupIssue] = useState<LedgerLoadIssue | null>(null)
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile(profileKey))
  const [dashboard, setDashboard] = useState<Dashboard>(() => localDemo ? demoDashboard : emptyDashboard)
  const [transactions, setTransactions] = useState<Transaction[]>(() => localDemo ? demoTransactions : [])
  const [loadingLedger, setLoadingLedger] = useState(setupComplete)
  const [ledgerIssue, setLedgerIssue] = useState<LedgerLoadIssue | null>(null)

  const checkSetup = useCallback(async () => {
    setCheckingSetup(true)
    setSetupIssue(null)
    try {
      const complete = await isOnboardingComplete()
      if (complete) {
        setLoadingLedger(true)
        const serverProfile = await getUserProfile()
        setProfile(serverProfile)
        localStorage.setItem(profileKey, JSON.stringify(serverProfile))
      }
      setSetupComplete(complete)
    } catch (error) {
      setSetupIssue(ledgerLoadIssue(error, 'setup'))
    } finally {
      setCheckingSetup(false)
    }
  }, [profileKey])

  const refreshLedger = useCallback(async () => {
    setLoadingLedger(true)
    setLedgerIssue(null)
    try {
      const [dashboardResponse, transactionsResponse] = await Promise.all([getDashboard(), getTransactions()])
      setDashboard(dashboardResponse.data)
      setTransactions(transactionsResponse.data)
    } catch (error) {
      setLedgerIssue(ledgerLoadIssue(error, 'ledger'))
    } finally {
      setLoadingLedger(false)
    }
  }, [])

  useEffect(() => {
    if (setupComplete) void refreshLedger()
  }, [refreshLedger, setupComplete])

  useEffect(() => {
    if (!localDemo) void checkSetup()
  }, [checkSetup, localDemo])

  async function finishSetup(accounts: AccountSetupInput[], nextProfile: UserProfile) {
    const savedMembers = await setupOnboarding(
      accounts,
      nextProfile.members.map(({ name }) => ({ name })),
      nextProfile.displayName,
      nextProfile.householdName
    )
    const savedProfile = { ...nextProfile, members: savedMembers }
    persistSetup(savedProfile, profileKey, setupKey)
    setProfile(savedProfile)
    setLoadingLedger(true)
    setSetupComplete(true)
  }

  async function exploreDemo(nextProfile: UserProfile) {
    await bootstrapDemo()
    const demoMembers = await getMembers().catch(() => nextProfile.members)
    const demoProfile = { ...nextProfile, members: demoMembers }
    persistSetup(demoProfile, profileKey, setupKey)
    setProfile(demoProfile)
    setSetupComplete(true)
  }

  async function addTransaction(draft: TransactionDraft, idempotencyKey?: string): Promise<Transaction> {
    const transaction = await confirmDraft(draft, idempotencyKey)
    setTransactions((current) => [transaction, ...current])
    setDashboard((current) => applyConfirmedTransaction(current, transaction))
    return transaction
  }

  if (checkingSetup) return <SessionLoadingPage />
  if (setupIssue) return <LedgerLoadError issue={setupIssue} onRetry={checkSetup} onSignOut={onSignOut} />
  if (!setupComplete) return <OnboardingPage onSave={finishSetup} onExploreDemo={exploreDemo} onRestored={checkSetup} allowDemo={localDemo} />
  if (loadingLedger) return <SessionLoadingPage />
  if (ledgerIssue) return <LedgerLoadError issue={ledgerIssue} onRetry={refreshLedger} onSignOut={onSignOut} />

  const demoMode = isDemoExperience(localDemo, profile)
  let page = <HomePage dashboard={dashboard} demoMode={demoMode} profile={profile} />
  if (path === '/transactions') page = <TransactionsPage transactions={transactions} demoMode={demoMode} />
  if (path === '/shared') page = <SharedPage transactions={transactions} sharedBalancePaise={dashboard.sharedBalancePaise} memberBalances={dashboard.memberBalances} demoMode={demoMode} profile={profile} />
  if (path === '/add') page = <QuickAddPage onConfirm={addTransaction} members={profile.members} />
  if (path === '/assistant') page = <AssistantPage />
  if (path === '/settings') page = <SettingsPage />

  return <Shell userEmail={userEmail} onSignOut={onSignOut}>{page}</Shell>
}

export function LedgerLoadError({ issue, onRetry, onSignOut }: { issue: LedgerLoadIssue; onRetry: () => Promise<void>; onSignOut?: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    if (retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <main className="safe-page grid min-h-[100svh] place-items-center bg-canvas py-6 text-ink">
      <div className="w-full max-w-md rounded-[28px] border border-line bg-white p-5 text-left shadow-sm sm:p-8 dark:bg-night-surface">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" aria-hidden="true">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#718078] tone-muted">Nothing was changed</p>
        <h1 className="mt-2 text-balance font-display text-2xl font-bold leading-tight sm:text-3xl">{issue.title}</h1>
        <p role="alert" aria-live="polite" className="mt-3 break-words text-sm leading-6 text-[#617068] tone-muted sm:text-base">{issue.message}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button disabled={retrying} onClick={() => void retry()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-moss-900 px-5 text-sm font-semibold text-white transition hover:bg-moss-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:bg-[#27604e] dark:hover:bg-[#31745f]">
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            {retrying ? 'Trying again…' : issue.retryLabel}
          </button>
          {onSignOut && <button onClick={() => void onSignOut()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 text-sm font-semibold transition hover:border-moss-300 hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 focus-visible:ring-offset-2 dark:bg-night-surface dark:hover:bg-night-raised"><LogOut className="h-4 w-4" aria-hidden="true" />{issue.signOutLabel}</button>}
        </div>
        <p className="mt-5 text-xs leading-5 text-[#7b8881] tone-muted">If retry keeps failing, sign in again. Artha never substitutes sample balances for a failed private ledger.</p>
      </div>
    </main>
  )
}

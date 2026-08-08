import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoDashboard, demoTransactions } from './data/demo'
import { RouterProvider } from './lib/router'

const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    readonly status: number

    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  bootstrapDemo: vi.fn(),
  getMembers: vi.fn(),
  setupOnboarding: vi.fn(),
  getDashboard: vi.fn(),
  getTransactions: vi.fn(),
  confirmDraft: vi.fn()
}))

vi.mock('./lib/api', () => api)

import App, { applyConfirmedTransaction, isDemoExperience, LedgerLoadError, ledgerLoadIssue } from './App'
import type { Dashboard, Transaction } from './types'

describe('first-run gate', () => {
  beforeEach(() => {
    api.bootstrapDemo.mockResolvedValue(undefined)
    api.getMembers.mockResolvedValue([{ id: '7', name: 'Demo member' }])
    api.getDashboard.mockResolvedValue({ data: demoDashboard, demo: true })
    api.getTransactions.mockResolvedValue({ data: demoTransactions, demo: true })
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('does not bootstrap until the user explicitly chooses the sample demo', async () => {
    const user = userEvent.setup()
    render(<RouterProvider><App /></RouterProvider>)
    expect(screen.getByRole('heading', { name: 'Where does your money live?' })).toBeInTheDocument()
    expect(api.bootstrapDemo).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Explore sample demo' }))
    await waitFor(() => expect(api.bootstrapDemo).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('artha.setup.complete')).toBe('true')
    expect(await screen.findByRole('heading', { name: 'Your money, made clear.' })).toBeInTheDocument()
  })
})

describe('authenticated demo presentation', () => {
  it('uses the server-owned profile flag without turning personal profiles into demos', () => {
    expect(isDemoExperience(false, { displayName: 'Demo', householdName: 'Artha demo', members: [], isDemo: true })).toBe(true)
    expect(isDemoExperience(false, { displayName: 'Nayan', householdName: 'My household', members: [], isDemo: false })).toBe(false)
    expect(isDemoExperience(true, { displayName: 'Local', householdName: 'Local demo', members: [], isDemo: false })).toBe(true)
  })
})

describe('ledger recovery states', () => {
  afterEach(() => cleanup())

  it('explains a missing production RPC without implying that data was lost', () => {
    const issue = ledgerLoadIssue(new api.ApiError(404, 'missing function'), 'ledger')

    expect(issue).toMatchObject({
      title: 'Artha is finishing an update',
      retryLabel: 'Try again'
    })
    expect(issue.message).toContain('Your data is safe')
  })

  it('renders actionable mobile-safe recovery controls and retries once', async () => {
    const user = userEvent.setup()
    const retry = vi.fn().mockResolvedValue(undefined)
    const signOut = vi.fn().mockResolvedValue(undefined)
    const issue = ledgerLoadIssue(new api.ApiError(503, 'unavailable'), 'ledger')

    render(<LedgerLoadError issue={issue} onRetry={retry} onSignOut={signOut} />)

    expect(screen.getByRole('heading', { name: 'Artha is taking longer than expected' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Your data is safe')
    await user.click(screen.getByRole('button', { name: 'Retry connection' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('confirmed transaction dashboard updates', () => {
  const dashboard: Dashboard = {
    availablePaise: 13_800_000,
    incomePaise: 0,
    spendPaise: 0,
    sharedBalancePaise: 0,
    memberBalances: [{ id: 'member-1', name: 'Mira QA', balancePaise: 0, status: 'settled' }],
    monthly: [{ month: 'Aug', incomePaise: 0, spendPaise: 0 }],
    recentTransactions: []
  }

  it('updates the chart and member balance immediately for a shared expense', () => {
    const transaction: Transaction = {
      id: 'expense-1',
      kind: 'debit',
      amountPaise: 184_000,
      personalSharePaise: 92_000,
      merchant: 'Groceries',
      category: 'Groceries',
      account: 'HDFC QA',
      occurredAt: '2026-08-04',
      memberSplits: [{ memberId: 'member-1', memberName: 'Mira QA', amountPaise: 92_000 }],
      status: 'confirmed'
    }

    expect(applyConfirmedTransaction(dashboard, transaction)).toMatchObject({
      availablePaise: 13_616_000,
      spendPaise: 92_000,
      sharedBalancePaise: 92_000,
      memberBalances: [{ id: 'member-1', balancePaise: 92_000, status: 'owes you' }],
      monthly: [{ month: 'Aug', incomePaise: 0, spendPaise: 92_000 }]
    })
  })

  it('updates income immediately while keeping transfers out of totals', () => {
    const income: Transaction = {
      id: 'income-1', kind: 'credit', amountPaise: 2_500_000, personalSharePaise: 2_500_000,
      merchant: 'Salary', category: 'Salary', account: 'ICICI QA', occurredAt: '2026-08-06', memberSplits: [], status: 'confirmed'
    }
    const transfer: Transaction = {
      id: 'transfer-1', kind: 'transfer', amountPaise: 2_500_000, personalSharePaise: 2_500_000,
      merchant: 'Self transfer', category: 'Transfer', account: 'ICICI QA', destinationAccount: 'HDFC QA',
      occurredAt: '2026-08-07', memberSplits: [], status: 'confirmed'
    }

    const afterIncome = applyConfirmedTransaction(dashboard, income)
    const afterTransfer = applyConfirmedTransaction(afterIncome, transfer)

    expect(afterTransfer).toMatchObject({
      availablePaise: 16_300_000,
      incomePaise: 2_500_000,
      spendPaise: 0,
      monthly: [{ month: 'Aug', incomePaise: 2_500_000, spendPaise: 0 }]
    })
  })
})

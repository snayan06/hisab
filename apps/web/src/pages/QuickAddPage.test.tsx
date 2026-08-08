import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { RouterProvider } from '../lib/router'
import type { CaptureContext, Transaction, TransactionDraft } from '../types'
import { localDateOffset } from '../lib/date'
import { QuickAddPage } from './QuickAddPage'

describe('QuickAddPage', () => {
  const context: CaptureContext = {
    accounts: [
      { id: 'demo-hdfc-upi', name: 'HDFC UPI', kind: 'bank' },
      { id: 'demo-icici-bank', name: 'ICICI Bank', kind: 'bank' }
    ],
    categories: [
      { id: 'food', name: 'Food & Dining', kind: 'expense' },
      { id: 'salary', name: 'Salary', kind: 'income' },
      { id: 'other', name: 'Other', kind: 'both' }
    ]
  }

  beforeEach(() => {
    vi.spyOn(api, 'getCaptureContext').mockResolvedValue(context)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an accurate AI-assisted disclosure before capture', () => {
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    const notice = screen.getByRole('note', { name: /AI-assisted capture/i })
    expect(notice).toHaveTextContent(/configured AI provider.*reviewable result/i)
    expect(notice).toHaveTextContent(/nothing is written to your ledger until you confirm/i)
    expect(notice).not.toHaveTextContent(/fictional|pilot/i)
    expect(within(notice).getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings')
  })

  it('keeps a parsed entry unsaved until explicit confirmation', async () => {
    const user = userEvent.setup()
    const confirmed: Transaction = {
      id: 'new-transaction', kind: 'debit', amountPaise: 85000, personalSharePaise: 42500,
      merchant: 'dinner', category: 'Food & dining', account: 'HDFC UPI', occurredAt: '2026-08-04',
      memberSplits: [{ memberId: '7', memberName: 'Sam', amountPaise: 42500 }], status: 'confirmed'
    }
    const onConfirm = vi.fn().mockResolvedValue(confirmed)
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[{ id: '7', name: 'Sam' }]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'Paid 850 for dinner, half with Sam')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    expect(await screen.findByText(/nothing has been saved yet/i)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Yesterday' }))
    expect(screen.getByLabelText('Transaction date')).toHaveValue(localDateOffset(-1))

    await user.click(screen.getByRole('button', { name: /confirm and add transaction/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/added to your artha/i)).toBeInTheDocument()
  })

  it('creates only an unsaved review draft when Enter is pressed', async () => {
    const user = userEvent.setup()
    const parseSpy = vi.spyOn(api, 'parseDraft')
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    const composer = screen.getByLabelText(/your message/i)
    await user.type(composer, 'Paid 540 at Zomato{enter}')

    await waitFor(() => expect(parseSpy).toHaveBeenCalledWith('Paid 540 at Zomato', []))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/Enter to continue/i)).toHaveTextContent(/Shift\+Enter for a new line/i)
  })

  it('keeps Shift+Enter as a newline and ignores composing Enter', async () => {
    const user = userEvent.setup()
    const parseSpy = vi.spyOn(api, 'parseDraft')
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    const composer = screen.getByLabelText(/your message/i)
    await user.type(composer, 'Paid 540')
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(parseSpy).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
    expect(parseSpy).not.toHaveBeenCalled()
  })

  it('explains a missing payment account and offers grounded choices', async () => {
    const user = userEvent.setup()
    const parseSpy = vi.spyOn(api, 'parseDraft')
      .mockResolvedValueOnce({
        demo: false,
        data: {
          outcome: 'clarification',
          sourceText: 'Paid 540 at Zomato',
          understood: { amountPaise: 54_000, kind: 'expense', merchant: 'Zomato' },
          missingField: 'source_account_id',
          question: 'How did you pay for Zomato?',
          explanation: 'Choose one so Artha updates the correct balance. Nothing has been saved.',
          choices: [
            { id: 'demo-hdfc-upi', label: 'HDFC UPI', answer: 'paid from HDFC UPI' },
            { id: 'demo-icici-bank', label: 'ICICI Bank', answer: 'paid from ICICI Bank' }
          ],
          warnings: [],
          parserSource: 'gemini:test-model'
        }
      } as never)
      .mockResolvedValueOnce({
        demo: false,
        data: {
          kind: 'debit', amountPaise: 54_000, merchant: 'Zomato', category: 'Food & Dining',
          account: 'HDFC UPI', sourceAccountId: 'demo-hdfc-upi', occurredAt: localDateOffset(0),
          note: '', memberSplits: [], confidence: 'high',
          sourceText: 'Paid 540 at Zomato; paid from HDFC UPI'
        }
      })
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'Paid 540 at Zomato')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Zomato')
    expect(status).toHaveTextContent('₹540')
    expect(status).toHaveTextContent('How did you pay for Zomato?')
    expect(status).toHaveTextContent(/correct balance.*nothing has been saved/i)
    expect(screen.getByRole('button', { name: 'HDFC UPI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ICICI Bank' })).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'HDFC UPI' }))

    await waitFor(() => expect(parseSpy).toHaveBeenLastCalledWith(
      'Paid 540 at Zomato; paid from HDFC UPI',
      []
    ))
    expect(screen.getByLabelText(/your message/i)).toHaveValue('Paid 540 at Zomato; paid from HDFC UPI')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('separates suggested category, transaction details, context and optional tags', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'parseDraft').mockResolvedValue({
      demo: false,
      data: {
        kind: 'debit', amountPaise: 68_000, merchant: 'Burger King', category: 'Food & Dining',
        account: 'HDFC UPI', sourceAccountId: 'demo-hdfc-upi', occurredAt: localDateOffset(0),
        note: '', memberSplits: [], confidence: 'high',
        sourceText: 'Paid 680 for dinner at Burger King via Zomato from HDFC UPI, date night',
        platform: 'Zomato', subcategory: 'Fast Food',
        categorySuggestion: {
          source: 'safe_catalog', confidence: 1,
          reason: "Burger King is in Artha's food merchant catalog."
        },
        metadata: {
          version: 1,
          evidence: {
            merchant: { source: 'user_explicit', confidence: 0.99, reviewStatus: 'needs_review' },
            platform: { source: 'user_explicit', confidence: 0.99, reviewStatus: 'needs_review' },
            category: { source: 'safe_catalog', confidence: 1, reviewStatus: 'needs_review' }
          },
          attributes: [
            { key: 'meal_occasion', value: 'Dinner', source: 'user_explicit', confidence: 0.99, reviewStatus: 'needs_review' },
            { key: 'order_channel', value: 'Delivery', source: 'safe_catalog', confidence: 1, reviewStatus: 'needs_review' }
          ]
        },
        tags: [
          { name: 'Date Night', normalizedName: 'date night', source: 'user_explicit', confidence: 0.98, reviewStatus: 'needs_review', selected: true }
        ]
      }
    } as never)
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'Paid 680 for dinner at Burger King via Zomato from HDFC UPI, date night')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    expect(await screen.findByRole('heading', { name: 'Suggested category' })).toBeInTheDocument()
    expect(screen.getByText("Burger King is in Artha's food merchant catalog.")).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transaction details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Merchant')).toHaveValue('Burger King')
    expect(screen.getByLabelText('Platform')).toHaveValue('Zomato')
    expect(screen.getByLabelText('Subcategory')).toHaveValue('Fast Food')
    expect(screen.getByRole('heading', { name: 'Context' })).toBeInTheDocument()
    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText('Delivery')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Optional tags' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Date Night' })).toBeChecked()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('Category'), 'Other')
    expect(screen.queryByRole('heading', { name: 'Suggested category' })).not.toBeInTheDocument()
    expect(screen.queryByText("Burger King is in Artha's food merchant catalog.")).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Merchant'))
    await user.type(screen.getByLabelText('Merchant'), 'Local Cafe')
    expect(screen.getByLabelText('Category')).toHaveValue('Other')
    expect(screen.getByLabelText('Subcategory')).toHaveValue('')

    await user.clear(screen.getByLabelText('Platform'))
    await user.type(screen.getByLabelText('Platform'), 'Direct')
    expect(screen.queryByText('Delivery')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm and add transaction/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const submitted = onConfirm.mock.calls[0]?.[0] as TransactionDraft
    expect(submitted.platform).toBe('Direct')
    expect(submitted.metadata?.evidence.platform).toMatchObject({ source: 'user_corrected' })
    expect(submitted.metadata?.attributes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'order_channel' })
    ]))
    expect(submitted.metadata?.evidence.category).toMatchObject({ source: 'user_corrected' })
  })

  it('offers a form-first entry with an explicit date picker', async () => {
    const user = userEvent.setup()
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    expect(screen.getByLabelText('Transaction date')).toHaveValue(localDateOffset(0))
    expect(screen.getByText(/nothing has been saved yet/i)).toBeInTheDocument()
  })

  it('does not let a delayed parse overwrite later manual edits', async () => {
    const user = userEvent.setup()
    let resolveParse!: (value: Awaited<ReturnType<typeof api.parseDraft>>) => void
    vi.spyOn(api, 'parseDraft').mockReturnValue(new Promise((resolve) => { resolveParse = resolve }))
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'Paid 900 for an old draft')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '250')
    await user.type(screen.getByLabelText('Description'), 'Latest manual correction')

    await act(async () => resolveParse({
      demo: false,
      data: {
        kind: 'debit', amountPaise: 90_000, merchant: 'Stale parsed draft', category: 'Food & Dining',
        account: 'HDFC UPI', sourceAccountId: 'demo-hdfc-upi', occurredAt: localDateOffset(0), note: '',
        memberSplits: [], confidence: 'high', sourceText: 'Paid 900 for an old draft'
      }
    }))

    expect(screen.getByLabelText('Amount in rupees')).toHaveValue(250)
    expect(screen.getByLabelText('Description')).toHaveValue('Latest manual correction')
  })

  it('keeps the latest parse when two requests resolve out of order', async () => {
    const user = userEvent.setup()
    const pending: Array<(value: Awaited<ReturnType<typeof api.parseDraft>>) => void> = []
    vi.spyOn(api, 'parseDraft').mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    const examples = screen.getAllByRole('button', { name: /Paid|Received|Spent/ })
    await user.click(examples[0])
    await user.click(examples[1])
    await waitFor(() => expect(pending).toHaveLength(2))

    await act(async () => pending[1]({
      demo: false,
      data: {
        kind: 'credit', amountPaise: 4_500_000, merchant: 'Latest salary', category: 'Salary',
        account: 'ICICI Bank', sourceAccountId: 'demo-icici-bank', occurredAt: localDateOffset(0), note: '',
        memberSplits: [], confidence: 'high', sourceText: 'latest'
      }
    }))
    expect(screen.getByLabelText('Description')).toHaveValue('Latest salary')

    await act(async () => pending[0]({
      demo: false,
      data: {
        kind: 'debit', amountPaise: 85_000, merchant: 'Stale dinner', category: 'Food & Dining',
        account: 'HDFC UPI', sourceAccountId: 'demo-hdfc-upi', occurredAt: localDateOffset(-1), note: '',
        memberSplits: [], confidence: 'high', sourceText: 'stale'
      }
    }))

    expect(screen.getByLabelText('Description')).toHaveValue('Latest salary')
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked()
  })

  it('blocks confirmation when the date is empty or invalid', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '250')
    await user.type(screen.getByLabelText('Description'), 'Coffee')

    const date = screen.getByLabelText('Transaction date')
    expect(date).toBeRequired()
    fireEvent.change(date, { target: { value: '' } })

    expect(screen.getByRole('status')).toHaveTextContent(/enter a valid transaction date/i)
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    expect(confirmButton).toBeDisabled()
    await user.click(confirmButton)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('blocks confirmation when the description exceeds 240 characters', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '250')

    const description = screen.getByLabelText('Description')
    expect(description).toBeRequired()
    expect(description).toHaveAttribute('maxLength', '240')
    fireEvent.change(description, { target: { value: 'x'.repeat(241) } })

    expect(screen.getByRole('status')).toHaveTextContent(/description must be 240 characters or fewer/i)
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    expect(confirmButton).toBeDisabled()
    await user.click(confirmButton)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('preserves the sentence and opens manual entry when AI capture is unavailable', async () => {
    const user = userEvent.setup()
    const sourceText = '  self transfer 25k ICICI -> HDFC  '
    const onConfirm = vi.fn().mockResolvedValue({
      id: 'manual-recovery', kind: 'debit', amountPaise: 25_000, personalSharePaise: 25_000,
      merchant: 'Manual transfer', category: 'Other', account: 'HDFC UPI', occurredAt: localDateOffset(0),
      memberSplits: [], status: 'confirmed'
    } satisfies Transaction)
    vi.spyOn(api, 'parseDraft').mockImplementation(async (text) => {
      throw new api.CaptureDraftUnavailableError(text)
    })
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), sourceText)
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/automatic interpretation is temporarily unavailable/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/your text is still here/i)
    expect(screen.getByLabelText(/your message/i)).toHaveValue(sourceText)
    expect(screen.getByLabelText('Amount in rupees')).toHaveValue(null)
    expect(screen.getByLabelText('Transaction date')).toBeInTheDocument()
    expect(screen.getByText(/nothing has been saved yet/i)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review the details' })).toHaveFocus())

    await user.type(screen.getByLabelText('Amount in rupees'), '250')
    await user.type(screen.getByLabelText('Description'), 'Manual transfer')
    await user.click(screen.getByRole('button', { name: /confirm and add transaction/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]?.[0].sourceText).toBe(sourceText)
  })

  it('waits for a real account before confirming a recovered manual draft', async () => {
    const user = userEvent.setup()
    const sourceText = '  Paid 250 for coffee  '
    let resolveContext!: (context: CaptureContext) => void
    const contextPromise = new Promise<CaptureContext>((resolve) => {
      resolveContext = resolve
    })
    vi.spyOn(api, 'getCaptureContext').mockReturnValue(contextPromise)
    vi.spyOn(api, 'parseDraft').mockImplementation(async (text) => {
      throw new api.CaptureDraftUnavailableError(text)
    })
    const onConfirm = vi.fn().mockResolvedValue({
      id: 'account-grounded-recovery', kind: 'debit', amountPaise: 25_000, personalSharePaise: 25_000,
      merchant: 'Coffee', category: 'Other', account: 'ICICI', occurredAt: localDateOffset(0),
      memberSplits: [], status: 'confirmed'
    } satisfies Transaction)
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), sourceText)
    await user.click(screen.getByRole('button', { name: /create review draft/i }))
    await screen.findByRole('alert')
    await user.type(screen.getByLabelText('Amount in rupees'), '250')
    await user.type(screen.getByLabelText('Description'), 'Coffee')
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })

    expect(confirmButton).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()

    resolveContext({
      accounts: [{ id: 'account-1', name: 'ICICI', kind: 'bank' }],
      categories: [{ id: 'other', name: 'Other', kind: 'both' }]
    })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Paid from account' })).toHaveDisplayValue('ICICI'))
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sourceAccountId: 'account-1',
      sourceText
    }))
  })

  it('uses accounts that load before an in-flight capture becomes unavailable', async () => {
    const user = userEvent.setup()
    const sourceText = '  Paid 450 for lunch  '
    let resolveContext!: (context: CaptureContext) => void
    const contextPromise = new Promise<CaptureContext>((resolve) => {
      resolveContext = resolve
    })
    let rejectParse!: (reason?: unknown) => void
    const parsePromise = new Promise<Awaited<ReturnType<typeof api.parseDraft>>>((_, reject) => {
      rejectParse = reject
    })
    vi.spyOn(api, 'getCaptureContext').mockReturnValue(contextPromise)
    const parseSpy = vi.spyOn(api, 'parseDraft').mockReturnValue(parsePromise)
    const onConfirm = vi.fn().mockResolvedValue({
      id: 'loaded-before-recovery', kind: 'debit', amountPaise: 45_000, personalSharePaise: 45_000,
      merchant: 'Lunch', category: 'Other', account: 'HDFC', occurredAt: localDateOffset(0),
      memberSplits: [], status: 'confirmed'
    } satisfies Transaction)
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), sourceText)
    await user.click(screen.getByRole('button', { name: /create review draft/i }))
    await waitFor(() => expect(parseSpy).toHaveBeenCalledWith(sourceText, []))

    await act(async () => {
      resolveContext({
        accounts: [{ id: 'account-2', name: 'HDFC', kind: 'bank' }],
        categories: [{ id: 'other', name: 'Other', kind: 'both' }]
      })
      await contextPromise
    })
    await act(async () => {
      rejectParse(new api.CaptureDraftUnavailableError(sourceText))
      await Promise.resolve()
    })

    await screen.findByRole('alert')
    expect(screen.getByRole('combobox', { name: 'Paid from account' })).toHaveDisplayValue('HDFC')
    await user.type(screen.getByLabelText('Amount in rupees'), '450')
    await user.type(screen.getByLabelText('Description'), 'Lunch')
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sourceAccountId: 'account-2',
      sourceText
    }))
  })

  it('prevents rapid duplicate confirmation while the first write is pending', async () => {
    const user = userEvent.setup()
    let finishConfirmation: ((transaction: Transaction) => void) | undefined
    const pendingConfirmation = new Promise<Transaction>((resolve) => {
      finishConfirmation = resolve
    })
    const onConfirm = vi.fn().mockReturnValue(pendingConfirmation)
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '123')
    await user.type(screen.getByLabelText('Description'), 'Coffee')
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    await user.dblClick(confirmButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(confirmButton).toBeDisabled()
    finishConfirmation?.({
      id: 'only-once', kind: 'debit', amountPaise: 12_300, personalSharePaise: 12_300,
      merchant: 'Coffee', category: 'Other', account: 'HDFC UPI', occurredAt: localDateOffset(0),
      memberSplits: [], status: 'confirmed'
    })
    expect(await screen.findByText(/added to your artha/i)).toBeInTheDocument()
  })

  it('reuses the reviewed draft idempotency key after a lost response', async () => {
    const user = userEvent.setup()
    const confirmed: Transaction = {
      id: 'replayed', kind: 'debit', amountPaise: 12_300, personalSharePaise: 12_300,
      merchant: 'Coffee', category: 'Other', account: 'HDFC UPI', occurredAt: localDateOffset(0),
      memberSplits: [], status: 'confirmed'
    }
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('Artha took too long to respond. Please try again.'))
      .mockResolvedValueOnce(confirmed)
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '123')
    await user.type(screen.getByLabelText('Description'), 'Coffee')
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    await user.click(confirmButton)
    expect(await screen.findByText(/nothing was saved/i)).toBeInTheDocument()
    await user.click(confirmButton)

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
    expect(onConfirm.mock.calls[0][1]).toBe(onConfirm.mock.calls[1][1])
    expect(await screen.findByText(/added to your artha/i)).toBeInTheDocument()
  })

  it('keeps confirmation disabled for zero or negative amounts', async () => {
    const user = userEvent.setup()
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Description'), 'Invalid amount')
    const amount = screen.getByLabelText('Amount in rupees')
    const confirmButton = screen.getByRole('button', { name: /confirm and add transaction/i })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(amount, { target: { value: '-10' } })
    expect(confirmButton).toBeDisabled()
  })

  it('shows a real destination placeholder for an incomplete transfer', async () => {
    const user = userEvent.setup()
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'transfer 5000 from ICICI')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    expect(await screen.findByRole('option', { name: 'Select an account' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Transfer to account' })).toHaveValue('')
    expect(screen.getByText(/choose a destination account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm and add transaction/i })).toBeDisabled()
  })

  it('preserves exact capture and draft fields through context failure and retry', async () => {
    const user = userEvent.setup()
    let rejectContext!: (reason?: unknown) => void
    const failedContext = new Promise<CaptureContext>((_, reject) => {
      rejectContext = reject
    })
    vi.spyOn(api, 'getCaptureContext')
      .mockReturnValueOnce(failedContext)
      .mockResolvedValueOnce(context)
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    expect(screen.getByRole('status')).toHaveTextContent(/loading accounts and categories/i)
    await user.type(screen.getByLabelText(/your message/i), '  Paid 250 for coffee  ')
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '250')
    await user.type(screen.getByLabelText('Description'), 'Coffee at Blue Tokai')
    await act(async () => rejectContext(new Error('context unavailable')))

    expect(await screen.findByRole('alert')).toHaveTextContent(/accounts and categories are unavailable/i)
    expect(screen.getByLabelText(/your message/i)).toHaveValue('  Paid 250 for coffee  ')
    expect(screen.getByLabelText('Amount in rupees')).toHaveValue(250)
    expect(screen.getByLabelText('Description')).toHaveValue('Coffee at Blue Tokai')
    expect(screen.getByRole('button', { name: /confirm and add transaction/i })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Paid from account' })).toHaveDisplayValue('HDFC UPI'))
    expect(screen.getByLabelText(/your message/i)).toHaveValue('  Paid 250 for coffee  ')
    expect(screen.getByLabelText('Amount in rupees')).toHaveValue(250)
    expect(screen.getByLabelText('Description')).toHaveValue('Coffee at Blue Tokai')
  })

  it.each([
    ['Expense', 'debit', 'Food & Dining'],
    ['Income', 'credit', 'Salary'],
    ['Transfer', 'transfer', 'Transfer']
  ] as const)('recovers exact text as a manual %s', async (label, expectedKind, expectedCategory) => {
    const user = userEvent.setup()
    const sourceText = `  exact ${label} source text  `
    vi.spyOn(api, 'parseDraft').mockImplementation(async (text) => {
      throw new api.CaptureDraftUnavailableError(text)
    })
    const onConfirm = vi.fn().mockImplementation(async (draft: TransactionDraft) => ({
      id: `confirmed-${label}`,
      ...draft,
      personalSharePaise: draft.amountPaise,
      status: 'confirmed' as const
    }))
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), sourceText)
    await user.click(screen.getByRole('button', { name: /create review draft/i }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('radio', { name: label }))
    await user.type(screen.getByLabelText('Amount in rupees'), '125')
    await user.type(screen.getByLabelText('Description'), `${label} correction`)
    if (label === 'Transfer') {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Transfer to account' }), '1')
    }

    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /confirm and add transaction/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      kind: expectedKind,
      category: expectedCategory,
      sourceText
    }))
  })

  it('filters server-owned categories by transaction direction', async () => {
    const user = userEvent.setup()
    render(<RouterProvider><QuickAddPage onConfirm={vi.fn()} members={[]} /></RouterProvider>)
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))

    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category).toHaveDisplayValue('Food & Dining')
    expect(screen.getByRole('option', { name: 'Food & Dining' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Income' }))
    expect(category).toHaveDisplayValue('Salary')
    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Food & Dining' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
  })

  it('clears invalid split, destination and category fields when type changes', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockImplementation(async (draft: TransactionDraft) => ({
      id: 'switched-kind', ...draft, personalSharePaise: draft.amountPaise, status: 'confirmed' as const
    }))
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[{ id: 'sam', name: 'Sam' }]} /></RouterProvider>)
    await user.click(screen.getByRole('button', { name: 'Enter details manually' }))
    await user.type(screen.getByLabelText('Amount in rupees'), '500')
    await user.type(screen.getByLabelText('Description'), 'Changed transaction')
    await user.click(screen.getByLabelText('Share with Sam'))
    await user.click(screen.getByRole('radio', { name: 'Transfer' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transfer to account' }), '1')
    await user.click(screen.getByRole('radio', { name: 'Income' }))

    expect(screen.queryByRole('combobox', { name: 'Transfer to account' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Share with Sam')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('Salary')
    await user.click(screen.getByRole('button', { name: /confirm and add transaction/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      kind: 'credit',
      category: 'Salary',
      memberSplits: [],
      destinationAccountId: undefined,
      destinationAccount: undefined
    }))
  })

  it('requires correction when AI returns a category outside the server allow-list', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'parseDraft').mockResolvedValue({
      demo: false,
      data: {
        kind: 'debit', amountPaise: 25_000, merchant: 'Coffee', category: 'Invented category',
        account: 'HDFC UPI', sourceAccountId: 'demo-hdfc-upi', occurredAt: localDateOffset(0),
        note: '', memberSplits: [], confidence: 'high', sourceText: 'Paid 250 for coffee'
      }
    })
    const onConfirm = vi.fn()
    render(<RouterProvider><QuickAddPage onConfirm={onConfirm} members={[]} /></RouterProvider>)

    await user.type(screen.getByLabelText(/your message/i), 'Paid 250 for coffee')
    await user.click(screen.getByRole('button', { name: /create review draft/i }))

    const category = await screen.findByRole('combobox', { name: 'Category' })
    expect(category).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Invented category' })).not.toBeInTheDocument()
    expect(screen.getByText(/choose a category available for this transaction type/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm and add transaction/i })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.selectOptions(category, 'Food & Dining')
    expect(screen.getByRole('button', { name: /confirm and add transaction/i })).toBeEnabled()
  })
})

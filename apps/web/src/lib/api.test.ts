import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TransactionDraft } from '../types'

function assistantEnvelope(widget: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    mode: 'model',
    result: {
      message: 'Here is your current account overview.',
      intent: 'summary',
      widgets: [widget]
    },
    ...overrides
  }
}

describe('FastAPI adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('maps the authenticated capture context contract', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accounts: [
        { id: 'account-1', name: 'ICICI Bank', kind: 'bank' },
        { id: 2, name: 'Cash', kind: 'cash' }
      ],
      categories: [
        { id: 'food', name: 'Food & Dining', kind: 'expense' },
        { id: 'salary', name: 'Salary', kind: 'income' },
        { id: 'other', name: 'Other', kind: 'both' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { getCaptureContext } = await import('./api')

    await expect(getCaptureContext()).resolves.toEqual({
      accounts: [
        { id: 'account-1', name: 'ICICI Bank', kind: 'bank' },
        { id: 2, name: 'Cash', kind: 'cash' }
      ],
      categories: [
        { id: 'food', name: 'Food & Dining', kind: 'expense' },
        { id: 'salary', name: 'Salary', kind: 'income' },
        { id: 'other', name: 'Other', kind: 'both' }
      ]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.artha.test/api/v1/capture-context',
      expect.any(Object)
    )
  })

  it('rejects an invalid capture-context category kind', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accounts: [{ id: 'account-1', name: 'ICICI Bank', kind: 'bank' }],
      categories: [{ id: 'transfer', name: 'Transfer', kind: 'transfer' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { getCaptureContext } = await import('./api')

    await expect(getCaptureContext()).rejects.toThrow('Capture context response was invalid.')
  })

  it('preserves the parsed source account id through confirmation', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        draft: {
          kind: 'expense', amount_paise: 184000, description: 'Groceries', category: 'Groceries',
          paid_by_member_id: null, personal_share_paise: 92000, splits: [{ member_id: 7, amount_paise: 92000 }],
          source_account_id: 42, occurred_at: '2026-08-04T12:00:00Z', platform: 'Zomato',
          subcategory: 'Delivery',
          category_suggestion: { source: 'safe_catalog', confidence: 1, reason: 'Known platform.' },
          metadata: {
            version: 1,
            evidence: { platform: { source: 'safe_catalog', confidence: 1, review_status: 'needs_review' } },
            attributes: [{ key: 'order_channel', value: 'Delivery', source: 'safe_catalog', confidence: 1, review_status: 'needs_review' }]
          },
          tag_suggestions: [{ name: 'Work Meal', normalized_name: 'work meal', source: 'user_explicit', confidence: 0.95, review_status: 'needs_review' }]
        }, confidence: 0.97, warnings: []
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 42, name: 'HDFC UPI' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 7, name: 'Sam' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 9, kind: 'expense', amount_paise: 184000, description: 'Groceries', category: 'Groceries',
        paid_by_member_id: null, personal_share_paise: 92000, splits: [{ member_id: 7, amount_paise: 92000 }],
        source_account_id: 42, occurred_at: '2026-08-04T12:00:00Z'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { confirmDraft, isCaptureClarification, parseDraft } = await import('./api')

    const parsed = await parseDraft('Paid 1840 for groceries from HDFC UPI, split equally with Sam')
    if (isCaptureClarification(parsed.data)) throw new Error('expected a review draft')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(expect.objectContaining({ timezone: expect.any(String) }))
    expect(parsed.data.sourceAccountId).toBe(42)
    expect(parsed.data).toMatchObject({
      platform: 'Zomato',
      subcategory: 'Delivery',
      categorySuggestion: { source: 'safe_catalog', confidence: 1, reason: 'Known platform.' },
      metadata: {
        version: 1,
        evidence: { platform: { source: 'safe_catalog', confidence: 1, reviewStatus: 'needs_review' } },
        attributes: [{ key: 'order_channel', value: 'Delivery', source: 'safe_catalog', confidence: 1, reviewStatus: 'needs_review' }]
      },
      tags: [{ name: 'Work Meal', normalizedName: 'work meal', selected: true }]
    })
    const confirmed = await confirmDraft(parsed.data)

    const confirmInit = fetchMock.mock.calls[3]?.[1] as RequestInit
    expect(JSON.parse(String(confirmInit.body))).toMatchObject({
      source_account_id: 42,
      paid_by_member_id: null,
      platform: 'Zomato',
      subcategory: 'Delivery',
      metadata: {
        version: 1,
        evidence: { platform: { source: 'user_corrected', confidence: 1, review_status: 'reviewed' } },
        attributes: [{ key: 'order_channel', value: 'Delivery', source: 'user_corrected', confidence: 1, review_status: 'reviewed' }]
      },
      tags: [{ name: 'Work Meal', normalized_name: 'work meal', source: 'user_corrected', confidence: 0.95, review_status: 'reviewed' }],
      splits: [{ member_id: 7, amount_paise: 92000 }]
    })
    expect((confirmInit.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
    expect(confirmed.account).toBe('HDFC UPI')
    expect(parsed.data.memberSplits).toEqual([{ memberId: '7', memberName: 'Sam', amountPaise: 92000 }])
  })

  it('surfaces API validation errors instead of creating a fake success', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 422 })))
    const { confirmDraft } = await import('./api')
    const draft: TransactionDraft = {
      kind: 'debit', amountPaise: 10000, merchant: 'Test', category: 'Other', account: 'HDFC UPI',
      sourceAccountId: 42, occurredAt: '2026-08-04', note: '', memberSplits: [],
      confidence: 'high', sourceText: 'Paid 100'
    }

    await expect(confirmDraft(draft)).rejects.toThrow('API request failed (422)')
  })

  it('does not hide a parser validation error behind the local fallback', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 422 })))
    const { parseDraft } = await import('./api')

    await expect(parseDraft('split equally without an amount')).rejects.toThrow('API request failed (422)')
  })

  it('maps a grounded capture clarification without treating it as an error', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/drafts/parse')) {
        return new Response(JSON.stringify({
          outcome: 'clarification',
          source_text: 'Paid 540 at Zomato',
          understood: { amount_paise: 54_000, kind: 'expense', merchant: 'Zomato' },
          missing_field: 'source_account_id',
          question: 'How did you pay for Zomato?',
          explanation: 'Choose one so Artha updates the correct balance. Nothing has been saved.',
          choices: [
            { id: 'hdfc', label: 'HDFC UPI', answer: 'paid from HDFC UPI' },
            { id: 'sbi', label: 'SBI Cashback Card', answer: 'paid from SBI Cashback Card' }
          ],
          warnings: [],
          parser_source: 'gemini:test-model'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/v1/accounts') || url.endsWith('/api/v1/members')) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { parseDraft } = await import('./api')

    const parsed = await parseDraft('Paid 540 at Zomato')

    expect(parsed).toMatchObject({
      demo: false,
      data: {
        outcome: 'clarification',
        sourceText: 'Paid 540 at Zomato',
        understood: { amountPaise: 54_000, kind: 'expense', merchant: 'Zomato' },
        missingField: 'source_account_id',
        choices: [
          { id: 'hdfc', label: 'HDFC UPI', answer: 'paid from HDFC UPI' },
          { id: 'sbi', label: 'SBI Cashback Card', answer: 'paid from SBI Cashback Card' }
        ]
      }
    })
  })

  it('uses the local parser only for a transient API outage in demo mode', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    const { isCaptureClarification, parseDraft } = await import('./api')

    const parsed = await parseDraft('Paid 250 for coffee yesterday from HDFC UPI')
    if (isCaptureClarification(parsed.data)) throw new Error('expected a review draft')
    expect(parsed.demo).toBe(true)
    expect(parsed.data.amountPaise).toBe(25_000)
    expect(parsed.data.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('fails closed when demo mode is not explicitly enabled', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    const { CaptureDraftUnavailableError, parseDraft } = await import('./api')
    const sourceText = 'self transfer 25k ICICI -> HDFC'

    await expect(parseDraft(sourceText)).rejects.toEqual(expect.objectContaining({
      name: 'CaptureDraftUnavailableError',
      sourceText
    }))
    await expect(parseDraft(sourceText)).rejects.toBeInstanceOf(CaptureDraftUnavailableError)
  })

  it('never interprets production capture locally after an AI or API failure', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/drafts/parse')) return new Response('{}', { status: 503 })
      if (url.endsWith('/api/v1/accounts')) {
        return new Response(JSON.stringify([
          { id: 1, name: 'ICICI', type: 'bank' },
          { id: 2, name: 'HDFC', type: 'bank' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/v1/members')) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { CaptureDraftUnavailableError, parseDraft } = await import('./api')
    const sourceText = 'self transfer 25k ICICI -> HDFC'
    const parsing = parseDraft(sourceText)

    await expect(parsing).rejects.toEqual(expect.objectContaining({
      name: 'CaptureDraftUnavailableError',
      sourceText
    }))
    await expect(parsing).rejects.toBeInstanceOf(CaptureDraftUnavailableError)
  })

  it('never substitutes fictional ledger data during a production API outage', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    const { chatAssistant, getAccounts, getDashboard, getTransactions } = await import('./api')

    await expect(getDashboard()).rejects.toThrow('API request failed (503)')
    await expect(getTransactions()).rejects.toThrow('API request failed (503)')
    await expect(getAccounts()).rejects.toThrow('API request failed (503)')
    await expect(chatAssistant('What is my balance?')).rejects.toThrow('API request failed (503)')
  })

  it('derives production onboarding state from the authenticated household', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const { isOnboardingComplete } = await import('./api')

    await expect(isOnboardingComplete()).resolves.toBe(true)
    await expect(isOnboardingComplete()).resolves.toBe(false)
  })

  it('bootstraps the API in demo mode', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { bootstrapDemo } = await import('./api')

    await bootstrapDemo()
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/v1/demo/bootstrap', expect.objectContaining({ method: 'POST' }))
  })

  it('injects the current bearer token into FastAPI requests', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { configureApiAccessTokenProvider, getMembers } = await import('./api')
    configureApiAccessTokenProvider(async () => 'current-access-token')

    await getMembers()

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer current-access-token' }))
  })

  it('hydrates the returning user profile from the server', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      display_name: 'Ari',
      household_name: 'Ari household',
      is_demo: true,
      members: [{ id: 'member-1', name: 'Sam' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { getUserProfile } = await import('./api')

    await expect(getUserProfile()).resolves.toEqual({
      displayName: 'Ari',
      householdName: 'Ari household',
      isDemo: true,
      members: [{ id: 'member-1', name: 'Sam' }]
    })
  })

  it('retries a transient first GET without requiring the user to try again', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 42, name: 'HDFC UPI', type: 'bank' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    vi.stubGlobal('fetch', fetchMock)
    const { getAccounts } = await import('./api')

    await expect(getAccounts()).resolves.toEqual([{ id: 42, name: 'HDFC UPI', kind: 'bank' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-idempotent setup write', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const { setupOnboarding } = await import('./api')

    await expect(setupOnboarding([], [])).rejects.toThrow('Artha could not reach the API')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a confirmed write with the same idempotency key', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 9, kind: 'expense', amount_paise: 10_000, personal_share_paise: 10_000,
        description: 'Coffee', category: 'Dining', source_account_id: 42,
        occurred_at: '2026-08-04T12:00:00Z', splits: []
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { confirmDraft } = await import('./api')
    const draft: TransactionDraft = {
      kind: 'debit', amountPaise: 10_000, merchant: 'Coffee', category: 'Dining', account: 'HDFC UPI',
      sourceAccountId: 42, occurredAt: '2026-08-04', note: '', memberSplits: [],
      confidence: 'high', sourceText: 'Paid 100 for coffee'
    }

    await expect(confirmDraft(draft)).resolves.toMatchObject({ id: '9', amountPaise: 10_000 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>
    expect(firstHeaders['Idempotency-Key']).toBeTruthy()
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key'])
  })

  it('posts reviewed setup accounts with card metadata', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { setupOnboarding } = await import('./api')
    const accounts = [{
      name: 'Travel Card', kind: 'credit_card' as const, opening_balance_paise: -12_500,
      credit_limit_paise: 200_000, statement_day: 5, payment_due_day: 25
    }]

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ accounts: [], members: [{ id: 7, name: 'Sam' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await setupOnboarding(accounts, [{ name: 'Sam' }])
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      accounts,
      members: [{ name: 'Sam' }],
      display_name: 'You',
      household_name: 'My household'
    })
  })

  it('maps only approved assistant widgets from the strict API response', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your spending overview.', intent: 'spending', widgets: [
        { type: 'metric', title: 'Spend', value_paise: 12345, caption: 'This month', tone: 'neutral' },
        { type: 'chart', title: 'Trend', chart_type: 'line', points: [{ label: 'Aug', value_paise: 5000 }] },
        { type: 'clarification', question: 'Which period?', choices: ['This month'] }
      ] }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { chatAssistant } = await import('./api')

    const reply = await chatAssistant('Show spending')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ message: 'Show spending' })
    expect(reply.message).toBe('Here is your spending overview.')
    expect(reply.provider).toBe('gemini · gemini-3.5-flash-lite')
    expect(Object.keys(reply).sort()).toEqual(['message', 'provider', 'widgets'])
    expect(reply.widgets.map((widget) => widget.type)).toEqual(['metric', 'line_chart', 'clarification'])
    expect(JSON.stringify(reply)).not.toContain('onerror')
  })

  it('accepts an empty optional metric caption and omits the UI detail', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(assistantEnvelope({
      type: 'metric', title: 'Balance', value_paise: 12345, caption: ''
    })), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { chatAssistant } = await import('./api')

    const reply = await chatAssistant('Show my balance')

    expect(reply.widgets).toEqual([expect.objectContaining({
      type: 'metric',
      title: 'Balance',
      detail: undefined
    })])
  })

  it('accepts all twenty server-bounded household table rows', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const payload = assistantEnvelope({
      type: 'table',
      title: 'Household balances',
      rows: Array.from({ length: 20 }, (_, index) => ({
        label: `Member ${index}`,
        amount_paise: index
      }))
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const { chatAssistant } = await import('./api')

    const reply = await chatAssistant('Show shared balances')

    expect(reply.widgets[0]?.type).toBe('table')
    if (reply.widgets[0]?.type !== 'table') throw new Error('Expected a table widget')
    expect(reply.widgets[0].rows).toHaveLength(20)
  })

  it.each([
    ['arbitrary financial prose', 'summary', 'Your balance is a grand.'],
    ['approved message for the wrong intent', 'summary', 'Here is your spending overview.'],
    ['whitespace-modified approved message', 'summary', '  Here is your current account overview.  ']
  ])('rejects assistant narrative contract violation: %s', async (_case, intent, message) => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const payload = assistantEnvelope({ type: 'metric', title: 'Balance', value_paise: 12345 })
    payload.result.intent = intent
    payload.result.message = message
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it('publishes the exact browser-side assistant narrative contract', async () => {
    const api = await import('./api')

    expect(api).toHaveProperty('APPROVED_ASSISTANT_MESSAGES', {
      summary: 'Here is your current account overview.',
      spending: 'Here is your spending overview.',
      income: 'Here is your income overview.',
      cashflow: 'Here is your cash-flow overview.',
      shared: 'Here are your shared balances.',
      transactions: 'Here is your recent ledger activity.',
      clarification: 'I need a little more detail to answer that.',
      unsupported: 'I can only help with read-only ledger questions.'
    })
  })

  it('rejects a successful response without a model-written assistant message', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: {
        intent: 'summary',
        widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it('rejects a legacy top-level assistant payload without a result envelope', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      mode: 'model',
      message: 'Legacy top-level model copy.',
      widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it.each([
    ['missing mode', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }] }
    }],
    ['deterministic mode', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'deterministic_fallback',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }] }
    }],
    ['missing intent', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }] }
    }],
    ['unknown intent', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'forecast', widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }] }
    }],
    ['missing widgets', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'summary' }
    }],
    ['empty widgets', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [] }
    }],
    ['overlong message', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'x'.repeat(401), intent: 'summary', widgets: [{ type: 'metric', title: 'Balance', value_paise: 12345 }] }
    }],
    ['unknown widget', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [{ type: 'html', content: '<b>unsafe</b>' }] }
    }],
    ['legacy widget alias', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [{ type: 'bar_chart', title: 'Trend', data: [{ label: 'Now', value: 1 }] }] }
    }],
    ['invalid chart widget', {
      provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'model',
      result: { message: 'Here is your current account overview.', intent: 'summary', widgets: [{ type: 'chart', title: 'Trend', chart_type: 'line', points: [] }] }
    }]
  ])('rejects an invalid assistant envelope with %s', async (_case, payload) => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it.each([
    ['malformed metric fields', { type: 'metric', title: 123, value_paise: 'oops' }],
    ['metric extra key', { type: 'metric', title: 'Balance', value_paise: 12345, sql: 'select 1' }],
    ['invalid chart type', { type: 'chart', title: 'Trend', chart_type: 'area', points: [{ label: 'Now', value_paise: 1 }] }],
    ['oversized chart points', { type: 'chart', title: 'Trend', chart_type: 'line', points: Array.from({ length: 13 }, (_, index) => ({ label: `P${index}`, value_paise: index })) }],
    ['invalid chart point label', { type: 'chart', title: 'Trend', chart_type: 'line', points: [{ label: 123, value_paise: 1 }] }],
    ['invalid chart point value', { type: 'chart', title: 'Trend', chart_type: 'line', points: [{ label: 'Now', value_paise: 'oops' }] }],
    ['empty table rows', { type: 'table', title: 'Activity', rows: [] }],
    ['oversized table rows', { type: 'table', title: 'Activity', rows: Array.from({ length: 21 }, (_, index) => ({ label: `R${index}`, amount_paise: index })) }],
    ['invalid table date', { type: 'table', title: 'Activity', rows: [{ label: 'Rent', amount_paise: 1, date: '7 Aug' }] }],
    ['invalid table kind', { type: 'table', title: 'Activity', rows: [{ label: 'Rent', amount_paise: 1, kind: 'forecast' }] }],
    ['ungrounded insight widget', { type: 'insight', title: 'Note', body: 'An arbitrary second narrative.' }],
    ['blank insight body', { type: 'insight', title: 'Note', body: '   ' }],
    ['overlong insight body', { type: 'insight', title: 'Note', body: 'x'.repeat(401) }],
    ['overlong clarification question', { type: 'clarification', question: 'x'.repeat(241), choices: [] }],
    ['too many clarification choices', { type: 'clarification', question: 'Choose a period', choices: ['A', 'B', 'C', 'D', 'E'] }],
    ['invalid clarification choice', { type: 'clarification', question: 'Choose a period', choices: ['   '] }]
  ])('rejects malformed assistant widget schema: %s', async (_case, widget) => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(assistantEnvelope(widget)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it.each([
    ['unknown provider', { provider: 'disabled' }],
    ['missing model', { model: undefined }],
    ['blank model', { model: '   ' }],
    ['overlong model', { model: 'x'.repeat(81) }]
  ])('rejects invalid assistant provider metadata: %s', async (_case, overrides) => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    const payload = assistantEnvelope({ type: 'metric', title: 'Balance', value_paise: 12345 }, overrides)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })))
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('Show my balance')).rejects.toThrow('Assistant response was invalid')
  })

  it('propagates assistant provider failures in demo mode without fabricating local widgets', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.test')
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { chatAssistant } = await import('./api')

    await expect(chatAssistant('What is my available balance?')).rejects.toThrow('API request failed (503)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('previews and restores a recovery bundle with an idempotency key', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.artha.test')
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sha256: 'a'.repeat(64), household_name: 'Family ledger', eligible: true, blocker: null,
        members: 2, accounts: 4, categories: 8, transactions: 42, splits: 10,
        transfers: 3, settlements: 1, merchant_rules: 2, audit_events: 20
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        household_id: 'household-1', restored: true, idempotent_replay: false, sha256: 'a'.repeat(64)
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { previewRecoveryBundle, restoreRecoveryBundle } = await import('./api')
    const bundle = { format: 'artha-recovery', schema_version: 1 }

    await expect(previewRecoveryBundle(bundle)).resolves.toMatchObject({ householdName: 'Family ledger', eligible: true, counts: { accounts: 4, transactions: 42 } })
    await expect(restoreRecoveryBundle(bundle, 'restore-key-123')).resolves.toMatchObject({ householdId: 'household-1', restored: true })

    const restoreRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(restoreRequest.method).toBe('POST')
    expect(restoreRequest.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': 'restore-key-123' }))
    expect(JSON.parse(String(restoreRequest.body))).toEqual(bundle)
  })
})

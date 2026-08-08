import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnboardingPage } from './OnboardingPage'

describe('OnboardingPage', () => {
  afterEach(cleanup)
  it('reviews and saves money plus credit-card opening balances', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<OnboardingPage onSave={onSave} onExploreDemo={vi.fn()} />)

    await user.clear(screen.getByLabelText('Your display name'))
    await user.type(screen.getByLabelText('Your display name'), 'Ari')
    await user.clear(screen.getByLabelText('Household name'))
    await user.type(screen.getByLabelText('Household name'), 'Shah family')
    await user.click(screen.getByRole('button', { name: /Add a family member/ }))
    await user.type(screen.getByLabelText('Family member 1 name'), 'Sam')
    await user.type(screen.getByLabelText('Money account 1 name'), 'HDFC UPI')
    await user.type(screen.getByLabelText('Money account 1 current balance'), '12500')
    await user.click(screen.getByRole('button', { name: /Add a credit card/ }))
    await user.type(screen.getByLabelText('Credit card 1 name'), 'Travel Card')
    await user.type(screen.getByLabelText('Credit card 1 outstanding'), '2400')
    await user.type(screen.getByLabelText('Credit card 1 credit limit'), '100000')
    await user.type(screen.getByLabelText('Credit card 1 statement day'), '5')
    await user.type(screen.getByLabelText('Credit card 1 payment due day'), '25')
    await user.click(screen.getByRole('button', { name: 'Review setup' }))
    await user.click(screen.getByRole('button', { name: 'Save setup and open Artha' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'HDFC UPI', kind: 'bank', opening_balance_paise: 1_250_000 }),
      expect.objectContaining({ name: 'Travel Card', kind: 'credit_card', opening_balance_paise: -240_000, credit_limit_paise: 10_000_000, statement_day: 5, payment_due_day: 25 })
    ], { displayName: 'Ari', householdName: 'Shah family', members: [{ id: expect.stringMatching(/^draft-/), name: 'Sam' }], isDemo: false })
  })

  it('offers an explicit sample demo without production-warning language', async () => {
    const user = userEvent.setup()
    const onExploreDemo = vi.fn().mockResolvedValue(undefined)
    render(<OnboardingPage onSave={vi.fn()} onExploreDemo={onExploreDemo} />)
    expect(screen.queryByText(/fictional|pilot/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Explore sample demo' }))
    await waitFor(() => expect(onExploreDemo).toHaveBeenCalledWith({ displayName: 'You', householdName: 'My household', members: [], isDemo: true }))
  })

  it('rejects duplicate names across money accounts and credit cards before review', async () => {
    const user = userEvent.setup()
    render(<OnboardingPage onSave={vi.fn()} onExploreDemo={vi.fn()} />)

    await user.type(screen.getByLabelText('Money account 1 name'), 'Shared name')
    await user.type(screen.getByLabelText('Money account 1 current balance'), '1000')
    await user.click(screen.getByRole('button', { name: /Add a credit card/ }))
    await user.type(screen.getByLabelText('Credit card 1 name'), ' shared NAME ')
    await user.type(screen.getByLabelText('Credit card 1 outstanding'), '100')
    await user.type(screen.getByLabelText('Credit card 1 credit limit'), '1000')
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(screen.getByRole('alert')).toHaveTextContent('unique name')
    expect(screen.getByRole('heading', { name: 'Where does your money live?' })).toBeInTheDocument()
  })

  it('rejects non-finite opening balances in the browser', async () => {
    const user = userEvent.setup()
    render(<OnboardingPage onSave={vi.fn()} onExploreDemo={vi.fn()} />)

    await user.type(screen.getByLabelText('Money account 1 name'), 'Primary')
    await user.type(screen.getByLabelText('Money account 1 current balance'), 'Infinity')
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(screen.getByRole('alert')).toHaveTextContent('current balance of zero or more')
  })

  it('does not advance with an empty required account row', async () => {
    const user = userEvent.setup()
    render(<OnboardingPage onSave={vi.fn()} onExploreDemo={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(screen.getByRole('alert')).toHaveTextContent('current balance of zero or more')
    expect(screen.getByRole('heading', { name: 'Where does your money live?' })).toBeInTheDocument()
  })

  it('rejects a credit-card outstanding amount above its limit', async () => {
    const user = userEvent.setup()
    render(<OnboardingPage onSave={vi.fn()} onExploreDemo={vi.fn()} />)

    await user.type(screen.getByLabelText('Money account 1 name'), 'Primary')
    await user.type(screen.getByLabelText('Money account 1 current balance'), '1000')
    await user.click(screen.getByRole('button', { name: /Add a credit card/ }))
    await user.type(screen.getByLabelText('Credit card 1 name'), 'Travel Card')
    await user.type(screen.getByLabelText('Credit card 1 outstanding'), '2000')
    await user.type(screen.getByLabelText('Credit card 1 credit limit'), '1000')
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(screen.getByRole('alert')).toHaveTextContent('cannot be higher than its credit limit')
  })
})

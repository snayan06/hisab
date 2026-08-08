import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { demoDashboard } from '../data/demo'
import { RouterProvider } from '../lib/router'
import { HomePage } from './HomePage'

describe('HomePage quick capture', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('passes the sentence directly to Quick Add route state', async () => {
    const user = userEvent.setup()
    render(
      <RouterProvider>
        <HomePage dashboard={demoDashboard} demoMode profile={{ displayName: 'You', householdName: 'My household', members: [], isDemo: true }} />
      </RouterProvider>,
    )

    const capture = 'Paid 1840 for groceries from HDFC UPI, split equally with Sam'
    await user.type(screen.getByLabelText(/describe a transaction/i), capture)
    await user.click(screen.getByRole('button', { name: /make draft/i }))

    expect(window.location.pathname).toBe('/add')
    expect(window.history.state).toEqual({ capture })
  })

  it('provides chart values without relying on color or hover', () => {
    render(
      <RouterProvider>
        <HomePage dashboard={demoDashboard} demoMode profile={{ displayName: 'You', householdName: 'My household', members: [], isDemo: true }} />
      </RouterProvider>,
    )

    const chartTable = screen.getByRole('table', { name: 'Six-month income and spending values' })
    expect(within(chartTable).getAllByRole('row')).toHaveLength(demoDashboard.monthly.length + 1)
    expect(within(chartTable).getByRole('columnheader', { name: 'Income' })).toBeInTheDocument()
  })

  it('shows a useful chart empty state', () => {
    render(
      <RouterProvider>
        <HomePage dashboard={{ ...demoDashboard, monthly: [] }} demoMode profile={{ displayName: 'You', householdName: 'My household', members: [], isDemo: true }} />
      </RouterProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('No monthly activity to chart yet')
  })
})

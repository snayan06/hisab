import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'


describe('LoginPage', () => {
  afterEach(cleanup)

  it('keeps magic link as the default and offers password sign in', async () => {
    const user = userEvent.setup()
    render(<LoginPage onSendLink={vi.fn()} onPasswordSignIn={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use a password instead' }))

    expect(screen.getByLabelText('Email address')).toBeVisible()
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('button', { name: 'Sign in with password' })).toBeVisible()
  })

  it('submits password sign in with Enter and never prints the password', async () => {
    const user = userEvent.setup()
    const onPasswordSignIn = vi.fn().mockResolvedValue(undefined)
    render(<LoginPage onSendLink={vi.fn()} onPasswordSignIn={onPasswordSignIn} />)

    await user.click(screen.getByRole('button', { name: 'Use a password instead' }))
    await user.type(screen.getByLabelText('Email address'), 'test@artha.com')
    await user.type(screen.getByLabelText('Password'), 'secret-value{Enter}')

    expect(onPasswordSignIn).toHaveBeenCalledWith('test@artha.com', 'secret-value')
    expect(document.body).not.toHaveTextContent('secret-value')
  })

  it('shows a generic password error without exposing provider details', async () => {
    const user = userEvent.setup()
    const onPasswordSignIn = vi.fn().mockRejectedValue(new Error('Email or password did not match. Please try again.'))
    render(<LoginPage onSendLink={vi.fn()} onPasswordSignIn={onPasswordSignIn} />)

    await user.click(screen.getByRole('button', { name: 'Use a password instead' }))
    await user.type(screen.getByLabelText('Email address'), 'test@artha.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-value')
    await user.click(screen.getByRole('button', { name: 'Sign in with password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password did not match')
    expect(screen.getByRole('alert')).not.toHaveTextContent('wrong-value')
  })
})

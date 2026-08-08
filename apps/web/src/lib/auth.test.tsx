import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from './router'

const supabase = vi.hoisted(() => {
  const getSession = vi.fn()
  const signInWithOtp = vi.fn()
  const signInWithPassword = vi.fn()
  const signOut = vi.fn()
  const refreshSession = vi.fn()
  let authCallback: ((event: AuthChangeEvent, session: Session | null) => void) | undefined
  const unsubscribe = vi.fn()
  const client = {
    auth: {
      getSession,
      signInWithOtp,
      signInWithPassword,
      signOut,
      refreshSession,
      onAuthStateChange: vi.fn((callback: typeof authCallback) => {
        authCallback = callback
        return { data: { subscription: { unsubscribe } } }
      })
    }
  }
  return { getSession, signInWithOtp, signInWithPassword, signOut, refreshSession, unsubscribe, client, callback: () => authCallback }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => supabase.client) }))

import App from '../App'
import { AuthProvider, isDemoMode, useAuth } from './auth'

function session(token: string): Session {
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'ari@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-08-04T00:00:00Z' }
  } as Session
}

function AuthProbe() {
  const auth = useAuth()
  return <div><span>{auth.status}</span><span>{auth.session?.access_token ?? 'none'}</span><button onClick={() => void auth.refreshSession()}>Refresh</button><button onClick={() => void auth.signOut()}>Sign out</button></div>
}

function PasswordProbe() {
  const auth = useAuth()
  return <button onClick={() => void auth.signInWithPassword('  demo@example.com  ', 'private-password')}>Use password</button>
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  }
}

describe('Supabase auth provider', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
    supabase.getSession.mockResolvedValue({ data: { session: null }, error: null })
    supabase.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    supabase.signInWithPassword.mockResolvedValue({ data: { session: session('password-token') }, error: null })
    supabase.signOut.mockResolvedValue({ error: null })
    supabase.refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
    storage.clear()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('fails closed when demo auth is not explicitly enabled', () => {
    vi.stubEnv('VITE_DEMO_MODE', '')

    expect(isDemoMode()).toBe(false)
  })

  it('shows an accessible magic-link gate and sends the redirect to this origin', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider>)

    expect(await screen.findByRole('heading', { name: 'Sign in to Artha' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email address'), 'ari@example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    await waitFor(() => expect(supabase.signInWithOtp).toHaveBeenCalledWith({
      email: 'ari@example.com',
      options: { emailRedirectTo: window.location.origin }
    }))
    expect(screen.getByRole('status')).toHaveTextContent('sign-in is not complete yet')
  })

  it('signs in with a password without persisting or echoing the password', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><PasswordProbe /></AuthProvider>)

    await user.click(await screen.findByRole('button', { name: 'Use password' }))

    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'demo@example.com',
      password: 'private-password'
    })
    expect(localStorage.getItem('private-password')).toBeNull()
    expect(document.body).not.toHaveTextContent('private-password')
  })

  it('loads, refreshes, observes and signs out of the persisted session', async () => {
    const firstSession = session('token-one')
    const secondSession = session('token-two')
    supabase.getSession.mockResolvedValue({ data: { session: firstSession }, error: null })
    supabase.refreshSession.mockResolvedValue({ data: { session: secondSession }, error: null })
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('token-one')).toBeInTheDocument()

    await act(async () => supabase.callback()?.('TOKEN_REFRESHED', secondSession))
    expect(screen.getByText('token-two')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(supabase.refreshSession).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(supabase.signOut).toHaveBeenCalledTimes(1))
  })

  it('restores the same signed-in session after the app remounts', async () => {
    const persisted = session('persisted-token')
    supabase.getSession.mockResolvedValue({ data: { session: persisted }, error: null })
    const first = render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('persisted-token')).toBeInTheDocument()
    first.unmount()
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('persisted-token')).toBeInTheDocument()
    expect(supabase.getSession).toHaveBeenCalledTimes(2)
  })

  it('explains an expired or reused link and lets the user request a fresh one', async () => {
    window.history.replaceState({}, '', '/?error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired')
    const user = userEvent.setup()
    render(<AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('This sign-in link has expired')
    expect(screen.getByRole('alert')).toHaveTextContent('open the newest email in this browser')
    expect(window.location.search).toBe('')

    await user.type(screen.getByLabelText('Email address'), 'ari@example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a fresh sign-in link' }))

    await waitFor(() => expect(supabase.signInWithOtp).toHaveBeenCalledWith({
      email: 'ari@example.com',
      options: { emailRedirectTo: window.location.origin }
    }))
    expect(screen.getByRole('status')).toHaveTextContent('sign-in is not complete yet')
  })

  it('explains a PKCE callback opened in the wrong browser', async () => {
    window.history.replaceState({}, '', '/?code=one-time-authorization-code&sb_flow_id=flow-id')
    render(<AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Open the link in the browser that requested it')
    expect(screen.getByRole('alert')).toHaveTextContent('does not have the secure sign-in verifier')
    expect(screen.getByLabelText('Email address')).toBeEnabled()
    expect(window.location.search).toBe('')
  })

  it('accepts a successful callback session without showing recovery guidance', async () => {
    const callbackSession = session('callback-token')
    window.history.replaceState({}, '', '/?code=one-time-authorization-code&sb_flow_id=flow-id')
    supabase.getSession.mockResolvedValue({ data: { session: callbackSession }, error: null })
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('callback-token')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('turns a session PKCE error into recoverable same-browser guidance', async () => {
    supabase.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'PKCE code verifier not found in storage' } })
    const user = userEvent.setup()
    render(<AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Open the link in the browser that requested it')
    expect(screen.getByLabelText('Email address')).toBeEnabled()
    await user.type(screen.getByLabelText('Email address'), 'ari@example.com')
    expect(screen.getByRole('button', { name: 'Email me a fresh sign-in link' })).toBeEnabled()
  })

  it('keeps an expired stored session recoverable without implying a new signup', async () => {
    supabase.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token: refresh token expired' } })
    render(<AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired')
    expect(screen.getByRole('alert')).toHaveTextContent('existing server-stored ledger and setup will still be there')
    expect(screen.getByLabelText('Email address')).toBeEnabled()
  })
})

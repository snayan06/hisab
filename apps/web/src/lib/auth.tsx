/* eslint-disable react-refresh/only-export-components */
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { configureApiAccessTokenProvider } from './api'

export type AuthStatus = 'demo' | 'loading' | 'authenticated' | 'unauthenticated' | 'error'

export interface AuthRecovery {
  kind: 'expired_link' | 'wrong_browser' | 'callback_failed' | 'session_failed'
  title: string
  message: string
}

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  error: string | null
  recovery: AuthRecovery | null
  signInWithMagicLink: (email: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const demoAuth: AuthContextValue = {
  status: 'demo',
  session: null,
  user: null,
  error: null,
  recovery: null,
  signInWithMagicLink: async () => undefined,
  signInWithPassword: async () => undefined,
  signOut: async () => undefined,
  refreshSession: async () => undefined
}

const AuthContext = createContext<AuthContextValue>(demoAuth)
let supabaseClient: SupabaseClient | null = null
const AUTH_CALLBACK_PARAMETERS = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'] as const

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}

function authConfiguration(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  return url && anonKey ? { url, anonKey } : null
}

function getSupabaseClient(): SupabaseClient | null {
  const configuration = authConfiguration()
  if (!configuration) return null
  if (!supabaseClient) {
    supabaseClient = createClient(configuration.url, configuration.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'artha.auth'
      }
    })
  }
  return supabaseClient
}

function callbackParameters(): URLSearchParams {
  const parameters = new URLSearchParams(window.location.search)
  const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  hashParameters.forEach((value, key) => {
    if (!parameters.has(key)) parameters.set(key, value)
  })
  return parameters
}

function classifyRecovery(message: string, code = '', context: 'callback' | 'session' = 'callback'): AuthRecovery {
  const normalized = `${code} ${message}`.toLowerCase()
  if (/pkce|code verifier|flow state|same browser/.test(normalized)) {
    return {
      kind: 'wrong_browser',
      title: 'Open the link in the browser that requested it',
      message: 'This browser does not have the secure sign-in verifier. Return to the browser where you requested the link, or request a fresh link here and open it here.'
    }
  }
  if (context === 'callback' && /otp_expired|expired|already (?:been )?used|invalid.*(?:otp|link)/.test(normalized)) {
    return {
      kind: 'expired_link',
      title: 'This sign-in link has expired',
      message: 'Magic links can expire and can only be used once. Request a fresh link below, then open the newest email in this browser.'
    }
  }
  if (context === 'session') {
    return {
      kind: 'session_failed',
      title: /expired|refresh token|session.*invalid/.test(normalized) ? 'Your session has expired' : 'Your session could not be restored',
      message: 'Request a fresh sign-in link below. Your existing server-stored ledger and setup will still be there.'
    }
  }
  return {
    kind: 'callback_failed',
    title: 'That sign-in link did not work',
    message: 'The link may be invalid or incomplete. Request a fresh link below and open it in this same browser.'
  }
}

function callbackRecovery(parameters: URLSearchParams): AuthRecovery | null {
  const error = parameters.get('error')?.trim() ?? ''
  const code = parameters.get('error_code')?.trim() ?? ''
  const description = parameters.get('error_description')?.trim() ?? ''
  return error || code || description ? classifyRecovery(description || error, code) : null
}

function clearCallbackParameters() {
  const url = new URL(window.location.href)
  AUTH_CALLBACK_PARAMETERS.forEach((parameter) => url.searchParams.delete(parameter))
  const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ''))
  const hasAuthHash = AUTH_CALLBACK_PARAMETERS.some((parameter) => hashParameters.has(parameter))
  if (hasAuthHash) url.hash = ''
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = isDemoMode()
  const [status, setStatus] = useState<AuthStatus>(demo ? 'demo' : 'loading')
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<AuthRecovery | null>(null)

  useEffect(() => {
    if (demo) {
      configureApiAccessTokenProvider(async () => null)
      setStatus('demo')
      setSession(null)
      setError(null)
      setRecovery(null)
      return
    }

    const client = getSupabaseClient()
    if (!client) {
      configureApiAccessTokenProvider(async () => null)
      setStatus('error')
      setError('Supabase authentication is not configured for this deployment.')
      setRecovery(null)
      return
    }

    let active = true
    const parameters = callbackParameters()
    const callbackIssue = callbackRecovery(parameters)
    const hasAuthorizationCode = parameters.has('code')
    configureApiAccessTokenProvider(async () => {
      const { data, error: sessionError } = await client.auth.getSession()
      if (sessionError) return null
      return data.session?.access_token ?? null
    })

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) {
        setStatus('unauthenticated')
        setError(null)
        setRecovery(classifyRecovery(sessionError.message, '', callbackIssue || hasAuthorizationCode ? 'callback' : 'session'))
        if (callbackIssue || hasAuthorizationCode) clearCallbackParameters()
        return
      }
      setSession(data.session)
      setStatus(data.session ? 'authenticated' : 'unauthenticated')
      setError(null)
      setRecovery(data.session
        ? null
        : callbackIssue ?? (hasAuthorizationCode ? classifyRecovery('PKCE code verifier is unavailable in this browser') : null))
      if (callbackIssue || hasAuthorizationCode) clearCallbackParameters()
    })

    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setStatus(nextSession ? 'authenticated' : 'unauthenticated')
      setError(null)
      if (nextSession || event === 'SIGNED_OUT') setRecovery(null)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
      configureApiAccessTokenProvider(async () => null)
    }
  }, [demo])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    user: session?.user ?? null,
    error,
    recovery,
    signInWithMagicLink: async (email: string) => {
      const client = getSupabaseClient()
      if (!client) throw new Error('Supabase authentication is not configured.')
      const { error: signInError } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin }
      })
      if (signInError) throw new Error('The sign-in link could not be sent. Please try again.')
      setRecovery(null)
    },
    signInWithPassword: async (email: string, password: string) => {
      const client = getSupabaseClient()
      if (!client) throw new Error('Supabase authentication is not configured.')
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password
      })
      if (signInError) throw new Error('Email or password did not match. Please try again.')
      setRecovery(null)
    },
    signOut: async () => {
      const client = getSupabaseClient()
      if (!client) return
      const { error: signOutError } = await client.auth.signOut()
      if (signOutError) throw new Error('Sign out failed. Please try again.')
    },
    refreshSession: async () => {
      const client = getSupabaseClient()
      if (!client) return
      const { data, error: refreshError } = await client.auth.refreshSession()
      if (refreshError) {
        setSession(null)
        setStatus('unauthenticated')
        setRecovery(classifyRecovery(refreshError.message, '', 'session'))
        throw new Error('Your session expired. Please sign in again.')
      }
      setSession(data.session)
      setStatus(data.session ? 'authenticated' : 'unauthenticated')
    }
  }), [error, recovery, session, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

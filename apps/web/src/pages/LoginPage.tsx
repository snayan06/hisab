import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ThemeControl } from '../components/ThemeControl'
import { Button, Card } from '../components/ui'
import type { AuthRecovery } from '../lib/auth'

export function LoginPage({
  configurationError,
  recovery,
  onSendLink,
  onPasswordSignIn
}: {
  configurationError?: string | null
  recovery?: AuthRecovery | null
  onSendLink: (email: string) => Promise<void>
  onPasswordSignIn: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (configurationError || !email.trim()) return
    setSending(true)
    setError('')
    setSent(false)
    try {
      if (usePassword) {
        await onPasswordSignIn(email.trim(), password)
      } else {
        await onSendLink(email.trim())
        setSent(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : usePassword ? 'Email or password did not match. Please try again.' : 'The sign-in link could not be sent.')
    } finally {
      setPassword('')
      setSending(false)
    }
  }

  return (
    <main className="safe-page min-h-[100svh] bg-canvas py-8 text-ink sm:grid sm:place-items-center">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex min-h-11 items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-moss-900 font-display text-xl font-bold text-white dark:bg-[#27604e]">H</span>
            <div><p className="font-display text-lg font-bold leading-none">Artha</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#839089] tone-subtle">Private ledger</p></div>
          </div>
          <ThemeControl />
        </header>

        <Card className="p-6 sm:p-8">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-moss-100 text-moss-800"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
          <h1 className="font-display mt-5 text-balance text-3xl font-bold tracking-[-0.05em]">Sign in to Artha</h1>
          <p className="mt-3 text-sm leading-6 text-[#6e7b74] tone-muted">There is no separate sign-up. Use a secure email link, or sign in with a password if your account has one.</p>

          {recovery && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <strong className="block">{recovery.title}</strong>
              <span className="mt-1 block">{recovery.message}</span>
            </div>
          )}

          <form className="mt-7" onSubmit={(event) => void submit(event)}>
            <label className="block" htmlFor="login-email">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7c8882] tone-muted">Email address</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7c8882]" aria-hidden="true" />
                <input id="login-email" name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} disabled={Boolean(configurationError)} placeholder="you@example.com…" className="min-h-12 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-sm font-semibold outline-none transition focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100 disabled:cursor-not-allowed disabled:opacity-60" />
              </span>
            </label>
            {usePassword && (
              <label className="mt-4 block" htmlFor="login-password">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7c8882] tone-muted">Password</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7c8882]" aria-hidden="true" />
                  <input id="login-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(configurationError)} className="min-h-12 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-sm font-semibold outline-none transition focus-visible:border-moss-400 focus-visible:ring-4 focus-visible:ring-moss-100 disabled:cursor-not-allowed disabled:opacity-60" />
                </span>
              </label>
            )}
            <Button type="submit" loading={sending} disabled={Boolean(configurationError) || (usePassword && !password)} className="mt-4 w-full">{usePassword ? 'Sign in with password' : recovery ? 'Email me a fresh sign-in link' : 'Email me a sign-in link'}</Button>
          </form>

          <button type="button" onClick={() => { setUsePassword((current) => !current); setError(''); setSent(false); setPassword('') }} disabled={Boolean(configurationError) || sending} className="mt-3 min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-moss-800 transition hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 disabled:cursor-not-allowed disabled:opacity-50">{usePassword ? 'Use an email link instead' : 'Use a password instead'}</button>

          {configurationError && <p role="alert" aria-live="polite" className="mt-4 break-words rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{configurationError}</p>}
          {error && <p role="alert" aria-live="polite" className="mt-4 break-words rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
          {sent && <p role="status" className="mt-4 rounded-xl border border-moss-200 bg-moss-50 px-4 py-3 text-sm leading-6 text-moss-900"><strong>Link sent—sign-in is not complete yet.</strong> Keep this tab open and open the email link in this same browser. Your existing onboarding and ledger will load automatically.</p>}
        </Card>
      </div>
    </main>
  )
}

export function SessionLoadingPage() {
  return <main className="grid min-h-[100svh] place-items-center bg-canvas px-4 text-ink"><div role="status" aria-live="polite" className="text-center"><span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-moss-200 border-t-moss-800 motion-reduce:animate-none" aria-hidden="true" /><p className="mt-4 text-sm font-semibold">Loading your secure session…</p></div></main>
}

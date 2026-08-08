import { CircleHelp, PencilLine } from 'lucide-react'
import { formatMoney } from '../lib/money'
import type { CaptureChoice, CaptureClarification } from '../types'
import { Button, Card } from './ui'

export function CaptureClarificationCard({
  clarification,
  busy,
  onChoose,
  onManual
}: {
  clarification: CaptureClarification
  busy: boolean
  onChoose: (choice: CaptureChoice) => void
  onManual: () => void
}) {
  const summary = [
    clarification.understood.merchant,
    clarification.understood.amountPaise ? formatMoney(clarification.understood.amountPaise) : undefined,
    clarification.understood.category
  ].filter(Boolean).join(' · ')

  return (
    <Card role="status" aria-live="polite" aria-label="More information needed" className="mt-5 overflow-hidden border-moss-200">
      <div className="flex items-start gap-3 bg-moss-50 p-5 dark:bg-night-raised">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-moss-800" aria-hidden="true">🍽️</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-moss-700">Here’s what I understood</p>
          <p className="mt-1 break-words text-base font-bold">{summary || 'A transaction to review'}</p>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-moss-700" aria-hidden="true" />
          <div>
            <h2 className="font-display text-lg font-bold">{clarification.question}</h2>
            <p className="mt-1 text-sm leading-6 text-[#68766f] tone-muted">{clarification.explanation}</p>
          </div>
        </div>
        {clarification.choices.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggested answers">
            {clarification.choices.map((choice) => (
              <button key={choice.id} type="button" disabled={busy} onClick={() => onChoose(choice)} className="min-h-11 rounded-full border border-moss-200 bg-white px-4 text-sm font-semibold text-moss-900 transition hover:border-moss-500 hover:bg-moss-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 disabled:cursor-not-allowed disabled:opacity-50">
                {choice.label}
              </button>
            ))}
          </div>
        )}
        <Button variant="secondary" className="mt-4" onClick={onManual} icon={<PencilLine className="h-4 w-4" aria-hidden="true" />}>Enter details manually</Button>
      </div>
    </Card>
  )
}

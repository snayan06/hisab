import type { MetadataEvidence, TransactionDraft } from '../types'

const correctedEvidence: MetadataEvidence = {
  source: 'user_corrected',
  confidence: 1,
  reviewStatus: 'needs_review'
}

export function TransactionMetadataReview({
  draft,
  onChange
}: {
  draft: TransactionDraft
  onChange: (draft: TransactionDraft) => void
}) {
  const updateField = (
    field: 'merchant' | 'platform' | 'subcategory',
    value: string
  ) => {
    const normalized = value.trim() ? value : undefined
    const evidence = { ...draft.metadata?.evidence }
    const invalidatesCategorySuggestion = Boolean(draft.categorySuggestion)
      && (field === 'merchant' || field === 'platform')
    const clearsDerivedSubcategory = field === 'merchant'
      && Boolean(draft.subcategory)
      && draft.metadata?.evidence.subcategory?.source !== 'user_corrected'
    if (field !== 'merchant' && normalized === undefined) delete evidence[field]
    else evidence[field] = correctedEvidence
    if (invalidatesCategorySuggestion) delete evidence.category
    if (clearsDerivedSubcategory) delete evidence.subcategory
    const attributes = field === 'platform'
      ? (draft.metadata?.attributes ?? []).filter((attribute) => attribute.key !== 'order_channel')
      : (draft.metadata?.attributes ?? [])
    onChange({
      ...draft,
      [field]: field === 'merchant' ? value : normalized,
      subcategory: clearsDerivedSubcategory
        ? undefined
        : (field === 'subcategory' ? normalized : draft.subcategory),
      category: invalidatesCategorySuggestion ? '' : draft.category,
      categorySuggestion: invalidatesCategorySuggestion ? undefined : draft.categorySuggestion,
      confidence: invalidatesCategorySuggestion ? 'review' : draft.confidence,
      metadata: draft.metadata
        ? {
            ...draft.metadata,
            evidence,
            attributes
          }
        : draft.metadata
    })
  }

  return (
    <div className="mx-5 mb-5 space-y-5 rounded-2xl border border-line bg-[#fbfcfa] p-4 dark:border-night-border dark:bg-night-raised">
      {draft.categorySuggestion && (
        <section aria-labelledby="suggested-category-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="suggested-category-heading" className="text-sm font-bold"><span aria-hidden="true">✨</span> Suggested category</h3>
            <span className="rounded-full bg-moss-100 px-2.5 py-1 text-xs font-semibold text-moss-800">{draft.category}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#66736d] tone-muted">{draft.categorySuggestion.reason}</p>
        </section>
      )}

      <section aria-labelledby="transaction-details-heading">
        <h3 id="transaction-details-heading" className="text-sm font-bold"><span aria-hidden="true">🧾</span> Transaction details</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MetadataField label="Merchant" value={draft.merchant} maxLength={160} onChange={(value) => updateField('merchant', value)} />
          <MetadataField label="Platform" value={draft.platform ?? ''} maxLength={100} placeholder="Optional" onChange={(value) => updateField('platform', value)} />
          <MetadataField label="Subcategory" value={draft.subcategory ?? ''} maxLength={80} placeholder="Optional" onChange={(value) => updateField('subcategory', value)} />
        </div>
      </section>

      <section aria-labelledby="context-heading">
        <h3 id="context-heading" className="text-sm font-bold"><span aria-hidden="true">💬</span> Context</h3>
        {draft.metadata?.attributes.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.metadata.attributes.map((attribute) => (
              <span key={attribute.key} className="rounded-full border border-moss-200 bg-white px-3 py-1.5 text-xs dark:border-night-border dark:bg-night-input">
                <span className="text-[#738078] tone-muted">{attribute.key === 'meal_occasion' ? 'Meal' : 'Order'}</span>{' '}
                <strong>{attribute.value}</strong>
              </span>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-[#738078] tone-muted">No extra context was inferred.</p>}
      </section>

      <section aria-labelledby="optional-tags-heading">
        <h3 id="optional-tags-heading" className="text-sm font-bold"><span aria-hidden="true">🏷️</span> Optional tags</h3>
        {draft.tags?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.tags.map((tag) => (
              <label key={tag.normalizedName} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold dark:border-night-border dark:bg-night-input">
                <input
                  type="checkbox"
                  aria-label={tag.name}
                  checked={tag.selected}
                  onChange={(event) => onChange({
                    ...draft,
                    tags: draft.tags?.map((item) => item.normalizedName === tag.normalizedName
                      ? { ...item, selected: event.target.checked, reviewStatus: 'needs_review' }
                      : item)
                  })}
                  className="h-4 w-4 accent-moss-800"
                />
                {tag.name}
              </label>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-[#738078] tone-muted">No optional tags suggested.</p>}
      </section>
    </div>
  )
}

function MetadataField({
  label,
  value,
  maxLength,
  placeholder,
  onChange
}: {
  label: string
  value: string
  maxLength: number
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="text-xs font-semibold text-[#65726b] tone-muted">
      {label}
      <input
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus-visible:border-moss-400 focus-visible:ring-2 focus-visible:ring-moss-100 dark:border-night-border dark:bg-night-input dark:text-night-ink"
      />
    </label>
  )
}

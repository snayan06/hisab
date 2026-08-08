import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatAssistant } from '../lib/api'
import { AssistantPage } from './AssistantPage'

vi.mock('../lib/api', () => ({ chatAssistant: vi.fn() }))

describe('AssistantPage generated UI', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows an accurate read-only AI disclosure before a question is sent', () => {
    render(<AssistantPage />)

    const notice = screen.getByRole('note', { name: /AI-assisted answer/i })
    expect(notice).toHaveTextContent(/configured AI provider.*reviewable answer/i)
    expect(notice).toHaveTextContent(/read-only and cannot change your ledger/i)
    expect(notice).not.toHaveTextContent(/fictional|pilot/i)
    expect(within(notice).getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings')
  })

  it('renders generated chart data as an accessible table', async () => {
    vi.mocked(chatAssistant).mockResolvedValue({
      message: 'Here is your spending overview.',
      provider: 'Test provider',
      widgets: [{
        type: 'bar_chart',
        title: 'Monthly spend',
        data: [{ label: 'July', value: 12000 }, { label: 'August', value: 15000 }]
      }]
    })
    const user = userEvent.setup()
    render(<AssistantPage />)

    await user.type(screen.getByLabelText('Ask Artha'), 'Show my monthly spending trend')
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText('Here is your spending overview.')).toBeInTheDocument()
    const dataTable = screen.getByRole('table', { name: 'Monthly spend values' })
    expect(within(dataTable).getByRole('rowheader', { name: 'August' })).toBeInTheDocument()
    expect(within(dataTable).getByRole('cell', { name: '15000' })).toBeInTheDocument()
  })

  it('submits with Enter and documents Shift+Enter', async () => {
    vi.mocked(chatAssistant).mockResolvedValue({
      message: 'Here is your spending overview.',
      provider: 'Test provider',
      widgets: []
    })
    const user = userEvent.setup()
    render(<AssistantPage />)

    await user.type(screen.getByLabelText('Ask Artha'), 'Show my spending{enter}')

    await waitFor(() => expect(chatAssistant).toHaveBeenCalledWith('Show my spending'))
    expect(screen.getByText(/Enter to continue/i)).toHaveTextContent(/Shift\+Enter for a new line/i)
  })

  it('does not submit Shift+Enter or an IME composition Enter', async () => {
    const user = userEvent.setup()
    render(<AssistantPage />)
    const composer = screen.getByLabelText('Ask Artha')

    await user.type(composer, 'Show my spending')
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })

    expect(chatAssistant).not.toHaveBeenCalled()
  })

  it('renders a chart-specific empty state instead of a broken graph', async () => {
    vi.mocked(chatAssistant).mockResolvedValue({
      message: 'Here is your recent ledger activity.',
      provider: 'Test provider',
      widgets: [{ type: 'line_chart', title: 'Monthly trend', data: [] }]
    })
    const user = userEvent.setup()
    render(<AssistantPage />)

    await user.type(screen.getByLabelText('Ask Artha'), 'Show a trend')
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText('No data is available for this chart yet.')).toBeInTheDocument()
  })

  it('labels successful model output as an AI response and shows its provider and model', async () => {
    vi.mocked(chatAssistant).mockResolvedValue({
      message: 'Here is your current account overview.',
      provider: 'Gemini · gemini-3.5-flash-lite',
      widgets: [{ type: 'metric', title: 'Available balance', value: '₹12,345' }]
    })
    const user = userEvent.setup()
    render(<AssistantPage />)

    await user.type(screen.getByLabelText('Ask Artha'), 'What is my available balance?')
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText('AI response')).toBeInTheDocument()
    expect(screen.getByText('Gemini · gemini-3.5-flash-lite')).toBeInTheDocument()
    expect(screen.queryByText('Deterministic fallback')).not.toBeInTheDocument()
  })

  it('restores the exact question after an unavailable response and permits retry without a fake exchange', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.mocked(chatAssistant)
      .mockRejectedValueOnce(new Error('API request failed (503)'))
      .mockResolvedValueOnce({
        message: 'Here is your current account overview.',
        provider: 'Ollama · qwen3:4b',
        widgets: [{ type: 'metric', title: 'Available balance', value: '₹12,345' }]
      })
    const user = userEvent.setup()
    render(<AssistantPage />)
    const rawQuestion = '  Could I cover a ₹12,000 repair today?  '
    const question = rawQuestion.trim()
    const input = screen.getByLabelText('Ask Artha')

    await user.type(input, rawQuestion)
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Artha could not reach the assistant. Your ledger was not changed; please try again.')
    expect(input).toHaveValue(rawQuestion)
    expect(chatAssistant).toHaveBeenNthCalledWith(1, question)
    expect(screen.queryByText(question, { selector: 'section p' })).not.toBeInTheDocument()
    expect(screen.queryByText('Available balance')).not.toBeInTheDocument()
    expect(screen.queryByText('AI response')).not.toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })

    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText('Here is your current account overview.')).toBeInTheDocument()
    expect(chatAssistant).toHaveBeenNthCalledWith(2, question)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('places an unavailable error before existing conversation history', async () => {
    vi.mocked(chatAssistant)
      .mockResolvedValueOnce({
        message: 'Here is your current account overview.',
        provider: 'Gemini · gemini-3.5-flash-lite',
        widgets: []
      })
      .mockRejectedValueOnce(new Error('API request failed (503)'))
    const user = userEvent.setup()
    render(<AssistantPage />)
    const input = screen.getByLabelText('Ask Artha')

    await user.type(input, 'What is my balance?')
    await user.click(screen.getByRole('button', { name: 'Send question' }))
    expect(await screen.findByText('Here is your current account overview.')).toBeInTheDocument()

    await user.type(input, 'Show my spending')
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    const alert = await screen.findByRole('alert')
    const priorQuestion = screen.getByText('What is my balance?', { selector: 'section p' })
    expect(alert.compareDocumentPosition(priorQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not submit a blank-only question', async () => {
    const user = userEvent.setup()
    render(<AssistantPage />)

    await user.type(screen.getByLabelText('Ask Artha'), '   ')

    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    expect(chatAssistant).not.toHaveBeenCalled()
  })

  it('disables the textarea while an assistant request is pending', async () => {
    vi.mocked(chatAssistant).mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    render(<AssistantPage />)
    const input = screen.getByLabelText('Ask Artha')

    await user.type(input, 'Show my balance')
    await user.click(screen.getByRole('button', { name: 'Send question' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Reading your latest ledger summary…')
    expect(input).toBeDisabled()
  })

  it('shows honest progress messages without exposing model reasoning', () => {
    vi.useFakeTimers()
    vi.mocked(chatAssistant).mockReturnValue(new Promise(() => undefined))
    render(<AssistantPage />)
    const input = screen.getByLabelText('Ask Artha')

    fireEvent.change(input, { target: { value: 'Where did I spend the most?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))

    expect(screen.getByRole('status')).toHaveTextContent('Reading your latest ledger summary…')
    act(() => vi.advanceTimersByTime(650))
    expect(screen.getByRole('status')).toHaveTextContent('Choosing the safest view for your question…')
    act(() => vi.advanceTimersByTime(650))
    expect(screen.getByRole('status')).toHaveTextContent('Preparing verified numbers and charts…')
    expect(screen.getByRole('status')).not.toHaveTextContent(/thinking|reasoning|chain of thought/i)

    vi.useRealTimers()
  })
})

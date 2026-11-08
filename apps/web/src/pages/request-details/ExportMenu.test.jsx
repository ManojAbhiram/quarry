import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../components/kit'
import ExportMenu from './ExportMenu'

const setup = (exporter) =>
  render(
    <ToastProvider>
      <ExportMenu exporter={exporter} />
    </ToastProvider>,
  )

describe('ExportMenu', () => {
  it('exports in the chosen format', async () => {
    const exporter = vi.fn(() => Promise.resolve())
    setup(exporter)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel (.xlsx)' }))
    expect(exporter).toHaveBeenCalledWith('xlsx')
  })

  it('shows a busy state while exporting and blocks a second export', async () => {
    let finish
    const exporter = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    setup(exporter)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(screen.getByRole('button', { name: 'CSV (.csv)' }))
    const trigger = screen.getByRole('button', { name: 'Exporting' })
    expect(trigger).toHaveTextContent('Exporting')
    await userEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'PDF report (.pdf)' })).toBeDisabled()
    expect(exporter).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument())
  })

  it('raises an error toast when the export fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setup(vi.fn(() => Promise.reject(new Error('boom'))))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(screen.getByRole('button', { name: 'PDF report (.pdf)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export PDF')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from './index'

const setup = (props = {}) =>
  render(
    <div>
      <Menu label="Account menu" button={<span>AR</span>} {...props}>
        {({ close }) => (
          <div>
            <p>Signed in as Asha</p>
            <button onClick={close}>Done</button>
          </div>
        )}
      </Menu>
      <button>outside</button>
    </div>,
  )

describe('Menu', () => {
  it('starts closed and tells assistive tech it can expand', () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Signed in as Asha')).not.toBeInTheDocument()
  })

  it('opens on click and reports it', async () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Signed in as Asha')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the button', async () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Signed in as Asha')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the user clicks elsewhere', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByText('Signed in as Asha')).not.toBeInTheDocument()
  })

  it('lets the content close the menu', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Signed in as Asha')).not.toBeInTheDocument()
  })

  it('toggles closed when the button is clicked again', async () => {
    const onOpenChange = vi.fn()
    setup({ onOpenChange })
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await userEvent.click(trigger)
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)
  })
})

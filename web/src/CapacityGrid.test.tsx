import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CapacityGrid } from './CapacityGrid'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function capacity(weeklyHours: number, allocatedHours: number, week = '2026-01-05') {
  return {
    weeks: [week],
    people: [{ id: 4, name: 'Dee Okafor', weeklyHours, allocatedHours: [allocatedHours] }],
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

test('keeps the draft and current numbers when a save fails', async () => {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) =>
    options?.method === 'PATCH'
      ? new Response('Service unavailable', { status: 503 })
      : jsonResponse(capacity(40, 45)),
  )
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Weekly hours for Dee Okafor' }), {
    target: { value: '50' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Save failed: Service unavailable')).toBeTruthy()
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')
  expect(screen.getByText('45 / 40 h')).toBeTruthy()
  expect(screen.getByText('Over by 5 h')).toBeTruthy()
})

test('updates capacity from the save response while the refresh is pending', async () => {
  const refresh = deferred<Response>()
  let reads = 0
  const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      return Promise.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours: 50 }))
    }
    reads += 1
    return reads === 1 ? Promise.resolve(jsonResponse(capacity(40, 45))) : refresh.promise
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await screen.findByText('45 / 50 h')
  expect(screen.queryByText('Over by 5 h')).toBeNull()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

  await act(async () => {
    refresh.resolve(jsonResponse(capacity(50, 45)))
    await refresh.promise
  })
  await waitFor(() => expect(screen.queryByText('Refreshing capacity…')).toBeNull())
})

test('does not show an old range response after a newer range loads', async () => {
  const oldRange = deferred<Response>()
  const fetchMock = vi.fn((url: RequestInfo | URL) =>
    String(url).includes('from=2026-01-05')
      ? Promise.resolve(jsonResponse(capacity(20, 10)))
      : oldRange.promise,
  )
  vi.stubGlobal('fetch', fetchMock)

  const view = render(<CapacityGrid from="2025-12-29" to="2026-01-04" />)
  view.rerender(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('10 / 20 h')

  await act(async () => {
    oldRange.resolve(jsonResponse(capacity(40, 45, '2025-12-29')))
    await oldRange.promise
  })

  expect(screen.getByText('10 / 20 h')).toBeTruthy()
  expect(screen.queryByText('45 / 40 h')).toBeNull()
})

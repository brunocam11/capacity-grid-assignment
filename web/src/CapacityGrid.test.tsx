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
      ? new Response('person not found', { status: 404 })
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

  expect(await screen.findByText("Could not save Dee Okafor's weekly hours: person not found")).toBeTruthy()
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

  const editButton = screen.getByRole('button', { name: 'Edit' })
  fireEvent.click(editButton)
  expect(document.activeElement).toBe(screen.getByRole('spinbutton'))
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
  expect(screen.getByText("Saved Dee Okafor's weekly hours.")).toBeTruthy()
  expect(document.activeElement).toBe(editButton)
})

test('shows server and network load errors with a working Retry button', async () => {
  let requests = 0
  const fetchMock = vi.fn(() => {
    requests += 1
    if (requests === 1) return Promise.resolve(new Response(null, { status: 500 }))
    if (requests === 2) return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(jsonResponse(capacity(40, 45)))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  expect(await screen.findByText('Could not load capacity: Server error. Try again.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Could not load capacity: Check your connection and try again.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('45 / 40 h')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test('does not replace an active draft while another person is visible', async () => {
  const save = deferred<Response>()
  let weeklyHours = 40
  const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      return save.promise.then((response) => {
        weeklyHours = 50
        return response
      })
    }
    return Promise.resolve(jsonResponse({
      weeks: ['2026-01-05'],
      people: [
        { id: 4, name: 'Dee Okafor', weeklyHours, allocatedHours: [45] },
        { id: 5, name: 'Eli Nakamura', weeklyHours: 0, allocatedHours: [20] },
      ],
    }))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')

  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Weekly hours for Dee Okafor' }), {
    target: { value: '50' },
  })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Eli' } })
  expect(screen.getByText('Editing Dee Okafor')).toBeTruthy()
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')
  expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Editing Dee Okafor')).toBeTruthy()

  await act(async () => {
    save.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours: 50 }))
    await save.promise
  })
  await screen.findByText("Saved Dee Okafor's weekly hours.")
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  await screen.findByText('45 / 50 h')
})

test('keeps a draft across a range change, failed save, and retry', async () => {
  const firstSave = deferred<Response>()
  let saves = 0
  let weeklyHours = 40
  const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      saves += 1
      if (saves === 1) return firstSave.promise
      weeklyHours = 50
      return Promise.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours }))
    }
    const week = String(url).includes('from=2026-01-12') ? '2026-01-12' : '2026-01-05'
    return Promise.resolve(jsonResponse(capacity(weeklyHours, 45, week)))
  })
  vi.stubGlobal('fetch', fetchMock)

  const view = render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  view.rerender(<CapacityGrid from="2026-01-12" to="2026-01-18" />)
  await screen.findByText('Week of Jan 12')
  expect(screen.getByText('Editing Dee Okafor')).toBeTruthy()
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')

  await act(async () => {
    firstSave.resolve(new Response(null, { status: 500 }))
    await firstSave.promise
  })
  expect(await screen.findByText("Could not save Dee Okafor's weekly hours: Server error. Try again.")).toBeTruthy()
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('45 / 50 h')
  expect(screen.getByText("Saved Dee Okafor's weekly hours.")).toBeTruthy()
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

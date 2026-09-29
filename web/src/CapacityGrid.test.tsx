import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CapacityGrid } from './CapacityGrid'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('table-scroll')) return 600
    return this.classList.contains('capacity-row') ? 72 : 0
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
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

  const editButton = screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' })
  fireEvent.click(editButton)
  expect(document.activeElement).toBe(screen.getByRole('spinbutton'))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await screen.findByText('45 / 50 h')
  expect(screen.queryByText('Over by 5 h')).toBeNull()
  expect(fetchMock).toHaveBeenCalledWith('/api/people/4', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{"weeklyHours":50}',
  })
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

  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Weekly hours for Dee Okafor' }), {
    target: { value: '50' },
  })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Eli' } })
  expect(screen.getByText('Editing Dee Okafor')).toBeTruthy()
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')
  expect((screen.getByRole('button', { name: 'Edit weekly hours for Eli Nakamura' }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect((screen.getByRole('button', { name: 'Edit weekly hours for Eli Nakamura' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Editing Dee Okafor')).toBeTruthy()

  await act(async () => {
    save.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours: 50 }))
    await save.promise
  })
  await screen.findByText("Saved Dee Okafor's weekly hours.")
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Capacity grid' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  view.rerender(<CapacityGrid from="2026-01-12" to="2026-01-18" />)
  await screen.findByText('Week of Jan 12')
  expect(screen.getByText('Applied range: Jan 12, 2026 – Jan 18, 2026')).toBeTruthy()
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

test('keeps a newer save when an older request for the same range arrives late', async () => {
  const oldRefresh = deferred<Response>()
  let reads = 0
  let saves = 0
  const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      saves += 1
      return Promise.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours: saves === 1 ? 50 : 60 }))
    }
    reads += 1
    if (reads === 1) return Promise.resolve(jsonResponse(capacity(40, 45)))
    return reads === 2 ? oldRefresh.promise : Promise.resolve(jsonResponse(capacity(60, 45)))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')
  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('45 / 50 h')
  await waitFor(() => expect(reads).toBe(2))

  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('45 / 60 h')
  await waitFor(() => expect(reads).toBe(3))

  await act(async () => {
    oldRefresh.resolve(jsonResponse(capacity(50, 45)))
    await oldRefresh.promise
  })
  expect(screen.getByText('45 / 60 h')).toBeTruthy()
  expect(screen.queryByText('45 / 50 h')).toBeNull()
})

test('keeps saved hours visible when the following refresh fails', async () => {
  let reads = 0
  const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      return Promise.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours: 50 }))
    }
    reads += 1
    return Promise.resolve(reads === 1
      ? jsonResponse(capacity(40, 45))
      : new Response(null, { status: 500 }))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('45 / 40 h')
  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await screen.findByText('Could not load capacity: Server error. Try again.')
  expect(screen.getByText('45 / 50 h')).toBeTruthy()
  expect(screen.getByText("Saved Dee Okafor's weekly hours.")).toBeTruthy()
})

test('rejects capacity precision that the grid cannot display', async () => {
  let weeklyHours = 40
  const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      weeklyHours = 39.99
      return Promise.resolve(jsonResponse({ id: 4, name: 'Dee Okafor', weeklyHours }))
    }
    return Promise.resolve(jsonResponse(capacity(weeklyHours, 40)))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('40 / 40 h')
  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Dee Okafor' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '39.999' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Enter 0 to 168 weekly hours with at most two decimal places for Dee Okafor.')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(1)

  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '39.99' } })
  expect(screen.queryByText('Enter 0 to 168 weekly hours with at most two decimal places for Dee Okafor.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('40 / 39.99 h')
  expect(screen.getByText('Over by 0.01 h')).toBeTruthy()
})

test('mounts only nearby rows and keeps the edit draft while scrolling and filtering', async () => {
  const people = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    name: `Person ${String(index).padStart(3, '0')}`,
    weeklyHours: 40,
    allocatedHours: [45],
  }))
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ weeks: ['2026-01-05'], people })))

  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  await screen.findByText('Person 000')
  const scrollArea = screen.getByRole('region', { name: 'Capacity results' })
  const mountedRows = () => scrollArea.querySelectorAll('tr.capacity-row')
  expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('501')
  expect(mountedRows().length).toBeLessThan(30)

  fireEvent.click(screen.getByRole('button', { name: 'Edit weekly hours for Person 000' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
  fireEvent.scroll(scrollArea, { target: { scrollTop: 72 * 200 } })
  const scrolledPerson = await screen.findByText('Person 200')
  expect(scrolledPerson.closest('tr')?.getAttribute('aria-rowindex')).toBe('202')
  expect(screen.queryByText('Person 000')).toBeNull()
  expect(mountedRows().length).toBeLessThan(30)
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Person 4' } })
  expect(scrollArea.scrollTop).toBe(0)
  fireEvent.scroll(scrollArea)
  await screen.findByText('Person 400')
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Capacity grid' }))
})

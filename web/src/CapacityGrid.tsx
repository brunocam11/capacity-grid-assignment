import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

type Props = {
  from: string
  to: string
}

type CapacityPerson = {
  id: number
  name: string
  weeklyHours: number
  allocatedHours: number[]
}

type CapacityResponse = {
  weeks: string[]
  people: CapacityPerson[]
}

type UpdatedPerson = Pick<CapacityPerson, 'id' | 'name' | 'weeklyHours'>
type EditingPerson = Pick<CapacityPerson, 'id' | 'name'>

const ROW_HEIGHT = 72
const hoursFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const weekFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const rangeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function weekLabel(value: string): string {
  return weekFormatter.format(new Date(`${value}T00:00:00Z`))
}

function rangeLabel(value: string): string {
  return rangeFormatter.format(new Date(`${value}T00:00:00Z`))
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'Check your connection and try again.'
  return error instanceof Error ? error.message : 'Please try again.'
}

async function responseErrorMessage(response: Response): Promise<string> {
  if (response.status >= 500) return 'Server error. Try again.'
  return (await response.text()).trim() || 'Please try again.'
}

export function CapacityGrid({ from, to }: Props) {
  const rangeKey = `${from}:${to}`
  const activeLoad = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const scrollArea = useRef<HTMLDivElement | null>(null)
  const editInput = useRef<HTMLInputElement | null>(null)
  const editButton = useRef<HTMLButtonElement | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; data: CapacityResponse } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState('')
  const [editingPerson, setEditingPerson] = useState<EditingPerson | null>(null)
  const [draftHours, setDraftHours] = useState('')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    activeLoad.current = controller
    const params = new URLSearchParams({ from, to })
    setLoading(true)
    setLoadError('')

    async function loadCapacity() {
      try {
        const response = await fetch(`/api/capacity?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response))
        }
        const data = (await response.json()) as CapacityResponse
        if (!controller.signal.aborted) {
          setLoaded({ key: rangeKey, data })
        }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadCapacity()
    return () => {
      controller.abort()
      if (activeLoad.current === controller) activeLoad.current = null
    }
  }, [from, to, revision, rangeKey])

  useEffect(() => {
    if (editingPerson && savingId === null) editInput.current?.focus()
  }, [editingPerson, savingId])

  useEffect(() => {
    if (editingPerson || !editButton.current) return
    if (editButton.current.isConnected && !editButton.current.disabled) {
      editButton.current.focus()
    } else {
      heading.current?.focus()
    }
    editButton.current = null
  }, [editingPerson])

  function startEditing(person: CapacityPerson, button: HTMLButtonElement) {
    if (editingPerson) return
    editButton.current = button
    setEditingPerson({ id: person.id, name: person.name })
    setDraftHours(String(person.weeklyHours))
    setSaveError('')
    setNotice('')
  }

  function cancelEditing() {
    if (savingId !== null) return
    setEditingPerson(null)
    setSaveError('')
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editingPerson === null || savingId !== null) return

    const enteredHours = Number(draftHours)
    const weeklyHours = Math.round(enteredHours * 100) / 100
    if (draftHours.trim() === '' || !Number.isFinite(enteredHours) || enteredHours < 0 || enteredHours > 168 || enteredHours !== weeklyHours) {
      setSaveError(`Enter 0 to 168 weekly hours with at most two decimal places for ${editingPerson.name}.`)
      return
    }

    const personId = editingPerson.id
    const personName = editingPerson.name
    setSavingId(personId)
    setSaveError('')
    setNotice('')
    try {
      const response = await fetch(`/api/people/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyHours }),
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response))
      }

      const saved = (await response.json()) as UpdatedPerson
      activeLoad.current?.abort()
      setLoaded((current) => current && {
        ...current,
        data: {
          ...current.data,
          people: current.data.people.map((person) =>
            person.id === saved.id ? { ...person, weeklyHours: saved.weeklyHours } : person,
          ),
        },
      })
      setEditingPerson(null)
      setNotice(`Saved ${saved.name}'s weekly hours.`)
      setRevision((value) => value + 1)
    } catch (error) {
      setSaveError(`Could not save ${personName}'s weekly hours: ${errorMessage(error)}`)
    } finally {
      setSavingId(null)
    }
  }

  const data = loaded?.key === rangeKey ? loaded.data : null
  const matchingPeople = useMemo(() => data?.people.filter((person) =>
    person.name.toLowerCase().includes(filter.trim().toLowerCase()),
  ) ?? [], [data, filter])
  const getPersonKey = useCallback((index: number) => matchingPeople[index]?.id ?? index, [matchingPeople])
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: matchingPeople.length,
    getScrollElement: () => scrollArea.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: getPersonKey,
    overscan: 5,
    initialRect: { width: 850, height: 600 },
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const topSpace = virtualRows[0]?.start ?? 0
  const bottomSpace = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0

  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }, [filter, rangeKey, matchingPeople.length])

  return (
    <section className="capacity-section" aria-labelledby="capacity-heading">
      <div className="section-heading">
        <div>
          <h2 id="capacity-heading" ref={heading} tabIndex={-1}>Capacity grid</h2>
          <p>Applied range: {rangeLabel(from)} – {rangeLabel(to)}</p>
          <p>Allocated hours / weekly capacity. Dates expand to full weeks.</p>
        </div>
        {data && <span className="people-count">{data.people.length} people</span>}
      </div>

      {loading && <p className="status" role="status">{data ? 'Refreshing capacity…' : 'Loading capacity…'}</p>}
      {loadError && (
        <div className="message error-message" role="alert">
          <span>Could not load capacity: {loadError}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      )}
      {notice && <p className="message success-message" role="status">{notice}</p>}

      {editingPerson && (
        <form className="edit-panel" onSubmit={saveHours} noValidate>
          <div>
            <strong>Editing {editingPerson.name}</strong>
            <p>Weekly hours apply to every week. Use up to two decimal places.</p>
          </div>
          <label>
            Weekly hours for {editingPerson.name}
            <input
              ref={editInput}
              type="number"
              min="0"
              max="168"
              step="0.01"
              value={draftHours}
              onChange={(event) => {
                setDraftHours(event.target.value)
                setSaveError('')
              }}
              disabled={savingId !== null}
              required
            />
          </label>
          <div className="edit-actions">
            <button type="submit" disabled={savingId !== null}>
              {savingId !== null ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={savingId !== null} onClick={cancelEditing}>
              Cancel
            </button>
          </div>
          {saveError && <p className="edit-error" role="alert">{saveError}</p>}
        </form>
      )}

      {data && (
        <>
          <div className="grid-tools">
            <label>
              Find a person
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search by name"
              />
            </label>
            <span>{matchingPeople.length} shown</span>
          </div>

          {matchingPeople.length === 0 ? (
            <p className="empty-state">No people match that search.</p>
          ) : (
            <div
              className="table-scroll"
              ref={scrollArea}
              role="region"
              aria-label="Capacity results"
              aria-busy={loading}
              tabIndex={0}
            >
              <table aria-rowcount={matchingPeople.length + 1} style={{ minWidth: `max(850px, ${22 + 9 * data.weeks.length}rem)` }}>
                <thead>
                  <tr aria-rowindex={1}>
                    <th scope="col">Person</th>
                    <th scope="col">Weekly hours</th>
                    {data.weeks.map((week) => <th scope="col" key={week}>Week of {weekLabel(week)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {topSpace > 0 && (
                    <tr className="virtual-spacer" aria-hidden="true">
                      <td colSpan={data.weeks.length + 2} style={{ height: topSpace }} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const person = matchingPeople[virtualRow.index]
                    return (
                      <tr
                        key={person.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="capacity-row"
                        aria-rowindex={virtualRow.index + 2}
                      >
                        <th scope="row" className="person-name" title={person.name}>{person.name}</th>
                        <td className="capacity-edit">
                          <div className="edit-display">
                            <span>{hoursFormatter.format(person.weeklyHours)} h</span>
                            <button
                              type="button"
                              className="text-button"
                              aria-label={`Edit weekly hours for ${person.name}`}
                              disabled={editingPerson !== null}
                              onClick={(event) => startEditing(person, event.currentTarget)}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                        {data.weeks.map((week, index) => {
                          const allocated = person.allocatedHours[index] ?? 0
                          const over = allocated > person.weeklyHours
                          return (
                            <td key={week} className={over ? 'over-capacity' : 'within-capacity'}>
                              <span className="cell-value">
                                {hoursFormatter.format(allocated)} / {hoursFormatter.format(person.weeklyHours)} h
                              </span>
                              {over && <span className="over-label">Over by {hoursFormatter.format(allocated - person.weeklyHours)} h</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {bottomSpace > 0 && (
                    <tr className="virtual-spacer" aria-hidden="true">
                      <td colSpan={data.weeks.length + 2} style={{ height: bottomSpace }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

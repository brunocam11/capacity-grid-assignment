import { useState, type FormEvent } from 'react'
import { CapacityGrid } from './CapacityGrid'

type DateRange = { from: string; to: string }

const INITIAL_RANGE: DateRange = { from: '2025-12-29', to: '2026-01-18' }
const DAY_MS = 24 * 60 * 60 * 1000

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function startOfWeek(value: string): string {
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay()
  return shiftDate(value, -((weekday + 6) % 7))
}

function endOfWeek(value: string): string {
  return shiftDate(startOfWeek(value), 6)
}

export function App() {
  const [range, setRange] = useState<DateRange>(INITIAL_RANGE)
  const [draft, setDraft] = useState<DateRange>(INITIAL_RANGE)
  const [rangeError, setRangeError] = useState('')

  function moveWeek(direction: number) {
    const next = {
      from: shiftDate(range.from, direction * 7),
      to: shiftDate(range.to, direction * 7),
    }
    setRange(next)
    setDraft(next)
    setRangeError('')
  }

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setRangeError('Choose a start date on or before the end date.')
      return
    }

    const next = { from: startOfWeek(draft.from), to: endOfWeek(draft.to) }
    const weekCount =
      (Date.parse(startOfWeek(next.to)) - Date.parse(next.from)) / (7 * DAY_MS) + 1
    if (weekCount > 12) {
      setRangeError('Choose a range of at most 12 weeks.')
      return
    }

    setRange(next)
    setDraft(next)
    setRangeError('')
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>Team capacity</h1>
          <p>Weekly allocation against each person’s available hours.</p>
        </div>
      </header>

      <form className="range-controls" onSubmit={applyRange}>
        <div className="week-navigation">
          <button type="button" onClick={() => moveWeek(-1)}>
            Previous week
          </button>
          <button type="button" onClick={() => moveWeek(1)}>
            Next week
          </button>
        </div>
        <label>
          From
          <input
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <button type="submit" className="primary-button">Apply range</button>
        <span className="range-hint">Monday to Sunday, up to 12 weeks</span>
        {rangeError && <p className="form-error" role="alert">{rangeError}</p>}
      </form>

      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}

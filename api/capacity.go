package main

import (
	"log"
	"net/http"
	"time"
)

const maxCapacityWeeks = 105

type capacityPerson struct {
	ID             int       `json:"id"`
	Name           string    `json:"name"`
	WeeklyHours    float64   `json:"weeklyHours"`
	AllocatedHours []float64 `json:"allocatedHours"`
}

type capacityResponse struct {
	Weeks  []string         `json:"weeks"`
	People []capacityPerson `json:"people"`
}

func weekStart(day time.Time) time.Time {
	weekday := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -weekday)
}

func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	from, fromErr := time.Parse(time.DateOnly, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.DateOnly, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil || from.After(to) {
		http.Error(w, "from and to must be valid dates in ascending order", http.StatusBadRequest)
		return
	}

	firstWeek := weekStart(from)
	lastWeek := weekStart(to)
	weeks := make([]string, 0, 12)
	weekIndexes := make(map[string]int)
	for day := firstWeek; !day.After(lastWeek); day = day.AddDate(0, 0, 7) {
		if len(weeks) == maxCapacityWeeks {
			http.Error(w, "range must span at most 105 weeks", http.StatusBadRequest)
			return
		}
		label := day.Format(time.DateOnly)
		weekIndexes[label] = len(weeks)
		weeks = append(weeks, label)
	}

	lastDay := lastWeek.AddDate(0, 0, 6)
	rows, err := s.db.Query(r.Context(), `
		WITH weekly_allocations AS (
			SELECT a.person_id,
				date_trunc('week', days.day)::date AS week_start,
				SUM(a.hours_per_day)::double precision AS allocated_hours
			FROM assignments a
			CROSS JOIN LATERAL generate_series(
				GREATEST(a.start_date, $1::date)::timestamp,
				LEAST(a.end_date, $2::date)::timestamp,
				interval '1 day'
			) AS days(day)
			WHERE a.start_date <= $2::date
				AND a.end_date >= $1::date
				AND EXTRACT(ISODOW FROM days.day) <= 5
			GROUP BY a.person_id, date_trunc('week', days.day)::date
		)
		SELECT p.id, p.name, p.weekly_hours::double precision,
			weeks.week_start::date,
			COALESCE(weekly_allocations.allocated_hours, 0)
		FROM people p
		CROSS JOIN generate_series(
			$1::date::timestamp,
			$2::date::timestamp,
			interval '1 week'
		) AS weeks(week_start)
		LEFT JOIN weekly_allocations
			ON weekly_allocations.person_id = p.id
			AND weekly_allocations.week_start = weeks.week_start::date
		ORDER BY p.name, p.id, weeks.week_start
	`, firstWeek, lastDay)
	if err != nil {
		log.Printf("load capacity: %v", err)
		http.Error(w, "could not load capacity", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	people := make([]capacityPerson, 0)
	currentID := -1
	for rows.Next() {
		var id int
		var name string
		var weeklyHours float64
		var week time.Time
		var allocatedHours float64
		if err := rows.Scan(&id, &name, &weeklyHours, &week, &allocatedHours); err != nil {
			log.Printf("scan capacity: %v", err)
			http.Error(w, "could not load capacity", http.StatusInternalServerError)
			return
		}
		if id != currentID {
			people = append(people, capacityPerson{
				ID:             id,
				Name:           name,
				WeeklyHours:    weeklyHours,
				AllocatedHours: make([]float64, len(weeks)),
			})
			currentID = id
		}
		index := weekIndexes[week.Format(time.DateOnly)]
		people[len(people)-1].AllocatedHours[index] = allocatedHours
	}
	if err := rows.Err(); err != nil {
		log.Printf("read capacity: %v", err)
		http.Error(w, "could not load capacity", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, capacityResponse{Weeks: weeks, People: people})
}

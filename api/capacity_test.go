package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func isolatedDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is required for SQL tests")
	}

	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	config.MinConns = 0
	if config.ConnConfig.RuntimeParams == nil {
		config.ConnConfig.RuntimeParams = make(map[string]string)
	}
	config.ConnConfig.RuntimeParams["search_path"] = "pg_temp"

	db, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)

	for _, statement := range []string{
		"CREATE TEMP TABLE people (LIKE public.people)",
		"CREATE TEMP TABLE assignments (LIKE public.assignments)",
	} {
		if _, err := db.Exec(context.Background(), statement); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestCapacityAggregatesFullWeeks(t *testing.T) {
	db := isolatedDB(t)
	s := &server{db: db}
	path := "/api/capacity?from=2026-01-07&to=2026-01-13"

	empty := httptest.NewRecorder()
	s.handleCapacity(empty, httptest.NewRequest(http.MethodGet, path, nil))
	if empty.Code != http.StatusOK {
		t.Fatalf("empty roster: got status %d, body %q", empty.Code, empty.Body.String())
	}
	var emptyResponse capacityResponse
	if err := json.Unmarshal(empty.Body.Bytes(), &emptyResponse); err != nil {
		t.Fatal(err)
	}
	if emptyResponse.People == nil || len(emptyResponse.People) != 0 {
		t.Fatalf("empty roster: expected an empty people array, got %+v", emptyResponse.People)
	}

	for _, statement := range []string{
		`INSERT INTO people (id, name, weekly_hours) VALUES
			(1, 'Ana', 40), (2, 'Ben', 0), (3, 'Cora', 32)`,
		`INSERT INTO assignments (id, person_id, project_id, start_date, end_date, hours_per_day) VALUES
			(1, 1, 1, '2026-01-05', '2026-01-09', 4),
			(2, 1, 1, '2026-01-07', '2026-01-13', 2),
			(3, 1, 1, '2026-01-07', '2026-01-13', 2),
			(4, 1, 1, '2026-01-10', '2026-01-11', 9),
			(5, 1, 1, '2026-01-12', '2026-01-16', 3),
			(6, 1, 1, '2025-12-29', '2026-01-06', 1),
			(7, 3, 1, '2026-01-13', '2026-01-13', 8)`,
	} {
		if _, err := db.Exec(context.Background(), statement); err != nil {
			t.Fatal(err)
		}
	}

	response := httptest.NewRecorder()
	s.handleCapacity(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, body %q", response.Code, response.Body.String())
	}
	var got capacityResponse
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := capacityResponse{
		Weeks: []string{"2026-01-05", "2026-01-12"},
		People: []capacityPerson{
			{ID: 1, Name: "Ana", WeeklyHours: 40, AllocatedHours: []float64{34, 23}},
			{ID: 2, Name: "Ben", WeeklyHours: 0, AllocatedHours: []float64{0, 0}},
			{ID: 3, Name: "Cora", WeeklyHours: 32, AllocatedHours: []float64{0, 8}},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("capacity mismatch:\ngot  %+v\nwant %+v", got, want)
	}
}

func TestCapacityRejectsInvalidRange(t *testing.T) {
	s := &server{}
	for _, test := range []struct {
		name string
		path string
	}{
		{"missing date", "/api/capacity?from=2026-01-01"},
		{"invalid date", "/api/capacity?from=2026-02-30&to=2026-03-01"},
		{"reversed dates", "/api/capacity?from=2026-01-08&to=2026-01-07"},
		{"too many weeks", "/api/capacity?from=2026-01-01&to=2028-12-31"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			s.handleCapacity(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got status %d, body %q", response.Code, response.Body.String())
			}
		})
	}
}

func patchPerson(s *server, id, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPatch, "/api/people/"+id, strings.NewReader(body))
	request.SetPathValue("id", id)
	response := httptest.NewRecorder()
	s.handleUpdatePerson(response, request)
	return response
}

func TestUpdatePersonRejectsInvalidInput(t *testing.T) {
	s := &server{}
	for _, test := range []struct {
		name string
		id   string
		body string
	}{
		{"invalid ID", "abc", `{"weeklyHours":40}`},
		{"zero ID", "0", `{"weeklyHours":40}`},
		{"missing value", "1", `{}`},
		{"null value", "1", `{"weeklyHours":null}`},
		{"negative value", "1", `{"weeklyHours":-0.01}`},
		{"above maximum", "1", `{"weeklyHours":168.01}`},
		{"excess precision", "1", `{"weeklyHours":39.999}`},
		{"unknown field", "1", `{"weeklyHours":40,"other":1}`},
		{"second object", "1", `{"weeklyHours":40}{"weeklyHours":41}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := patchPerson(s, test.id, test.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got status %d, body %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestUpdatePersonPersistsHours(t *testing.T) {
	db := isolatedDB(t)
	if _, err := db.Exec(context.Background(), "INSERT INTO people (id, name, weekly_hours) VALUES (1, 'Ana', 40)"); err != nil {
		t.Fatal(err)
	}
	s := &server{db: db}

	for _, hours := range []float64{39.99, 0, 168} {
		body, err := json.Marshal(map[string]float64{"weeklyHours": hours})
		if err != nil {
			t.Fatal(err)
		}
		response := patchPerson(s, "1", string(body))
		if response.Code != http.StatusOK {
			t.Fatalf("saving %v: got status %d, body %q", hours, response.Code, response.Body.String())
		}
		var got updatedPerson
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got != (updatedPerson{ID: 1, Name: "Ana", WeeklyHours: hours}) {
			t.Fatalf("saving %v: got %+v", hours, got)
		}
		var stored float64
		if err := db.QueryRow(context.Background(), "SELECT weekly_hours::double precision FROM people WHERE id = 1").Scan(&stored); err != nil {
			t.Fatal(err)
		}
		if stored != hours {
			t.Fatalf("saving %v: stored %v", hours, stored)
		}
	}

	missing := patchPerson(s, "99", `{"weeklyHours":40}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing person: got status %d, body %q", missing.Code, missing.Body.String())
	}
}

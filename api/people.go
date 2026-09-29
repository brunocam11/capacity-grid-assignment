package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type updatedPerson struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weeklyHours"`
}

func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid person ID", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input struct {
		WeeklyHours *float64 `json:"weeklyHours"`
	}
	if err := decoder.Decode(&input); err != nil {
		http.Error(w, "body must contain weeklyHours", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		http.Error(w, "body must contain one JSON object", http.StatusBadRequest)
		return
	}
	if input.WeeklyHours == nil || *input.WeeklyHours < 0 || *input.WeeklyHours > 168 || *input.WeeklyHours != math.Round(*input.WeeklyHours*100)/100 {
		http.Error(w, "weeklyHours must be between 0 and 168 with at most two decimal places", http.StatusBadRequest)
		return
	}
	weeklyHours := math.Round(*input.WeeklyHours*100) / 100

	var person updatedPerson
	err = s.db.QueryRow(r.Context(), `
		UPDATE people
		SET weekly_hours = $1
		WHERE id = $2
		RETURNING id, name, weekly_hours::double precision
	`, weeklyHours, id).Scan(&person.ID, &person.Name, &person.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "person not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("update person %d: %v", id, err)
		http.Error(w, "could not save weekly hours", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, person)
}

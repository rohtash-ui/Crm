package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type PollScheduler struct {
	pollerSvc *domain.PollerService
	interval  time.Duration
}

func NewPollScheduler(pollerSvc *domain.PollerService, interval time.Duration) *PollScheduler {
	if interval == 0 {
		interval = 5 * time.Minute
	}
	return &PollScheduler{
		pollerSvc: pollerSvc,
		interval:  interval,
	}
}

func (s *PollScheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	log.Printf("[POLL SCHEDULER] started, interval=%s", s.interval)

	for {
		select {
		case <-ctx.Done():
			log.Println("[POLL SCHEDULER] shutting down")
			return
		case <-ticker.C:
			if err := s.pollerSvc.PollAll(ctx); err != nil {
				log.Printf("[POLL SCHEDULER ERROR] %v", err)
			}
		}
	}
}

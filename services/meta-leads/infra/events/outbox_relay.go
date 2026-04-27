package events

import (
	"context"
	"log"
	"time"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type OutboxRelay struct {
	outboxRepo domain.OutboxRepo
	publisher  domain.EventPublisher
	interval   time.Duration
	batchSize  int
}

func NewOutboxRelay(outboxRepo domain.OutboxRepo, publisher domain.EventPublisher, interval time.Duration, batchSize int) *OutboxRelay {
	if interval == 0 {
		interval = 1 * time.Second
	}
	if batchSize == 0 {
		batchSize = 100
	}
	return &OutboxRelay{
		outboxRepo: outboxRepo,
		publisher:  publisher,
		interval:   interval,
		batchSize:  batchSize,
	}
}

func (r *OutboxRelay) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	log.Printf("[OUTBOX RELAY] started, interval=%s batch=%d", r.interval, r.batchSize)

	for {
		select {
		case <-ctx.Done():
			log.Println("[OUTBOX RELAY] shutting down")
			return
		case <-ticker.C:
			r.drain(ctx)
		}
	}
}

func (r *OutboxRelay) drain(ctx context.Context) {
	entries, err := r.outboxRepo.ListUnpublished(ctx, r.batchSize)
	if err != nil {
		log.Printf("[OUTBOX RELAY ERROR] list unpublished: %v", err)
		return
	}

	for _, entry := range entries {
		if err := r.publisher.Publish(entry.EventType, entry.PartitionKey, entry.Payload); err != nil {
			log.Printf("[OUTBOX RELAY ERROR] publish id=%d: %v", entry.ID, err)
			r.outboxRepo.IncrementAttempts(ctx, entry.ID)
			continue
		}

		if err := r.outboxRepo.MarkPublished(ctx, entry.ID); err != nil {
			log.Printf("[OUTBOX RELAY ERROR] mark published id=%d: %v", entry.ID, err)
		}
	}
}

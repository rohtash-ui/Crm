// Package infra — Redis-backed idempotency store for sync operations.
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"crm-services/services/sync/domain"
)

const idempotencyTTL = 24 * time.Hour
const idempotencyPrefix = "sync:idempotency:"

// RedisClient is a minimal interface for the Redis operations we need.
// In production this would be satisfied by go-redis or similar.
type RedisClient interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
}

// RedisIdempotencyStore implements domain.IdempotencyStore using Redis.
type RedisIdempotencyStore struct {
	client RedisClient
}

// NewRedisIdempotencyStore creates a new Redis-backed idempotency store.
func NewRedisIdempotencyStore(client RedisClient) *RedisIdempotencyStore {
	return &RedisIdempotencyStore{client: client}
}

func (s *RedisIdempotencyStore) Check(ctx context.Context, key string) (*domain.ChangeResult, error) {
	val, err := s.client.Get(ctx, idempotencyPrefix+key)
	if err != nil {
		return nil, nil // key not found or Redis error — treat as not seen
	}
	if val == "" {
		return nil, nil
	}

	var result domain.ChangeResult
	if err := json.Unmarshal([]byte(val), &result); err != nil {
		return nil, fmt.Errorf("unmarshal idempotency result: %w", err)
	}

	return &result, nil
}

func (s *RedisIdempotencyStore) Store(ctx context.Context, key string, result *domain.ChangeResult) error {
	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal idempotency result: %w", err)
	}

	return s.client.Set(ctx, idempotencyPrefix+key, string(data), idempotencyTTL)
}

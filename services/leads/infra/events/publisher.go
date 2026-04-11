package events

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/rohtash-ui/crm/services/leads/domain"
)

// KafkaPublisher implements domain.EventPublisher using Kafka.
// In production this would use a real Kafka client (e.g., confluent-kafka-go or Sarama).
type KafkaPublisher struct {
	brokers []string
	topic   string
}

func NewKafkaPublisher(brokers []string, topic string) *KafkaPublisher {
	return &KafkaPublisher{
		brokers: brokers,
		topic:   topic,
	}
}

func (p *KafkaPublisher) Publish(event domain.LeadEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	// In production: produce to Kafka topic with event.Type as the topic,
	// event.TenantID as the partition key for ordering guarantees.
	//
	// producer.Produce(&kafka.Message{
	//     TopicPartition: kafka.TopicPartition{Topic: &event.Type},
	//     Key:            []byte(event.TenantID),
	//     Value:          payload,
	// }, nil)

	log.Printf("[EVENT] topic=%s tenant=%s lead=%s payload=%s",
		event.Type, event.TenantID, event.LeadID, string(payload))

	return nil
}

// NoopPublisher is used in tests and development.
type NoopPublisher struct {
	Published []domain.LeadEvent
}

func NewNoopPublisher() *NoopPublisher {
	return &NoopPublisher{}
}

func (p *NoopPublisher) Publish(event domain.LeadEvent) error {
	p.Published = append(p.Published, event)
	return nil
}

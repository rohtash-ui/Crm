package events

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

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

func (p *KafkaPublisher) Publish(topic string, key string, payload []byte) error {
	// In production: use confluent-kafka-go or Sarama to produce to the topic
	// with the key as partition key for ordering guarantees.
	//
	// producer.Produce(&kafka.Message{
	//     TopicPartition: kafka.TopicPartition{Topic: &topic},
	//     Key:            []byte(key),
	//     Value:          payload,
	// }, nil)

	var evt map[string]interface{}
	json.Unmarshal(payload, &evt)

	log.Printf("[EVENT] topic=%s key=%s type=%v", topic, key, evt["type"])
	return nil
}

type NoopPublisher struct {
	Published []PublishedMessage
}

type PublishedMessage struct {
	Topic   string
	Key     string
	Payload []byte
}

func NewNoopPublisher() *NoopPublisher {
	return &NoopPublisher{}
}

func (p *NoopPublisher) Publish(topic string, key string, payload []byte) error {
	p.Published = append(p.Published, PublishedMessage{Topic: topic, Key: key, Payload: payload})
	return nil
}

func FormatEventLog(payload []byte) string {
	var m map[string]interface{}
	if err := json.Unmarshal(payload, &m); err != nil {
		return string(payload)
	}
	return fmt.Sprintf("type=%v tenant=%v lead=%v", m["type"], m["tenant_id"], m["lead_id"])
}

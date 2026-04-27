package unit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

func computeSignature(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyWebhookSignature_Valid(t *testing.T) {
	body := []byte(`{"object":"page","entry":[]}`)
	secret := "test_app_secret_123"
	sig := computeSignature(body, secret)

	err := domain.VerifyWebhookSignature(body, sig, secret)
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
}

func TestVerifyWebhookSignature_InvalidSignature(t *testing.T) {
	body := []byte(`{"object":"page","entry":[]}`)
	secret := "test_app_secret_123"

	err := domain.VerifyWebhookSignature(body, "sha256=deadbeef", secret)
	if err != domain.ErrInvalidSignature {
		t.Fatalf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestVerifyWebhookSignature_WrongSecret(t *testing.T) {
	body := []byte(`{"object":"page","entry":[]}`)
	correctSecret := "correct_secret"
	wrongSecret := "wrong_secret"
	sig := computeSignature(body, correctSecret)

	err := domain.VerifyWebhookSignature(body, sig, wrongSecret)
	if err != domain.ErrInvalidSignature {
		t.Fatalf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestVerifyWebhookSignature_MissingPrefix(t *testing.T) {
	body := []byte(`{"object":"page"}`)
	err := domain.VerifyWebhookSignature(body, "no_prefix_here", "secret")
	if err != domain.ErrInvalidSignature {
		t.Fatalf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestVerifyWebhookSignature_TamperedBody(t *testing.T) {
	originalBody := []byte(`{"object":"page","entry":[]}`)
	tamperedBody := []byte(`{"object":"page","entry":[{"id":"evil"}]}`)
	secret := "test_secret"
	sig := computeSignature(originalBody, secret)

	err := domain.VerifyWebhookSignature(tamperedBody, sig, secret)
	if err != domain.ErrInvalidSignature {
		t.Fatalf("expected ErrInvalidSignature for tampered body, got: %v", err)
	}
}

func TestVerifyHubChallenge_Valid(t *testing.T) {
	err := domain.VerifyHubChallenge("my_verify_token", "my_verify_token")
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
}

func TestVerifyHubChallenge_Invalid(t *testing.T) {
	err := domain.VerifyHubChallenge("wrong_token", "my_verify_token")
	if err != domain.ErrInvalidVerifyToken {
		t.Fatalf("expected ErrInvalidVerifyToken, got: %v", err)
	}
}

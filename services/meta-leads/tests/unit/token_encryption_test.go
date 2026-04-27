package unit

import (
	"testing"

	"github.com/rohtash-ui/crm/services/meta-leads/infra/crypto"
)

func TestAESTokenEncryptor_RoundTrip(t *testing.T) {
	encryptor := crypto.NewAESTokenEncryptor("test-master-key-for-encryption")

	plaintext := []byte("EAABsbCS1IBYBA...long_page_access_token")
	ciphertext, err := encryptor.Encrypt(plaintext, "key-1")
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	decrypted, err := encryptor.Decrypt(ciphertext, "key-1")
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}

	if string(decrypted) != string(plaintext) {
		t.Errorf("round-trip failed: got %q, want %q", decrypted, plaintext)
	}
}

func TestAESTokenEncryptor_DifferentCiphertext(t *testing.T) {
	encryptor := crypto.NewAESTokenEncryptor("test-key")
	plaintext := []byte("same_token")

	c1, _ := encryptor.Encrypt(plaintext, "key-1")
	c2, _ := encryptor.Encrypt(plaintext, "key-1")

	if string(c1) == string(c2) {
		t.Error("same plaintext should produce different ciphertext (random nonce)")
	}
}

func TestAESTokenEncryptor_WrongKey(t *testing.T) {
	enc1 := crypto.NewAESTokenEncryptor("key-one")
	enc2 := crypto.NewAESTokenEncryptor("key-two")

	ciphertext, _ := enc1.Encrypt([]byte("secret"), "k")
	_, err := enc2.Decrypt(ciphertext, "k")
	if err == nil {
		t.Error("decrypting with wrong key should fail")
	}
}

func TestAESTokenEncryptor_ShortCiphertext(t *testing.T) {
	encryptor := crypto.NewAESTokenEncryptor("test-key")
	_, err := encryptor.Decrypt([]byte("short"), "k")
	if err == nil {
		t.Error("decrypting short ciphertext should fail")
	}
}

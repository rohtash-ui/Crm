package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"

	"github.com/rohtash-ui/crm/services/meta-leads/domain"
)

type AESTokenEncryptor struct {
	masterKey []byte
}

func NewAESTokenEncryptor(masterKey string) domain.TokenEncryptor {
	key := sha256.Sum256([]byte(masterKey))
	return &AESTokenEncryptor{masterKey: key[:]}
}

func (e *AESTokenEncryptor) Encrypt(plaintext []byte, _ string) ([]byte, error) {
	block, err := aes.NewCipher(e.masterKey)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	return aesGCM.Seal(nonce, nonce, plaintext, nil), nil
}

func (e *AESTokenEncryptor) Decrypt(ciphertext []byte, _ string) ([]byte, error) {
	block, err := aes.NewCipher(e.masterKey)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, encrypted := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

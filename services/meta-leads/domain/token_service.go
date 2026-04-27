package domain

import (
	"context"
	"fmt"
)

type TokenService struct {
	connectionRepo ConnectionRepo
	encryptor      TokenEncryptor
	kmsKeyID       string
}

func NewTokenService(connectionRepo ConnectionRepo, encryptor TokenEncryptor, kmsKeyID string) *TokenService {
	return &TokenService{
		connectionRepo: connectionRepo,
		encryptor:      encryptor,
		kmsKeyID:       kmsKeyID,
	}
}

func (s *TokenService) StoreConnection(ctx context.Context, tenantID, pageID, appID, pageAccessToken string) error {
	ciphertext, err := s.encryptor.Encrypt([]byte(pageAccessToken), s.kmsKeyID)
	if err != nil {
		return fmt.Errorf("encrypt token: %w", err)
	}

	conn := &MetaConnection{
		TenantID:                  tenantID,
		PageID:                    pageID,
		AppID:                     appID,
		PageAccessTokenCiphertext: ciphertext,
		KMSKeyID:                  s.kmsKeyID,
		TokenStatus:               TokenStatusActive,
	}

	return s.connectionRepo.Upsert(ctx, conn)
}

func (s *TokenService) RevokeConnection(ctx context.Context, id string) error {
	return s.connectionRepo.UpdateTokenStatus(ctx, id, TokenStatusRevoked)
}

func (s *TokenService) DecryptToken(conn *MetaConnection) (string, error) {
	plaintext, err := s.encryptor.Decrypt(conn.PageAccessTokenCiphertext, conn.KMSKeyID)
	if err != nil {
		return "", fmt.Errorf("decrypt token: %w", err)
	}
	return string(plaintext), nil
}

package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func VerifyWebhookSignature(body []byte, signatureHeader string, appSecret string) error {
	if !strings.HasPrefix(signatureHeader, "sha256=") {
		return ErrInvalidSignature
	}

	expectedSig := signatureHeader[7:]

	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(body)
	computedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(computedSig), []byte(expectedSig)) {
		return ErrInvalidSignature
	}

	return nil
}

func VerifyHubChallenge(verifyToken, expectedToken string) error {
	if verifyToken != expectedToken {
		return ErrInvalidVerifyToken
	}
	return nil
}

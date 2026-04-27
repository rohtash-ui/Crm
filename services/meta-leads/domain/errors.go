package domain

import "errors"

var (
	ErrInvalidSignature   = errors.New("invalid webhook signature")
	ErrInvalidVerifyToken = errors.New("invalid verify token")
	ErrDuplicateDelivery  = errors.New("duplicate webhook delivery")
	ErrConnectionNotFound = errors.New("meta connection not found")
	ErrFormNotFound       = errors.New("meta form not found")
	ErrTokenRevoked       = errors.New("page access token has been revoked")
	ErrTokenExpired       = errors.New("page access token has expired")
	ErrRateLimited        = errors.New("meta graph API rate limited")
	ErrGraphAPI           = errors.New("meta graph API error")
)

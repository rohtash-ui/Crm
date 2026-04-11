FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY . .
RUN go mod download 2>/dev/null || true
RUN CGO_ENABLED=0 GOOS=linux go build -o /sync-server ./cmd/sync-server/main.go

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /sync-server /usr/local/bin/sync-server

EXPOSE 8080

ENTRYPOINT ["sync-server"]

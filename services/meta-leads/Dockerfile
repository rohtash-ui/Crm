FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /meta-leads ./cmd/server

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /meta-leads /usr/local/bin/meta-leads

EXPOSE 8080

ENTRYPOINT ["meta-leads"]

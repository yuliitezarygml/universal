# Multi-stage Dockerfile for ArtCraft Server
FROM rust:1.98.1-slim-bookworm AS builder

WORKDIR /build

# Pre-cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release || true
RUN rm -rf src

# Copy real sources and static assets
COPY src ./src
COPY static ./static

# Touch main.rs to invalidate the dummy build and compile real binary
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/artcraft-server /app/artcraft-server
COPY static /app/static

ENV PORT=8080
ENV STORAGE_DIR=/app/storage
ENV ADMIN_PASSWORD=admin123

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/v1/craft_apps/release_info || exit 1

CMD ["/app/artcraft-server"]

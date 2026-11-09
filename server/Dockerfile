# syntax=docker/dockerfile:1
FROM rust:1.98.1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations ./migrations
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --locked --release

FROM debian:bookworm-slim
COPY --from=build /app/target/release/iskra-server /usr/local/bin/iskra-server
USER 10001:10001
EXPOSE 8080
CMD ["iskra-server"]

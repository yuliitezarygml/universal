CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deletion_pending')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    access_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(access_token_hash) = 32),
    access_expires_at timestamptz NOT NULL,
    refresh_token_hash bytea UNIQUE CHECK (octet_length(refresh_token_hash) = 32),
    refresh_expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL))
);

CREATE INDEX sessions_account_id_idx ON sessions (account_id);

CREATE TABLE account_limits (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    daily_requests integer NOT NULL DEFAULT 10 CHECK (daily_requests >= 0),
    daily_attachments integer NOT NULL DEFAULT 3 CHECK (daily_attachments >= 0),
    active_requests integer NOT NULL DEFAULT 1 CHECK (active_requests >= 1),
    CHECK (daily_attachments <= daily_requests)
);

CREATE FUNCTION set_default_account_limits() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO account_limits (account_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_limits_on_create
AFTER INSERT ON accounts
FOR EACH ROW EXECUTE FUNCTION set_default_account_limits();

CREATE TABLE account_usage_daily (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day_utc date NOT NULL,
    requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
    requests_with_attachment integer NOT NULL DEFAULT 0 CHECK (requests_with_attachment >= 0),
    PRIMARY KEY (account_id, day_utc),
    CHECK (requests_with_attachment <= requests)
);

CREATE TABLE provider_usage_daily (
    provider text NOT NULL,
    day_utc date NOT NULL,
    attempts integer NOT NULL CHECK (attempts >= 0),
    PRIMARY KEY (provider, day_utc)
);

CREATE TABLE provider_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    model text NOT NULL,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled')),
    upstream_status integer,
    input_tokens bigint CHECK (input_tokens >= 0),
    output_tokens bigint CHECK (output_tokens >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    UNIQUE (account_id, request_id)
);

CREATE INDEX provider_attempts_active_idx ON provider_attempts (account_id, started_at) WHERE status = 'started';

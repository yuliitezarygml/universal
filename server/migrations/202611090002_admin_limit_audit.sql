CREATE TABLE admin_limit_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    previous_daily_requests integer NOT NULL,
    previous_daily_attachments integer NOT NULL,
    daily_requests integer NOT NULL,
    daily_attachments integer NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

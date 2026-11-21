-- Trusted browser sessions are valid until revoked. Existing bearer sessions keep their expiry.
alter table telegram_sessions alter column expires_at drop not null;

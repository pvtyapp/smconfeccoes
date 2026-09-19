-- ══════════════════════════════════════════════════════════════════
-- 011_client_portal.sql
-- Portal do Cliente — Fase 1: conta, login e verificação por WhatsApp
-- Ver plano completo: artifact "Portal do Cliente SM"
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_accounts (
  id            SERIAL PRIMARY KEY,
  contact_id    INTEGER NOT NULL UNIQUE REFERENCES wa_contacts(id),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS whatsapp_otp_codes (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'signup', -- 'signup' | 'reset_password'
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_otp_purpose') THEN
    ALTER TABLE whatsapp_otp_codes ADD CONSTRAINT chk_otp_purpose
      CHECK (purpose IN ('signup', 'reset_password'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_otp_phone_active
ON whatsapp_otp_codes(phone, created_at DESC)
WHERE consumed_at IS NULL;

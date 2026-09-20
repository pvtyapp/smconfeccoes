-- ══════════════════════════════════════════════════════════════════
-- 017_regime_tributario.sql
-- Dados fiscais obrigatórios pro cliente jurídico não-MEI (nota fiscal não
-- é emitida pra pessoa física nem MEI — decisão do dono, 2026-09-20).
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS regime_tributario TEXT
    CHECK (regime_tributario IN ('mei', 'simples_nacional', 'lucro_presumido', 'lucro_real')),
  ADD COLUMN IF NOT EXISTS ie_isento BOOLEAN NOT NULL DEFAULT false;

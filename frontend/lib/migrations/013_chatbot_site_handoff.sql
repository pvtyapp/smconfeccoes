-- ══════════════════════════════════════════════════════════════════
-- 013_chatbot_site_handoff.sql
-- Portal do Cliente — Fase 4: chatbot recepciona e direciona pro site
-- Cooldowns próprios, independentes do last_greeting_sent_at existente
-- (esse é diário, os novos são 6h ou uma vez só — ver plano, seção 06)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS site_transition_notice_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendant_wait_notice_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS known_customer_greeting_sent_at   TIMESTAMPTZ;

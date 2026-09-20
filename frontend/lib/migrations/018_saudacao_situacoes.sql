-- ══════════════════════════════════════════════════════════════════
-- 018_saudacao_situacoes.sql
-- Replano "Saudação única" — 4 situações reais do contato (cliente ativo,
-- formulário pendente, tem histórico sem conta, sem histórico nenhum),
-- cada uma com cooldown de 6h. site_transition_notice_sent_at (que era
-- "manda 1x só pra sempre") vira no_history_notice_sent_at, no mesmo
-- padrão de 6h das outras.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE wa_contacts RENAME COLUMN site_transition_notice_sent_at TO no_history_notice_sent_at;

ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS application_pending_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_history_notice_sent_at         TIMESTAMPTZ;

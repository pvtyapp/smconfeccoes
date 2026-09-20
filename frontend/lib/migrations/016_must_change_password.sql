-- ══════════════════════════════════════════════════════════════════
-- 016_must_change_password.sql
-- Aprovação de Fornecedor agora entrega login direto (WhatsApp + senha
-- temporária de 6 dígitos) — precisa forçar troca no primeiro acesso.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

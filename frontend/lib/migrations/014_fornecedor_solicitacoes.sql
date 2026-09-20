-- ══════════════════════════════════════════════════════════════════
-- 014_fornecedor_solicitacoes.sql
-- Replano v2 — formulário "Solicitar acesso ao Fornecedor" + aprovação
-- manual no painel admin (substitui o mecanismo silencioso/automático
-- planejado antes — ver artifact "LP e Fornecedor Fixo v2").
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fornecedor_solicitacoes (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  business_name   TEXT,
  purchase_notes  TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  contact_id      INTEGER REFERENCES wa_contacts(id),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fornecedor_solicitacoes_status ON fornecedor_solicitacoes(status);

ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS fornecedor_fixo_since TIMESTAMPTZ;

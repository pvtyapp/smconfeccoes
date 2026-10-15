-- Nota fiscal cancelada junto com o pedido (PIV 15/10/2026): cancelar um pedido
-- com nota autorizada cancela a nota na Sefaz via Focus NFe (dentro de 24h).
ALTER TABLE fiscal_notes DROP CONSTRAINT IF EXISTS fiscal_notes_status_check;
ALTER TABLE fiscal_notes ADD CONSTRAINT fiscal_notes_status_check
  CHECK (status IN ('pendente', 'processando', 'autorizada', 'rejeitada', 'cancelada'));
ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMPTZ;

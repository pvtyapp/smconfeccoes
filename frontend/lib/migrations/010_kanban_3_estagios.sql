-- Migration 010: Kanban de pedidos de 5 pra 3 estágios
-- Antes: triagem → confirmando → em_separacao → pronto → pago → concluido
-- Agora: triagem (com sub-estado de confirmação) → em_separacao → pronto → concluido
--   confirmando vira sub-estado dentro de triagem (confirmation_requested_at)
--   pago vira selo estático dentro de pronto (paid_label), sem status próprio
-- Estoque: antes debitava na entrada de em_separacao; agora debita só no
--   Concluir Entrega (status=concluido) — ver app/api/orders/[id]/status/route.ts

ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_requested_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_label BOOLEAN;

-- Migra pedidos em andamento ANTES de apertar a constraint, senão o ALTER falha.
UPDATE orders SET confirmation_requested_at = COALESCE(confirmation_requested_at, updated_at)
  WHERE status = 'confirmando';
UPDATE orders SET status = 'triagem' WHERE status = 'confirmando';

UPDATE orders SET paid_label = true WHERE status = 'pago';
UPDATE orders SET status = 'pronto' WHERE status = 'pago';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_status;
ALTER TABLE orders ADD CONSTRAINT chk_order_status
  CHECK (status IN ('triagem','em_separacao','pronto','concluido','cancelado'));

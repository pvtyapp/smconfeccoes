-- Migration 009: novo pipeline de stages
-- triagem → confirmando → em_separacao → pronto → pago → concluido
-- Antes: pronto era o estado final; agora concluido é o estado final

-- 1. Atualiza o CHECK constraint para incluir pago e concluido
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_status;
ALTER TABLE orders ADD CONSTRAINT chk_order_status
  CHECK (status IN ('triagem','confirmando','em_separacao','pronto','pago','concluido','cancelado'));

-- 2. Migra pedidos no estado legado "pronto" (= entregue/pago) para o novo estado correto.
--    paid_at preenchido → concluido; sem paid_at → pronto (aguardando retirada, mantém no board)
UPDATE orders
SET status = 'concluido', completed_at = COALESCE(completed_at, paid_at, updated_at)
WHERE status = 'pronto' AND paid_at IS NOT NULL;

-- 3. Índice de suporte para queries do board por status
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

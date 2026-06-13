-- ─────────────────────────────────────────────────────────────────────────────
-- 003_manual_orders.sql
-- Suporte a pedidos manuais (dashboard) e serviços terceirizados
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Permitir contatos sem JID (criados manualmente pelo operador)
ALTER TABLE wa_contacts ALTER COLUMN jid DROP NOT NULL;

-- 2. Origem do pedido: 'whatsapp' (bot) | 'manual' (operador no dashboard)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'whatsapp';

-- 3. Previsão de entrega (especialmente útil para serviços terceirizados)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- 4. Flag de serviço por item (mão de obra / serviço terceirizado)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;

-- 5. Nota por item (descrição adicional do serviço, opcional)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_note TEXT;

-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_orders_source        ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_date ON orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_order_items_service  ON order_items(is_service);

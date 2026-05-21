-- ─────────────────────────────────────────────────────────────
-- 001_autoatendimento.sql
-- Autoatendimento WhatsApp — SM Confecções
-- ─────────────────────────────────────────────────────────────

-- 1. Campo chatbot_enabled em products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Contatos WhatsApp
CREATE TABLE IF NOT EXISTS wa_contacts (
  id          SERIAL PRIMARY KEY,
  jid         TEXT NOT NULL UNIQUE,        -- ex: 5516992692363@s.whatsapp.net
  name        TEXT,
  phone       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'idle', -- estado atual do bot
  state_data  JSONB,                        -- dados temporários da coleta
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Pedidos
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,         -- ex: #0001
  contact_id  INTEGER NOT NULL REFERENCES wa_contacts(id),
  status      TEXT NOT NULL DEFAULT 'triagem',
  -- triagem | confirmando | em_separacao | pronto | concluido | cancelado
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Itens do pedido
CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id),
  product_name  TEXT NOT NULL,              -- snapshot do nome na hora
  color         TEXT,
  size          TEXT,
  qty           INTEGER NOT NULL DEFAULT 0, -- qtd solicitada pelo cliente
  qty_confirmed INTEGER,                    -- qtd confirmada pelo operador
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Histórico de eventos
CREATE TABLE IF NOT EXISTS order_events (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'system', -- 'system' | 'operator' | 'client'
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Sequência para numeração de pedidos
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

-- 7. Índices úteis
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_contact     ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_jid    ON wa_contacts(jid);

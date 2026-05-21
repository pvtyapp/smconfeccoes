-- ══════════════════════════════════════════════════════════════════
-- 002_lifecycle_financials.sql
-- Lifecycle de clientes, financeiro, anexos, vínculo com variantes
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1. order_items — vínculo com variante + snapshot de preço
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id  UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS unit_price  NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_id);

-- ──────────────────────────────────────────────────────────────────
-- 2. orders — campos financeiros e de conclusão
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS total_value    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS due_date       DATE,
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pix_confirmed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ;

-- Normaliza status legado: 'concluido' não existe mais, pronto é o estado final
UPDATE orders SET status = 'pronto' WHERE status = 'concluido';

-- Check constraint de status (evita valores inválidos)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_status'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_order_status
      CHECK (status IN ('triagem','confirmando','em_separacao','pronto','cancelado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_due_date   ON orders(due_date);
CREATE INDEX IF NOT EXISTS idx_orders_paid        ON orders(paid_at);
CREATE INDEX IF NOT EXISTS idx_orders_completed   ON orders(completed_at);

-- ──────────────────────────────────────────────────────────────────
-- 3. wa_contacts — lifecycle de marketing + prazo de pagamento
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE wa_contacts
  -- Lifecycle
  ADD COLUMN IF NOT EXISTS lifecycle_state      TEXT     NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_order_at        TIMESTAMPTZ,
  -- Sequência ausente: 0=nunca enviado, 1=D7, 2=D15, 3=D30
  ADD COLUMN IF NOT EXISTS ausente_seq          SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ausente_last_sent_at TIMESTAMPTZ,
  -- Sequência curioso: 0=nunca enviado, 1=C7, 2=C14, 3=C21
  ADD COLUMN IF NOT EXISTS curioso_seq          SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS curioso_started_at   TIMESTAMPTZ,
  -- Prazo de pagamento
  ADD COLUMN IF NOT EXISTS payment_term_enabled BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_term_type    TEXT,       -- 'days' | 'fixed_date'
  ADD COLUMN IF NOT EXISTS payment_term_days    SMALLINT;   -- só quando type='days'

-- Constraints de validação
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lifecycle_state') THEN
    ALTER TABLE wa_contacts ADD CONSTRAINT chk_lifecycle_state
      CHECK (lifecycle_state IN ('new','active','ausente','curioso'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_term_type') THEN
    ALTER TABLE wa_contacts ADD CONSTRAINT chk_payment_term_type
      CHECK (payment_term_type IS NULL OR payment_term_type IN ('days','fixed_date'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ausente_seq') THEN
    ALTER TABLE wa_contacts ADD CONSTRAINT chk_ausente_seq
      CHECK (ausente_seq BETWEEN 0 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_curioso_seq') THEN
    ALTER TABLE wa_contacts ADD CONSTRAINT chk_curioso_seq
      CHECK (curioso_seq BETWEEN 0 AND 3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle    ON wa_contacts(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_contacts_last_order   ON wa_contacts(last_order_at);
CREATE INDEX IF NOT EXISTS idx_contacts_ausente_sent ON wa_contacts(ausente_last_sent_at);

-- ──────────────────────────────────────────────────────────────────
-- 4. order_attachments — arquivos DTF e comprovantes PIX
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_attachments (
  id            SERIAL       PRIMARY KEY,
  order_id      INTEGER      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- messageId da Evolution API (para re-download se necessário)
  message_id    TEXT,
  -- 'dtf' = arquivo de impressão | 'pix_comprovante' = comprovante de pagamento
  type          TEXT         NOT NULL,
  -- URL no Vercel Blob (após upload; NULL se ainda não processado)
  blob_url      TEXT,
  filename      TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_attachment_type CHECK (type IN ('dtf','pix_comprovante'))
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order ON order_attachments(order_id);

-- ──────────────────────────────────────────────────────────────────
-- 5. product_variants — trigger de auto-geração de SKU oculto
-- ──────────────────────────────────────────────────────────────────
-- Função: gera SKU no formato SM-PROD-COR-TAM quando não informado
CREATE OR REPLACE FUNCTION fn_auto_sku() RETURNS TRIGGER AS $$
DECLARE
  v_prod  TEXT;
  v_base  TEXT;
  v_final TEXT;
  v_n     INT := 0;
BEGIN
  -- Não sobrescreve se já tem SKU válido
  IF NEW.sku IS NOT NULL AND TRIM(NEW.sku) <> '' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_prod FROM products WHERE id = NEW.product_id;

  v_base :=
    'SM-' ||
    UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(v_prod,   'PROD'), '[^A-Za-z0-9]', '', 'g'), 1, 4)) ||
    '-'   ||
    UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(NEW.color, 'X'),   '[^A-Za-z0-9]', '', 'g'), 1, 3)) ||
    '-'   ||
    UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(NEW.size,  'U'),   '[^A-Za-z0-9]', '', 'g'), 1, 3));

  v_final := v_base;

  -- Garante unicidade com sufixo numérico se necessário
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM product_variants
      WHERE sku = v_final
        AND id IS DISTINCT FROM NEW.id
    );
    v_n     := v_n + 1;
    v_final := v_base || '-' || v_n;
  END LOOP;

  NEW.sku := v_final;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger dispara antes de INSERT ou UPDATE de color/size
DROP TRIGGER IF EXISTS trg_auto_sku ON product_variants;
CREATE TRIGGER trg_auto_sku
  BEFORE INSERT OR UPDATE OF color, size ON product_variants
  FOR EACH ROW EXECUTE FUNCTION fn_auto_sku();

-- Backfill: preenche SKUs ausentes em variantes existentes
DO $$
DECLARE
  v       RECORD;
  v_prod  TEXT;
  v_base  TEXT;
  v_final TEXT;
  v_n     INT;
BEGIN
  FOR v IN SELECT * FROM product_variants WHERE sku IS NULL OR TRIM(sku) = '' LOOP
    SELECT name INTO v_prod FROM products WHERE id = v.product_id;
    v_base :=
      'SM-' ||
      UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(v_prod,   'PROD'), '[^A-Za-z0-9]', '', 'g'), 1, 4)) ||
      '-'   ||
      UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(v.color, 'X'),    '[^A-Za-z0-9]', '', 'g'), 1, 3)) ||
      '-'   ||
      UPPER(SUBSTR(REGEXP_REPLACE(COALESCE(v.size,  'U'),    '[^A-Za-z0-9]', '', 'g'), 1, 3));
    v_final := v_base;
    v_n     := 0;
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM product_variants WHERE sku = v_final AND id != v.id
      );
      v_n     := v_n + 1;
      v_final := v_base || '-' || v_n;
    END LOOP;
    UPDATE product_variants SET sku = v_final WHERE id = v.id;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 6. app_settings — configurações globais do sistema
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Horário padrão dos disparos proativos (formato HH, 24h)
INSERT INTO app_settings (key, value) VALUES
  ('proactive_hour',   '09'),   -- 09:00 — disparos de lifecycle e cobrança
  ('ausente_d7_msg',   'Oi {nome}, como estão as vendas? Percebi que faz uns dias que não faz pedidos aqui com a gente.'),
  ('ausente_d15_msg',  'Estamos com estoque renovado, quando precisar é só chamar.'),
  ('ausente_d30_msg',  'Sentimos sua falta por aqui, dá uma olhada no nosso catálogo — temos produtos sazonais que podem te agradar!'),
  ('curioso_c7_msg',   'Conseguiu resolver? Ainda temos aquele estoque disponível.'),
  ('curioso_c14_msg',  'Esse produto tá saindo bastante, me chama antes de acabar.'),
  ('curioso_c21_msg',  'Se quiser fechar aquele pedido, pode me chamar qualquer hora.')
ON CONFLICT (key) DO NOTHING;

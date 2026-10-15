-- ══════════════════════════════════════════════════════════════════
-- 020_marketplace_fechamentos.sql
-- Fechamento diário das lojas de marketplace da SM (SHP_MARI, SHP_SAMU,
-- TKTK_SAMU), lançado pelo agente do outro PC via API (navegador logado)
-- ou corrigido à mão na aba Lançamentos. Alimenta a aba Painel Marketplace
-- e o gráfico de faturamento do Dashboard.
--
-- marketplace_fechamentos  → 1 linha por dia + loja (o POST substitui)
-- marketplace_vendas_itens → venda item a item do dia + loja (curva ABC)
-- marketplace_custos       → custo por tipo de peça: prefixo do SKU →
--                            soma do material_cost dos produtos + extra
--
-- Lucro = vendas − taxas − cupom − frete − ads − custo (calculado na leitura).
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS marketplace_fechamentos (
  id                SERIAL PRIMARY KEY,
  dia               DATE NOT NULL,
  loja              TEXT NOT NULL CHECK (loja IN ('SHP_MARI', 'SHP_SAMU', 'TKTK_SAMU')),
  pedidos           INTEGER NOT NULL DEFAULT 0 CHECK (pedidos >= 0),
  pecas             INTEGER NOT NULL DEFAULT 0 CHECK (pecas >= 0),
  vendas            NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxas             NUMERIC(12,2) NOT NULL DEFAULT 0,
  cupom             NUMERIC(12,2) NOT NULL DEFAULT 0,
  frete             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ads               NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo             NUMERIC(12,2),                 -- null = não deu pra calcular (sem itens)
  itens_sem_custo   INTEGER NOT NULL DEFAULT 0,    -- itens cujo SKU não caiu em nenhuma regra
  pedidos_upseller  INTEGER,                       -- conferência: o que o Upseller mostrou no dia
  repasse           NUMERIC(12,2),                 -- conferência: o "a receber" que a plataforma mostrou
  observacao        TEXT,
  origem            TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('robo', 'manual')),
  atualizado_por    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dia, loja)
);

CREATE TABLE IF NOT EXISTS marketplace_vendas_itens (
  id        SERIAL PRIMARY KEY,
  dia       DATE NOT NULL,
  loja      TEXT NOT NULL,
  pedido    TEXT,
  sku       TEXT,
  titulo    TEXT,
  variacao  TEXT,
  qtd       INTEGER NOT NULL DEFAULT 1 CHECK (qtd > 0),
  valor     NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxa      NUMERIC(12,2) NOT NULL DEFAULT 0,
  cupom     NUMERIC(12,2) NOT NULL DEFAULT 0,
  frete     NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo     NUMERIC(12,2)                          -- null = SKU sem regra de custo
);
CREATE INDEX IF NOT EXISTS marketplace_vendas_itens_dia_loja ON marketplace_vendas_itens (dia, loja);

CREATE TABLE IF NOT EXISTS marketplace_custos (
  id          SERIAL PRIMARY KEY,
  prefixo     TEXT NOT NULL UNIQUE,                -- começo do SKU, sem diferenciar maiúscula (o maior que casar vence)
  nome        TEXT NOT NULL,
  produtos    UUID[] NOT NULL DEFAULT '{}',        -- products.id: soma o material_cost de cada um
  extra       NUMERIC(10,2) NOT NULL DEFAULT 0,    -- valor fixo somado por peça (ex.: estampa)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

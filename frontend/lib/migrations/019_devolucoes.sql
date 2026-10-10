-- ══════════════════════════════════════════════════════════════════
-- 019_devolucoes.sql
-- Controle de devoluções do marketplace (Shopee/TikTok) — uma linha por
-- peça/SKU devolvido, pra reaproveitar em pedido novo. Lançada pelo robô
-- (origem "robo", com o nº da devolução da plataforma) ou à mão.
-- Exclusão é lógica (deleted_at). O índice único de (numero_devolucao, sku)
-- vale também pras apagadas: o robô nunca recria o que o operador apagou.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS devolucoes (
  id                SERIAL PRIMARY KEY,
  data              DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  loja              TEXT NOT NULL CHECK (loja IN ('MARI', 'SAMUEL')),
  numero_devolucao  TEXT,
  pedido            TEXT,
  sku               TEXT NOT NULL,
  produto           TEXT,
  cor               TEXT,
  tamanho           TEXT,
  quantidade        INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  motivo            TEXT,
  situacao          TEXT NOT NULL DEFAULT 'A caminho'
                    CHECK (situacao IN ('A caminho', 'Disponível', 'Reservada', 'Usada', 'Descartada', 'Não volta')),
  pedido_reservado  TEXT,
  observacao        TEXT,
  origem            TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('robo', 'manual')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS devolucoes_numero_sku_unico
  ON devolucoes (numero_devolucao, sku)
  WHERE numero_devolucao IS NOT NULL AND numero_devolucao <> '';

CREATE INDEX IF NOT EXISTS devolucoes_lista_idx ON devolucoes (data DESC, id DESC) WHERE deleted_at IS NULL;

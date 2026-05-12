-- Configuração remota para atualização obrigatória e fim do período de assinatura (Mercado Pago).

CREATE TABLE IF NOT EXISTS public.app_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_app_version TEXT NOT NULL DEFAULT '1.0.0',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.app_config IS 'Configuração global do app (ex.: versão mínima obrigatória).';

INSERT INTO public.app_config (id, min_app_version)
VALUES (1, '1.0.0')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

COMMENT ON COLUMN public.users.subscription_period_end IS 'Fim do período vigente da assinatura (ex.: próxima cobrança MP), quando disponível.';

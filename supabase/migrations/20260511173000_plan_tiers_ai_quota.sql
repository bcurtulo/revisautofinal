-- Níveis Plus/Premium, contagem de mensagens IA mensal e campos de assinatura MP.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan_type TEXT,
  ADD COLUMN IF NOT EXISTS plan_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS mp_preapproval_id TEXT,
  ADD COLUMN IF NOT EXISTS ai_messages_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ai_message_date TIMESTAMPTZ;

COMMENT ON COLUMN public.users.plan_type IS 'free | plus | premium';
COMMENT ON COLUMN public.users.ai_messages_count IS 'Mensagens ao Dr. Graxa no mês UTC de last_ai_message_date';
COMMENT ON COLUMN public.users.last_ai_message_date IS 'Última mensagem IA — para reset mensal do contador';

-- Sincronizar plan_type a partir de plan (legado) sem sobrescrever assinantes existentes
UPDATE public.users
SET plan_type = lower(trim(plan))
WHERE plan_type IS NULL OR trim(plan_type) = '';

UPDATE public.users
SET plan_type = 'free'
WHERE plan_type IS NULL OR plan_type NOT IN ('free', 'plus', 'premium');

ALTER TABLE public.users
  ALTER COLUMN plan_type SET DEFAULT 'free';

-- Garantir coluna plan alinhada aos valores permitidos
UPDATE public.users
SET plan = plan_type
WHERE plan IS NULL OR trim(plan) = '' OR lower(trim(plan)) NOT IN ('free', 'plus', 'premium');

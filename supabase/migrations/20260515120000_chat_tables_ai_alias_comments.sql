-- Nomenclatura de produto (Dr. Graxa): fisicamente usamos chat_sessions / chat_messages
-- no backend; ai_chats / ai_messages referem-se a estas tabelas (session_id = chat_id).

COMMENT ON TABLE public.chat_sessions IS 'Dr. Graxa — conversas (produto: ai_chats).';
COMMENT ON TABLE public.chat_messages IS 'Dr. Graxa — mensagens (produto: ai_messages); session_id referencia ai_chats(id).';


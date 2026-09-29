# RevisAuto — Webapp

Gestão de manutenção, gastos e documentação de veículos.
Vite + React 19 + TypeScript + Tailwind 4, com backend Express e Supabase.

Versão web do app anteriormente empacotado com Capacitor para Android.

## Stack

- **Front:** Vite, React 19, TypeScript, Tailwind CSS 4, lucide-react, motion
- **Back:** Express rodando em Cloudflare Workers (node:http)
- **Banco/Auth:** Supabase
- **IA:** Google Gemini (assistente "Dr. Graxa")
- **Pagamentos:** Mercado Pago (assinaturas)
- **Biometria:** WebAuthn (Face ID / Touch ID / digital / Windows Hello)

## Rodando localmente

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha as chaves
npm run build
npm run dev
```

Tudo em `http://localhost:8787`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Worker local (front + API) em :8787 |
| `npm run build` | Gera o `dist/` |
| `npm run deploy` | Build + publica na Cloudflare |
| `npm run tail` | Logs do Worker em tempo real |
| `npm run lint` | Typecheck com `tsc --noEmit` |

## Deploy

Veja **[GUIA-DEPLOY-CLOUDFLARE.md](GUIA-DEPLOY-CLOUDFLARE.md)** para o passo a
passo completo, incluindo variáveis de ambiente, configuração do Mercado Pago
e do Supabase, e checklist pós-deploy.

## Estrutura

```
src/
  App.tsx           # aplicação (telas, estado, chamadas de API)
  biometric.ts      # desbloqueio local via WebAuthn
  plans.ts          # regras de plano (free/plus/premium) e limites
  translations.ts   # PT-BR, PT-PT, EN, ES
  constants.ts      # marcas e modelos de veículos
  types.ts          # tipos compartilhados com o backend
  utils/format.ts   # datas, moeda, locale
server.ts           # API Express (roda no Worker)
mp.ts               # cliente REST do Mercado Pago
wrangler.jsonc      # configuração do Cloudflare Worker
supabase/migrations # esquema do banco
```

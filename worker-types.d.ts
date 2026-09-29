/**
 * Tipos do runtime do Cloudflare Workers.
 *
 * Usamos uma directive de referência em vez de "types" no tsconfig.json:
 * declarar "types" ali desativaria a inclusão automática dos demais pacotes
 * @types do projeto (React, Node), quebrando a checagem do front-end.
 */
/// <reference types="@cloudflare/workers-types" />

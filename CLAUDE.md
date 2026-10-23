# Controle Financeiro

App pessoal (PWA em HTML, CSS e JS puros, sem build), publicado no GitHub Pages a partir da `main`. O dono testa sempre online, em vários aparelhos.

## A cada mudança no app

- Aumente `VERSAO.numero` em `app.js` e atualize `VERSAO.data` com a data e a hora da mudança no horário de Brasília (`TZ=America/Sao_Paulo date '+%d/%m/%Y %H:%M'`). A versão aparece no topo do app.
- Use o mesmo número em `CACHE` no `sw.js` (`controle-financeiro-v<número>`).
- Para publicar, abra um PR para a `main` e faça o merge; o GitHub Pages atualiza o link sozinho.

## Estilo

- Textos da interface e do código em português, simples e diretos. O app deve ser intuitivo, sem precisar de explicação.

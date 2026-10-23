# Controle Financeiro

App simples de controle financeiro pessoal que roda em qualquer aparelho (PC, celular e tablet) direto no navegador e pode ser instalado como aplicativo (PWA). Funciona offline.

## O que faz

O app tem 5 abas:

- **Mês:** tudo que entra e sai no mês (avulsos, fixos, faturas de cartão e dívidas), com receitas, despesas, saldo e quanto ainda falta pagar. No topo, **Para pagar** mostra o que está atrasado ou vence nos próximos 7 dias. Cada conta tem uma caixinha para marcar como paga; a fatura do cartão aparece numa linha só (toque em "Ver" para ver as compras).
- **Futuro:** quanto entra, sai e sobra em cada um dos próximos 12 ou 24 meses, quanto você junta no período e, em **Quando sobra mais**, o mês em que cada compra ou dívida termina e quanto passa a sobrar a partir dele.
- **Fixos:** salário e contas que se repetem: todo mês ou só em alguns meses (IPTU, 13º, férias…). Dá para mudar o valor de um mês só ou tirar de um mês específico.
- **Cartões:** cada cartão com o dia de fechamento e de vencimento, as próximas faturas e as compras. Informe a data da compra e o app coloca cada parcela na fatura certa. Compras sem cartão (carnê, boleto) também ficam aqui.
- **Dívidas:** o que você deve, para quem e quando vence. Mostra quanto falta, quanto já foi pago, quanto pagar em cada mês e o mês em que tudo fica quitado.

Ao digitar uma descrição, o app sugere descrições já usadas e escolhe a categoria sozinho.

Também faz backup (exportar/importar) e exporta uma planilha CSV que abre no Excel.

## Onde ficam os dados

- **Sem login:** os dados ficam só no aparelho (no navegador).
- **Com login ("Entrar" com a conta Google):** os dados ficam também na sua conta, no Firebase (Firestore), e sincronizam entre todos os aparelhos em que você entrar. Funciona offline: as mudanças são enviadas quando a internet voltar.

As regras do Firestore só permitem que cada conta leia e altere os próprios dados (documento `usuarios/<id da conta>`). A configuração do Firebase em `nuvem.js` não é secreta; ela só identifica o projeto.

Regras usadas no Firestore:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Estrutura

| Arquivo | Para que serve |
|---|---|
| `index.html` | Estrutura da página |
| `style.css` | Visual (inclui modo escuro e layout para celular/PC) |
| `app.js` | Toda a lógica do app |
| `nuvem.js` | Login com Google e sincronização no Firebase |
| `sw.js` | Service worker: faz o app abrir sem internet |
| `manifest.webmanifest` | Informações para instalar como app |
| `icons/` | Ícones do app |

Não tem build nem dependências: é só HTML, CSS e JavaScript.

## Rodar no computador

Na pasta do projeto:

```sh
python3 -m http.server 8000
```

Depois abra http://localhost:8000 no navegador.

## Publicar de graça (GitHub Pages)

1. No GitHub, abra o repositório e vá em **Settings → Pages**.
2. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
3. Em um ou dois minutos o app fica disponível em `https://<seu-usuario>.github.io/<nome-do-repositorio>/`.

No plano gratuito do GitHub, o Pages só funciona com repositório **público**. Isso torna público apenas o código; seus dados financeiros continuam só no seu aparelho.

## Instalar como app

- **Android (Chrome):** abra o link e toque em "Instalar app" (ou menu ⋮ → "Instalar app").
- **iPhone/iPad (Safari):** abra o link, toque em Compartilhar → "Adicionar à Tela de Início".
- **PC (Chrome/Edge):** clique no ícone de instalar na barra de endereço.

## Ao alterar o código

Depois de mudar qualquer arquivo:

1. Em `app.js`, aumente `VERSAO.numero` e coloque a data e a hora da mudança (horário de Brasília). Ela aparece no topo do app, então dá para conferir em cada aparelho se a versão nova já chegou.
2. Em `sw.js`, use o mesmo número em `CACHE` (ex.: `controle-financeiro-v5` → `v6`) para os aparelhos baixarem a nova versão.

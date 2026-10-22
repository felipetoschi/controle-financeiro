# Controle Financeiro

App simples de controle financeiro pessoal que roda em qualquer aparelho (PC, celular e tablet) direto no navegador e pode ser instalado como aplicativo (PWA). Funciona offline.

## O que faz

O app tem 4 abas:

- **Mês:** tudo que entra e sai no mês (avulsos, fixos, parcelas e dívidas), com receitas, despesas, saldo e quanto ainda falta pagar. Cada conta tem uma caixinha para marcar como paga.
- **Fixos:** salário e contas que se repetem todo mês (energia, água, aluguel…). Aparecem sozinhos em todos os meses. Dá para mudar o valor de um mês só (ex.: a conta de luz veio diferente) ou tirar de um mês específico.
- **Parcelados:** compras parceladas. Informe a quantidade de parcelas e o valor de cada parcela ou o total; cada parcela aparece no mês dela.
- **Dívidas:** o que você deve, para quem e quando vence. Mostra quanto falta, quanto já foi pago, quanto pagar em cada mês e o mês em que tudo fica quitado.

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

Depois de mudar qualquer arquivo, aumente a versão em `sw.js` (`controle-financeiro-v1` → `v2`) para os aparelhos baixarem a nova versão.

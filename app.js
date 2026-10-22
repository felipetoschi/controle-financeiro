'use strict';

// Chaves onde os dados ficam guardados no navegador (localStorage).
const CHAVE = 'controle-financeiro:v2';
const CHAVE_V1 = 'controle-financeiro:v1';
const CHAVE_ABA = 'controle-financeiro:aba';

const CATEGORIAS_PADRAO = {
  receita: ['Salário', 'Renda extra', 'Investimentos', 'Outros'],
  despesa: ['Moradia', 'Energia', 'Água', 'Internet e telefone', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Outros'],
};
const CATEGORIA_DIVIDA = 'Dívidas';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const TIPOS = new Set(['receita', 'despesa']);
const MES_RE = /^\d{4}-\d{2}$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const formatoDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

const $ = (seletor) => document.querySelector(seletor);

// ---------- Dados ----------
//
// avulsos:    lançamentos de um dia só            { id, tipo, descricao, categoria, centavos, data }
// fixos:      repetem todo mês                     { id, tipo, descricao, categoria, centavos, dia, inicio, fim, ajustes, pulados }
// parcelados: compras em N parcelas (despesa)      { id, descricao, categoria, total, parcelas, inicio, dia }
// dividas:    dívidas em N parcelas                { id, descricao, credor, obs, total, parcelas, inicio, dia }
// pagos:      { "<f|p|d>:<id>:<AAAA-MM>": true } marca o que já foi pago/recebido em cada mês
// Meses são "AAAA-MM", datas "AAAA-MM-DD" e valores em centavos (inteiros).

function mesclarCategorias(c) {
  const r = {};
  for (const tipo of TIPOS) {
    const extras = c && Array.isArray(c[tipo]) ? c[tipo].filter((x) => typeof x === 'string') : [];
    r[tipo] = [...new Set([...CATEGORIAS_PADRAO[tipo], ...extras])];
  }
  return r;
}

// Valida e completa dados vindos do armazenamento ou de um backup. Aceita o formato antigo (v1).
function normalizar(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.transacoes) && !d.avulsos) d = { categorias: d.categorias, avulsos: d.transacoes };
  const lista = (x) => (Array.isArray(x) ? x : []);
  const r = {
    versao: 2,
    categorias: mesclarCategorias(d.categorias),
    avulsos: lista(d.avulsos),
    fixos: lista(d.fixos),
    parcelados: lista(d.parcelados),
    dividas: lista(d.dividas),
    pagos: d.pagos && typeof d.pagos === 'object' ? d.pagos : {},
  };
  const ok =
    r.avulsos.every((t) => t && t.id && TIPOS.has(t.tipo) && Number.isInteger(t.centavos) && DATA_RE.test(t.data)) &&
    r.fixos.every((f) => f && f.id && TIPOS.has(f.tipo) && Number.isInteger(f.centavos) && MES_RE.test(f.inicio) && Number.isInteger(f.dia)) &&
    [...r.parcelados, ...r.dividas].every((p) => p && p.id && Number.isInteger(p.total) && Number.isInteger(p.parcelas) && p.parcelas > 0 && MES_RE.test(p.inicio) && Number.isInteger(p.dia));
  if (!ok) return null;
  for (const f of r.fixos) {
    f.ajustes = f.ajustes && typeof f.ajustes === 'object' ? f.ajustes : {};
    f.pulados = Array.isArray(f.pulados) ? f.pulados : [];
    f.fim = f.fim || null;
  }
  return r;
}

function carregar() {
  for (const chave of [CHAVE, CHAVE_V1]) {
    try {
      const bruto = localStorage.getItem(chave);
      const d = bruto && normalizar(JSON.parse(bruto));
      if (d) return d;
    } catch (e) {
      console.warn('Não foi possível ler os dados salvos', e);
    }
  }
  return normalizar({});
}

function salvarNoAparelho() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(dados));
  } catch (e) {
    alert('Não foi possível salvar os dados neste aparelho. Faça um backup para não perdê-los.');
  }
}

function salvar() {
  salvarNoAparelho();
  window.financas.aoSalvar?.(dados);
}

let dados = carregar();
let mesAtual = mesHoje();
let abaAtual = 'mes';
try {
  abaAtual = localStorage.getItem(CHAVE_ABA) || 'mes';
} catch {}

// ---------- Datas e valores ----------

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mesHoje() {
  return hojeISO().slice(0, 7);
}

function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d || 1);
}

function addMeses(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function difMeses(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return a2 * 12 + m2 - (a1 * 12 + m1);
}

// Data do dia `dia` no mês `ym`; em meses mais curtos usa o último dia.
function dataNoMes(ym, dia) {
  const [a, m] = ym.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${ym}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

function maiuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function nomeMes(ym) {
  return maiuscula(formatoMes.format(paraData(ym + '-01')));
}

function nomeMesCurto(ym) {
  const [a, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]}/${a}`;
}

function dataCurta(iso) {
  return iso.split('-').reverse().join('/');
}

// Aceita "1.234,56", "12,5", "12.50", "R$ 30" etc. Retorna centavos ou null.
function lerValor(texto) {
  let t = texto.replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const centavos = Math.round(parseFloat(t) * 100);
  return centavos > 0 ? centavos : null;
}

function valorParaCampo(centavos) {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

function formatar(centavos) {
  return moeda.format(centavos / 100);
}

function novoId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Parcela `i` (0 = primeira) de um total dividido em n; os centavos que sobram vão nas primeiras.
function valorParcela(total, n, i) {
  const base = Math.floor(total / n);
  return base + (i < total - base * n ? 1 : 0);
}

// ---------- Regras ----------

function fixoNoMes(f, ym) {
  return ym >= f.inicio && (!f.fim || ym <= f.fim) && !f.pulados.includes(ym);
}

function valorFixo(f, ym) {
  return f.ajustes[ym] ?? f.centavos;
}

// prefixo: 'p' para parcelados, 'd' para dívidas.
function parcela(item, prefixo, i) {
  const mes = addMeses(item.inicio, i);
  const chave = `${prefixo}:${item.id}:${mes}`;
  return { i, mes, data: dataNoMes(mes, item.dia), centavos: valorParcela(item.total, item.parcelas, i), chave, pago: !!dados.pagos[chave] };
}

function parcelasDe(item, prefixo) {
  return Array.from({ length: item.parcelas }, (_, i) => parcela(item, prefixo, i));
}

function limparPagos(prefixo, id) {
  for (const chave of Object.keys(dados.pagos)) if (chave.startsWith(`${prefixo}:${id}:`)) delete dados.pagos[chave];
}

// Tudo que entra ou sai num mês, já com fixos, parcelas e dívidas.
function ocorrencias(ym) {
  const lista = [];
  for (const t of dados.avulsos) {
    if (t.data.startsWith(ym)) lista.push({ fonte: 'avulso', ref: t, tipo: t.tipo, descricao: t.descricao, categoria: t.categoria, centavos: t.centavos, data: t.data });
  }
  for (const f of dados.fixos) {
    if (!fixoNoMes(f, ym)) continue;
    const chave = `f:${f.id}:${ym}`;
    lista.push({ fonte: 'fixo', ref: f, tipo: f.tipo, descricao: f.descricao, categoria: f.categoria, centavos: valorFixo(f, ym), data: dataNoMes(ym, f.dia), etiqueta: 'Fixo', chave, pago: !!dados.pagos[chave] });
  }
  for (const [fonte, prefixo, itens] of [['parcelado', 'p', dados.parcelados], ['divida', 'd', dados.dividas]]) {
    for (const item of itens) {
      const k = difMeses(item.inicio, ym);
      if (k < 0 || k >= item.parcelas) continue;
      const p = parcela(item, prefixo, k);
      const nome = fonte === 'divida' ? 'Dívida' : 'Parcela';
      lista.push({
        fonte, ref: item, tipo: 'despesa', descricao: item.descricao,
        categoria: fonte === 'divida' ? CATEGORIA_DIVIDA : item.categoria,
        centavos: p.centavos, data: p.data, chave: p.chave, pago: p.pago,
        etiqueta: item.parcelas > 1 ? `${nome} ${k + 1}/${item.parcelas}` : nome,
      });
    }
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
}

function resumoDivida(d) {
  const parcelas = parcelasDe(d, 'd');
  const abertas = parcelas.filter((p) => !p.pago);
  return {
    parcelas,
    pagas: parcelas.length - abertas.length,
    restante: abertas.reduce((s, p) => s + p.centavos, 0),
    pago: parcelas.filter((p) => p.pago).reduce((s, p) => s + p.centavos, 0),
    proxima: abertas[0] || null,
    quitacao: abertas.length ? abertas[abertas.length - 1].mes : null,
  };
}

// ---------- Construção da tela ----------

function elemento(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function botao(texto, classe, aoClicar) {
  const b = elemento('button', classe, texto);
  b.type = 'button';
  b.addEventListener('click', aoClicar);
  return b;
}

function barra(fracao, classe) {
  const fundo = elemento('div', 'barra');
  const cheio = elemento('div', classe);
  cheio.style.width = `${Math.max(0, Math.min(1, fracao)) * 100}%`;
  fundo.append(cheio);
  return fundo;
}

function vazio(caixa, texto) {
  caixa.append(elemento('p', 'vazio', texto));
}

function corDoSaldo(el, valor) {
  el.className = 'valor ' + (valor < 0 ? 'despesa' : valor > 0 ? 'receita' : '');
}

function render() {
  for (const b of document.querySelectorAll('.abas button')) b.classList.toggle('ativa', b.dataset.aba === abaAtual);
  for (const s of document.querySelectorAll('.aba')) s.hidden = s.id !== `aba-${abaAtual}`;
  renderMes();
  renderFixos();
  renderParcelados();
  renderDividas();
}

// ----- Aba Mês -----

function renderMes() {
  $('#mes-atual').textContent = nomeMes(mesAtual);

  const itens = ocorrencias(mesAtual);
  const soma = (filtro) => itens.filter(filtro).reduce((s, t) => s + t.centavos, 0);
  const receitas = soma((t) => t.tipo === 'receita');
  const despesas = soma((t) => t.tipo === 'despesa');
  const falta = soma((t) => t.tipo === 'despesa' && t.chave && !t.pago);

  $('#total-receitas').textContent = formatar(receitas);
  $('#total-despesas').textContent = formatar(despesas);
  $('#saldo').textContent = formatar(receitas - despesas);
  corDoSaldo($('#saldo'), receitas - despesas);
  $('#falta-pagar').textContent = formatar(falta);
  $('#falta-pagar').className = 'valor' + (falta > 0 ? ' despesa' : '');

  renderLista(itens);
  renderCategorias(itens, despesas);
}

function renderLista(itens) {
  const lista = $('#lista');
  lista.replaceChildren();
  if (itens.length === 0) return vazio(lista, 'Nada neste mês. Toque em + para adicionar.');

  let diaAtual = null;
  let grupo = null;
  for (const t of itens) {
    if (t.data !== diaAtual) {
      diaAtual = t.data;
      grupo = elemento('div', 'dia');
      grupo.append(elemento('p', 'dia-titulo', formatoDia.format(paraData(t.data))));
      lista.append(grupo);
    }

    const linha = elemento('div', 'linha' + (t.pago ? ' paga' : ''));

    // Fixos, parcelas e dívidas têm a marcação de pago/recebido; avulsos já aconteceram.
    const marcar = elemento('span', 'marcar');
    if (t.chave) {
      const caixa = elemento('input');
      caixa.type = 'checkbox';
      caixa.checked = t.pago;
      caixa.setAttribute('aria-label', `${t.tipo === 'receita' ? 'Recebido' : 'Pago'}: ${t.descricao}`);
      caixa.addEventListener('change', () => {
        if (caixa.checked) dados.pagos[t.chave] = true;
        else delete dados.pagos[t.chave];
        salvar();
        render();
      });
      marcar.append(caixa);
    }

    const info = elemento('div', 'info');
    info.append(elemento('span', 'descricao', t.descricao));
    const detalhe = elemento('span', 'detalhe', t.categoria);
    if (t.etiqueta) detalhe.append(' · ', elemento('span', 'etiqueta', t.etiqueta));
    if (t.pago) detalhe.append(' · ', elemento('span', 'ok', t.tipo === 'receita' ? 'recebido' : 'pago'));
    info.append(detalhe);

    const quantia = elemento('span', 'quantia ' + t.tipo, (t.tipo === 'despesa' ? '− ' : '+ ') + formatar(t.centavos));
    const editar = botao('Editar', 'btn-mini', () => editarOcorrencia(t));

    linha.append(marcar, info, quantia, editar);
    grupo.append(linha);
  }
}

function editarOcorrencia(t) {
  if (t.fonte === 'avulso') abrirAvulso(t.ref);
  else if (t.fonte === 'fixo') abrirOcorrencia(t.ref, mesAtual);
  else if (t.fonte === 'parcelado') abrirParcelado(t.ref);
  else abrirDivida(t.ref);
}

function renderCategorias(itens, totalDespesas) {
  const caixa = $('#categorias');
  caixa.replaceChildren();
  if (totalDespesas === 0) return vazio(caixa, 'Sem despesas neste mês.');

  const porCategoria = new Map();
  for (const t of itens) if (t.tipo === 'despesa') porCategoria.set(t.categoria, (porCategoria.get(t.categoria) || 0) + t.centavos);
  const ordenadas = [...porCategoria].sort((a, b) => b[1] - a[1]);
  const maior = ordenadas[0][1];

  for (const [categoria, centavos] of ordenadas) {
    const item = elemento('div', 'cat');
    const linha = elemento('div', 'cat-linha');
    const pct = Math.round((centavos / totalDespesas) * 100);
    linha.append(elemento('span', '', categoria), elemento('span', '', `${formatar(centavos)} · ${pct}%`));
    item.append(linha, barra(centavos / maior, 'cheio-despesa'));
    caixa.append(item);
  }
}

// ----- Aba Fixos -----

function renderFixos() {
  const hoje = mesHoje();
  let receitas = 0;
  let despesas = 0;
  for (const f of dados.fixos) {
    if (!fixoNoMes(f, hoje)) continue;
    if (f.tipo === 'receita') receitas += valorFixo(f, hoje);
    else despesas += valorFixo(f, hoje);
  }
  $('#fx-total-receitas').textContent = formatar(receitas);
  $('#fx-total-despesas').textContent = formatar(despesas);
  $('#fx-sobra').textContent = formatar(receitas - despesas);
  corDoSaldo($('#fx-sobra'), receitas - despesas);

  for (const tipo of TIPOS) {
    const caixa = $(`#lista-fixos-${tipo}s`);
    caixa.replaceChildren();
    const itens = dados.fixos
      .filter((f) => f.tipo === tipo)
      .sort((a, b) => Number(!!a.fim && a.fim < hoje) - Number(!!b.fim && b.fim < hoje) || a.dia - b.dia);
    if (itens.length === 0) {
      vazio(caixa, tipo === 'receita' ? 'Cadastre aqui seu salário.' : 'Cadastre aqui energia, água, aluguel…');
    }
    for (const f of itens) {
      const encerrado = f.fim && f.fim < hoje;
      const linha = elemento('div', 'linha' + (encerrado ? ' paga' : ''));
      const info = elemento('div', 'info');
      info.append(elemento('span', 'descricao', f.descricao));
      let texto = `${f.categoria} · todo dia ${f.dia} · desde ${nomeMesCurto(f.inicio)}`;
      if (f.fim) texto += encerrado ? ` · encerrado em ${nomeMesCurto(f.fim)}` : ` · até ${nomeMesCurto(f.fim)}`;
      info.append(elemento('span', 'detalhe', texto));
      linha.append(info, elemento('span', 'quantia ' + tipo, formatar(f.centavos)), botao('Editar', 'btn-mini', () => abrirFixo(f)));
      caixa.append(linha);
    }
  }
}

// ----- Aba Parcelados -----

function renderParcelados() {
  const hoje = mesHoje();
  let doMes = 0;
  let restante = 0;
  let ultimo = null;
  const caixa = $('#lista-parcelados');
  caixa.replaceChildren();

  const itens = dados.parcelados.map((p) => ({ p, fim: addMeses(p.inicio, p.parcelas - 1) }));
  itens.sort((a, b) => Number(a.fim < hoje) - Number(b.fim < hoje) || a.fim.localeCompare(b.fim));
  if (itens.length === 0) vazio(caixa, 'Nenhuma compra parcelada. Toque em + para adicionar.');

  for (const { p, fim } of itens) {
    const parcelas = parcelasDe(p, 'p');
    const atual = parcelas.find((x) => x.mes === hoje);
    if (atual) doMes += atual.centavos;
    const falta = parcelas.filter((x) => x.mes >= hoje && !x.pago).reduce((s, x) => s + x.centavos, 0);
    restante += falta;
    if (falta > 0 && (!ultimo || fim > ultimo)) ultimo = fim;

    const k = difMeses(p.inicio, hoje) + 1; // parcela que cai neste mês
    let situacao;
    if (k < 1) situacao = `começa em ${nomeMesCurto(p.inicio)}`;
    else if (k > p.parcelas) situacao = `terminou em ${nomeMesCurto(fim)}`;
    else situacao = `parcela ${k} de ${p.parcelas} neste mês · termina em ${nomeMesCurto(fim)}`;

    const linha = elemento('div', 'linha' + (k > p.parcelas ? ' paga' : ''));
    const info = elemento('div', 'info');
    info.append(
      elemento('span', 'descricao', p.descricao),
      elemento('span', 'detalhe', `${p.parcelas}× ${formatar(valorParcela(p.total, p.parcelas, p.parcelas - 1))} · total ${formatar(p.total)} · ${p.categoria}`),
      elemento('span', 'detalhe', situacao),
      barra(Math.max(0, Math.min(k, p.parcelas)) / p.parcelas, 'cheio-primaria'),
    );
    linha.append(info, botao('Editar', 'btn-mini', () => abrirParcelado(p)));
    caixa.append(linha);
  }

  $('#pc-total-mes').textContent = formatar(doMes);
  $('#pc-total-restante').textContent = formatar(restante);
  $('#pc-fim').textContent = ultimo ? nomeMes(ultimo) : '—';
}

// ----- Aba Dívidas -----

function renderDividas() {
  const hoje = mesHoje();
  const caixa = $('#lista-dividas');
  caixa.replaceChildren();

  const itens = dados.dividas.map((d) => ({ d, r: resumoDivida(d) }));
  // Em aberto primeiro (pela próxima data), quitadas no fim.
  itens.sort((a, b) => Number(!a.r.proxima) - Number(!b.r.proxima) || (a.r.proxima?.data || '').localeCompare(b.r.proxima?.data || ''));

  let restante = 0;
  let pago = 0;
  let quitacao = null;
  const porMes = new Map();

  if (itens.length === 0) vazio(caixa, 'Nenhuma dívida cadastrada. Toque em + para adicionar.');

  for (const { d, r } of itens) {
    restante += r.restante;
    pago += r.pago;
    if (r.quitacao && (!quitacao || r.quitacao > quitacao)) quitacao = r.quitacao;
    for (const p of r.parcelas) if (!p.pago) porMes.set(p.mes, (porMes.get(p.mes) || 0) + p.centavos);

    const linha = elemento('div', 'linha divida' + (r.proxima ? '' : ' paga'));
    const info = elemento('div', 'info');
    info.append(elemento('span', 'descricao', d.credor ? `${d.descricao} — ${d.credor}` : d.descricao));

    if (r.proxima) {
      const atrasada = r.proxima.mes < hoje;
      const prox = elemento('span', 'detalhe' + (atrasada ? ' alerta' : ''),
        `${atrasada ? 'Atrasada' : 'Próxima'}: ${formatar(r.proxima.centavos)} em ${dataCurta(r.proxima.data)}`);
      info.append(
        prox,
        elemento('span', 'detalhe', `${r.pagas} de ${d.parcelas} pagas · falta ${formatar(r.restante)} · quita em ${nomeMesCurto(r.quitacao)}`),
      );
    } else {
      info.append(elemento('span', 'detalhe ok', `Quitada · ${formatar(d.total)}`));
    }
    if (d.obs) info.append(elemento('span', 'detalhe', d.obs));
    info.append(barra(r.pagas / d.parcelas, 'cheio-receita'));

    const botoes = elemento('div', 'botoes');
    if (r.proxima) {
      botoes.append(botao('Paguei', 'btn btn-pequeno', () => {
        dados.pagos[r.proxima.chave] = true;
        salvar();
        render();
      }));
    }
    botoes.append(botao('Editar', 'btn-mini', () => abrirDivida(d)));
    linha.append(info, botoes);
    caixa.append(linha);
  }

  $('#dv-total-restante').textContent = formatar(restante);
  $('#dv-total-pago').textContent = formatar(pago);
  $('#dv-quitacao').textContent = quitacao ? nomeMes(quitacao) : itens.length ? 'Tudo pago!' : '—';

  // Quanto sai em cada mês e quanto ainda falta depois dele.
  const caixaMes = $('#dv-por-mes');
  caixaMes.replaceChildren();
  const meses = [...porMes].sort((a, b) => a[0].localeCompare(b[0]));
  if (meses.length === 0) return vazio(caixaMes, 'Nenhum pagamento pendente.');
  const maior = Math.max(...meses.map((m) => m[1]));
  let falta = restante;
  for (const [mes, valor] of meses) {
    falta -= valor;
    const item = elemento('div', 'cat');
    const linha = elemento('div', 'cat-linha');
    const nome = elemento('span', '', nomeMes(mes));
    if (mes < hoje) nome.append(' ', elemento('span', 'alerta', '(atrasado)'));
    linha.append(nome, elemento('span', '', formatar(valor)));
    item.append(linha, barra(valor / maior, 'cheio-despesa'));
    item.append(elemento('span', 'detalhe', falta > 0 ? `depois deste mês ainda falta ${formatar(falta)}` : 'último pagamento 🎉'));
    caixaMes.append(item);
  }
}

// ---------- Formulários ----------

function mostrarErro(prefixo, msg) {
  const el = $(`#${prefixo}-erro`);
  el.textContent = msg || '';
  el.hidden = !msg;
}

function radio(nome) {
  return document.querySelector(`input[name="${nome}"]:checked`).value;
}

function marcarRadio(nome, valor) {
  document.querySelector(`input[name="${nome}"][value="${valor}"]`).checked = true;
}

function preencherCategorias(select, tipo, selecionada) {
  select.replaceChildren();
  const opcoes = [...dados.categorias[tipo]];
  if (selecionada && !opcoes.includes(selecionada)) opcoes.push(selecionada);
  for (const c of opcoes) {
    const op = elemento('option', '', c);
    op.value = c;
    select.append(op);
  }
  if (selecionada) select.value = selecionada;
}

// Data sugerida para algo novo: hoje, se estiver vendo o mês atual; senão, dia 1 do mês exibido.
function dataPadrao() {
  const hoje = hojeISO();
  return hoje.startsWith(mesAtual) ? hoje : mesAtual + '-01';
}

function abrir(dialogo, prefixo, editando, tituloNovo, tituloEditar) {
  dialogo.querySelector('form')?.reset();
  mostrarErro(prefixo, '');
  $(`#${prefixo}-titulo`).textContent = editando ? tituloEditar : tituloNovo;
  const excluir = $(`#${prefixo}-excluir`);
  if (excluir) excluir.hidden = !editando;
  dialogo.showModal();
}

for (const d of document.querySelectorAll('dialog')) {
  for (const b of d.querySelectorAll('.fechar')) b.addEventListener('click', () => d.close());
}

// ----- Avulso -----

const dlgAvulso = $('#dlg-avulso');
let avulsoEditando = null;

function abrirAvulso(t, tipo = 'despesa') {
  avulsoEditando = t;
  abrir(dlgAvulso, 'av', t, 'Novo lançamento', 'Editar lançamento');
  marcarRadio('av-tipo', t ? t.tipo : tipo);
  preencherCategorias($('#av-categoria'), t ? t.tipo : tipo, t?.categoria);
  $('#av-descricao').value = t ? t.descricao : '';
  $('#av-valor').value = t ? valorParaCampo(t.centavos) : '';
  $('#av-data').value = t ? t.data : dataPadrao();
  $('#av-descricao').focus();
}

dlgAvulso.addEventListener('change', (e) => {
  if (e.target.name === 'av-tipo') preencherCategorias($('#av-categoria'), e.target.value);
});

dlgAvulso.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const descricao = $('#av-descricao').value.trim();
  const centavos = lerValor($('#av-valor').value);
  const data = $('#av-data').value;
  if (!descricao) return mostrarErro('av', 'Informe uma descrição.');
  if (centavos === null) return mostrarErro('av', 'Valor inválido. Use, por exemplo, 25,90.');
  if (!data) return mostrarErro('av', 'Informe a data.');

  const campos = { tipo: radio('av-tipo'), descricao, centavos, categoria: $('#av-categoria').value, data };
  if (avulsoEditando) Object.assign(avulsoEditando, campos);
  else dados.avulsos.push({ id: novoId(), ...campos });
  salvar();
  mesAtual = data.slice(0, 7);
  dlgAvulso.close();
  render();
});

$('#av-excluir').addEventListener('click', () => {
  const t = avulsoEditando;
  if (!confirm(`Excluir "${t.descricao}" (${formatar(t.centavos)})?`)) return;
  dados.avulsos = dados.avulsos.filter((x) => x !== t);
  salvar();
  dlgAvulso.close();
  render();
});

// ----- Fixo -----

const dlgFixo = $('#dlg-fixo');
let fixoEditando = null;

function abrirFixo(f) {
  fixoEditando = f;
  abrir(dlgFixo, 'fx', f, 'Novo fixo mensal', 'Editar fixo mensal');
  marcarRadio('fx-tipo', f ? f.tipo : 'despesa');
  preencherCategorias($('#fx-categoria'), f ? f.tipo : 'despesa', f?.categoria);
  $('#fx-descricao').value = f ? f.descricao : '';
  $('#fx-valor').value = f ? valorParaCampo(f.centavos) : '';
  $('#fx-inicio').value = f ? dataNoMes(f.inicio, f.dia) : dataPadrao();
  $('#fx-fim').value = f && f.fim ? dataNoMes(f.fim, f.dia) : '';
  const nota = $('#fx-nota');
  nota.hidden = !f;
  if (f) {
    nota.textContent = `Se mudar o valor, o novo valor vale a partir de ${nomeMes(mesAtual)}; os meses anteriores ficam como estavam. ` +
      'Para mudar só um mês (ex.: a conta de luz veio diferente), toque no lançamento na aba Mês.';
  }
  $('#fx-descricao').focus();
}

dlgFixo.addEventListener('change', (e) => {
  if (e.target.name === 'fx-tipo') preencherCategorias($('#fx-categoria'), e.target.value);
});

dlgFixo.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const descricao = $('#fx-descricao').value.trim();
  const centavos = lerValor($('#fx-valor').value);
  const inicioData = $('#fx-inicio').value;
  const fimData = $('#fx-fim').value;
  if (!descricao) return mostrarErro('fx', 'Informe uma descrição.');
  if (centavos === null) return mostrarErro('fx', 'Valor inválido. Use, por exemplo, 150,00.');
  if (!inicioData) return mostrarErro('fx', 'Informe a data do primeiro vencimento ou recebimento.');
  const inicio = inicioData.slice(0, 7);
  const fim = fimData ? fimData.slice(0, 7) : null;
  if (fim && fim < inicio) return mostrarErro('fx', 'O último mês não pode ser antes do primeiro.');

  const campos = { tipo: radio('fx-tipo'), descricao, centavos, categoria: $('#fx-categoria').value, dia: Number(inicioData.slice(8)), inicio, fim };
  const f = fixoEditando;
  if (f) {
    // Novo valor vale a partir do mês exibido: guarda o valor antigo nos meses anteriores.
    if (centavos !== f.centavos) {
      for (let m = f.inicio; m < mesAtual && (!f.fim || m <= f.fim); m = addMeses(m, 1)) {
        if (!(m in f.ajustes)) f.ajustes[m] = f.centavos;
      }
    }
    Object.assign(f, campos);
  } else {
    dados.fixos.push({ id: novoId(), ...campos, ajustes: {}, pulados: [] });
  }
  salvar();
  dlgFixo.close();
  render();
});

$('#fx-excluir').addEventListener('click', () => {
  const f = fixoEditando;
  if (!confirm(`Excluir "${f.descricao}" de TODOS os meses, inclusive os anteriores?\n\nSe só parou de existir agora, use "Último mês" em vez de excluir.`)) return;
  dados.fixos = dados.fixos.filter((x) => x !== f);
  limparPagos('f', f.id);
  salvar();
  dlgFixo.close();
  render();
});

// ----- Um mês de um fixo -----

const dlgOcorrencia = $('#dlg-ocorrencia');
let ocorrencia = null;

function abrirOcorrencia(f, ym) {
  ocorrencia = { f, ym };
  mostrarErro('oc', '');
  $('#oc-titulo').textContent = `${f.descricao} — ${nomeMes(ym)}`;
  $('#oc-valor').value = valorParaCampo(valorFixo(f, ym));
  $('#oc-nota').textContent = `O valor normal é ${formatar(f.centavos)}. Mudar aqui altera só ${nomeMes(ym)}.`;
  dlgOcorrencia.showModal();
}

dlgOcorrencia.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { f, ym } = ocorrencia;
  const centavos = lerValor($('#oc-valor').value);
  if (centavos === null) return mostrarErro('oc', 'Valor inválido. Use, por exemplo, 150,00.');
  if (centavos === f.centavos) delete f.ajustes[ym];
  else f.ajustes[ym] = centavos;
  salvar();
  dlgOcorrencia.close();
  render();
});

$('#oc-editar').addEventListener('click', () => {
  dlgOcorrencia.close();
  abrirFixo(ocorrencia.f);
});

$('#oc-pular').addEventListener('click', () => {
  const { f, ym } = ocorrencia;
  if (!confirm(`Tirar "${f.descricao}" só de ${nomeMes(ym)}? Os outros meses continuam.`)) return;
  if (!f.pulados.includes(ym)) f.pulados.push(ym);
  delete dados.pagos[`f:${f.id}:${ym}`];
  salvar();
  dlgOcorrencia.close();
  render();
});

// ----- Parcelados e dívidas (mesma forma de informar parcelas e valor) -----

function lerParcelamento(prefixo) {
  const n = Number($(`#${prefixo}-parcelas`).value);
  const v = lerValor($(`#${prefixo}-valor`).value);
  if (!Number.isInteger(n) || n < 1 || n > 600) return { erro: 'Informe a quantidade de parcelas (de 1 a 600).' };
  if (v === null) return { erro: 'Valor inválido. Use, por exemplo, 150,00.' };
  const total = radio(`${prefixo}-modo`) === 'total' ? v : v * n;
  if (total < n) return { erro: 'Valor total pequeno demais para essa quantidade de parcelas.' };
  return { n, total };
}

function atualizarPrevia(prefixo) {
  const r = lerParcelamento(prefixo);
  const data = $(`#${prefixo}-inicio`).value;
  const el = $(`#${prefixo}-previa`);
  if (r.erro || !data) {
    el.textContent = '';
    return;
  }
  const inicio = data.slice(0, 7);
  el.textContent = r.n === 1
    ? `Pagamento único de ${formatar(r.total)} em ${dataCurta(data)}.`
    : `${r.n}× de ${formatar(valorParcela(r.total, r.n, 0))} = ${formatar(r.total)} · de ${nomeMesCurto(inicio)} até ${nomeMesCurto(addMeses(inicio, r.n - 1))}`;
}

function preencherParcelamento(prefixo, item) {
  const exato = item && item.total % item.parcelas === 0;
  marcarRadio(`${prefixo}-modo`, !item || exato ? 'parcela' : 'total');
  $(`#${prefixo}-parcelas`).value = item ? item.parcelas : prefixo === 'dv' ? 1 : '';
  $(`#${prefixo}-valor`).value = item ? valorParaCampo(exato ? item.total / item.parcelas : item.total) : '';
  $(`#${prefixo}-inicio`).value = item ? dataNoMes(item.inicio, item.dia) : dataPadrao();
}

for (const prefixo of ['pc', 'dv']) {
  const dlg = $(prefixo === 'pc' ? '#dlg-parcelado' : '#dlg-divida');
  dlg.addEventListener('input', () => atualizarPrevia(prefixo));
  dlg.addEventListener('change', () => atualizarPrevia(prefixo));
}

// ----- Parcelado -----

const dlgParcelado = $('#dlg-parcelado');
let parceladoEditando = null;

function abrirParcelado(p) {
  parceladoEditando = p;
  abrir(dlgParcelado, 'pc', p, 'Nova compra parcelada', 'Editar compra parcelada');
  $('#pc-descricao').value = p ? p.descricao : '';
  preencherCategorias($('#pc-categoria'), 'despesa', p ? p.categoria : 'Compras');
  preencherParcelamento('pc', p);
  atualizarPrevia('pc');
  $('#pc-descricao').focus();
}

dlgParcelado.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const descricao = $('#pc-descricao').value.trim();
  const data = $('#pc-inicio').value;
  if (!descricao) return mostrarErro('pc', 'Informe uma descrição.');
  const r = lerParcelamento('pc');
  if (r.erro) return mostrarErro('pc', r.erro);
  if (!data) return mostrarErro('pc', 'Informe a data da primeira parcela.');

  const campos = { descricao, categoria: $('#pc-categoria').value, total: r.total, parcelas: r.n, inicio: data.slice(0, 7), dia: Number(data.slice(8)) };
  const p = parceladoEditando;
  if (p) {
    const pagos = new Set(parcelasDe(p, 'p').filter((x) => x.pago).map((x) => x.mes));
    limparPagos('p', p.id);
    Object.assign(p, campos);
    for (const x of parcelasDe(p, 'p')) if (pagos.has(x.mes)) dados.pagos[x.chave] = true;
  } else {
    dados.parcelados.push({ id: novoId(), ...campos });
  }
  salvar();
  dlgParcelado.close();
  render();
});

$('#pc-excluir').addEventListener('click', () => {
  const p = parceladoEditando;
  if (!confirm(`Excluir a compra "${p.descricao}" e todas as parcelas dela?`)) return;
  dados.parcelados = dados.parcelados.filter((x) => x !== p);
  limparPagos('p', p.id);
  salvar();
  dlgParcelado.close();
  render();
});

// ----- Dívida -----

const dlgDivida = $('#dlg-divida');
let dividaEditando = null;

function abrirDivida(d) {
  dividaEditando = d;
  abrir(dlgDivida, 'dv', d, 'Nova dívida', 'Editar dívida');
  $('#dv-descricao').value = d ? d.descricao : '';
  $('#dv-credor').value = d ? d.credor || '' : '';
  $('#dv-obs').value = d ? d.obs || '' : '';
  preencherParcelamento('dv', d);
  $('#dv-pagas').value = d ? resumoDivida(d).pagas : 0;
  atualizarPrevia('dv');
  $('#dv-descricao').focus();
}

dlgDivida.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const descricao = $('#dv-descricao').value.trim();
  const data = $('#dv-inicio').value;
  const pagas = Number($('#dv-pagas').value || 0);
  if (!descricao) return mostrarErro('dv', 'Informe o que é a dívida.');
  const r = lerParcelamento('dv');
  if (r.erro) return mostrarErro('dv', r.erro);
  if (!data) return mostrarErro('dv', 'Informe a data do primeiro vencimento.');
  if (!Number.isInteger(pagas) || pagas < 0 || pagas > r.n) return mostrarErro('dv', `Parcelas já pagas deve ser de 0 a ${r.n}.`);

  const campos = {
    descricao, credor: $('#dv-credor').value.trim(), obs: $('#dv-obs').value.trim(),
    total: r.total, parcelas: r.n, inicio: data.slice(0, 7), dia: Number(data.slice(8)),
  };
  let d = dividaEditando;
  if (d) {
    limparPagos('d', d.id);
    Object.assign(d, campos);
  } else {
    d = { id: novoId(), ...campos };
    dados.dividas.push(d);
  }
  // As primeiras `pagas` parcelas ficam marcadas como pagas.
  parcelasDe(d, 'd').slice(0, pagas).forEach((x) => (dados.pagos[x.chave] = true));
  salvar();
  dlgDivida.close();
  render();
});

$('#dv-excluir').addEventListener('click', () => {
  const d = dividaEditando;
  if (!confirm(`Excluir a dívida "${d.descricao}" e todas as parcelas dela?`)) return;
  dados.dividas = dados.dividas.filter((x) => x !== d);
  limparPagos('d', d.id);
  salvar();
  dlgDivida.close();
  render();
});

// ----- Botão + -----

const dlgNovo = $('#dlg-novo');
const ABRIR_NOVO = {
  avulso: () => abrirAvulso(null),
  fixo: () => abrirFixo(null),
  parcelado: () => abrirParcelado(null),
  divida: () => abrirDivida(null),
};

for (const b of dlgNovo.querySelectorAll('[data-novo]')) {
  b.addEventListener('click', () => {
    dlgNovo.close();
    ABRIR_NOVO[b.dataset.novo]();
  });
}

$('#btn-nova').addEventListener('click', () => {
  if (abaAtual === 'fixos') abrirFixo(null);
  else if (abaAtual === 'parcelados') abrirParcelado(null);
  else if (abaAtual === 'dividas') abrirDivida(null);
  else dlgNovo.showModal();
});

// ---------- Backup ----------

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = elemento('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#btn-exportar').addEventListener('click', () => {
  baixar(`financas-backup-${hojeISO()}.json`, JSON.stringify(dados, null, 2), 'application/json');
});

$('#btn-importar').addEventListener('click', () => $('#arquivo-importar').click());

$('#arquivo-importar').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  let d = null;
  try {
    d = normalizar(JSON.parse(await arquivo.text()));
  } catch {}
  if (!d) return alert('Arquivo inválido. Escolha um backup exportado por este app.');
  const total = window.financas.contar(d);
  if (!confirm(`Importar ${total} registro(s)? Os dados atuais deste aparelho serão substituídos.`)) return;
  dados = d;
  salvar();
  render();
});

// Planilha com tudo, mês a mês: do primeiro registro até o fim das parcelas (ou 12 meses à frente para os fixos).
$('#btn-csv').addEventListener('click', () => {
  const hoje = mesHoje();
  const inicios = [
    ...dados.avulsos.map((t) => t.data.slice(0, 7)),
    ...dados.fixos.map((f) => f.inicio),
    ...[...dados.parcelados, ...dados.dividas].map((p) => p.inicio),
  ];
  const fins = [
    ...dados.avulsos.map((t) => t.data.slice(0, 7)),
    ...dados.fixos.map((f) => f.fim || addMeses(hoje, 11)),
    ...[...dados.parcelados, ...dados.dividas].map((p) => addMeses(p.inicio, p.parcelas - 1)),
  ];
  if (inicios.length === 0) return alert('Ainda não há nada para exportar.');
  const primeiro = inicios.sort()[0];
  const ultimo = fins.sort().at(-1);

  // Separador ";" e vírgula decimal para abrir direto no Excel em português.
  const aspas = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const linhas = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Detalhe', 'Valor', 'Pago'].join(';')];
  for (let m = primeiro, n = 0; m <= ultimo && n < 600; m = addMeses(m, 1), n++) {
    for (const t of ocorrencias(m)) {
      const valor = ((t.tipo === 'despesa' ? -t.centavos : t.centavos) / 100).toFixed(2).replace('.', ',');
      linhas.push([
        dataCurta(t.data), t.tipo === 'receita' ? 'Receita' : 'Despesa', aspas(t.descricao), aspas(t.categoria),
        aspas(t.etiqueta || 'Avulso'), valor, t.chave ? (t.pago ? 'Sim' : 'Não') : '',
      ].join(';'));
    }
  }
  baixar(`financas-${hojeISO()}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
});

// ---------- Navegação e instalação ----------

for (const b of document.querySelectorAll('.abas button')) {
  b.addEventListener('click', () => {
    abaAtual = b.dataset.aba;
    try {
      localStorage.setItem(CHAVE_ABA, abaAtual);
    } catch {}
    render();
    window.scrollTo(0, 0);
  });
}

$('#mes-anterior').addEventListener('click', () => {
  mesAtual = addMeses(mesAtual, -1);
  render();
});
$('#mes-seguinte').addEventListener('click', () => {
  mesAtual = addMeses(mesAtual, 1);
  render();
});

let pedidoInstalacao = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoInstalacao = e;
  $('#btn-instalar').hidden = false;
});
$('#btn-instalar').addEventListener('click', async () => {
  if (!pedidoInstalacao) return;
  pedidoInstalacao.prompt();
  await pedidoInstalacao.userChoice;
  pedidoInstalacao = null;
  $('#btn-instalar').hidden = true;
});

if ('serviceWorker' in navigator) {
  // Quando uma versão nova do app assume, recarrega a página para mostrá-la.
  if (navigator.serviceWorker.controller) {
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregou) return;
      recarregou = true;
      location.reload();
    });
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
  });
}

// ---------- Ponte com a sincronização na nuvem (nuvem.js) ----------

window.financas = {
  dados: () => dados,
  normalizar,
  contar: (d) => d.avulsos.length + d.fixos.length + d.parcelados.length + d.dividas.length,
  // Troca os dados pelos que vieram da nuvem (não reenvia para a nuvem).
  substituir(d) {
    dados = d;
    salvarNoAparelho();
    render();
  },
  aoSalvar: null, // definido por nuvem.js quando há login
};

if (!['mes', 'fixos', 'parcelados', 'dividas'].includes(abaAtual)) abaAtual = 'mes';
render();

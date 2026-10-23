'use strict';

// Versão mostrada no topo do app. A cada mudança: aumente o número, atualize a data/hora (horário de Brasília)
// e use o mesmo número em CACHE no sw.js.
const VERSAO = { numero: 5, data: '23/10/2026 16:41' };

// Chaves onde os dados ficam guardados no navegador (localStorage).
const CHAVE = 'controle-financeiro:v2';
const CHAVE_V1 = 'controle-financeiro:v1';
const CHAVE_ABA = 'controle-financeiro:aba';

const CATEGORIAS_PADRAO = {
  receita: ['Salário', 'Renda extra', 'Investimentos', 'Outros'],
  despesa: ['Moradia', 'Energia', 'Água', 'Internet e telefone', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Outros'],
};
const CATEGORIA_DIVIDA = 'Dívidas';
const DIA_MS = 86400000;

// Palavras que sugerem a categoria ao digitar a descrição.
const PALAVRAS_CATEGORIA = [
  [/sal[aá]rio|vencimento|subs[ií]dio|13|d[eé]cimo|f[eé]rias/i, 'Salário'],
  [/bico|extra|freela|venda/i, 'Renda extra'],
  [/energia|luz|enel|cemig|copel|celesc|light|coelba|equatorial/i, 'Energia'],
  [/[aá]gua|saneamento|sabesp|copasa|esgoto/i, 'Água'],
  [/internet|celular|telefone|vivo|claro|tim\b|oi\b|fibra/i, 'Internet e telefone'],
  [/aluguel|condom[ií]nio|iptu|g[aá]s|reforma|m[oó]vel|casa/i, 'Moradia'],
  [/mercado|supermercado|feira|padaria|a[cç]ougue|ifood|restaurante|lanche|comida/i, 'Alimentação'],
  [/uber|99|gasolina|combust[ií]vel|[oô]nibus|metr[oô]|ipva|carro|moto|estacionamento|ped[aá]gio|seguro auto/i, 'Transporte'],
  [/farm[aá]cia|rem[eé]dio|m[eé]dico|plano de sa[uú]de|unimed|dentista|exame|academia/i, 'Saúde'],
  [/escola|faculdade|curso|livro|mensalidade/i, 'Educação'],
  [/netflix|spotify|prime|disney|hbo|max\b|youtube|globoplay|icloud|google one|assinatura/i, 'Assinaturas'],
  [/cinema|viagem|bar\b|show|passeio|jogo/i, 'Lazer'],
];

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
// fixos.meses (opcional): meses do ano em que acontece (1–12), ex.: IPTU [2..11]; sem ele, todo mês
// cartoes:    cartões de crédito                   { id, nome, fechamento, vencimento }
// parcelados: compras em N parcelas (despesa)      { id, descricao, categoria, total, parcelas, inicio, dia, cartao?, compra? }
//             com cartão, inicio/dia vêm da fatura em que a compra cai (calculados a partir de `compra`)
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
    cartoes: lista(d.cartoes),
    parcelados: lista(d.parcelados),
    dividas: lista(d.dividas),
    pagos: d.pagos && typeof d.pagos === 'object' ? d.pagos : {},
  };
  const ok =
    r.avulsos.every((t) => t && t.id && TIPOS.has(t.tipo) && Number.isInteger(t.centavos) && DATA_RE.test(t.data)) &&
    r.fixos.every((f) => f && f.id && TIPOS.has(f.tipo) && Number.isInteger(f.centavos) && MES_RE.test(f.inicio) && Number.isInteger(f.dia)) &&
    r.cartoes.every((c) => c && c.id && typeof c.nome === 'string' && diaValido(c.fechamento) && diaValido(c.vencimento)) &&
    [...r.parcelados, ...r.dividas].every((p) => p && p.id && Number.isInteger(p.total) && Number.isInteger(p.parcelas) && p.parcelas > 0 && MES_RE.test(p.inicio) && Number.isInteger(p.dia));
  if (!ok) return null;
  for (const f of r.fixos) {
    f.ajustes = f.ajustes && typeof f.ajustes === 'object' ? f.ajustes : {};
    f.pulados = Array.isArray(f.pulados) ? f.pulados : [];
    f.fim = f.fim || null;
    const meses = Array.isArray(f.meses) ? [...new Set(f.meses.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b) : [];
    if (meses.length > 0 && meses.length < 12) f.meses = meses;
    else delete f.meses;
  }
  const cartoes = new Set(r.cartoes.map((c) => c.id));
  for (const p of r.parcelados) if (p.cartao && !cartoes.has(p.cartao)) delete p.cartao;
  return r;
}

function diaValido(n) {
  return Number.isInteger(n) && n >= 1 && n <= 31;
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

function somarDias(iso, n) {
  const d = new Date(paraData(iso).getTime() + n * DIA_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function difDias(de, ate) {
  return Math.round((paraData(ate) - paraData(de)) / DIA_MS);
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
  return ym >= f.inicio && (!f.fim || ym <= f.fim) && !f.pulados.includes(ym) && (!f.meses || f.meses.includes(Number(ym.slice(5))));
}

// "fev a nov", "jun e dez", "jan, mar e jul"
function descreverMeses(meses) {
  const seguidos = meses.every((m, i) => i === 0 || m === meses[i - 1] + 1);
  if (seguidos && meses.length > 2) return `${MESES[meses[0] - 1]} a ${MESES[meses.at(-1) - 1]}`;
  const nomes = meses.map((m) => MESES[m - 1]);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0];
}

function cartaoDe(id) {
  return id ? dados.cartoes.find((c) => c.id === id) || null : null;
}

// Mês da fatura em que cai uma compra: compras a partir do dia do fechamento vão para a fatura seguinte.
function mesDaFatura(cartao, dataCompra) {
  const mes = dataCompra.slice(0, 7);
  const fecha = Number(dataCompra.slice(8)) >= cartao.fechamento ? addMeses(mes, 1) : mes;
  return cartao.vencimento > cartao.fechamento ? fecha : addMeses(fecha, 1);
}

// Troca os dados de um parcelado mantendo marcadas como pagas as mesmas parcelas (pela ordem).
function atualizarParcelado(p, campos) {
  const pagas = new Set(parcelasDe(p, 'p').filter((x) => x.pago).map((x) => x.i));
  limparPagos('p', p.id);
  Object.assign(p, campos);
  for (const x of parcelasDe(p, 'p')) if (pagas.has(x.i)) dados.pagos[x.chave] = true;
}

// Recalcula as parcelas das compras de um cartão depois de mudar o fechamento ou o vencimento.
function reposicionarCompras(cartao) {
  for (const p of dados.parcelados) {
    if (p.cartao !== cartao.id || !p.compra) continue;
    atualizarParcelado(p, { inicio: mesDaFatura(cartao, p.compra), dia: cartao.vencimento });
  }
}

function sugerirCategoria(descricao, tipo) {
  const anterior = [...dados.avulsos, ...dados.fixos, ...dados.parcelados]
    .find((x) => (x.tipo || 'despesa') === tipo && x.descricao.toLowerCase() === descricao.trim().toLowerCase());
  if (anterior) return anterior.categoria;
  for (const [re, categoria] of PALAVRAS_CATEGORIA) {
    if (re.test(descricao) && dados.categorias[tipo].includes(categoria)) return categoria;
  }
  return null;
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
        cartao: fonte === 'parcelado' ? cartaoDe(item.cartao) : null,
        etiqueta: item.parcelas > 1 ? `${nome} ${k + 1}/${item.parcelas}` : nome,
      });
    }
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
}

// Junta as parcelas de cada cartão numa linha só: a fatura do mês.
function agruparFaturas(itens) {
  const faturas = new Map();
  const r = [];
  for (const t of itens) {
    if (!t.cartao) {
      r.push(t);
      continue;
    }
    let f = faturas.get(t.cartao.id);
    if (!f) {
      f = {
        fonte: 'fatura', ref: t.cartao, tipo: 'despesa', descricao: `Fatura ${t.cartao.nome}`, categoria: 'Cartão de crédito',
        centavos: 0, data: dataNoMes(t.data.slice(0, 7), t.cartao.vencimento), chaves: [], itens: [], pago: true,
      };
      faturas.set(t.cartao.id, f);
      r.push(f);
    }
    f.centavos += t.centavos;
    f.chaves.push(t.chave);
    f.itens.push(t);
    f.pago &&= t.pago;
  }
  for (const f of faturas.values()) f.etiqueta = f.itens.length === 1 ? '1 compra' : `${f.itens.length} compras`;
  return r.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
}

function marcarPago(t, pago) {
  for (const chave of t.chaves || [t.chave]) {
    if (pago) dados.pagos[chave] = true;
    else delete dados.pagos[chave];
  }
  salvar();
  render();
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
  renderFuturo();
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

  renderParaPagar();
  renderLista(itens);
  renderCategorias(itens, despesas);
}

function renderLista(itens) {
  const lista = $('#lista');
  lista.replaceChildren();
  if (itens.length === 0) return vazio(lista, 'Nada neste mês. Toque em + para adicionar.');

  let diaAtual = null;
  let grupo = null;
  for (const t of agruparFaturas(itens)) {
    if (t.data !== diaAtual) {
      diaAtual = t.data;
      grupo = elemento('div', 'dia');
      grupo.append(elemento('p', 'dia-titulo', formatoDia.format(paraData(t.data))));
      lista.append(grupo);
    }
    grupo.append(...linhaOcorrencia(t));
  }
}

// Linha de um lançamento (e, para faturas, a lista de compras que abre ao tocar). `quando` troca o detalhe.
function linhaOcorrencia(t, quando) {
  const linha = elemento('div', 'linha' + (t.pago ? ' paga' : ''));

  // Fixos, parcelas, faturas e dívidas têm a marcação de pago/recebido; avulsos já aconteceram.
  const marcar = elemento('span', 'marcar');
  if (t.chave || t.chaves) {
    const caixa = elemento('input');
    caixa.type = 'checkbox';
    caixa.checked = t.pago;
    caixa.setAttribute('aria-label', `${t.tipo === 'receita' ? 'Recebido' : 'Pago'}: ${t.descricao}`);
    caixa.addEventListener('change', () => marcarPago(t, caixa.checked));
    marcar.append(caixa);
  }

  const info = elemento('div', 'info');
  info.append(elemento('span', 'descricao', t.descricao));
  const detalhe = elemento('span', 'detalhe');
  if (quando) detalhe.append(quando);
  else detalhe.append(t.categoria);
  if (t.etiqueta) detalhe.append(' · ', elemento('span', 'etiqueta', t.etiqueta));
  if (t.pago && !quando) detalhe.append(' · ', elemento('span', 'ok', t.tipo === 'receita' ? 'recebido' : 'pago'));
  info.append(detalhe);

  const quantia = elemento('span', 'quantia ' + t.tipo, (t.tipo === 'despesa' ? '− ' : '+ ') + formatar(t.centavos));
  if (t.fonte !== 'fatura') {
    linha.append(marcar, info, quantia, botao('Editar', 'btn-mini', () => editarOcorrencia(t)));
    return [linha];
  }

  const compras = elemento('div', 'compras');
  compras.hidden = true;
  for (const c of t.itens) {
    const l = elemento('div', 'linha');
    const i = elemento('div', 'info');
    i.append(elemento('span', 'descricao', c.descricao), elemento('span', 'detalhe', `${c.categoria} · ${c.etiqueta}`));
    l.append(i, elemento('span', 'quantia despesa', formatar(c.centavos)), botao('Editar', 'btn-mini', () => abrirParcelado(c.ref)));
    compras.append(l);
  }
  const ver = botao('Ver', 'btn-mini', () => {
    compras.hidden = !compras.hidden;
    ver.textContent = compras.hidden ? 'Ver' : 'Fechar';
  });
  ver.setAttribute('aria-expanded', 'false');
  linha.append(marcar, info, quantia, ver);
  return [linha, compras];
}

// Contas não pagas que venceram há pouco ou vencem nos próximos 7 dias.
function renderParaPagar() {
  const painel = $('#para-pagar');
  const hoje = hojeISO();
  const de = somarDias(hoje, -20);
  const ate = somarDias(hoje, 7);
  const meses = [...new Set([de.slice(0, 7), hoje.slice(0, 7), ate.slice(0, 7)])];
  const itens = meses
    .flatMap((m) => agruparFaturas(ocorrencias(m)))
    .filter((t) => t.tipo === 'despesa' && (t.chave || t.chaves) && !t.pago && t.data >= de && t.data <= ate);

  painel.hidden = itens.length === 0 || mesAtual !== mesHoje();
  if (painel.hidden) return;
  const lista = $('#lista-para-pagar');
  lista.replaceChildren();
  const atrasadas = itens.filter((t) => t.data < hoje).length;
  $('#para-pagar-titulo').textContent = atrasadas
    ? `Para pagar · ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`
    : 'Para pagar nos próximos dias';
  for (const t of itens) {
    const dias = difDias(hoje, t.data);
    const quando = dias < 0
      ? elemento('span', 'alerta', `atrasada desde ${dataCurta(t.data).slice(0, 5)}`)
      : dias === 0 ? elemento('span', 'alerta', 'vence hoje')
      : dias === 1 ? 'vence amanhã' : `vence em ${dias} dias (${dataCurta(t.data).slice(0, 5)})`;
    lista.append(...linhaOcorrencia(t, quando));
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

// ----- Aba Futuro -----

let mesesFuturo = 12;

function renderFuturo() {
  const hoje = mesHoje();
  const meses = Array.from({ length: mesesFuturo }, (_, i) => {
    const ym = addMeses(hoje, i);
    const itens = ocorrencias(ym);
    const entra = itens.filter((t) => t.tipo === 'receita').reduce((s, t) => s + t.centavos, 0);
    const sai = itens.filter((t) => t.tipo === 'despesa').reduce((s, t) => s + t.centavos, 0);
    // O que é diferente neste mês: contas que não são de todo mês e o que termina nele.
    const marcas = [];
    for (const f of dados.fixos) if (f.meses && fixoNoMes(f, ym)) marcas.push({ texto: f.descricao, classe: f.tipo });
    for (const t of itens) {
      if ((t.fonte === 'parcelado' || t.fonte === 'divida') && addMeses(t.ref.inicio, t.ref.parcelas - 1) === ym && t.ref.parcelas > 1) {
        marcas.push({ texto: `última: ${t.ref.descricao}`, classe: 'fim' });
      }
    }
    return { ym, entra, sai, sobra: entra - sai, marcas };
  });

  const acumulado = meses.reduce((s, m) => s + m.sobra, 0);
  $('#ft-sobra-hoje').textContent = formatar(meses[0].sobra);
  corDoSaldo($('#ft-sobra-hoje'), meses[0].sobra);
  $('#ft-rotulo-fim').textContent = `Sobra em ${nomeMesCurto(meses.at(-1).ym)}`;
  $('#ft-sobra-fim').textContent = formatar(meses.at(-1).sobra);
  corDoSaldo($('#ft-sobra-fim'), meses.at(-1).sobra);
  $('#ft-rotulo-acumulado').textContent = `Juntando tudo em ${mesesFuturo} meses`;
  $('#ft-acumulado').textContent = formatar(acumulado);
  corDoSaldo($('#ft-acumulado'), acumulado);

  const caixa = $('#ft-meses');
  caixa.replaceChildren();
  const maior = Math.max(1, ...meses.map((m) => Math.abs(m.sobra)));
  let guardado = 0;
  for (const m of meses) {
    guardado += m.sobra;
    const linha = elemento('button', 'mes-futuro');
    linha.type = 'button';
    linha.addEventListener('click', () => irParaMes(m.ym));
    const topo = elemento('div', 'cat-linha');
    topo.append(elemento('strong', '', nomeMesCurto(m.ym)), elemento('strong', m.sobra < 0 ? 'despesa' : 'receita', formatar(m.sobra)));
    linha.append(topo, barra(Math.abs(m.sobra) / maior, m.sobra < 0 ? 'cheio-despesa' : 'cheio-receita'));
    linha.append(elemento('span', 'detalhe', `entra ${formatar(m.entra)} · sai ${formatar(m.sai)} · juntando: ${formatar(guardado)}`));
    if (m.marcas.length) {
      const chips = elemento('div', 'chips');
      for (const c of m.marcas) chips.append(elemento('span', 'chip ' + c.classe, c.texto));
      linha.append(chips);
    }
    caixa.append(linha);
  }
  $('#ft-mais').textContent = mesesFuturo === 12 ? 'Ver 24 meses' : 'Ver só 12 meses';

  // Quando cada compra, dívida ou conta termina, e quanto passa a sobrar por mês a partir daí.
  const folgas = [];
  for (const [itens, prefixo, nome] of [[dados.parcelados, 'p', 'Compra'], [dados.dividas, 'd', 'Dívida']]) {
    for (const item of itens) {
      const fim = addMeses(item.inicio, item.parcelas - 1);
      if (fim < hoje) continue;
      const cartao = prefixo === 'p' ? cartaoDe(item.cartao) : null;
      folgas.push({ mes: addMeses(fim, 1), descricao: item.descricao, centavos: valorParcela(item.total, item.parcelas, item.parcelas - 1), tipo: cartao ? `cartão ${cartao.nome}` : nome });
    }
  }
  for (const f of dados.fixos) {
    if (f.tipo === 'despesa' && f.fim && f.fim >= hoje) folgas.push({ mes: addMeses(f.fim, 1), descricao: f.descricao, centavos: f.centavos, tipo: 'Fixo' });
  }
  folgas.sort((a, b) => a.mes.localeCompare(b.mes));

  const lista = $('#ft-folgas');
  lista.replaceChildren();
  if (folgas.length === 0) return vazio(lista, 'Nenhuma compra parcelada ou dívida terminando.');
  let somaFolga = 0;
  for (const f of folgas) {
    somaFolga += f.centavos;
    const item = elemento('div', 'cat');
    const topo = elemento('div', 'cat-linha');
    topo.append(elemento('span', '', `${nomeMesCurto(f.mes)} · ${f.descricao}`), elemento('span', 'receita', `+${formatar(f.centavos)}`));
    item.append(topo, elemento('span', 'detalhe', `${maiuscula(f.tipo)} · a partir daí, +${formatar(somaFolga)} por mês no total`));
    lista.append(item);
  }
}

function irParaMes(ym) {
  mesAtual = ym;
  trocarAba('mes');
}

$('#ft-mais').addEventListener('click', () => {
  mesesFuturo = mesesFuturo === 12 ? 24 : 12;
  renderFuturo();
});

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
      let texto = `${f.categoria} · ${f.meses ? `dia ${f.dia} em ${descreverMeses(f.meses)}` : `todo dia ${f.dia}`} · desde ${nomeMesCurto(f.inicio)}`;
      if (f.fim) texto += encerrado ? ` · encerrado em ${nomeMesCurto(f.fim)}` : ` · até ${nomeMesCurto(f.fim)}`;
      info.append(elemento('span', 'detalhe', texto));
      linha.append(info, elemento('span', 'quantia ' + tipo, formatar(f.centavos)), botao('Editar', 'btn-mini', () => abrirFixo(f)));
      caixa.append(linha);
    }
  }
}

// ----- Aba Cartões (compras parceladas) -----

function renderParcelados() {
  const hoje = mesHoje();
  let doMes = 0;
  let restante = 0;
  let ultimo = null;
  const caixa = $('#lista-cartoes');
  caixa.replaceChildren();

  const grupos = [...dados.cartoes.map((c) => ({ cartao: c, compras: [] })), { cartao: null, compras: [] }];
  for (const p of dados.parcelados) grupos.find((g) => g.cartao?.id === (cartaoDe(p.cartao)?.id))?.compras.push(p);

  for (const { cartao, compras } of grupos) {
    if (!cartao && compras.length === 0) continue;
    const painel = elemento('div', 'painel');
    const cabeca = elemento('div', 'painel-cabeca');
    const titulo = elemento('div', 'info');
    titulo.append(elemento('h3', '', cartao ? cartao.nome : 'Sem cartão (carnê, boleto…)'));
    if (cartao) titulo.append(elemento('span', 'detalhe', `fecha dia ${cartao.fechamento} · vence dia ${cartao.vencimento}`));
    cabeca.append(titulo);
    if (cartao) cabeca.append(botao('Editar', 'btn-mini', () => abrirCartao(cartao)));
    painel.append(cabeca);

    // Próximas faturas deste cartão.
    if (cartao) {
      const faturas = elemento('div', 'faturas');
      for (let i = 0; i < 6; i++) {
        const ym = addMeses(hoje, i);
        const valor = ocorrencias(ym).filter((t) => t.cartao?.id === cartao.id).reduce((s, t) => s + t.centavos, 0);
        const f = elemento('button', 'fatura' + (i === 0 ? ' atual' : ''));
        f.type = 'button';
        f.addEventListener('click', () => irParaMes(ym));
        f.append(elemento('span', 'rotulo', nomeMesCurto(ym)), elemento('strong', '', formatar(valor)));
        faturas.append(f);
      }
      painel.append(faturas);
    }

    compras.sort((a, b) => {
      const fa = addMeses(a.inicio, a.parcelas - 1);
      const fb = addMeses(b.inicio, b.parcelas - 1);
      return Number(fa < hoje) - Number(fb < hoje) || fa.localeCompare(fb);
    });
    if (compras.length === 0) vazio(painel, 'Nenhuma compra neste cartão ainda.');
    for (const p of compras) {
      const fim = addMeses(p.inicio, p.parcelas - 1);
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
      else if (p.parcelas === 1) situacao = `à vista · ${nomeMesCurto(fim)}`;
      else situacao = `parcela ${k} de ${p.parcelas} · termina em ${nomeMesCurto(fim)}`;

      const linha = elemento('div', 'linha' + (k > p.parcelas ? ' paga' : ''));
      const info = elemento('div', 'info');
      info.append(
        elemento('span', 'descricao', p.descricao),
        elemento('span', 'detalhe', `${p.parcelas}× ${formatar(valorParcela(p.total, p.parcelas, p.parcelas - 1))} · total ${formatar(p.total)} · ${p.categoria}`),
        elemento('span', 'detalhe', situacao),
        barra(Math.max(0, Math.min(k, p.parcelas)) / p.parcelas, 'cheio-primaria'),
      );
      linha.append(info, botao('Editar', 'btn-mini', () => abrirParcelado(p)));
      painel.append(linha);
    }
    caixa.append(painel);
  }

  const novo = botao('+ Adicionar cartão', 'btn btn-secundario', () => abrirCartao(null));
  caixa.append(novo);

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
  const categoria = $(`#${prefixo}-categoria`);
  if (categoria) delete categoria.dataset.escolhida;
  preencherSugestoes();
  mostrarErro(prefixo, '');
  $(`#${prefixo}-titulo`).textContent = editando ? tituloEditar : tituloNovo;
  const excluir = $(`#${prefixo}-excluir`);
  if (excluir) excluir.hidden = !editando;
  dialogo.showModal();
}

for (const d of document.querySelectorAll('dialog')) {
  for (const b of d.querySelectorAll('.fechar')) b.addEventListener('click', () => d.close());
}

// Descrições já usadas aparecem como sugestão ao digitar.
function preencherSugestoes() {
  for (const [id, itens] of [['sug-av', dados.avulsos], ['sug-fx', dados.fixos], ['sug-pc', dados.parcelados]]) {
    const lista = $(`#${id}`);
    lista.replaceChildren(...[...new Set(itens.map((x) => x.descricao))].sort().map((d) => {
      const op = elemento('option');
      op.value = d;
      return op;
    }));
  }
}

// Ao digitar a descrição, escolhe a categoria sozinho (até a pessoa escolher outra).
for (const prefixo of ['av', 'fx', 'pc']) {
  const select = $(`#${prefixo}-categoria`);
  select.addEventListener('change', () => (select.dataset.escolhida = '1'));
  $(`#${prefixo}-descricao`).addEventListener('input', (e) => {
    if (select.dataset.escolhida) return;
    const tipo = prefixo === 'pc' ? 'despesa' : radio(`${prefixo}-tipo`);
    const sugestao = sugerirCategoria(e.target.value, tipo);
    if (sugestao) select.value = sugestao;
  });
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
  if (e.target.name !== 'av-tipo') return;
  preencherCategorias($('#av-categoria'), e.target.value, sugerirCategoria($('#av-descricao').value, e.target.value));
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
  abrir(dlgFixo, 'fx', f, 'Nova conta fixa', 'Editar conta fixa');
  mesesFixo = f?.meses ? [...f.meses] : MESES.map((_, j) => j + 1);
  desenharMeses();
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
  if (e.target.name !== 'fx-tipo') return;
  preencherCategorias($('#fx-categoria'), e.target.value, sugerirCategoria($('#fx-descricao').value, e.target.value));
});

// Meses em que o fixo acontece: todos ligados = todo mês.
let mesesFixo = [];

function desenharMeses() {
  const caixa = $('#fx-meses');
  caixa.replaceChildren();
  MESES.forEach((nome, i) => {
    const b = botao(nome, 'mes-chip', () => {
      const m = i + 1;
      // Com todos ligados, o primeiro toque escolhe só aquele mês.
      if (mesesFixo.length === 12) mesesFixo = [m];
      else if (mesesFixo.includes(m)) mesesFixo = mesesFixo.filter((x) => x !== m);
      else mesesFixo = [...mesesFixo, m].sort((a, b) => a - b);
      if (mesesFixo.length === 0) mesesFixo = MESES.map((_, j) => j + 1);
      desenharMeses();
    });
    b.setAttribute('aria-pressed', String(mesesFixo.includes(i + 1)));
    caixa.append(b);
  });
  const todos = mesesFixo.length === 12;
  $('#fx-repete').textContent = todos ? '· todo mês' : `· ${descreverMeses(mesesFixo)}`;
  if (!todos) caixa.append(botao('todo mês', 'mes-chip limpar', () => {
    mesesFixo = MESES.map((_, j) => j + 1);
    desenharMeses();
  }));
}

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
  if (f) delete f.meses;
  if (mesesFixo.length < 12) campos.meses = [...mesesFixo];
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
  const cartao = prefixo === 'pc' ? cartaoDe($('#pc-cartao').value) : null;
  if (cartao) {
    const inicio = mesDaFatura(cartao, data);
    const venc = dataCurta(dataNoMes(inicio, cartao.vencimento)).slice(0, 5);
    el.textContent = r.n === 1
      ? `${formatar(r.total)} na fatura de ${nomeMesCurto(inicio)} (vence ${venc})`
      : `${r.n}× de ${formatar(valorParcela(r.total, r.n, 0))} = ${formatar(r.total)} · faturas de ${nomeMesCurto(inicio)} a ${nomeMesCurto(addMeses(inicio, r.n - 1))}`;
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

function preencherCartoes(selecionado) {
  const select = $('#pc-cartao');
  select.replaceChildren();
  for (const c of dados.cartoes) select.append(new Option(c.nome, c.id));
  select.append(new Option('Sem cartão (carnê, boleto…)', ''), new Option('+ Novo cartão…', 'novo'));
  select.value = selecionado ?? '';
  select.dataset.anterior = select.value;
  ajustarFormCompra();
}

function ajustarFormCompra() {
  $('#pc-rotulo-data').textContent = $('#pc-cartao').value ? 'Data da compra' : 'Data da primeira parcela';
}

function abrirParcelado(p) {
  parceladoEditando = p;
  abrir(dlgParcelado, 'pc', p, 'Nova compra', 'Editar compra');
  $('#pc-descricao').value = p ? p.descricao : '';
  preencherCategorias($('#pc-categoria'), 'despesa', p ? p.categoria : 'Compras');
  preencherParcelamento('pc', p);
  // Compra nova: sugere o último cartão usado e pagamento à vista.
  const ultimo = [...dados.parcelados].reverse().find((x) => cartaoDe(x.cartao));
  preencherCartoes(p ? cartaoDe(p.cartao)?.id || '' : (ultimo?.cartao || dados.cartoes[0]?.id || ''));
  if (p?.compra && cartaoDe(p.cartao)) $('#pc-inicio').value = p.compra;
  if (!p && $('#pc-cartao').value) $('#pc-parcelas').value = 1;
  atualizarPrevia('pc');
  $('#pc-descricao').focus();
}

$('#pc-cartao').addEventListener('change', (e) => {
  const select = e.target;
  if (select.value === 'novo') {
    select.value = select.dataset.anterior;
    abrirCartao(null, (c) => {
      preencherCartoes(c.id);
      atualizarPrevia('pc');
    });
    return;
  }
  select.dataset.anterior = select.value;
  ajustarFormCompra();
});

dlgParcelado.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const descricao = $('#pc-descricao').value.trim();
  const data = $('#pc-inicio').value;
  const cartao = cartaoDe($('#pc-cartao').value);
  if (!descricao) return mostrarErro('pc', 'Informe uma descrição.');
  const r = lerParcelamento('pc');
  if (r.erro) return mostrarErro('pc', r.erro);
  if (!data) return mostrarErro('pc', cartao ? 'Informe a data da compra.' : 'Informe a data da primeira parcela.');

  const campos = cartao
    ? { cartao: cartao.id, compra: data, inicio: mesDaFatura(cartao, data), dia: cartao.vencimento }
    : { cartao: undefined, compra: undefined, inicio: data.slice(0, 7), dia: Number(data.slice(8)) };
  Object.assign(campos, { descricao, categoria: $('#pc-categoria').value, total: r.total, parcelas: r.n });
  const p = parceladoEditando;
  if (p) {
    atualizarParcelado(p, campos);
    if (!cartao) {
      delete p.cartao;
      delete p.compra;
    }
  } else {
    dados.parcelados.push(JSON.parse(JSON.stringify({ id: novoId(), ...campos })));
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

// ----- Cartão -----

const dlgCartao = $('#dlg-cartao');
let cartaoEditando = null;
let aoSalvarCartao = null;

function abrirCartao(c, aoSalvar = null) {
  cartaoEditando = c;
  aoSalvarCartao = aoSalvar;
  abrir(dlgCartao, 'ct', c, 'Novo cartão', 'Editar cartão');
  $('#ct-nome').value = c ? c.nome : '';
  $('#ct-vencimento').value = c ? c.vencimento : '';
  $('#ct-fechamento').value = c ? c.fechamento : '';
  $('#ct-fechamento').dataset.escolhido = c ? '1' : '';
  previaCartao();
  $('#ct-nome').focus();
}

function previaCartao() {
  const venc = Number($('#ct-vencimento').value);
  const fecha = Number($('#ct-fechamento').value);
  $('#ct-previa').textContent = diaValido(venc) && diaValido(fecha)
    ? `Compras a partir do dia ${fecha} já ficam para a fatura seguinte: é o melhor dia para comprar.`
    : '';
}

// Quase todo cartão fecha uns 7 dias antes do vencimento: sugere isso até a pessoa mudar.
$('#ct-vencimento').addEventListener('input', () => {
  const venc = Number($('#ct-vencimento').value);
  if (!$('#ct-fechamento').dataset.escolhido && diaValido(venc)) $('#ct-fechamento').value = venc > 7 ? venc - 7 : venc + 23;
  previaCartao();
});
$('#ct-fechamento').addEventListener('input', () => {
  $('#ct-fechamento').dataset.escolhido = '1';
  previaCartao();
});

dlgCartao.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('#ct-nome').value.trim();
  const vencimento = Number($('#ct-vencimento').value);
  const fechamento = Number($('#ct-fechamento').value);
  if (!nome) return mostrarErro('ct', 'Dê um nome ao cartão.');
  if (!diaValido(vencimento)) return mostrarErro('ct', 'Dia do vencimento deve ser de 1 a 31.');
  if (!diaValido(fechamento)) return mostrarErro('ct', 'Dia do fechamento deve ser de 1 a 31.');
  if (fechamento === vencimento) return mostrarErro('ct', 'O fechamento e o vencimento não podem ser no mesmo dia.');

  let c = cartaoEditando;
  if (c) {
    const mudou = c.vencimento !== vencimento || c.fechamento !== fechamento;
    Object.assign(c, { nome, vencimento, fechamento });
    if (mudou) reposicionarCompras(c);
  } else {
    c = { id: novoId(), nome, vencimento, fechamento };
    dados.cartoes.push(c);
  }
  salvar();
  dlgCartao.close();
  render();
  aoSalvarCartao?.(c);
});

$('#ct-excluir').addEventListener('click', () => {
  const c = cartaoEditando;
  const compras = dados.parcelados.filter((p) => p.cartao === c.id);
  const aviso = compras.length ? `\n\nAs ${compras.length} compra(s) dele continuam, como "sem cartão".` : '';
  if (!confirm(`Excluir o cartão "${c.nome}"?${aviso}`)) return;
  for (const p of compras) {
    delete p.cartao;
    delete p.compra;
  }
  dados.cartoes = dados.cartoes.filter((x) => x !== c);
  salvar();
  dlgCartao.close();
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

function trocarAba(aba) {
  abaAtual = aba;
  try {
    localStorage.setItem(CHAVE_ABA, abaAtual);
  } catch {}
  render();
  window.scrollTo(0, 0);
}

for (const b of document.querySelectorAll('.abas button')) b.addEventListener('click', () => trocarAba(b.dataset.aba));

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

$('#versao').textContent = `Versão ${VERSAO.numero} · ${VERSAO.data}`;

if (!['mes', 'futuro', 'fixos', 'parcelados', 'dividas'].includes(abaAtual)) abaAtual = 'mes';
render();

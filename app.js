'use strict';

// Chave onde os dados ficam guardados no navegador (localStorage).
const CHAVE = 'controle-financeiro:v1';

const CATEGORIAS_PADRAO = {
  receita: ['Salário', 'Freelance', 'Investimentos', 'Outros'],
  despesa: ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Contas', 'Compras', 'Outros'],
};

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const formatoDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

const $ = (seletor) => document.querySelector(seletor);

// ---------- Dados ----------

function dadosVazios() {
  return { categorias: structuredClone(CATEGORIAS_PADRAO), transacoes: [] };
}

function dadosValidos(d) {
  return d && Array.isArray(d.transacoes) && d.transacoes.every((t) =>
    t && typeof t.id === 'string' && (t.tipo === 'receita' || t.tipo === 'despesa') &&
    Number.isInteger(t.centavos) && /^\d{4}-\d{2}-\d{2}$/.test(t.data));
}

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) {
      const d = JSON.parse(bruto);
      if (dadosValidos(d)) return { categorias: d.categorias || structuredClone(CATEGORIAS_PADRAO), transacoes: d.transacoes };
    }
  } catch (e) {
    console.warn('Não foi possível ler os dados salvos', e);
  }
  return dadosVazios();
}

function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(dados));
  } catch (e) {
    alert('Não foi possível salvar os dados neste aparelho. Faça um backup para não perdê-los.');
  }
}

let dados = carregar();
let mesAtual = hojeISO().slice(0, 7); // "AAAA-MM"

// ---------- Utilidades ----------

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d || 1);
}

function maiuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function moverMes(delta) {
  const d = paraData(mesAtual + '-01');
  d.setMonth(d.getMonth() + delta);
  mesAtual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  render();
}

// Aceita "1.234,56", "12,5", "12.50", "R$ 30" etc. Retorna centavos ou null.
function lerValor(texto) {
  let t = texto.replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const centavos = Math.round(parseFloat(t) * 100);
  return centavos > 0 ? centavos : null;
}

function formatar(centavos) {
  return moeda.format(centavos / 100);
}

function novoId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function elemento(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// ---------- Tela ----------

function render() {
  $('#mes-atual').textContent = maiuscula(formatoMes.format(paraData(mesAtual + '-01')));

  const doMes = dados.transacoes.filter((t) => t.data.startsWith(mesAtual));
  const receitas = doMes.filter((t) => t.tipo === 'receita').reduce((s, t) => s + t.centavos, 0);
  const despesas = doMes.filter((t) => t.tipo === 'despesa').reduce((s, t) => s + t.centavos, 0);
  const saldo = receitas - despesas;

  $('#total-receitas').textContent = formatar(receitas);
  $('#total-despesas').textContent = formatar(despesas);
  const elSaldo = $('#saldo');
  elSaldo.textContent = formatar(saldo);
  elSaldo.className = 'valor ' + (saldo < 0 ? 'despesa' : saldo > 0 ? 'receita' : '');

  renderLista(doMes);
  renderCategorias(doMes, despesas);
}

function renderLista(doMes) {
  const lista = $('#lista');
  lista.replaceChildren();

  if (doMes.length === 0) {
    lista.append(elemento('p', 'vazio', 'Nenhuma transação neste mês. Toque em + para adicionar.'));
    return;
  }

  const ordenadas = [...doMes].sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || 0) - (a.criadoEm || 0));
  let diaAtual = null;
  let grupo = null;

  for (const t of ordenadas) {
    if (t.data !== diaAtual) {
      diaAtual = t.data;
      grupo = elemento('div', 'dia');
      grupo.append(elemento('p', 'dia-titulo', formatoDia.format(paraData(t.data))));
      lista.append(grupo);
    }

    const linha = elemento('div', 'transacao');
    const info = elemento('div', 'info');
    info.append(elemento('span', 'descricao', t.descricao), elemento('span', 'categoria', t.categoria));

    const sinal = t.tipo === 'despesa' ? '− ' : '+ ';
    const quantia = elemento('span', 'quantia ' + t.tipo, sinal + formatar(t.centavos));

    const botoes = elemento('div', 'botoes');
    const editar = elemento('button', 'btn-mini', 'Editar');
    editar.addEventListener('click', () => abrirFormulario(t));
    const excluir = elemento('button', 'btn-mini', 'Excluir');
    excluir.addEventListener('click', () => excluirTransacao(t));
    botoes.append(editar, excluir);

    linha.append(info, quantia, botoes);
    grupo.append(linha);
  }
}

function renderCategorias(doMes, totalDespesas) {
  const caixa = $('#categorias');
  caixa.replaceChildren();

  if (totalDespesas === 0) {
    caixa.append(elemento('p', 'vazio', 'Sem despesas neste mês.'));
    return;
  }

  const porCategoria = new Map();
  for (const t of doMes) {
    if (t.tipo !== 'despesa') continue;
    porCategoria.set(t.categoria, (porCategoria.get(t.categoria) || 0) + t.centavos);
  }

  const ordenadas = [...porCategoria].sort((a, b) => b[1] - a[1]);
  const maior = ordenadas[0][1];

  for (const [categoria, centavos] of ordenadas) {
    const item = elemento('div', 'cat');
    const linha = elemento('div', 'cat-linha');
    const pct = Math.round((centavos / totalDespesas) * 100);
    linha.append(elemento('span', '', categoria), elemento('span', '', `${formatar(centavos)} · ${pct}%`));
    const barra = elemento('div', 'barra');
    const preenchido = elemento('div');
    preenchido.style.width = `${(centavos / maior) * 100}%`;
    barra.append(preenchido);
    item.append(linha, barra);
    caixa.append(item);
  }
}

// ---------- Formulário ----------

const dialogo = $('#dialogo');
const form = $('#form');

function tipoSelecionado() {
  return form.querySelector('input[name="tipo"]:checked').value;
}

function preencherCategorias(tipo, selecionada) {
  const select = $('#tx-categoria');
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

function abrirFormulario(t) {
  form.reset();
  $('#form-erro').hidden = true;
  $('#form-titulo').textContent = t ? 'Editar transação' : 'Nova transação';
  $('#tx-id').value = t ? t.id : '';

  const tipo = t ? t.tipo : 'despesa';
  form.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
  preencherCategorias(tipo, t && t.categoria);

  $('#tx-descricao').value = t ? t.descricao : '';
  $('#tx-valor').value = t ? (t.centavos / 100).toFixed(2).replace('.', ',') : '';
  // Para uma nova transação, usa hoje se estiver vendo o mês atual; senão, o dia 1 do mês exibido.
  const hoje = hojeISO();
  $('#tx-data').value = t ? t.data : (hoje.startsWith(mesAtual) ? hoje : mesAtual + '-01');

  dialogo.showModal();
  $('#tx-descricao').focus();
}

function mostrarErro(msg) {
  const el = $('#form-erro');
  el.textContent = msg;
  el.hidden = false;
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'tipo') preencherCategorias(e.target.value);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const descricao = $('#tx-descricao').value.trim();
  const centavos = lerValor($('#tx-valor').value);
  const data = $('#tx-data').value;

  if (!descricao) return mostrarErro('Informe uma descrição.');
  if (centavos === null) return mostrarErro('Valor inválido. Use, por exemplo, 25,90.');
  if (!data) return mostrarErro('Informe a data.');

  const id = $('#tx-id').value;
  const campos = { tipo: tipoSelecionado(), descricao, centavos, categoria: $('#tx-categoria').value, data };

  if (id) {
    const t = dados.transacoes.find((x) => x.id === id);
    if (t) Object.assign(t, campos);
  } else {
    dados.transacoes.push({ id: novoId(), criadoEm: Date.now(), ...campos });
  }

  salvar();
  mesAtual = data.slice(0, 7);
  dialogo.close();
  render();
});

$('#btn-cancelar').addEventListener('click', () => dialogo.close());

function excluirTransacao(t) {
  if (!confirm(`Excluir "${t.descricao}" (${formatar(t.centavos)})?`)) return;
  dados.transacoes = dados.transacoes.filter((x) => x.id !== t.id);
  salvar();
  render();
}

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
  try {
    const d = JSON.parse(await arquivo.text());
    if (!dadosValidos(d)) throw new Error('formato');
    const n = d.transacoes.length;
    if (!confirm(`Importar ${n} transação(ões)? Os dados atuais deste aparelho serão substituídos.`)) return;
    dados = { categorias: d.categorias || structuredClone(CATEGORIAS_PADRAO), transacoes: d.transacoes };
    salvar();
    render();
  } catch {
    alert('Arquivo inválido. Escolha um backup exportado por este app.');
  }
});

$('#btn-csv').addEventListener('click', () => {
  // Separador ";" e vírgula decimal para abrir direto no Excel em português.
  const aspas = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const linhas = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor'].join(';')];
  const ordenadas = [...dados.transacoes].sort((a, b) => a.data.localeCompare(b.data));
  for (const t of ordenadas) {
    const valor = ((t.tipo === 'despesa' ? -t.centavos : t.centavos) / 100).toFixed(2).replace('.', ',');
    const data = t.data.split('-').reverse().join('/');
    linhas.push([data, t.tipo === 'receita' ? 'Receita' : 'Despesa', aspas(t.descricao), aspas(t.categoria), valor].join(';'));
  }
  baixar(`financas-${hojeISO()}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
});

// ---------- Navegação e instalação ----------

$('#mes-anterior').addEventListener('click', () => moverMes(-1));
$('#mes-seguinte').addEventListener('click', () => moverMes(1));
$('#btn-nova').addEventListener('click', () => abrirFormulario(null));

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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
  });
}

render();

import { ajustarPrazoMensal, criarRepositorioTarefas } from './tarefas-mensais.js';

const CAMPOS = {
  tarefas: 'id,usuario_id,titulo,descricao,prazo,prioridade,status,recorrente_mensal,dia_vencimento,tarefa_anterior_id,criado_em,atualizado_em',
  compromissos: 'id,usuario_id,titulo,descricao,inicio,fim,status,antecedencia_lembrete_dias,criado_em,atualizado_em',
  contas: 'id,usuario_id,tipo,titulo,descricao,categoria,valor,vencimento,status,recorrente_mensal,dia_vencimento,antecedencia_lembrete_dias,liquidado_em,conta_anterior_id,criado_em,atualizado_em',
};
const STATUS_TAREFAS = ['pendente', 'aberta', 'em_progresso', 'concluida', 'cancelada'];
const STATUS_COMPROMISSOS = ['agendado', 'confirmado', 'concluido', 'cancelado'];

function resultado(resposta) {
  if (resposta.error) throw resposta.error;
  return resposta.data;
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function titulo(valor) {
  const s = texto(valor);
  if (!s || s.length > 200) throw new Error('Informe um título com até 200 caracteres.');
  return s;
}

function inteiro(valor, minimo, maximo, mensagem) {
  if (valor === null || valor === undefined || texto(valor) === '' || typeof valor === 'boolean') {
    throw new Error(mensagem);
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) throw new Error(mensagem);
  return n;
}

function dataCivil(valor) {
  const s = texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) throw new Error('Informe uma data válida.');
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error('Informe uma data válida.');
  }
  return s;
}

function instante(valor) {
  if (!valor || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(valor))) {
    throw new Error('Informe uma data e horário válidos.');
  }
  dataCivil(String(valor).slice(0, 10));
  const d = new Date(valor);
  if (!Number.isFinite(d.getTime())) throw new Error('Informe uma data e horário válidos.');
  return d.toISOString();
}

export function dataLocal(valor = new Date()) {
  const d = new Date(valor);
  if (!Number.isFinite(d.getTime())) throw new Error('Data inválida.');
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numeroDia(valor) {
  return new Date(`${dataCivil(valor)}T00:00:00.000Z`).getTime() / 86400000;
}

export function proximoVencimento(vencimento, diaVencimento) {
  const [ano, mes] = dataCivil(vencimento).split('-').map(Number);
  const proximoAno = mes === 12 ? ano + 1 : ano;
  if (proximoAno > 9999) throw new Error('O próximo vencimento excede o intervalo de datas permitido.');
  const proximoMes = mes === 12 ? 1 : mes + 1;
  return ajustarPrazoMensal(`${String(proximoAno).padStart(4, '0')}-${String(proximoMes).padStart(2, '0')}-01`, diaVencimento);
}

function lembrete(valor = 1) {
  return inteiro(valor, 0, 2147483647, 'Informe uma antecedência inteira e não negativa.');
}

function prepararConta(entrada) {
  if (!['pagar', 'receber'].includes(entrada.tipo)) throw new Error('Selecione pagar ou receber.');
  const valorTexto = texto(entrada.valor).replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(valorTexto)) throw new Error('Informe um valor positivo ou zero, com até duas casas decimais e sem separador de milhar.');
  const valor = Number(valorTexto);
  if (!Number.isFinite(valor) || valor < 0 || !Number.isSafeInteger(Math.round(valor * 100))) {
    throw new Error('O valor informado está fora do intervalo permitido.');
  }
  const recorrente = entrada.recorrente_mensal === true;
  const dia = recorrente ? inteiro(entrada.dia_vencimento, 1, 31, 'Selecione um dia entre 1 e 31.') : null;
  let vencimento = dataCivil(entrada.vencimento);
  if (recorrente) vencimento = ajustarPrazoMensal(vencimento, dia);
  return {
    tipo: entrada.tipo,
    titulo: titulo(entrada.titulo),
    descricao: texto(entrada.descricao) || null,
    categoria: texto(entrada.categoria) || null,
    valor,
    vencimento,
    recorrente_mensal: recorrente,
    dia_vencimento: dia,
    antecedencia_lembrete_dias: lembrete(entrada.antecedencia_lembrete_dias),
  };
}

function prepararCompromisso(entrada) {
  const inicio = instante(entrada.inicio);
  const fim = entrada.fim ? instante(entrada.fim) : null;
  if (fim && new Date(fim) < new Date(inicio)) throw new Error('O término não pode ser anterior ao início.');
  const status = entrada.status || 'agendado';
  if (!STATUS_COMPROMISSOS.includes(status)) throw new Error('Selecione um status válido para o compromisso.');
  return {
    titulo: titulo(entrada.titulo),
    descricao: texto(entrada.descricao) || null,
    inicio,
    fim,
    status,
    antecedencia_lembrete_dias: lembrete(entrada.antecedencia_lembrete_dias),
  };
}

/**
 * Utiliza exclusivamente a instância Supabase autenticada já usada pelo app.
 * Não cria outro cliente nem armazena registros pessoais em localStorage.
 * Todos os acessos incluem usuario_id; as políticas RLS continuam sendo a
 * barreira de autorização no servidor.
 */
export function criarRepositorioOrganizador(cliente) {
  if (typeof cliente?.from !== 'function' || typeof cliente?.auth?.getSession !== 'function') {
    throw new Error('Informe o cliente Supabase autenticado do aplicativo.');
  }
  const tarefas = criarRepositorioTarefas(cliente);

  async function usuarioAtual() {
    const dados = resultado(await cliente.auth.getSession());
    if (!dados?.session?.user?.id) throw new Error('Entre na sua conta para acessar o organizador.');
    return dados.session.user.id;
  }

  async function conferirSessao(usuarioId) {
    if (await usuarioAtual() !== usuarioId) throw new Error('A conta conectada mudou. Atualize o painel.');
  }

  async function buscar(tabela, id, usuarioId) {
    return resultado(await cliente.from(tabela).select(CAMPOS[tabela])
      .eq('usuario_id', usuarioId).eq('id', id).single());
  }

  async function listarTabela(tabela, usuarioId) {
    const registros = [];
    const tamanho = 500;
    for (let inicio = 0; ; inicio += tamanho) {
      await conferirSessao(usuarioId);
      const pagina = resultado(await cliente.from(tabela).select(CAMPOS[tabela])
        .eq('usuario_id', usuarioId).order('id', { ascending: true })
        .range(inicio, inicio + tamanho - 1));
      registros.push(...pagina);
      if (pagina.length < tamanho) break;
    }
    return registros;
  }

  async function buscarSucessora(id, usuarioId) {
    return resultado(await cliente.from('contas').select(CAMPOS.contas)
      .eq('usuario_id', usuarioId).eq('conta_anterior_id', id).maybeSingle());
  }

  async function garantirSucessora(conta, usuarioId) {
    if (conta.status !== 'liquidada' || !conta.recorrente_mensal) return null;
    await conferirSessao(usuarioId);
    // Se um gatilho já criou a sucessora, apenas devolve a ocorrência existente.
    const existente = await buscarSucessora(conta.id, usuarioId);
    if (existente) return existente;
    const dia = conta.dia_vencimento ?? Number(conta.vencimento.slice(8, 10));
    const campos = {
      usuario_id: usuarioId,
      tipo: conta.tipo,
      titulo: conta.titulo,
      descricao: conta.descricao,
      categoria: conta.categoria,
      valor: conta.valor,
      vencimento: proximoVencimento(conta.vencimento, dia),
      status: 'pendente',
      recorrente_mensal: true,
      dia_vencimento: dia,
      antecedencia_lembrete_dias: conta.antecedencia_lembrete_dias,
      liquidado_em: null,
      conta_anterior_id: conta.id,
    };
    const resposta = await cliente.from('contas').insert(campos).select(CAMPOS.contas).single();
    if (!resposta.error) return resposta.data;
    // A restrição UNIQUE(conta_anterior_id) resolve a corrida entre aparelhos.
    // Também recupera uma inserção confirmada cuja resposta tenha sido perdida.
    try {
      const recuperada = await buscarSucessora(conta.id, usuarioId);
      if (recuperada) return recuperada;
    } catch {
      // Mantém o erro original para permitir nova tentativa sem duplicar.
    }
    throw resposta.error;
  }

  return {
    tarefas,

    async listar() {
      const usuarioId = await usuarioAtual();
      const [listaTarefas, compromissos, contas] = await Promise.all([
        listarTabela('tarefas', usuarioId),
        listarTabela('compromissos', usuarioId),
        listarTabela('contas', usuarioId),
      ]);
      await conferirSessao(usuarioId);
      return { tarefas: listaTarefas, compromissos, contas };
    },

    async salvarCompromisso(entrada, id = null) {
      const campos = prepararCompromisso(entrada);
      const usuarioId = await usuarioAtual();
      const consulta = id
        ? cliente.from('compromissos').update(campos).eq('usuario_id', usuarioId).eq('id', id)
        : cliente.from('compromissos').insert({ ...campos, usuario_id: usuarioId });
      return resultado(await consulta.select(CAMPOS.compromissos).single());
    },

    async salvarConta(entrada, id = null) {
      const campos = prepararConta(entrada);
      const usuarioId = await usuarioAtual();
      // Liquidações e vínculos históricos não podem ser sobrescritos pelo formulário.
      const consulta = id
        ? cliente.from('contas').update(campos).eq('usuario_id', usuarioId).eq('id', id).eq('status', 'pendente')
        : cliente.from('contas').insert({ ...campos, usuario_id: usuarioId, status: 'pendente' });
      const resposta = await consulta.select(CAMPOS.contas).maybeSingle();
      const conta = resultado(resposta);
      if (!conta) throw new Error('A conta não está mais pendente ou não foi encontrada. Atualize a lista.');
      return conta;
    },

    async alterarStatusTarefa(id, status) {
      if (!STATUS_TAREFAS.includes(status)) throw new Error('Selecione um status válido.');
      if (status === 'concluida') return tarefas.concluir(id);
      const usuarioId = await usuarioAtual();
      const ocorrencia = resultado(await cliente.from('tarefas').update({ status })
        .eq('usuario_id', usuarioId).eq('id', id).select(CAMPOS.tarefas).single());
      return { ocorrencia, proxima: null, aviso: null };
    },

    async liquidarConta(id) {
      const usuarioId = await usuarioAtual();
      resultado(await cliente.from('contas').update({ status: 'liquidada', liquidado_em: new Date().toISOString() })
        .eq('usuario_id', usuarioId).eq('id', id).eq('status', 'pendente'));
      const ocorrencia = await buscar('contas', id, usuarioId);
      if (ocorrencia.status !== 'liquidada') throw new Error('A liquidação não foi confirmada. Atualize e tente novamente.');
      try {
        const proxima = await garantirSucessora(ocorrencia, usuarioId);
        return { ocorrencia, proxima, aviso: null };
      } catch (erro) {
        // A liquidação já foi persistida. Não anunciar falha de pagamento nem
        // apagar o histórico porque a criação da próxima ocorrência falhou.
        return {
          ocorrencia,
          proxima: null,
          aviso: 'Liquidação registrada. A próxima conta mensal ainda precisa ser gerada; tente novamente para recuperar a recorrência.',
          erroRecorrencia: erro.message || 'Não foi possível gerar a próxima ocorrência.',
        };
      }
    },

    async recuperarRecorrencias() {
      const usuarioId = await usuarioAtual();
      const contas = await listarTabela('contas', usuarioId);
      const comSucessora = new Set(contas.map(c => c.conta_anterior_id).filter(Boolean));
      const pendencias = contas.filter(c => c.status === 'liquidada' && c.recorrente_mensal && !comSucessora.has(c.id));
      const recuperadas = [];
      const avisos = [];
      for (const conta of pendencias) {
        await conferirSessao(usuarioId);
        try {
          recuperadas.push(await garantirSucessora(conta, usuarioId));
        } catch (erro) {
          avisos.push({ id: conta.id, titulo: conta.titulo, mensagem: erro.message || 'Recorrência não recuperada.' });
        }
      }
      await conferirSessao(usuarioId);
      return { recuperadas, avisos };
    },
  };
}

function normalizar(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Deriva a interface sem alterar registros. Datas civis usam o calendário local. */
export function montarPainel(dados, filtros = {}, agora = new Date()) {
  const hoje = dataLocal(agora);
  const diaHoje = numeroDia(hoje);
  const busca = normalizar(filtros.busca);
  const de = filtros.de ? dataCivil(filtros.de) : null;
  const ate = filtros.ate ? dataCivil(filtros.ate) : null;
  if (de && ate && de > ate) throw new Error('O início do filtro deve ser anterior ao término.');
  const horizonte = filtros.proximosDias === undefined ? 30
    : inteiro(filtros.proximosDias, 0, 3650, 'Informe um horizonte de até 3650 dias.');

  const itens = [
    ...dados.tarefas.map(t => ({
      grupo: 'tarefas', registro: t, data: t.prazo,
      ativo: !['concluida', 'cancelada'].includes(t.status),
      antecedencia: null,
    })),
    ...dados.compromissos.map(c => ({
      grupo: 'compromissos', registro: c, data: dataLocal(c.inicio),
      ativo: !['concluido', 'concluida', 'cancelado', 'cancelada'].includes(c.status),
      antecedencia: c.antecedencia_lembrete_dias,
    })),
    ...dados.contas.map(c => ({
      grupo: c.tipo, registro: c, data: c.vencimento,
      ativo: c.status === 'pendente', antecedencia: c.antecedencia_lembrete_dias,
    })),
  ].map(item => {
    const dias = item.data ? numeroDia(item.data) - diaHoje : null;
    const compromisso = item.grupo === 'compromissos';
    const atrasado = item.ativo && (compromisso
      ? new Date(item.registro.fim || item.registro.inicio).getTime() < new Date(agora).getTime()
      : dias !== null && dias < 0);
    const emAndamento = compromisso && item.ativo && item.registro.fim
      && new Date(item.registro.inicio) <= new Date(agora) && new Date(item.registro.fim) >= new Date(agora);
    const ocorreHoje = dias === 0 || (compromisso && item.data < hoje && item.registro.fim && dataLocal(item.registro.fim) >= hoje);
    return {
      ...item, dias, atrasado, emAndamento: Boolean(emAndamento), hoje: Boolean(ocorreHoje),
      lembrete: item.ativo && !atrasado && dias !== null && dias >= 0
        && item.antecedencia !== null && dias <= item.antecedencia,
    };
  });

  const selecionados = itens.filter(item => {
    const r = item.registro;
    if (filtros.grupo && filtros.grupo !== 'todos' && item.grupo !== filtros.grupo) return false;
    if (busca && !normalizar(`${r.titulo} ${r.descricao || ''} ${r.categoria || ''}`).includes(busca)) return false;
    if (filtros.prioridade && filtros.prioridade !== 'todas' && r.prioridade !== filtros.prioridade) return false;
    if (filtros.categoria && r.categoria !== filtros.categoria) return false;
    if (filtros.status === 'ativos' && !item.ativo) return false;
    if (filtros.status === 'historico' && item.ativo) return false;
    if (filtros.status && !['todos', 'ativos', 'historico'].includes(filtros.status) && r.status !== filtros.status) return false;
    if (de && (!item.data || item.data < de)) return false;
    if (ate && (!item.data || item.data > ate)) return false;
    return true;
  }).sort((a, b) => {
    const data = (a.data || '9999-12-31').localeCompare(b.data || '9999-12-31');
    if (data) return data;
    if (a.grupo === 'compromissos' && b.grupo === 'compromissos') return new Date(a.registro.inicio) - new Date(b.registro.inicio);
    return a.registro.titulo.localeCompare(b.registro.titulo, 'pt-BR');
  });

  // O resumo considera os filtros atuais e o vencimento como referência de período.
  // Pago/recebido não são confundidos com saldo bancário.
  const financeiras = selecionados.filter(i => ['pagar', 'receber'].includes(i.grupo));
  const somar = (tipo, status, apenasAtrasadas = false) => financeiras
    .filter(i => i.grupo === tipo && i.registro.status === status && (!apenasAtrasadas || i.atrasado))
    .reduce((total, i) => total + Math.round(Number(i.registro.valor) * 100), 0) / 100;
  const aPagar = somar('pagar', 'pendente');
  const aReceber = somar('receber', 'pendente');
  return {
    dataReferencia: hoje,
    itens: selecionados,
    agenda: selecionados.filter(i => i.data),
    hoje: selecionados.filter(i => i.ativo && i.hoje),
    atrasados: selecionados.filter(i => i.atrasado),
    lembretes: selecionados.filter(i => i.lembrete),
    proximos: selecionados.filter(i => i.ativo && i.dias !== null && i.dias >= 0 && i.dias <= horizonte),
    semPrazo: selecionados.filter(i => i.ativo && !i.data),
    historico: selecionados.filter(i => !i.ativo),
    resumoFinanceiro: {
      aPagar, aReceber,
      pago: somar('pagar', 'liquidada'),
      recebido: somar('receber', 'liquidada'),
      pagarAtrasado: somar('pagar', 'pendente', true),
      receberAtrasado: somar('receber', 'pendente', true),
      saldoPrevisto: Math.round((aReceber - aPagar) * 100) / 100,
      referenciaPeriodo: 'vencimento',
    },
  };
}

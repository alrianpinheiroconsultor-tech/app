const CAMPOS = 'id,usuario_id,titulo,descricao,prazo,prioridade,status,criado_em,atualizado_em,recorrente_mensal,dia_vencimento,tarefa_anterior_id';

function diasNoMes(ano, mes) {
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  return [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
}

function lerData(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor));
  if (!partes) throw new Error('Informe um prazo válido.');
  const [, anoTexto, mesTexto, diaTexto] = partes;
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) {
    throw new Error('Informe um prazo válido.');
  }
  return { ano, mes, dia };
}

function validarDia(valor) {
  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw new Error('Selecione um dia de vencimento entre 1 e 31.');
  }
  const dia = Number(valor);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new Error('Selecione um dia de vencimento entre 1 e 31.');
  }
  return dia;
}

// Trabalha com datas civis, sem conversão de fuso horário.
// O mês vem do primeiro prazo informado; o dia original não é alterado.
export function ajustarPrazoMensal(prazo, diaVencimento) {
  const { ano, mes } = lerData(prazo);
  const dia = Math.min(validarDia(diaVencimento), diasNoMes(ano, mes));
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function prepararCampos(entrada) {
  const titulo = String(entrada.titulo || '').trim();
  if (!titulo || titulo.length > 200) {
    throw new Error('Informe um título com até 200 caracteres.');
  }
  const prioridade = entrada.prioridade || 'media';
  if (!['critica', 'alta', 'media', 'baixa'].includes(prioridade)) {
    throw new Error('Selecione uma prioridade válida.');
  }
  const recorrente = entrada.recorrente_mensal === true;
  const dia = recorrente ? validarDia(entrada.dia_vencimento) : null;
  let prazo = entrada.prazo || null;
  if (recorrente && !prazo) {
    throw new Error('Informe o primeiro vencimento da conta mensal.');
  }
  if (prazo) {
    lerData(prazo);
    if (recorrente) prazo = ajustarPrazoMensal(prazo, dia);
  }
  return {
    titulo,
    descricao: String(entrada.descricao || '').trim() || null,
    prazo,
    prioridade,
    recorrente_mensal: recorrente,
    dia_vencimento: dia,
  };
}

function resultado(resposta) {
  if (resposta.error) throw resposta.error;
  return resposta.data;
}

/**
 * Recebe a instância Supabase já autenticada do aplicativo.
 * Não cria outro cliente, não guarda credenciais e não usa localStorage.
 * Categoria e subtarefas não são enviadas: não existem na tabela tarefas.
 */
export function criarRepositorioTarefas(cliente) {
  if (!cliente || typeof cliente.from !== 'function' || typeof cliente.auth?.getSession !== 'function') {
    throw new Error('O módulo de tarefas precisa do cliente Supabase do aplicativo.');
  }

  async function usuarioAtual() {
    const dados = resultado(await cliente.auth.getSession());
    const usuarioId = dados?.session?.user?.id;
    if (!usuarioId) throw new Error('Entre na sua conta para acessar as tarefas.');
    return usuarioId;
  }

  async function buscarOcorrencia(id, usuarioId) {
    return resultado(await cliente.from('tarefas')
      .select(CAMPOS)
      .eq('usuario_id', usuarioId)
      .eq('id', id)
      .single());
  }

  return {
    // Inclui as concluídas, mantendo o histórico disponível para a interface.
    async listar() {
      const usuarioId = await usuarioAtual();
      return resultado(await cliente.from('tarefas')
        .select(CAMPOS)
        .eq('usuario_id', usuarioId)
        .order('prazo', { ascending: true, nullsFirst: false })
        .order('criado_em', { ascending: false }));
    },

    // Inclui contas atrasadas e futuras, sempre pela data real de vencimento.
    async listarContasAPagar() {
      const usuarioId = await usuarioAtual();
      return resultado(await cliente.from('tarefas')
        .select(CAMPOS)
        .eq('usuario_id', usuarioId)
        .eq('recorrente_mensal', true)
        .neq('status', 'concluida')
        .neq('status', 'cancelada')
        .order('prazo', { ascending: true, nullsFirst: false })
        .order('criado_em', { ascending: true }));
    },

    async criar(entrada) {
      const campos = prepararCampos(entrada);
      const usuarioId = await usuarioAtual();
      return resultado(await cliente.from('tarefas')
        .insert({ ...campos, usuario_id: usuarioId, status: 'pendente' })
        .select(CAMPOS)
        .single());
    },

    // Recebe os campos completos do formulário. Não altera status nem o vínculo
    // com a ocorrência anterior e não dispara conclusão durante uma edição.
    async editar(id, entrada) {
      const campos = prepararCampos(entrada);
      const usuarioId = await usuarioAtual();
      return resultado(await cliente.from('tarefas')
        .update(campos)
        .eq('usuario_id', usuarioId)
        .eq('id', id)
        .select(CAMPOS)
        .single());
    },

    async concluir(id) {
      const usuarioId = await usuarioAtual();

      // O gatilho do banco cria a próxima ocorrência na mesma transação.
      // Não inserir a próxima no navegador: isso duplicaria a responsabilidade
      // e poderia gerar duas contas em cliques simultâneos ou outros aparelhos.
      // O filtro também evita repetir a atualização de uma tarefa já concluída.
      resultado(await cliente.from('tarefas')
        .update({ status: 'concluida' })
        .eq('usuario_id', usuarioId)
        .eq('id', id)
        .neq('status', 'concluida'));

      const ocorrencia = await buscarOcorrencia(id, usuarioId);
      if (ocorrencia.status !== 'concluida') {
        throw new Error('A tarefa não está concluída. Atualize a lista antes de tentar novamente.');
      }

      // Ler a próxima também recupera o resultado quando uma tentativa anterior
      // foi confirmada no banco, mas a resposta não chegou ao dispositivo.
      const proxima = resultado(await cliente.from('tarefas')
        .select(CAMPOS)
        .eq('usuario_id', usuarioId)
        .eq('tarefa_anterior_id', id)
        .maybeSingle());

      return {
        ocorrencia,
        proxima,
        aviso: ocorrencia.recorrente_mensal && !proxima
          ? 'A ocorrência foi concluída, mas a próxima não foi encontrada. Verifique o gatilho de recorrência mensal antes de cadastrar outra conta.'
          : null,
      };
    },
  };
}

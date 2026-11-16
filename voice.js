(() => {
  'use strict';

  const input = document.getElementById('voice-command');
  const start = document.getElementById('voice-start');
  const apply = document.getElementById('voice-apply');
  const status = document.getElementById('voice-status');
  const overlay = document.getElementById('ov-edit');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let active = null;
  let timeout = null;

  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pad = value => String(value).padStart(2, '0');
  const report = message => { status.textContent = message; };

  const categories = [
    ['Saúde', /\b(saude|consulta|medic[oa]|dentista|exame|terapia|psicolog[oa]|academia|treino|remedio|vacina|hospital)\b/],
    ['Finanças', /\b(financas|pagar|pagamento|boleto|fatura|imposto|orcamento|banco|conta de luz|conta de agua)\b/],
    ['Estudos', /\b(estudos|estudar|aula|curso|prova|faculdade|escola|licao|ingles)\b/],
    ['Trabalho', /\b(trabalho|reuniao|cliente|relatorio|gestor|empresa|escritorio)\b/],
    ['Casa', /\b(casa|limpar|lavar|faxina|cozinhar|mercado|supermercado|conserto)\b/],
    ['Social', /\b(social|aniversario|festa|amigos|visitar|encontro)\b/],
    ['Projetos', /\b(projetos?|planejamento|lancamento)\b/]
  ];

  function identifyCategory(text) {
    const explicit = categories.filter(([name]) => new RegExp('\\b(?:categoria|aba|area)(?: de)?\\s+' + normalize(name) + '\\b').test(text));
    if (explicit.length === 1) return { value: explicit[0][0], note: '' };
    const matches = categories.filter(([, pattern]) => pattern.test(text));
    if (matches.length === 1) return { value: matches[0][0], note: '' };
    return {
      value: 'Geral',
      note: matches.length > 1 || explicit.length > 1
        ? 'Há sinais de mais de uma categoria. Escolha a correta no formulário.'
        : 'Categoria não identificada: escolha no formulário.'
    };
  }

  function identifyDeadline(text) {
    const notes = [];
    const now = new Date();
    let parts = null;
    let relative = false;
    let match;
    if ((match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
      parts = [+match[1], +match[2], +match[3]];
    } else if ((match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) {
      parts = [+match[3], +match[2], +match[1]];
    } else if ((match = text.match(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})\b/))) {
      const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      parts = [+match[3], months.indexOf(match[2]) + 1, +match[1]];
    } else if (/\b(hoje|amanha)\b/.test(text)) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
      const offset = /\bdepois de amanha\b/.test(text) ? 2 : /\bamanha\b/.test(text) ? 1 : 0;
      day.setDate(day.getDate() + offset);
      parts = [day.getFullYear(), day.getMonth() + 1, day.getDate()];
      relative = true;
    }
    if (!parts) {
      return { value: '', note: 'Prazo não preenchido. Informe hoje, amanhã ou uma data completa com dia, mês e ano; se necessário, selecione manualmente.' };
    }

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day, 12);
    if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { value: '', note: 'A data informada não existe. Corrija o prazo manualmente.' };
    }
    const time = text.match(/\b(?:as|pelas)\s+(\d{1,2})(?:\s*[:h]\s*(\d{2})|\s+horas?(?:\s+e\s+(\d{1,2})(?:\s+minutos?)?)|\s+e\s+(\d{1,2})(?:\s+minutos?)?)?(?!\d)/)
      || text.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})\b/)
      || text.match(/\b(\d{1,2})\s+horas?\b/);
    let hour = 23;
    let minute = 59;
    if (time) {
      hour = +time[1];
      minute = +(time[2] || time[3] || time[4] || 0);
      if (/\b(meia|tarde|noite|manha)\b/.test(text) || /\b(?:as|pelas)\s+\d+\s+e\s+[a-z]/.test(text)) {
        return { value: '', note: 'Confirme a data e o horário no campo Prazo. Para preenchimento automático, use horário numérico de 24 horas, como 14:30.' };
      }
      if (hour > 23 || minute > 59) return { value: '', note: 'Horário inválido. Corrija o prazo manualmente.' };
    } else {
      notes.push('Sem horário numérico identificado: sugerido 23:59. Ajuste se necessário.');
    }
    if (relative) notes.push('Data calculada pelo calendário deste dispositivo.');
    if (new Date(year, month - 1, day, hour, minute) < now) notes.push('Atenção: o prazo está no passado.');
    return { value: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`, note: notes.join(' ') };
  }

  function interpret() {
    const original = input.value.trim();
    if (!original) { report('Fale ou escreva uma tarefa primeiro.'); input.focus(); return; }
    if (original.length > 2000) { report('Use até 2.000 caracteres e apenas uma tarefa por comando.'); return; }
    const text = normalize(original);
    const category = identifyCategory(text);
    const deadline = identifyDeadline(text);
    let priority = 'media';
    if (/\b(critica|emergencia)\b/.test(text)) priority = 'critica';
    else if (/\b(prioridade alta|urgente|urgencia)\b/.test(text)) priority = 'alta';
    else if (/\b(prioridade baixa|sem pressa)\b/.test(text)) priority = 'baixa';
    if (/\b(nao e urgente|sem urgencia|nao urgente)\b/.test(text)) priority = 'media';
    document.getElementById('f-titulo').value = original.slice(0, 200);
    document.getElementById('f-desc').value = original;
    document.getElementById('f-cat').value = category.value;
    document.getElementById('f-dl').value = deadline.value;
    selPri(priority);
    report([
      `Sugestão: ${category.value}. Revise os campos e use o botão de salvar da tarefa.`,
      category.note,
      deadline.note,
      original.length > 200 ? 'Título limitado a 200 caracteres; o comando completo está na descrição.' : ''
    ].filter(Boolean).join(' '));
  }

  function resetListening() {
    clearTimeout(timeout);
    timeout = null;
    start.textContent = '🎙️ Falar';
    start.setAttribute('aria-pressed', 'false');
    apply.disabled = false;
    input.readOnly = false;
  }

  function cancelListening() {
    const recognition = active;
    active = null;
    if (recognition) recognition.abort();
    resetListening();
  }

  apply.addEventListener('click', interpret);
  if (!Recognition || !window.isSecureContext) {
    start.disabled = true;
    report('Reconhecimento de voz indisponível neste navegador ou endereço. Digite o comando e toque em Interpretar comando.');
  } else {
    report('Toque em Falar e permita o microfone. Você também pode digitar o comando.');
    start.addEventListener('click', () => {
      if (active) { active.stop(); return; }
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      let received = false;
      let failed = false;
      active = recognition;
      recognition.onstart = () => {
        if (active !== recognition) return;
        start.textContent = '⏹️ Encerrar fala';
        start.setAttribute('aria-pressed', 'true');
        apply.disabled = true;
        input.readOnly = true;
        report('Ouvindo… diga uma tarefa com categoria, data e prioridade, se desejar.');
      };
      recognition.onresult = event => {
        if (active !== recognition || !overlay.classList.contains('open')) return;
        const transcript = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim();
        if (!transcript) return;
        received = true;
        input.value = transcript;
        interpret();
      };
      recognition.onerror = event => {
        if (active !== recognition) return;
        failed = true;
        const messages = {
          'not-allowed': 'Microfone não autorizado. Permita o acesso nas configurações do navegador ou digite o comando.',
          'service-not-allowed': 'O reconhecimento de voz foi bloqueado. Digite o comando.',
          'audio-capture': 'Microfone indisponível. Confira o dispositivo ou digite o comando.',
          'no-speech': 'Nenhuma fala identificada. Tente novamente ou digite.',
          'network': 'O serviço de voz não respondeu. Tente novamente ou digite o comando.',
          'aborted': 'Gravação encerrada. Você pode tentar novamente ou digitar.'
        };
        report(messages[event.error] || 'Não foi possível reconhecer a fala. Tente novamente ou digite o comando.');
        active = null;
        resetListening();
      };
      recognition.onend = () => {
        if (active !== recognition) return;
        active = null;
        resetListening();
        if (!received && !failed) report('Nenhuma fala identificada. Tente novamente ou digite o comando.');
      };
      try {
        recognition.start();
        timeout = setTimeout(() => {
          if (active !== recognition) return;
          cancelListening();
          if (!received) report('Tempo de escuta encerrado. Tente novamente ou digite o comando.');
        }, 45000);
      } catch {
        cancelListening();
        report('Não foi possível iniciar o microfone. Tente novamente ou digite o comando.');
      }
    });
  }

  new MutationObserver(() => {
    if (!overlay.classList.contains('open')) {
      cancelListening();
      input.value = '';
      report(Recognition && window.isSecureContext
        ? 'Toque em Falar ou digite uma tarefa para preencher os campos.'
        : 'Digite o comando e toque em Interpretar comando. Voz indisponível neste navegador ou endereço.');
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) {
      cancelListening();
      report('Microfone desligado ao sair da tela. Toque em Falar para retomar.');
    }
  });
  window.addEventListener('pagehide', cancelListening);
})();

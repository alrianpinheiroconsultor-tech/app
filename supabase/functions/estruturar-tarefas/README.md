# Estruturar responsabilidades

Função de servidor autenticada que transforma texto livre em sugestões revisáveis. Não cria contas, não altera perfis e não grava tarefas. A integração das telas e da persistência ainda deve ser implementada no aplicativo.

## Publicação e segredos

Publique a Edge Function `estruturar-tarefas` no projeto Supabase existente.

Configure exclusivamente nos segredos do servidor:

- `AI_GATEWAY_URL`: URL HTTPS completa do endpoint de chat completions do AI Gateway, compatível com ferramentas no formato OpenAI.
- `AI_GATEWAY_API_KEY`: credencial privada do gateway.
- `AI_GATEWAY_MODEL`: identificador de um modelo do gateway que aceite ferramentas e escolha obrigatória de função.

A função utiliza `SUPABASE_URL` e `SUPABASE_ANON_KEY` do ambiente da Edge Function para validar o token da sessão com `auth.getUser`. Não utiliza chave de serviço nem recebe `usuario_id` do navegador.

Nunca coloque a credencial do gateway em HTML, código do navegador, variáveis com prefixo `VITE_` ou arquivos versionados. O endpoint é definido no servidor, não pelo corpo da requisição. Redirecionamentos são recusados para evitar encaminhar credenciais a outro endereço.

## Contrato

Faça uma chamada autenticada a `estruturar-tarefas` usando `functions.invoke` do cliente Supabase existente, com este corpo:

```json
{
  "texto": "Enviar o relatório até 20/12/2026 com prioridade alta. Organizar os documentos sem prazo definido."
}
```

O limite é de 12.000 caracteres e 30 sugestões por chamada. O texto é enviado ao AI Gateway para processamento; a interface deve informar isso antes do envio.

A resposta contém `tarefas`, `revisao_obrigatoria` e `mensagem`. Cada sugestão contém:

- `titulo`
- `descricao`
- `prazo`, em `YYYY-MM-DD` ou null
- `prioridade`: `baixa`, `media` ou `alta`
- `status`: inicialmente `pendente`
- `referencia_prazo`: trecho literal usado para verificar a data, ou null
- `aviso`: eventual indicação de prazo removido

`referencia_prazo` e `aviso` são metadados da resposta, não colunas do banco. Não envie o objeto inteiro diretamente para a tabela.

## Revisão e gravação na próxima integração

A interface deve permitir editar e descartar cada sugestão antes de uma confirmação explícita. Ao confirmar, grave somente `usuario_id` da sessão autenticada, `titulo`, `descricao`, `prazo`, `prioridade` e `status` na tabela `tarefas`. Deixe `id`, `criado_em` e `atualizado_em` sob responsabilidade dos valores padrão e do trigger existentes no banco.

Não grave automaticamente ao gerar sugestões. Não apresente sucesso antes da confirmação do banco e preserve as sugestões quando uma gravação falhar.

## Política conservadora de prazos

Somente datas completas em `DD/MM/AAAA` ou `AAAA-MM-DD` são aceitas nesta implementação. O servidor verifica se a data existe no calendário e aparece no trecho literal fornecido pelo modelo, que também precisa existir no texto original.

Datas relativas, sem ano, ambíguas ou por extenso permanecem na descrição para revisão, com `prazo` null. A função não usa a data atual como prazo padrão. Mesmo uma data validada deve passar por revisão humana para confirmar sua associação à responsabilidade correta.

## Verificações de aceitação

- Sem token ou com sessão inválida: retorna 401 e não chama o gateway.
- Texto vazio ou acima do limite: retorna 400.
- Sem credenciais do gateway: retorna 503, sem expor segredos.
- Responsabilidade sem data: sugestão com `prazo` null.
- Data impossível ou sem trecho verificável: prazo removido, com aviso para revisão.
- Resposta malformada do modelo: retorna 502 e não grava nada.
- Limite do gateway: retorna 429.
- Tempo excedido: cancela a chamada e retorna erro recuperável.
- Sucesso: retorna apenas sugestões; nenhuma linha é criada em `tarefas`.

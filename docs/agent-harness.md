# Harness do agente

Counterpoint é um agente de produto, não apenas um cliente de modelo. Seu harness
define o que o modelo pode propor, o que só uma pessoa facilitadora pode autorizar
e onde cada ação é executada. Ele fica em
[`shared/src/counterpoint-harness.ts`](../shared/src/counterpoint-harness.ts), como
uma política pura e testável, aplicada pelo `RealtimeAgent`/`RealtimeSession` no
servidor e consultada pela extensão para o gate e a aprovação local.

```text
áudio da reunião (WebRTC, navegador → Realtime)
      |
      v
RealtimeAgent + RealtimeSession no servidor (WebSocket sideband)
      |
      v
Realtime: contexto + rascunho de uma intervenção
      |
      v
harness: candidato curto ou PASS (nenhuma ação)
      |
      v
gate local: abertura real ou descarte por expiração/fala humana
      |
      v
facilitador: falar localmente | pesquisar evidência | descartar
      |
      +--> fala Realtime, limitada ao texto aprovado
      |
      +--> POST /api/research, somente após clique explícito
```

## Contrato de autonomia

| Capacidade | Quem decide | Regra aplicada |
| --- | --- | --- |
| Gerar um rascunho | modelo | No máximo uma crítica, alternativa ou pergunta; `PASS` é válido. |
| Tornar o rascunho elegível | gate local | Apenas uma pausa real; candidatos vencidos ou interrompidos são suprimidos. |
| Falar | facilitador | Clique explícito, candidato atual e gate em `opening`. O payload contém somente o texto aprovado e instrui o modelo a não acrescentar fatos. |
| Pesquisar evidência | facilitador | Clique explícito, candidato atual e gate em `opening`. O modelo não chama Exa diretamente. |
| Escrever em ferramentas externas | ninguém nesta spike | Não há ferramentas de escrita, MCP corporativo, histórico persistente ou ações automáticas. |

O prompt de sessão não é a única proteção: `isFacilitatorActionAllowed` torna a
aprovação uma regra de código e `normalizeCounterpointDraft` descarta `PASS`, texto
vazio ou intervenções longas. O gate continua sendo a autoridade para timing social.

## Fronteiras

- A chave OpenAI, o `call_id` do provedor, o relay WebRTC e o `RealtimeSession`
  continuam somente no servidor. A chamada WebRTC aceita uma única mídia de áudio;
  não há `RTCDataChannel` no navegador.
- A extensão não concede ferramentas ao modelo e não recebe eventos Realtime brutos.
  Ela consulta uma projeção permitida do servidor: estado, rascunho normalizado e
  transcrição da fala local. Pesquisa é uma chamada da própria extensão ao servidor,
  realizada depois de um gesto humano.
- A sessão e cada resposta Realtime usam `tool_choice: "none"`; não há função ou
  MCP que o modelo possa invocar nesta spike.
- Cada resposta de rascunho e de fala usa `conversation: "none"`; uma sugestão
  descartada não vira memória de conversa por acidente.
- O harness não registra áudio nem cria memória persistente entre reuniões.

Os testes em `shared/src/counterpoint-harness.test.ts` cobrem o contrato de
aprovação e os payloads Realtime. Execute `npm run verify` na raiz do projeto.

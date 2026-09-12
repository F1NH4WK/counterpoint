# Arquitetura

```text
Google Meet tab audio
        |
        v
Chrome extension
  ├─ captura de aba + consentimento
  ├─ detector local de atividade de fala
  ├─ turn-taking gate (shared)
  ├─ WebRTC de áudio, sem data channel
  └─ sidebar: cartões, estado e controles
        | HTTPS: oferta SDP + controles/projeção permitidos
        v
Server
  ├─ relay da oferta SDP para OpenAI Realtime
  ├─ harness + RealtimeAgent/RealtimeSession (WebSocket sideband)
  └─ endpoint de pesquisa Exa sob demanda
        |
        +-- WebRTC: áudio da aba e áudio local do agente
        +-- WebSocket sideband: configuração, respostas e interrupção
        v
OpenAI Realtime
```

Essa divisão segue a variante de áudio no navegador com controles no servidor do
[guia de Voice Agents do Agents SDK](https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/): WebRTC mantém a mídia de baixa latência, enquanto o servidor detém o agente e a sessão sideband.

## Fronteiras de segurança

- A extensão envia uma oferta SDP com exatamente uma mídia de áudio ao servidor. Ele fala com `POST /v1/realtime/calls` usando `OPENAI_API_KEY`, cria um `RealtimeSession` sideband com o Agents SDK e devolve somente a resposta SDP mais um ID local opaco. A chave e o `call_id` do provedor nunca saem do servidor.
- O navegador não cria `RTCDataChannel` e não recebe eventos Realtime brutos. Ele consulta somente uma projeção permitida: estado, rascunho normalizado e transcrição da resposta audível localmente.
- O servidor vincula-se a `127.0.0.1` por padrão, valida a origem da extensão e pode exigir um token de demonstração.
- Exa é chamado exclusivamente no servidor e apenas após uma ação humana de pesquisa. O adapter real aguarda o snippet gerado no onboarding da Exa.
- MCPs corporativos, contexto interno e toda ação de escrita ficam fora desta spike. Uma evolução futura precisará de uma fronteira de aprovação humana no servidor.

## Fronteiras de produto

O agente pode gerar uma sugestão enquanto humanos falam, mas só pode apresentá-la para **revisão** em uma abertura permitida pelo gate. Se a janela expirar, a sugestão é descartada. A pessoa facilitadora decide se ela será falada localmente, pesquisada ou descartada. Uma fala humana cancela imediatamente a saída de áudio já iniciada.

Na primeira spike, a saída de voz será local à pessoa que instalou a extensão; ela não entra automaticamente no áudio compartilhado do Meet. Fazer o agente ser ouvido por todos exigiria uma integração adicional de mídia/participante e não será representado como pronto no MVP.

O modo demo passa pelo mesmo estado `opening → ready → speaking/listening`, mas usa uma sugestão e fontes sintéticas explicitamente rotuladas. Ele existe para validar e gravar o fluxo sem representar uma pesquisa Exa real.

## Harness do agente

O harness em `shared/src/counterpoint-harness.ts` é a fronteira de autonomia do produto. O servidor o aplica por meio de `RealtimeAgent` e `RealtimeSession`: centraliza as instruções de sessão, o payload de rascunho, a fala solicitada apenas a partir do texto aprovado e a regra de que falar/pesquisar só ocorre com `opening` mais um gesto explícito da pessoa facilitadora. Veja [o contrato completo](agent-harness.md).

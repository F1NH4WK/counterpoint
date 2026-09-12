# Arquitetura

```text
Google Meet tab audio
        |
        v
Chrome extension
  ├─ captura de aba + consentimento
  ├─ detector local de atividade de fala
  ├─ turn-taking gate (shared)
  ├─ cliente Realtime por WebRTC
  └─ sidebar: cartões, estado e controles
        |
        v
Server
  ├─ relay da oferta SDP para OpenAI Realtime
  └─ endpoint de pesquisa Exa sob demanda
```

## Fronteiras de segurança

- A extensão envia uma oferta SDP ao servidor. Ele fala com `POST /v1/realtime/calls` usando `OPENAI_API_KEY` e devolve apenas a resposta SDP; a chave nunca sai do servidor.
- O servidor vincula-se a `127.0.0.1` por padrão, valida a origem da extensão e pode exigir um token de demonstração.
- Exa é chamado exclusivamente no servidor e apenas após uma ação humana de pesquisa. O adapter real aguarda o snippet gerado no onboarding da Exa.
- MCPs corporativos, contexto interno e toda ação de escrita ficam fora desta spike. Uma evolução futura precisará de uma fronteira de aprovação humana no servidor.

## Fronteiras de produto

O agente pode gerar uma sugestão enquanto humanos falam, mas só pode apresentá-la para **revisão** em uma abertura permitida pelo gate. Se a janela expirar, a sugestão é descartada. A pessoa facilitadora decide se ela será falada localmente, pesquisada ou descartada. Uma fala humana cancela imediatamente a saída de áudio já iniciada.

Na primeira spike, a saída de voz será local à pessoa que instalou a extensão; ela não entra automaticamente no áudio compartilhado do Meet. Fazer o agente ser ouvido por todos exigiria uma integração adicional de mídia/participante e não será representado como pronto no MVP.

O modo demo passa pelo mesmo estado `opening → ready → speaking/listening`, mas usa uma sugestão e fontes sintéticas explicitamente rotuladas. Ele existe para validar e gravar o fluxo sem representar uma pesquisa Exa real.

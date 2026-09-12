# Server

O servidor é a fronteira dos segredos e possui três responsabilidades nesta spike:

1. receber uma oferta SDP somente de áudio da extensão e fazer o relay seguro para o OpenAI Realtime;
2. manter `RealtimeAgent` e `RealtimeSession` do Agents SDK em um WebSocket sideband;
3. consultar Exa somente quando a equipe pede evidência externa;

`OPENAI_API_KEY` e Exa ficam exclusivamente aqui. MCPs internos são uma evolução posterior, somente leitura. Nenhuma escrita em Slack, documentos ou tickets será exposta no primeiro fluxo.

## Rotas atuais

| Rota | Estado | Finalidade |
| --- | --- | --- |
| `GET /health` | pronta | Verifica que o processo está ativo. |
| `POST /api/realtime/call` | pronta e testada | Recebe uma oferta SDP com uma única mídia de áudio, encaminha para `POST /v1/realtime/calls`, conecta o sideband e devolve `{ "sdp", "sessionId" }`. O `call_id` do provedor não é exposto. |
| `GET /api/realtime/sessions/:sessionId` | pronta e testada | Retorna somente a projeção permitida do agente: estado, rascunho e transcrição da fala local. |
| `POST /api/realtime/sessions/:sessionId/draft` | pronta | Pede ao harness um rascunho em texto. |
| `POST /api/realtime/sessions/:sessionId/speak` | pronta | Fala apenas o candidato enviado após aprovação local da pessoa facilitadora. |
| `POST /api/realtime/sessions/:sessionId/cancel` | pronta | Interrompe a resposta ativa pelo SDK. |
| `DELETE /api/realtime/sessions/:sessionId` | pronta | Fecha a sessão sideband local. |
| `POST /api/research` | contrato pronto | Recebe `{ "query": "...", "depth": "fast" | "deep" }`. Retorna `503` até o adapter Exa gerado no onboarding ser conectado. |

## Rodar localmente

1. Copie `../.env.example` para `../.env` e preencha `OPENAI_API_KEY`.
2. Carregue a extensão uma vez em `chrome://extensions` e copie o ID para `COUNTERPOINT_ALLOWED_ORIGINS`.
3. Na raiz do repositório, rode `npm run dev:server`.

O processo escuta apenas em `127.0.0.1` por padrão. Para uma demonstração local rápida, `COUNTERPOINT_ALLOW_ANY_CHROME_EXTENSION=true` libera extensões Chrome locais; prefira sempre a origem explícita em qualquer outro contexto.

## Exa

A documentação atual da Exa pede que uma integração nova seja gerada pelo [Dashboard Onboarding](https://dashboard.exa.ai/onboarding), pois ele produz um snippet testado para a stack e caso de uso. Depois de gerar o snippet, encaixe-o atrás da interface `EvidenceSearch` em `src/research.ts`; o contrato HTTP e os testes já estão prontos.

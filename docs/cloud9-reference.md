# Referência do starter `cloud9`

`../cloud9` é um starter kit fornecido no hackathon e permanece inalterado. Ele não será submetido como se fosse Counterpoint.

## Trechos que podemos reutilizar como infraestrutura herdada

| Recurso | Arquivo de referência | Uso possível em Counterpoint |
| --- | --- | --- |
| Sessão de voz Realtime por WebRTC | `../cloud9/apps/web/src/app/voice/page.tsx` | Base para cliente de voz, adaptada para a extensão. |
| Token efêmero Realtime | `../cloud9/apps/web/src/app/api/realtime-token/route.ts` | Base para endpoint server-side de sessão. |
| Proxy Exa no servidor | `../cloud9/apps/web/src/app/api/search/route.ts` e `../cloud9/packages/agent-core/src/capabilities/search.ts` | Base para pesquisa externa com chave protegida. |

## O que não será copiado

- app de incidentes e follow-ups;
- template Slack/CopilotKit Channels;
- template mobile;
- integração Ambiguous AI;
- instruções específicas do `AGENTS.md` de cloud9.

Quando um trecho for portado, o README e a submissão devem identificá-lo como código herdado. A lógica de turn-taking, a captura Meet, a sidebar e o pipeline de crítica são o trabalho novo do hackathon.

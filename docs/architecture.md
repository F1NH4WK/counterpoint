# Arquitetura

```text
Google Meet tab audio
        |
        v
Chrome extension
  ├─ captura de aba + consentimento
  ├─ detector local de atividade de fala
  ├─ turn-taking gate (shared)
  ├─ cliente Realtime com token efêmero
  └─ sidebar: cartões, estado e controles
        |
        v
Server
  ├─ OpenAI Realtime token endpoint
  ├─ Exa research endpoint
  └─ MCP router interno, somente leitura
```

## Fronteiras de segurança

- A extensão recebe um token de sessão de curta duração, nunca `OPENAI_API_KEY`.
- Exa e MCPs corporativos são chamados exclusivamente no servidor.
- Contexto interno entra no agente como resultado citado e limitado da consulta, não como acesso irrestrito a ferramentas.
- Toda ação de escrita fica fora do MVP; uma evolução futura precisa de aprovação humana no limite do servidor.

## Fronteiras de produto

O agente pode gerar uma sugestão enquanto humanos falam, mas só pode apresentá-la em uma abertura permitida pelo gate. Se a janela expirar, a sugestão é descartada. Uma fala humana cancela imediatamente a saída de áudio do agente.

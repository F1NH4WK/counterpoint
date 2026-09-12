# Server

O servidor será pequeno e terá apenas três responsabilidades no MVP:

1. criar credenciais efêmeras para a sessão Realtime;
2. consultar Exa quando o usuário pedir evidência externa;
3. rotear consultas de leitura para um MCP interno configurado.

Tokens de OpenAI, Exa e MCP ficam exclusivamente aqui. Nenhuma escrita em Slack, documentos ou tickets será exposta no primeiro fluxo.

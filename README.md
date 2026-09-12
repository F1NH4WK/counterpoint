# Counterpoint

**Um cofacilitador de brainstorming que vive em uma conversa do Google Meet.**

Counterpoint escuta uma discussão com consentimento, identifica hipóteses e consensos rápidos, e oferece críticas curtas, alternativas ou evidências quando existe uma abertura social para isso. A equipe controla se a sugestão é ignorada, pesquisada ou falada.

## O problema

Em brainstorming, ideias costumam ser aprovadas por velocidade, familiaridade ou pela pessoa mais assertiva — não pela qualidade da evidência. Um chat separado perde a conversa e chega tarde. Counterpoint aparece onde a decisão nasce: na reunião.

## O MVP

1. Uma extensão Chrome é aberta em uma aba do Google Meet, mediante ação e consentimento explícitos da pessoa usuária.
2. Ela captura o áudio da aba e detecta localmente fala e silêncio.
3. Um gate de turn-taking permite uma intervenção apenas em uma abertura real de conversa; sugestões vencidas são descartadas.
4. A sidebar mostra uma crítica curta, uma alternativa ou uma pergunta socrática.
5. Quando a equipe pede evidência, o backend consulta Exa; quando a integração estiver configurada, também pode consultar MCPs internos em modo somente leitura.

## Estrutura

```text
extension/  Superfície Chrome/Google Meet: captura, painel e interação humana.
server/     Tokens efêmeros, Exa e conectores MCP; todos os segredos ficam aqui.
shared/     Gate de turn-taking, contratos e regras de produto testáveis.
docs/       Arquitetura, pipeline e registro de código herdado.
```

Leia [a arquitetura](docs/architecture.md), o [pipeline](docs/pipeline.md) e a [referência do starter](docs/cloud9-reference.md) antes de implementar.

## Limites deliberados do MVP

- Não há login, banco de dados ou histórico persistente entre reuniões.
- O primeiro conector interno será somente leitura.
- O agente não envia mensagens, cria tickets ou altera documentos sem aprovação explícita.
- Exa é usado sob demanda para evidência externa; não para cada fala.
- Não começaremos com um add-on oficial do Google Meet. A extensão Chrome é a spike mais rápida para validar captura e timing.

## Código herdado

O diretório vizinho `../cloud9` permanece intacto como material de referência do hackathon. Nenhum de seus apps é parte deste projeto até que um trecho seja deliberadamente portado e documentado em `docs/cloud9-reference.md`.

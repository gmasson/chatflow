# ChatFlow

O ChatFlow é um motor de conversa estilo chatbot, em JavaScript puro, guiado por botões para criar fluxos de conversa.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)
![Version](https://img.shields.io/badge/versão-0.1.0-blue)
![License](https://img.shields.io/badge/licença-MIT-blue)

Projeto pronto para criar fluxos de conversa, como cadastro de usuários, captura de leads, pesquisas de satisfação, tutoriais interativos e etc. Você só precisa escrever o roteiro em JSON. O ChatFlow lê o payload e renderiza tudo automaticamente. Sem inputs de texto, sem build — suba os arquivos, configure o roteiro e comece a usar.

Zero dependências. Sem build. Basta subir os arquivos em qualquer servidor estático.

## Funcionalidades

- **Motor de conversa agnóstico** — `js/chatflow.js` não sabe nada sobre o seu conteúdo. Alimente-o com um payload JSON vindo de um arquivo, URL ou variável, e ele renderiza a conversa.
- **Inicialização declarativa** — adicione `data-chatflow="flow.json"` a um elemento e o widget se monta sozinho, sem JavaScript.
- **Callbacks de ciclo de vida** — `onNode`, `onSelect` e `onError` permitem plugar analytics ou rastreamento de funil sem mexer na engine.
- Tipos de mensagem: **text**, **audio**, **video**, **image**, **iframe**, **link**, **html**
- Botões que ramificam o fluxo, abrem links externos ou reiniciam a conversa
- Carrega dados de forma assíncrona com estado de carregamento e uma tela de erro amigável (com botão de "Tentar novamente") se o payload estiver ausente ou malformado
- Valida o payload ao carregar — fluxo vazio, id ausente/duplicado, `startId` inválido ou `messages`/`options` que não sejam arrays são detectados antes de quebrar em execução
- Indicador de "digitando", scroll automático, navegação por teclado, região live para leitores de tela com `aria-busy` enquanto o bot "digita"
- `destroy()` para desmontagem limpa em SPAs
- Visual arredondado estilo Instagram com gradiente nas bolhas do usuário e botões outline
- Seguro por padrão: texto é escapado, links usam allowlist de protocolos, links externos recebem `rel="noopener noreferrer"`, iframes são sandboxados

## Início rápido

1. Sirva a pasta com qualquer servidor estático (veja a nota sobre `file://` abaixo).
2. Abra o `index.html` para ver a demo.
3. Edite o `flow.json` para escrever sua própria conversa.

Só isso. Não há nada para compilar.

> **Nota sobre `file://`:** a demo carrega o `flow.json` com `fetch()`. Alguns navegadores (especialmente o Chrome) bloqueiam `fetch()` para páginas abertas diretamente do disco (`file://`) por conta do CORS. Sirva a pasta — `npx serve`, `python -m http.server` ou o "Live Server" do seu editor funcionam — ou use a opção inline com `source` abaixo, que não precisa de servidor nenhum.

## Estrutura do projeto

```
chatflow/
├── index.html         # carrega o chatflow.js e o inicializa
├── flow.json          # O ROTEIRO — edite este arquivo para criar seu bot
├── css/chatflow.css   # estilos (tokens de design no topo)
└── js/chatflow.js     # o motor de conversa — agnóstico a conteúdo, raramente alterado
```

## Três formas de inicializar

### 1. Declarativa (zero JavaScript)

Aponte um elemento para seu arquivo de fluxo e deixe o motor fazer o resto:

```html
<link rel="stylesheet" href="css/chatflow.css">
<div data-chatflow="flow.json"></div>
<script src="js/chatflow.js" defer></script>
```

Todo elemento com `data-chatflow` é montado automaticamente ao carregar. É possível ter vários na mesma página. Este caminho não aceita callbacks — use a forma programática para isso.

### 2. Programática, por arquivo

```javascript
new ChatFlow({
  mount: document.getElementById('chat'),
  url: 'flow.json'
}).start();
```

### 3. Programática, por variável (sem fetch)

```javascript
new ChatFlow({
  mount: document.getElementById('chat'),
  source: window.chatbotData   // { config: {...}, flow: [...] }, objeto ou string JSON
}).start();
```

`start()` retorna uma Promise: resolve quando o primeiro nó termina de renderizar, e rejeita se os dados não puderam ser carregados ou falharam na validação. O widget já exibe um erro amigável na tela com botão de retry nesse caso, então o `.catch()` é opcional — útil principalmente para seu próprio log.

## Callbacks

Passe qualquer um destes ao construtor (todos opcionais). São ideais para rastreamento de conversão em funis de vendas — saiba quais nós as pessoas acessam e no que clicam.

```javascript
new ChatFlow({
  mount: document.getElementById('chat'),
  url: 'flow.json',
  onNode:   function (id, node) { /* um nó foi exibido */ },
  onSelect: function (option, fromId) { /* usuário clicou uma opção */ },
  onError:  function (err) { /* falha no carregamento/validação */ }
}).start();
```

| Callback   | Dispara quando…                           | Argumentos                        |
|------------|-------------------------------------------|-----------------------------------|
| `onNode`   | um nó é acessado (incl. início/reinício)  | `id` (string), `node` (objeto)    |
| `onSelect` | o usuário clica em um botão de opção      | `option` (objeto), `fromId` (string) |
| `onError`  | falha no carregamento ou validação        | `error` (Error)                   |

Um callback que lança exceção é capturado e logado — nunca derruba a conversa.

## API programática

Com a instância em mãos, você pode controlá-la diretamente:

```javascript
var bot = new ChatFlow({ mount: el, url: 'flow.json' });
bot.start();            // carrega + renderiza o nó inicial (retorna uma Promise)
bot.goTo('precos');     // pula direto para um nó pelo id
bot.restart();          // limpa e volta ao nó inicial
bot.destroy();          // desmonta: aborta digitação pendente, limpa o DOM
ChatFlow.VERSION;       // '0.4.0'
```

## Escrevendo um roteiro

O payload é um objeto com duas chaves: `config` e `flow`.

```json
{
  "config": {
    "startId": "inicio",
    "typingDelay": 900,
    "profile": { "name": "@perfil", "avatar": "img/avatar.jpg" }
  },
  "flow": [
    {
      "id": "inicio",
      "messages": [
        { "type": "text", "text": "Oi! **negrito**, *itálico* e [links](https://exemplo.com) funcionam." },
        { "type": "image", "src": "img/foto.jpg", "alt": "uma descrição" }
      ],
      "options": [
        { "label": "Me conte mais", "next": "detalhes" },
        { "label": "Abrir o site", "url": "https://exemplo.com" }
      ]
    },
    {
      "id": "detalhes",
      "messages": [ { "type": "text", "text": "Aqui estão os detalhes..." } ],
      "options": [ { "label": "Recomeçar", "restart": true } ]
    }
  ]
}
```

### Tipos de mensagem

| Tipo     | Campos                                                      |
|----------|-------------------------------------------------------------|
| `text`   | `text` — suporta `**negrito**`, `*itálico*`, `\n`, `[texto](url)` |
| `audio`  | `src`                                                       |
| `video`  | `src`, `poster` (opcional)                                  |
| `image`  | `src`, `alt`                                                |
| `iframe` | `src`, `title`, `ratio` (padrão `16 / 9`) ou `height`      |
| `link`   | `href`, `label` — um cartão clicável dentro do chat         |
| `html`   | `html` — HTML livre para casos avançados (veja nota de segurança) |

Qualquer mensagem também aceita `delay` (ms) para sobrescrever o tempo padrão de digitação. Um tipo desconhecido ou uma mensagem sem campo obrigatório gera um aviso no console ao carregar, mas não interrompe o bot — apenas problemas estruturais (fluxo vazio, ids ausentes/duplicados, `messages`/`options` que não sejam arrays, `startId` inválido) fazem isso.

### Tipos de botão

| Botão                                 | Comportamento                        |
|---------------------------------------|--------------------------------------|
| `{ label, next: 'idDoNo' }`          | exibe a resposta e avança            |
| `{ label, url: 'https://...' }`      | abre link externo (nova aba)         |
| `{ label, restart: true }`           | reinicia a conversa                  |

Opcional em qualquer botão: `bubble: false` para esconder a resposta do usuário, `newTab: false` para abrir link na mesma aba.

### Notas e placeholders

JSON não tem sintaxe de comentários, mas você pode usar a chave `_note` em qualquer mensagem — a engine a ignora e renderiza o texto como legenda abaixo do conteúdo. Ideal para documentar placeholders dentro do próprio roteiro.

```json
{ "type": "image", "src": "https://picsum.photos/seed/demo/640/420", "alt": "Exemplo",
  "_note": "image — troque pela sua URL" }
```

## Configuração

Dentro do mesmo payload JSON, na chave `config`:

```json
{
  "startId": "inicio",
  "typingDelay": 900,
  "autofocus": true,
  "profile": { "name": "@perfil", "avatar": "img/avatar.jpg", "status": "Online" }
}
```

`startId` é obrigatório e deve corresponder a um id existente no fluxo; o motor se recusa a iniciar caso contrário. `autofocus` (padrão `true`) foca o primeiro botão de opção em cada nó para usuários de teclado — defina como `false` para não alterar o foco. `profile.status` aparece como subtítulo no header (padrão `"Online"`). `browserBar` é opcional — adicione a chave `"browserBar": { "domain": "...", "label": "..." }` para exibir uma barra simulada de navegador no topo.

## Temas

Todos os tokens estão no topo do `css/chatflow.css`. O padrão é o visual arredondado estilo Instagram. Para alterar cores, fontes, espaçamentos ou o raio das bordas:

```css
:root {
  --cf-bubble-radius: 1.125rem;
  --cf-btn-radius:    1.5rem;
  --cf-bg:            #000000;
  --cf-bot-bubble:    #262626;
  --cf-user-bubble:   #3797f0;
  --cf-btn-bg:        #262626;
  --cf-text:          #f5f5f5;
  /* … e outros tokens no topo do arquivo */
}
```

Cores, fontes, espaçamentos e largura máxima são variáveis também — sobrescreva-as e nada na engine precisa mudar.

## Nota de segurança

Não há entrada de texto do usuário em nenhum ponto, então o único conteúdo é aquilo que o `flow.json` (ou sua variável `source`) contém. Ainda assim, a engine escapa todo `text`, permite apenas `http(s)`, `mailto` e `tel` em links, e sandboxa iframes. Um payload carregado via `url` é parseado com `JSON.parse` — dados puros, sem risco de execução de código pelo fetch em si. O tipo de mensagem `html` é uma válvula de escape que injeta marcação HTML bruta como está — use apenas com conteúdo que você controla.

## Licença

MIT

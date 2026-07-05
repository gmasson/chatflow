/**
 * ChatFlow
 *
 * A engine nao conhece nenhum conteudo: ela apenas interpreta um payload de
 * dados no formato { config, flow } — vindo de um arquivo JSON (url), de uma
 * variavel ja carregada ou de uma string JSON (source). Nao ha input de
 * texto, apenas botoes que avancam o fluxo, abrem links ou reiniciam.
 *
 * Tres formas de iniciar:
 *   1) Declarativa (zero JS):  <div data-chatflow="flow.json"></div>
 *   2) Por arquivo:            new ChatFlow({ mount: el, url: 'flow.json' }).start();
 *   3) Por variavel:           new ChatFlow({ mount: el, source: meuObjeto }).start();
 *
 * Callbacks opcionais (analytics/funil), passados no construtor:
 *   onNode(id, node)   — cada vez que um no e exibido
 *   onSelect(opt, from)— usuario clicou uma opcao (from = id do no atual)
 *   onError(err)       — falha ao carregar/validar os dados
 *
 * Autor: Gabriel Masson
 * Licenca: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.ChatFlow = factory(root);
  }
})(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  /* ----------------------------------------------------------------------
   * Constantes de comportamento (ajustaveis sem tocar na logica)
   * -------------------------------------------------------------------- */
  var DEFAULTS = {
    typingDelay: 900,     // ms de "digitando" antes de cada mensagem do bot
    autofocus: true       // foca o 1o botao a cada no (bom p/ teclado; desligavel)
  };

  // Protocolos aceitos em qualquer link (allowlist — deny by default)
  var SAFE_PROTOCOL = /^(https?:|mailto:|tel:)/i;

  // Campos obrigatorios por tipo de mensagem (checados ao carregar os dados).
  var REQUIRED_FIELDS = {
    text:   ['text'],
    audio:  ['src'],
    video:  ['src'],
    image:  ['src'],
    iframe: ['src'],
    link:   ['href', 'label'],
    html:   ['html']
  };

  // Icones estaticos em SVG inline (evita dependencia de fontes de icone)
  var ICON_LOCK =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z"/></svg>';
  var ICON_RELOAD =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';

  /* ----------------------------------------------------------------------
   * Utilidades de seguranca / formatacao
   * -------------------------------------------------------------------- */

  // Escapa caracteres perigosos antes de qualquer insercao como HTML.
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c];
    });
  }

  // Formatacao leve e segura: negrito, italico, quebra de linha e link.
  // A string ja e escapada primeiro; so entao aplicamos marcacao controlada.
  function formatText(raw) {
    var s = escapeHtml(raw);
    // link no formato [texto](url) — so protocolos da allowlist passam
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      if (!SAFE_PROTOCOL.test(url)) return label; // deny by default
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /* ----------------------------------------------------------------------
   * Engine
   * -------------------------------------------------------------------- */
  function ChatFlow(options) {
    var opts = options || {};
    if (!opts.mount) throw new Error('ChatFlow: "mount" e obrigatorio.');
    if (!opts.source && !opts.url) {
      throw new Error('ChatFlow: informe "source" (variavel) ou "url" (arquivo) com os dados do chatbot.');
    }

    this.root = opts.mount;
    this._source = opts.source;
    this._url = opts.url;

    // Callbacks de ciclo de vida (todos opcionais). So funcoes sao aceitas.
    this._cb = {
      node:   typeof opts.onNode === 'function' ? opts.onNode : null,
      select: typeof opts.onSelect === 'function' ? opts.onSelect : null,
      error:  typeof opts.onError === 'function' ? opts.onError : null
    };

    this.config = null; // populados apos o carregamento (ver start())
    this.flow = null;
    this.index = null;

    this.currentId = null; // id do no atualmente exibido (usado nos callbacks)
    this.busy = false;     // trava interacao enquanto o bot "digita"
    this.gen = 0;          // "epoca": invalida sequencias antigas ao reiniciar/avancar/destruir
    this._dead = false;    // marcado por destroy(): a instancia para de operar
    this._ready = null;    // promise compartilhada do carregamento dos dados
    this._loadingEl = null;

    this._buildSkeleton();
    this._renderLoading();
  }

  ChatFlow.VERSION = '0.4.0';

  // Dispara um callback opcional de forma isolada: um erro no codigo do
  // integrador nunca deve derrubar a conversa.
  ChatFlow.prototype._emit = function (kind, a, b) {
    var fn = this._cb[kind];
    if (!fn) return;
    try {
      fn(a, b);
    } catch (err) {
      if (global.console) global.console.error('ChatFlow: erro no callback "' + kind + '".', err);
    }
  };

  // Estrutura minima, presente mesmo antes dos dados chegarem.
  ChatFlow.prototype._buildSkeleton = function () {
    this.root.classList.add('cf');
    this.root.setAttribute('role', 'application');

    // Area de mensagens (anunciada por leitores de tela).
    this.messagesEl = el('div', 'cf-messages');
    this.messagesEl.setAttribute('role', 'log');
    this.messagesEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.messagesEl);

    // O container de opcoes e criado/removido dinamicamente em _renderOptions
    // e _clearOptions, sempre logo apos o ultimo balao da conversa.
    this.optionsEl = null;
  };

  // Barra do navegador embutido (opcional) + cabecalho do perfil. So pode
  // ser montado depois que os dados chegam, pois depende de config.profile
  // e config.browserBar. Inserido antes de messagesEl para ficar no topo.
  ChatFlow.prototype._buildChrome = function () {
    var self = this;
    var cfg = this.config;
    var profile = cfg.profile || {};

    if (cfg.browserBar) {
      var bar = el('div', 'cf-browserbar');
      var urlBox = el('div', 'cf-browserbar__url');
      urlBox.innerHTML = ICON_LOCK; // markup estatico controlado
      var domain = el('span', 'cf-browserbar__domain');
      domain.textContent = cfg.browserBar.domain || '';
      urlBox.appendChild(domain);
      if (cfg.browserBar.label) {
        var sub = el('span', 'cf-browserbar__label');
        sub.textContent = cfg.browserBar.label;
        urlBox.appendChild(sub);
      }
      var reload = el('button', 'cf-browserbar__btn');
      reload.type = 'button';
      reload.setAttribute('aria-label', 'Reiniciar conversa');
      reload.innerHTML = ICON_RELOAD;
      reload.addEventListener('click', function () { self.restart(); });
      bar.appendChild(urlBox);
      bar.appendChild(reload);
      this.root.insertBefore(bar, this.messagesEl);
    }

    var header = el('header', 'cf-header');

    // Botao voltar (estilo Instagram), reinicia a conversa.
    var back = el('button', 'cf-header__back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Voltar');
    back.innerHTML = '&#8592;'; // seta para esquerda
    back.addEventListener('click', function () { self.restart(); });
    header.appendChild(back);

    if (profile.avatar) {
      var avatar = el('img', 'cf-header__avatar');
      avatar.src = profile.avatar;
      avatar.alt = profile.name ? 'Foto de ' + profile.name : '';
      avatar.loading = 'lazy';
      header.appendChild(avatar);
    }

    var info = el('div', 'cf-header__info');
    var name = el('span', 'cf-header__name');
    name.textContent = profile.name || '';
    info.appendChild(name);

    var status = el('span', 'cf-header__status');
    status.textContent = profile.status || 'Online';
    info.appendChild(status);
    header.appendChild(info);

    this.root.insertBefore(header, this.messagesEl);
  };

  /* --- Carregamento e validacao dos dados ------------------------------ */

  // Resolve os dados brutos { config, flow } a partir de "source" (variavel,
  // se informada — tem prioridade) ou de "url" (arquivo, via fetch). O
  // resultado fica em this._ready para nunca carregar em paralelo.
  ChatFlow.prototype._load = function () {
    if (this._source !== undefined) return this._resolveSource(this._source);
    return this._fetchUrl(this._url);
  };

  ChatFlow.prototype._resolveSource = function (source) {
    if (source && typeof source === 'object') return Promise.resolve(source);
    if (typeof source === 'string') {
      try {
        return Promise.resolve(JSON.parse(source));
      } catch (err) {
        return Promise.reject(new Error('ChatFlow: "source" nao e um JSON valido (' + err.message + ').'));
      }
    }
    return Promise.reject(new Error('ChatFlow: "source" deve ser um objeto ou uma string JSON.'));
  };

  ChatFlow.prototype._fetchUrl = function (url) {
    return global.fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('ChatFlow: HTTP ' + res.status + ' ao carregar "' + url + '".');
        }
        return res.json();
      })
      .catch(function (err) {
        if (err instanceof SyntaxError) {
          throw new Error('ChatFlow: "' + url + '" nao contem um JSON valido.');
        }
        throw err;
      });
  };

  // Falha fechada: qualquer problema estrutural interrompe o carregamento com
  // uma mensagem clara, antes que a conversa comece a rodar quebrada. Ja
  // problemas por mensagem (tipo desconhecido, campo faltando) so avisam no
  // console — nao valia a pena travar o bot inteiro por causa de uma bolha.
  ChatFlow.prototype._validate = function (data) {
    if (!data || typeof data !== 'object') {
      throw new Error('ChatFlow: os dados devem ser um objeto com "config" e "flow".');
    }
    var flow = data.flow;
    if (!Array.isArray(flow) || flow.length === 0) {
      throw new Error('ChatFlow: "flow" deve ser um array com pelo menos um no.');
    }

    var seenIds = {};
    var warnings = [];
    flow.forEach(function (node, i) {
      if (!node || typeof node.id !== 'string' || !node.id) {
        throw new Error('ChatFlow: no #' + i + ' sem "id" valido.');
      }
      if (seenIds[node.id]) {
        throw new Error('ChatFlow: id duplicado no flow: "' + node.id + '".');
      }
      seenIds[node.id] = true;

      if (node.messages !== undefined && !Array.isArray(node.messages)) {
        throw new Error('ChatFlow: no "' + node.id + '": "messages" deve ser um array.');
      }
      if (node.options !== undefined && !Array.isArray(node.options)) {
        throw new Error('ChatFlow: no "' + node.id + '": "options" deve ser um array.');
      }

      (node.messages || []).forEach(function (msg, mi) {
        var required = REQUIRED_FIELDS[msg && msg.type];
        if (!required) {
          warnings.push('no "' + node.id + '", mensagem #' + mi + ': tipo "' + (msg && msg.type) + '" desconhecido.');
          return;
        }
        var missing = required.filter(function (field) { return !msg[field]; });
        if (missing.length) {
          warnings.push('no "' + node.id + '", mensagem #' + mi + ' (' + msg.type + '): faltando ' + missing.join(', ') + '.');
        }
      });
    });

    var cfg = data.config || {};
    if (!cfg.startId || !seenIds[cfg.startId]) {
      throw new Error('ChatFlow: "config.startId" ausente ou inexistente no flow.');
    }
    if (warnings.length && global.console) {
      global.console.warn('ChatFlow — possiveis problemas no roteiro:\n- ' + warnings.join('\n- '));
    }
  };

  ChatFlow.prototype._indexFlow = function () {
    this.index = {};
    for (var i = 0; i < this.flow.length; i++) {
      this.index[this.flow[i].id] = this.flow[i];
    }
  };

  /* --- Estados de carregamento e erro ----------------------------------- */

  ChatFlow.prototype._renderLoading = function () {
    var row = el('div', 'cf-msg cf-msg--system');
    row.textContent = 'Carregando conversa...';
    this.messagesEl.appendChild(row);
    this._loadingEl = row;
  };

  // Tela de erro amigavel com um caminho real de recuperacao (retry), em vez
  // de so avisar que algo deu errado — evita um beco sem saida na interface.
  ChatFlow.prototype._renderFatalError = function (err) {
    if (global.console) global.console.error(err);
    this.messagesEl.innerHTML = '';
    this.messagesEl.setAttribute('aria-busy', 'false');
    this._loadingEl = null;

    var box = el('div', 'cf-msg cf-error');
    var text = el('p', 'cf-error__text');
    text.textContent = 'Nao foi possivel carregar esta conversa.';
    box.appendChild(text);

    var retry = el('button', 'cf-error__retry');
    retry.type = 'button';
    retry.textContent = 'Tentar novamente';
    var self = this;
    retry.addEventListener('click', function () {
      if (self._dead) return;
      self._ready = null; // descarta a tentativa anterior para recarregar do zero
      self.messagesEl.innerHTML = '';
      self._renderLoading();
      self.start().catch(function () { /* ja tratado aqui e via onError */ });
    });
    box.appendChild(retry);
    this.messagesEl.appendChild(box);
  };

  /* --- Ciclo de vida ------------------------------------------------- */

  ChatFlow.prototype.start = function () {
    var self = this;
    if (this._dead) return Promise.resolve();
    if (!this._ready) {
      this._ready = this._load()
        .then(function (data) {
          self._validate(data);
          self.config = Object.assign({}, DEFAULTS, data.config || {});
          self.flow = data.flow;
          self._indexFlow();
          if (self._loadingEl && self._loadingEl.parentNode) {
            self._loadingEl.parentNode.removeChild(self._loadingEl);
          }
          self._loadingEl = null;
          self._buildChrome();
        })
        .catch(function (err) {
          self._emit('error', err);
          self._renderFatalError(err);
          throw err;
        });
    }
    return this._ready.then(function () {
      if (self._dead) return;
      return self.goTo(self.config.startId);
    });
  };

  ChatFlow.prototype.restart = function () {
    if (this._dead) return Promise.resolve();
    if (!this.config) return this.start(); // dados ainda carregando: so garante o start
    this.messagesEl.innerHTML = '';
    this.busy = false;
    return this.goTo(this.config.startId);
  };

  // Desmonta a instancia: aborta sequencias pendentes, limpa o DOM e a marca
  // como inativa. Util ao remover o widget em SPAs sem recarregar a pagina.
  ChatFlow.prototype.destroy = function () {
    this._dead = true;
    this.gen++; // qualquer digitacao pendente aborta na proxima checagem de epoca
    this.busy = false;
    if (this.root) {
      this.root.innerHTML = '';
      this.root.classList.remove('cf');
      this.root.removeAttribute('role');
    }
  };

  // Processa um no: renderiza as mensagens em sequencia e depois os botoes.
  ChatFlow.prototype.goTo = function (id) {
    var self = this;
    if (this._dead) return Promise.resolve();
    var node = this.index[id];
    if (!node) {
      this._appendSystem('Fluxo nao encontrado: "' + id + '".');
      return Promise.resolve();
    }

    // Nova epoca: qualquer sequencia anterior ainda pendente sera abortada.
    var gen = ++this.gen;
    this.currentId = id;
    this.busy = true;
    this.messagesEl.setAttribute('aria-busy', 'true');
    this._clearOptions();
    this._emit('node', id, node);
    var messages = node.messages || [];

    // Encadeia as mensagens respeitando o "delay" de cada uma.
    var chain = Promise.resolve();
    messages.forEach(function (msg) {
      chain = chain.then(function () {
        if (gen !== self.gen) return; // reiniciou, avancou ou destruiu: aborta
        var wait = typeof msg.delay === 'number' ? msg.delay : self.config.typingDelay;
        return self._typing(wait).then(function () {
          if (gen !== self.gen) return; // checa de novo apos o "digitando"
          self._appendBotMessage(msg);
          self._scroll();
        });
      });
    });

    return chain
      .then(function () {
        if (gen !== self.gen) return;
        self.busy = false;
        self.messagesEl.setAttribute('aria-busy', 'false');
        self._renderOptions(node.options || []);
      })
      .catch(function (err) {
        if (gen !== self.gen) return;
        self.busy = false;
        self.messagesEl.setAttribute('aria-busy', 'false');
        self._appendSystem('Ocorreu um erro ao carregar esta etapa.');
        if (global.console) global.console.error(err);
      });
  };

  // Mostra o indicador de "digitando" por um intervalo e o remove.
  ChatFlow.prototype._typing = function (ms) {
    var self = this;
    var row = el('div', 'cf-msg cf-msg--bot cf-msg--typing');
    var dots = el('div', 'cf-typing');
    dots.innerHTML = '<span></span><span></span><span></span>';
    dots.setAttribute('aria-label', 'digitando');
    row.appendChild(dots);
    this.messagesEl.appendChild(row);
    this._scroll();
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (row.parentNode) self.messagesEl.removeChild(row);
        resolve();
      }, Math.max(0, ms));
    });
  };

  // Cria a bolha do bot com o conteudo adequado ao tipo da mensagem.
  ChatFlow.prototype._appendBotMessage = function (msg) {
    var row = el('div', 'cf-msg cf-msg--bot');
    var content = this._buildContent(msg);
    if (content) row.appendChild(content);

    // Exibe a nota/legenda do placeholder (campo _note no JSON).
    if (msg._note) {
      var note = el('div', 'cf-note');
      note.textContent = msg._note;
      row.appendChild(note);
    }

    this.messagesEl.appendChild(row);
  };

  ChatFlow.prototype._appendUser = function (text) {
    var row = el('div', 'cf-msg cf-msg--user');
    var body = el('div', 'cf-text');
    body.textContent = text; // texto do proprio botao, inserido como texto puro
    row.appendChild(body);
    this.messagesEl.appendChild(row);
    this._scroll();
  };

  ChatFlow.prototype._appendSystem = function (text) {
    var row = el('div', 'cf-msg cf-msg--system');
    row.textContent = text;
    this.messagesEl.appendChild(row);
    this._scroll();
  };

  // Despacha a construcao do conteudo conforme o tipo declarado no roteiro.
  ChatFlow.prototype._buildContent = function (msg) {
    switch (msg.type) {
      case 'text':   return this._text(msg);
      case 'audio':  return this._audio(msg);
      case 'video':  return this._video(msg);
      case 'image':  return this._image(msg);
      case 'iframe': return this._iframe(msg);
      case 'link':   return this._link(msg);
      case 'html':   return this._html(msg);
      default:
        return this._text({ text: '[tipo de mensagem desconhecido: ' + msg.type + ']' });
    }
  };

  ChatFlow.prototype._text = function (msg) {
    var node = el('div', 'cf-text');
    node.innerHTML = formatText(msg.text || ''); // escapada em formatText
    return node;
  };

  ChatFlow.prototype._audio = function (msg) {
    var audio = el('audio', 'cf-audio');
    audio.controls = true;
    audio.preload = 'metadata';
    if (msg.src) audio.src = msg.src;
    return audio;
  };

  ChatFlow.prototype._video = function (msg) {
    var video = el('video', 'cf-video');
    video.controls = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    if (msg.poster) video.poster = msg.poster;
    if (msg.src) video.src = msg.src;
    return video;
  };

  ChatFlow.prototype._image = function (msg) {
    var img = el('img', 'cf-image');
    if (msg.src) img.src = msg.src;
    img.alt = msg.alt || '';
    img.loading = 'lazy';
    return img;
  };

  ChatFlow.prototype._iframe = function (msg) {
    var wrap = el('div', 'cf-embed');
    // Sem altura fixa, usa proporcao (16/9 por padrao) para responsividade.
    if (!msg.height) wrap.style.aspectRatio = msg.ratio || '16 / 9';

    var frame = el('iframe');
    if (msg.src) frame.src = msg.src;
    frame.title = msg.title || 'conteudo incorporado';
    frame.loading = 'lazy';
    frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.setAttribute('allowfullscreen', '');
    // Sandbox restritivo por padrao; o roteiro pode sobrescrever se precisar.
    frame.setAttribute('sandbox',
      msg.sandbox || 'allow-scripts allow-same-origin allow-presentation allow-popups');
    if (msg.height) frame.style.height = msg.height;
    wrap.appendChild(frame);
    return wrap;
  };

  // "link" e um cartao clicavel dentro da conversa (diferente dos botoes de acao).
  ChatFlow.prototype._link = function (msg) {
    var url = msg.href || '';
    if (!SAFE_PROTOCOL.test(url)) {
      return this._text({ text: msg.label || url });
    }
    var link = el('a', 'cf-linkcard');
    link.href = url;
    link.textContent = msg.label || url;
    link.title = msg.label || url;
    if (msg.newTab !== false) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    return link;
  };

  // Escape hatch para conteudo avancado. O autor do roteiro e responsavel
  // por este HTML (nao ha input de usuario em nenhum ponto da engine).
  ChatFlow.prototype._html = function (msg) {
    var node = el('div', 'cf-html');
    node.innerHTML = msg.html || '';
    return node;
  };

  /* --- Botoes de acao ------------------------------------------------- */

  ChatFlow.prototype._renderOptions = function (options) {
    var self = this;
    this._clearOptions();

    // Cria o container de opcoes sempre ao final de messagesEl,
    // garantindo que os botoes fiquem abaixo do ultimo balao.
    this.optionsEl = el('div', 'cf-options');
    this.messagesEl.appendChild(this.optionsEl);

    options.forEach(function (opt) {
      var btn = el('button', 'cf-option');
      btn.type = 'button';
      btn.textContent = opt.label || '';
      btn.addEventListener('click', function () { self._choose(opt); });
      self.optionsEl.appendChild(btn);
    });
    // Foca o primeiro botao para navegacao por teclado (desligavel via config).
    if (this.config.autofocus) {
      var first = this.optionsEl.querySelector('.cf-option');
      if (first) first.focus();
    }
  };

  ChatFlow.prototype._clearOptions = function () {
    if (this.optionsEl && this.optionsEl.parentNode) {
      this.optionsEl.parentNode.removeChild(this.optionsEl);
    }
    this.optionsEl = null;
  };

  // Trata a escolha: abrir link, reiniciar ou avancar para outro no.
  ChatFlow.prototype._choose = function (opt) {
    if (this._dead || this.busy) return; // ignora clique enquanto o bot ainda "digita"
    this._emit('select', opt, this.currentId);

    // Link externo (ex.: botao "VER AGORA").
    if (opt.url) {
      if (opt.bubble !== false) this._appendUser(opt.label || '');
      if (SAFE_PROTOCOL.test(opt.url)) {
        var target = opt.newTab === false ? '_self' : '_blank';
        global.open(opt.url, target, 'noopener,noreferrer');
      }
      this._clearOptions();
      if (opt.next) this.goTo(opt.next);
      return;
    }

    // Reinicio explicito.
    if (opt.restart) { this.restart(); return; }

    // Avanco padrao: mostra a resposta do usuario e segue para o proximo no.
    if (opt.bubble !== false) this._appendUser(opt.label || '');
    this._clearOptions();
    if (opt.next) this.goTo(opt.next);
  };

  /* --- Rolagem -------------------------------------------------------- */

  ChatFlow.prototype._scroll = function () {
    var box = this.messagesEl;
    var behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    // requestAnimationFrame garante que o layout ja incluiu o novo elemento.
    global.requestAnimationFrame(function () {
      box.scrollTo({ top: box.scrollHeight, behavior: behavior });
    });
  };

  /* ----------------------------------------------------------------------
   * Auto-inicializacao declarativa
   * Qualquer elemento com [data-chatflow="url"] vira um ChatFlow sozinho,
   * sem escrever JS. Para callbacks, use a inicializacao programatica.
   * -------------------------------------------------------------------- */
  if (typeof document !== 'undefined') {
    var autoInit = function () {
      var nodes = document.querySelectorAll('[data-chatflow]');
      for (var i = 0; i < nodes.length; i++) {
        var elem = nodes[i];
        if (elem.classList.contains('cf')) continue; // ja inicializado
        var url = elem.getAttribute('data-chatflow');
        if (!url) continue;
        new ChatFlow({ mount: elem, url: url }).start().catch(function () {
          /* a UI ja mostra o erro com botao de retry */
        });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit(); // script carregado depois do parse: inicia na hora
    }
  }

  return ChatFlow;
});

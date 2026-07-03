class PfPanelApp {
  constructor(rootNode) {
    this.root = rootNode;
    this.modalRoot = document.getElementById('modal-root');
    this.toastRoot = document.getElementById('toast-root');

    // Use centralized state from core module
    this.state = LSPD.createState();

    // Delegate API to core module
    this.api = LSPD.api;
    this.api._onUnauthorized = () => {
      this.state.user = null;
      this.renderLoginPage();
    };

    this.defineTemplates();
    this.init();
  }

  async init() {
    this.updateThemeClass();
    
    // Autenticação Real: Verifica se o usuário está logado
    const res = await this.api.fetch('/auth/me');
    if (res && res.success && res.user) {
      this.state.user = res.user;
      await this.renderAppShell();
    } else {
      this.renderLoginPage();
    }
  }

  setupModalClose() {
    LSPD.modal.setupClose(this.modalRoot);
  }

  // API is now delegated to LSPD.api (core/core.js)

  async renderAppShell() {
    this.clearTimers();
    LSPD.notifications.destroy(); // clear any old polling
    this.root.innerHTML = this.templates.appShell(this.state.user);
    this.setupCommonListeners();

    // Initialize notifications & mobile sidebar
    LSPD.notifications.setupListeners();
    LSPD.notifications.init();
    LSPD.mobileSidebar.setupListeners();

    await this.navigateTo(window.location.hash.substring(1) || 'dashboard');
  }

  async navigateTo(page) {
    this.clearTimers();
    this._navId = (this._navId || 0) + 1;
    const myNavId = this._navId;

    const contentContainer = this.root.querySelector('#page-content');
    if (!contentContainer) return;

    window.location.hash = page;
    this.state.currentPage = page;

    const titles = {
      dashboard: 'Visão Geral',
      ponto: 'Controle de Ponto',
      ranking: 'Ranking de Atividade',
      tickets: 'Controle de Tickets',
      transcripts: 'Transcripts de Atendimento'
    };

    const subtitles = {
      dashboard: 'Indicadores consolidados de tickets, bate-ponto e atendimentos da SSP.',
      ponto: 'Monitoramento de turnos, oficiais em patrulha e rankings de horas.',
      ranking: 'Desempenho operacional da corporação por patrulhas e ações.',
      tickets: 'Controle total dos atendimentos abertos, fechados, assumidos e vinculados ao Discord.',
      transcripts: 'Histórico interativo e transcripts completos dos tickets de atendimento encerrados.'
    };

    this.root.querySelector('#page-title').textContent = titles[page] || 'Painel SSP';
    this.root.querySelector('#page-subtitle').textContent = subtitles[page] || '';

    // Highlight active nav item in both sidebars
    this.root.querySelectorAll('.nav-item').forEach((a) => {
      if (a.hash === `#${page}`) a.classList.add('active');
      else a.classList.remove('active');
    });
    document.querySelectorAll('#mobile-sidebar .nav-item').forEach((a) => {
      if (a.hash === `#${page}`) a.classList.add('active');
      else a.classList.remove('active');
    });

    const pageRenderers = {
      dashboard: this.renderDashboardPage,
      ponto: this.renderPontoPage,
      ranking: this.renderRankingPage,
      tickets: this.renderTicketsPage,
      transcripts: this.renderTranscriptsPage
    };
    this.pageRenderers = pageRenderers;

    const renderer = pageRenderers[page] || this.renderNotFoundPage;
    await renderer.call(this, contentContainer);
    if (this._navId !== myNavId) return;
    this.startLiveRefresh(page);
  }

  startLiveRefresh(page) {
    const livePages = new Set(['dashboard', 'ponto', 'ranking', 'tickets', 'transcripts']);
    if (!livePages.has(page)) return;

    // Track scroll events on contentContainer to pause refresh on activity
    const contentContainer = this.root.querySelector('#page-content');
    if (contentContainer && !contentContainer._scrollListenerAdded) {
      contentContainer._scrollListenerAdded = true;
      contentContainer._lastScrollTime = 0;
      contentContainer.addEventListener('scroll', () => {
        contentContainer._lastScrollTime = Date.now();
      }, { passive: true });
    }

    const currentNavId = this._navId;
    this.state.timers.liveRefresh = setInterval(async () => {
      if (document.hidden) return;
      if (this.state.currentPage !== page) return;
      if (this._navId !== currentNavId) return;
      if (this.modalRoot.innerHTML.trim()) return;

      const currentContainer = this.root.querySelector('#page-content');
      if (!currentContainer) return;

      const active = document.activeElement;
      const isEditingFilter = active && currentContainer.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      if (isEditingFilter) return;

      // Skip refresh if user scrolled in the last 6 seconds
      const lastScroll = currentContainer._lastScrollTime || 0;
      if (Date.now() - lastScroll < 6000) return;

      const renderer = this.pageRenderers?.[page];
      if (!renderer) return;

      const scrollTop = currentContainer.scrollTop;
      await renderer.call(this, currentContainer, true);
      
      // Use requestAnimationFrame to restore scroll position after layout renders
      requestAnimationFrame(() => {
        if (currentContainer) {
          currentContainer.scrollTop = scrollTop;
        }
      });
    }, 4000);
  }

  setupCommonListeners() {
    this.root.querySelector('#theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    this.root.querySelector('#logout-btn')?.addEventListener('click', async () => {
      if (!confirm('Deseja realmente sair do painel?')) return;
      const res = await this.api.fetch('/auth/logout', { method: 'POST' });
      if (res && res.success) {
        window.location.reload();
      } else {
        this.showToast('Erro ao fazer logout.', 'error');
      }
    });

    window.onhashchange = () => this.navigateTo(window.location.hash.substring(1) || 'dashboard');
    this.updateThemeUI();
  }

  toggleTheme() {
    this.state.theme = this.state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.state.theme);
    this.updateThemeUI();
    if (window.location.hash === '#dashboard' || window.location.hash === '') {
      this.navigateTo('dashboard');
    }
  }

  updateThemeClass() {
    document.documentElement.className = this.state.theme;
  }

  updateThemeUI() {
    this.updateThemeClass();
    const themeButton = this.root.querySelector('#theme-toggle');
    if (themeButton) {
      themeButton.innerHTML = `<i class="fas fa-${this.state.theme === 'light' ? 'moon' : 'sun'}"></i>`;
    }
  }

  clearTimers() {
    Object.values(this.state.timers).forEach(clearInterval);
    this.state.timers = {};
  }

  // Utility methods — delegate to LSPD.utils (core/core.js)
  formatDateTime(value) { return LSPD.utils.formatDateTime(value); }
  formatDateTimeLocal(value) { return LSPD.utils.formatDateTimeLocal(value); }
  escapeHtml(value) { return LSPD.utils.escapeHtml(value); }
  formatDuration(ms) { return LSPD.utils.formatDuration(ms); }
  formatBytes(bytes) { return LSPD.utils.formatBytes(bytes); }
  formatLogDetailKey(key) { return LSPD.utils.formatLogDetailKey(key); }
  formatLogDetailValue(value) { return LSPD.utils.formatLogDetailValue(value); }

  renderLoginPage() {
    this.clearTimers();
    this.root.innerHTML = `
      <div class="min-h-screen flex items-center justify-center bg-[var(--bg-color)] p-4 relative overflow-hidden">
        <div class="absolute -top-40 -right-40 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl"></div>
        <div class="absolute -bottom-40 -left-40 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl"></div>
        
        <div class="card-premium rounded-2xl p-8 max-w-md w-full text-center relative z-10 backdrop-blur-md bg-[var(--card-bg)]/80">
          <div class="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white mb-6 shadow-xl shadow-brand-500/20 animate-bounce-slow">
            <i class="fas fa-shield-halved text-3xl"></i>
          </div>
          <h1 class="text-2xl font-black tracking-tight mb-2">Painel Operacional SSP</h1>
          <p class="text-xs text-brand-500 font-bold tracking-widest uppercase mb-8">Secretaria de Segurança Pública</p>
          
          <p class="text-sm text-[var(--text-muted)] mb-6 leading-relaxed">
            Este é um sistema restrito a oficiais da Secretaria de Segurança Pública.
          </p>
          
          <a href="/api/auth/discord" class="btn-brand w-full py-3.5 rounded-xl text-xs uppercase tracking-wider font-bold flex items-center justify-center gap-3 active:scale-98 transition-all hover:brightness-110">
            <i class="fab fa-discord text-lg"></i>
            Entrar com Discord
          </a>
          
          <div class="mt-8 border-t border-[var(--border-subtle)] pt-6 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>Serviço de Autenticação Segura</span>
            <span>v2.0</span>
          </div>
        </div>
      </div>
    `;
  }

  async renderDashboardPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const summary = await this.api.getDashboardSummary();

    if (!summary || !summary.success) {
      if (!silent) container.innerHTML = this.templates.errorPage('Não foi possível carregar os indicadores da SSP.');
      return;
    }

    if (silent) {
      // Atualiza os valores dos cards de resumo silenciosamente para evitar flicker
      const cards = {
        'Oficiais em Serviço': summary.pontosAbertos || 0,
        'Tickets Abertos': summary.ticketsAbertos || 0,
        'Transcripts Salvos': summary.totalTranscripts
      };

      for (const [title, value] of Object.entries(cards)) {
        const cardEl = container.querySelector(`[data-summary-title="${title}"]`);
        if (cardEl) {
          const valEl = cardEl.querySelector('.summary-value');
          if (valEl && valEl.textContent !== String(value)) {
            valEl.textContent = value;
          }
        }
      }

      // Atualiza o feed de atividades silenciosamente
      const feedContainer = container.querySelector('#activity-feed');
      if (feedContainer) {
        const newFeedHtml = summary.activityFeed?.length > 0
          ? summary.activityFeed.map(item => this.templates.activityFeedItem(item, this.formatDateTime.bind(this))).join('')
          : `
            <div class="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
              <i class="fas fa-clock-rotate-left text-3xl mb-3 opacity-50"></i>
              <p class="text-sm">Nenhuma atividade recente.</p>
            </div>
          `;
        if (feedContainer.innerHTML !== newFeedHtml) {
          feedContainer.innerHTML = newFeedHtml;
        }
      }
    } else {
      container.innerHTML = this.templates.dashboardPage(summary);
      this.renderCharts(summary);
      
      const feedContainer = this.root.querySelector('#activity-feed');
      if (feedContainer) {
        feedContainer.innerHTML = summary.activityFeed?.length > 0
          ? summary.activityFeed.map(item => this.templates.activityFeedItem(item, this.formatDateTime.bind(this))).join('')
          : `
            <div class="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
              <i class="fas fa-clock-rotate-left text-3xl mb-3 opacity-50"></i>
              <p class="text-sm">Nenhuma atividade recente.</p>
            </div>
          `;
      }
    }
  }

  // Chart rendering — delegate to LSPD.charts (core/core.js)
  renderCharts(summary) {
    LSPD.charts.render(this, summary);
  }

  async renderCidadaosPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getCidadaos(this.state.cidadaosSearch);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar banco de dados de cidadãos.');
      return;
    }

    container.innerHTML = this.templates.cidadaosPage(res.cidadaos, this.state.cidadaosSearch);
    this.setupCidadaosListeners(res.cidadaos);
  }

  setupCidadaosListeners(cidadaos) {
    const searchInput = this.root.querySelector('#cidadaos-search');
    
    searchInput?.addEventListener('input', (e) => {
      this.state.cidadaosSearch = e.target.value;
      if (this.state.timers.searchDebounce) clearTimeout(this.state.timers.searchDebounce);
      this.state.timers.searchDebounce = setTimeout(() => {
        this.renderCidadaosPage(this.root.querySelector('#page-content'));
      }, 300);
    });

    this.root.querySelectorAll('.view-dossier-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.userid;
        await this.openDossierModal(userId);
      });
    });
  }

  async openDossierModal(userId) {
    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl p-8 max-w-lg w-full text-center">
          <i class="fas fa-circle-notch fa-spin text-3xl text-brand-500"></i>
          <p class="text-sm mt-3 text-[var(--text-muted)]">Carregando dossiê administrativo...</p>
        </div>
      </div>
    `;
    const res = await this.api.getCidadaoDetails(userId);
    if (!res.success) {
      this.showToast(res.message || 'Erro ao carregar ficha.', 'error');
      this.modalRoot.innerHTML = '';
      return;
    }

    this.modalRoot.innerHTML = this.templates.dossierModal(res.cidadao, res.solicitacoes, this.formatDateTime.bind(this));
    this.setupModalClose();

    // Event listener para atualizar passaporte do oficial diretamente do modal
    const saveBtn = this.modalRoot.querySelector('#save-dossier-citizen-id-btn');
    const inputEl = this.modalRoot.querySelector('#edit-dossier-citizen-id');
    saveBtn?.addEventListener('click', async () => {
      const idCidade = inputEl.value.trim();
      if (!idCidade) {
        this.showToast('Insira um Citizen ID válido.', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

      try {
        const updateRes = await this.api.fetch('/cidadaos/update-citizen-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, idCidade })
        });

        if (updateRes.success) {
          this.showToast(updateRes.message || 'Passaporte atualizado!', 'success');
          
          // Atualiza visualmente na mesma hora no subtítulo do modal
          const displayEl = this.modalRoot.querySelector('#modal-display-citizen-id');
          if (displayEl) displayEl.textContent = idCidade;
          
          // Re-renderizar lista de cidadãos silenciosamente em background
          const pc = this.root.querySelector('#page-content');
          if (pc && this.state.currentPage === 'cidadaos') {
            await this.renderCidadaosPage(pc, true);
          }
        } else {
          this.showToast(updateRes.message || 'Erro ao atualizar passaporte.', 'error');
        }
      } catch (err) {
        this.showToast('Erro de rede ao atualizar passaporte.', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Salvar';
      }
    });
  }

  async renderSolicitacoesPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getSolicitacoes(this.state.solicitacoesFilters);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar fila de análise.');
      return;
    }

    container.innerHTML = this.templates.solicitacoesPage(res.solicitacoes, this.state.solicitacoesFilters);
    this.setupSolicitacoesListeners(res.solicitacoes);
  }

  setupSolicitacoesListeners(solicitacoes) {
    const moduloSelect = this.root.querySelector('#sol-modulo');
    const statusSelect = this.root.querySelector('#sol-status');
    const textSearch = this.root.querySelector('#sol-search');

    const applyFilters = () => {
      this.state.solicitacoesFilters.modulo = moduloSelect.value;
      this.state.solicitacoesFilters.status = statusSelect.value;
      this.state.solicitacoesFilters.q = textSearch.value;
      this.renderSolicitacoesPage(this.root.querySelector('#page-content'));
    };

    moduloSelect?.addEventListener('change', applyFilters);
    statusSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    this.root.querySelector('#sol-apply-filter')?.addEventListener('click', applyFilters);

    this.root.querySelectorAll('.analyse-sol-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const sol = solicitacoes.find(s => s._id === id);
        if (sol) this.openAnalyseModal(sol);
      });
    });

    this.root.querySelectorAll('.open-chat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const channelId = e.currentTarget.dataset.channelId;
        const title = e.currentTarget.dataset.title;
        this.openChatModal(channelId, title);
      });
    });
  }

  openAnalyseModal(sol) {
    this.modalRoot.innerHTML = this.templates.analyseModal(sol, this.formatDateTime.bind(this));
    this.setupModalClose();

    const approveBtn = this.modalRoot.querySelector('#approve-btn');
    const rejectBtn = this.modalRoot.querySelector('#reject-btn');
    const rejectReasonInput = this.modalRoot.querySelector('#reject-reason-input');

    approveBtn?.addEventListener('click', async () => {
      approveBtn.disabled = true;
      const res = await this.api.approveSolicitacao(sol._id);
      this.showToast(res.message || 'Solicitação aprovada!', res.success ? 'success' : 'error');
      this.modalRoot.innerHTML = '';
      if (res.success) {
        this.renderSolicitacoesPage(this.root.querySelector('#page-content'));
      }
    });

    rejectBtn?.addEventListener('click', async () => {
      const reason = rejectReasonInput.value.trim();
      if (!reason) {
        this.showToast('Insira um motivo de reprovação válido.', 'error');
        rejectReasonInput.classList.add('border-rose-500');
        return;
      }
      rejectBtn.disabled = true;
      const res = await this.api.rejectSolicitacao(sol._id, reason);
      this.showToast(res.message || 'Solicitação reprovada!', res.success ? 'success' : 'error');
      this.modalRoot.innerHTML = '';
      if (res.success) {
        this.renderSolicitacoesPage(this.root.querySelector('#page-content'));
      }
    });
  }

  async renderTicketsPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getTickets(this.state.ticketsFilters);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar controle de tickets.');
      return;
    }

    container.innerHTML = this.templates.ticketsPage(res.tickets || [], res.stats || {}, this.state.ticketsFilters);
    this.setupTicketsListeners(res.tickets || []);
  }

  setupTicketsListeners(tickets) {
    const statusSelect = this.root.querySelector('#tickets-status');
    const textSearch = this.root.querySelector('#tickets-search');

    const applyFilters = () => {
      this.state.ticketsFilters.status = statusSelect.value;
      this.state.ticketsFilters.q = textSearch.value;
      this.renderTicketsPage(this.root.querySelector('#page-content'));
    };

    statusSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    this.root.querySelector('#tickets-apply-filter')?.addEventListener('click', applyFilters);

    this.root.querySelectorAll('.ticket-chat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const channelId = e.currentTarget.dataset.channelId;
        const title = e.currentTarget.dataset.title || channelId;
        this.openChatModal(channelId, title);
      });
    });

    this.root.querySelectorAll('.ticket-claim-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const res = await this.api.claimTicket(e.currentTarget.dataset.id);
        this.showToast(res.message || 'Ticket assumido.', res.success ? 'success' : 'error');
        if (res.success) this.renderTicketsPage(this.root.querySelector('#page-content'));
      });
    });

    this.root.querySelectorAll('.ticket-close-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (!confirm('Fechar este ticket no Discord, gerar transcript/log e arquivar o canal?')) return;
        const res = await this.api.closeTicket(e.currentTarget.dataset.id, true);
        this.showToast(res.message || 'Ticket fechado.', res.success ? 'success' : 'error');
        if (res.success) this.renderTicketsPage(this.root.querySelector('#page-content'));
      });
    });
  }

  async renderPontoPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    try {
      const corpFilter = this.state.pontoFilters.corporationSlug;
      const [statsRes, pontosRes, officersRes] = await Promise.all([
        this.api.fetch(`/ponto/stats${corpFilter ? `?corporationSlug=${corpFilter}` : ''}`),
        this.api.fetch(`/ponto?q=${encodeURIComponent(this.state.pontoFilters.q)}&status=${this.state.pontoFilters.status}&userId=${this.state.pontoFilters.userId}&roleId=${this.state.pontoFilters.roleId}&startDate=${this.state.pontoFilters.startDate}&endDate=${this.state.pontoFilters.endDate}&corporationSlug=${this.state.pontoFilters.corporationSlug}`),
        this.api.fetch('/officers')
      ]);

      if (!statsRes.success || !pontosRes.success) {
        container.innerHTML = this.templates.errorPage('Erro ao carregar dados do Bate-Ponto.');
        return;
      }

      container.innerHTML = this.templates.pontoPage(statsRes, pontosRes.pontos, this.state.pontoFilters, officersRes.officers || [], pontosRes.roles || []);
      this.setupPontoListeners(statsRes, pontosRes.pontos, officersRes.officers || [], pontosRes.roles || []);
    } catch (err) {
      console.error(err);
      container.innerHTML = this.templates.errorPage('Erro crítico de bate-ponto.');
    }
  }

  setupPontoListeners(stats, pontos, officers, roles) {
    const qInput = this.root.querySelector('#ponto-search');
    const statusSelect = this.root.querySelector('#ponto-status');
    const officerSelect = this.root.querySelector('#ponto-officer');
    const roleSelect = this.root.querySelector('#ponto-role');
    const corpSelect = this.root.querySelector('#ponto-corporation');
    const startDateInput = this.root.querySelector('#ponto-start-date');
    const endDateInput = this.root.querySelector('#ponto-end-date');
    const filterBtn = this.root.querySelector('#ponto-apply-filter');
    const exportXlsxBtn = this.root.querySelector('#export-ponto-xlsx');
    const exportPdfBtn = this.root.querySelector('#export-ponto-pdf');
    
    const applyFilters = () => {
      this.state.pontoFilters.q = qInput ? qInput.value.trim() : '';
      this.state.pontoFilters.status = statusSelect ? statusSelect.value : '';
      this.state.pontoFilters.userId = officerSelect ? officerSelect.value : '';
      this.state.pontoFilters.roleId = roleSelect ? roleSelect.value : '';
      this.state.pontoFilters.corporationSlug = corpSelect ? corpSelect.value : '';
      this.state.pontoFilters.startDate = startDateInput ? startDateInput.value : '';
      this.state.pontoFilters.endDate = endDateInput ? endDateInput.value : '';
      this.renderPontoPage(this.root.querySelector('#page-content'));
    };

    qInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    startDateInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    endDateInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    statusSelect?.addEventListener('change', applyFilters);
    officerSelect?.addEventListener('change', applyFilters);
    roleSelect?.addEventListener('change', applyFilters);
    corpSelect?.addEventListener('change', applyFilters);
    filterBtn?.addEventListener('click', applyFilters);

    exportXlsxBtn?.addEventListener('click', () => {
      const { q, status, userId, roleId, startDate, endDate, corporationSlug } = this.state.pontoFilters;
      window.open(`/api/ponto/export?format=xlsx&q=${encodeURIComponent(q)}&status=${status}&userId=${userId}&roleId=${roleId}&startDate=${startDate}&endDate=${endDate}&corporationSlug=${corporationSlug}`, '_blank');
    });

    exportPdfBtn?.addEventListener('click', () => {
      const { q, status, userId, roleId, startDate, endDate, corporationSlug } = this.state.pontoFilters;
      window.open(`/api/ponto/export?format=pdf&q=${encodeURIComponent(q)}&status=${status}&userId=${userId}&roleId=${roleId}&startDate=${startDate}&endDate=${endDate}&corporationSlug=${corporationSlug}`, '_blank');
    });

    const recordsBtn = this.root.querySelector('#ponto-btn-records');
    const officersBtn = this.root.querySelector('#ponto-btn-officers');

    recordsBtn?.addEventListener('click', () => {
      if (this.state.pontoActiveTab !== 'records') {
        this.state.pontoActiveTab = 'records';
        this.renderPontoPage(this.root.querySelector('#page-content'), true);
      }
    });

    officersBtn?.addEventListener('click', () => {
      if (this.state.pontoActiveTab !== 'officers') {
        this.state.pontoActiveTab = 'officers';
        this.renderPontoPage(this.root.querySelector('#page-content'), true);
      }
    });

    this.root.querySelectorAll('.view-ponto-officer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const userId = e.currentTarget.dataset.userId;
        this.openOfficerProfileModal(userId, true);
      });
    });
  }

  async renderCorregedoriaPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getCorregedoria(this.state.corregedoriaFilters);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar banco de dados da Corregedoria.');
      return;
    }

    container.innerHTML = this.templates.corregedoriaPage(res.casos, this.state.corregedoriaFilters);
    this.setupCorregedoriaListeners(res.casos);
  }

  setupCorregedoriaListeners(casos) {
    const statusSelect = this.root.querySelector('#corregedoria-status');
    const textSearch = this.root.querySelector('#corregedoria-search');

    const applyFilters = () => {
      this.state.corregedoriaFilters.status = statusSelect.value;
      this.state.corregedoriaFilters.q = textSearch.value;
      this.renderCorregedoriaPage(this.root.querySelector('#page-content'));
    };

    statusSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    this.root.querySelector('#corregedoria-apply-filter')?.addEventListener('click', applyFilters);

    this.root.querySelectorAll('.analyse-corregedoria-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const caso = casos.find(c => c._id === id);
        if (caso) this.openCorregedoriaModal(caso);
      });
    });

    this.root.querySelectorAll('.open-chat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const channelId = e.currentTarget.dataset.channelId;
        const title = e.currentTarget.dataset.title;
        this.openChatModal(channelId, title);
      });
    });
  }

  openCorregedoriaModal(caso) {
    this.modalRoot.innerHTML = this.templates.corregedoriaModal(caso, this.formatDateTime.bind(this));
    this.setupModalClose();
  }

  async renderTranscriptsPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getTranscripts(this.state.transcriptsFilters);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar base de transcripts de tickets.');
      return;
    }

    container.innerHTML = this.templates.transcriptsPage(res.transcripts, this.state.transcriptsFilters);
    this.setupTranscriptsListeners(res.transcripts);
  }

  setupTranscriptsListeners(transcripts) {
    const moduloSelect = this.root.querySelector('#transcripts-modulo');
    const textSearch = this.root.querySelector('#transcripts-search');

    const applyFilters = () => {
      this.state.transcriptsFilters.modulo = moduloSelect.value;
      this.state.transcriptsFilters.q = textSearch.value;
      this.renderTranscriptsPage(this.root.querySelector('#page-content'));
    };

    moduloSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    this.root.querySelector('#transcripts-apply-filter')?.addEventListener('click', applyFilters);

    this.root.querySelectorAll('.view-transcript-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const transcript = transcripts.find(t => t._id === id);
        if (transcript) this.openTranscriptModal(transcript);
      });
    });

    this.root.querySelectorAll('.download-transcript-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        window.open(`/api/transcripts/${e.currentTarget.dataset.id}/raw`, '_blank');
      });
    });
  }

  openTranscriptModal(transcript) {
    this.modalRoot.innerHTML = this.templates.transcriptModal(transcript, this.formatDateTime.bind(this));
    this.setupModalClose();
  }

  async openChatModal(channelId, title) {
    this.modalRoot.innerHTML = this.templates.chatModal(title, channelId);
    this.setupModalClose();

    const feed = this.modalRoot.querySelector('#chat-messages-feed');
    const form = this.modalRoot.querySelector('#chat-input-form');
    const input = this.modalRoot.querySelector('#chat-message-input');

    let lastMessageId = null;

    const loadMessages = async (isFirst = false) => {
      if (!document.getElementById('chat-modal-container')) return;

      try {
        const res = await this.api.fetch(`/tickets/${channelId}/messages`);
        if (!res.success) {
          if (isFirst) {
            feed.innerHTML = `
              <div class="text-center py-8 text-[var(--text-muted)] text-xs">
                <i class="fas fa-circle-exclamation text-rose-500 text-xl mb-2 block"></i>
                ${res.message || 'Erro ao carregar mensagens.'}
              </div>
            `;
          }
          return;
        }

        const messages = res.messages || [];
        if (messages.length === 0) {
          feed.innerHTML = `
            <div class="text-center py-8 text-[var(--text-muted)] text-xs">
              Nenhuma mensagem neste canal de ticket.
            </div>
          `;
          return;
        }

        const latestMsg = messages[messages.length - 1];
        const hasNewMessages = !lastMessageId || (latestMsg && latestMsg.id !== lastMessageId);

        if (hasNewMessages) {
          lastMessageId = latestMsg ? latestMsg.id : null;
          
          feed.innerHTML = messages.map(msg => {
            let content = msg.content;
            let isWebPanel = false;
            const match = content.match(/💻 \*\*\[Painel Web\]\s*(?:\([^)]+\))?\*\*:/);
            if (match) {
              content = content.substring(match[0].length).trim();
              isWebPanel = true;
            }

            const name = isWebPanel ? 'Painel Web (Dashboard)' : msg.author.name;
            const tag = isWebPanel 
              ? `<span class="bg-brand-500/20 text-brand-400 border border-brand-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase text-center font-semibold">PAINEL</span>`
              : (msg.author.bot ? `<span class="bg-zinc-800 text-zinc-400 border border-zinc-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase text-center font-semibold">BOT</span>` : '');

            return `
              <div class="flex items-start gap-3 text-left">
                <img src="${msg.author.avatarUrl}" class="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2 flex-wrap">
                    <span class="text-xs font-bold text-zinc-100">${name}</span>
                    ${tag}
                    <span class="text-[9px] text-[var(--text-muted)]">${new Date(msg.timestamp).toLocaleString('pt-BR')}</span>
                  </div>
                  <div class="text-xs text-zinc-300 mt-1 whitespace-pre-wrap leading-relaxed">${content}</div>
                </div>
              </div>
            `;
          }).join('');

          feed.scrollTop = feed.scrollHeight;
        }
      } catch (err) {
        console.error('Erro ao carregar chat:', err);
      }
    };

    await loadMessages(true);

    const pollInterval = setInterval(() => {
      if (!document.getElementById('chat-modal-container')) {
        clearInterval(pollInterval);
        return;
      }
      loadMessages(false);
    }, 3000);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      input.disabled = true;

      try {
        const res = await this.api.fetch(`/tickets/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text })
        });

        if (!res.success) {
          this.showToast(res.message || 'Erro ao enviar mensagem.', 'error');
        } else {
          await loadMessages(false);
        }
      } catch (err) {
        this.showToast('Erro de conexão ao enviar mensagem.', 'error');
      } finally {
        input.disabled = false;
        input.focus();
      }
    });
  }

  async renderLogsPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const res = await this.api.getLogs(this.state.logsFilters);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar auditoria de logs.');
      return;
    }

    container.innerHTML = this.templates.logsPage(res, this.state.logsFilters);
    this.setupLogsListeners(res);
  }

  setupLogsListeners(res) {
    const typeSelect = this.root.querySelector('#logs-type');
    const textSearch = this.root.querySelector('#logs-search');

    const applyFilters = (page = 1) => {
      this.state.logsFilters.type = typeSelect.value;
      this.state.logsFilters.q = textSearch.value;
      this.state.logsFilters.page = page;
      this.renderLogsPage(this.root.querySelector('#page-content'));
    };

    typeSelect?.addEventListener('change', () => applyFilters(1));
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters(1);
    });
    this.root.querySelector('#logs-apply-filter')?.addEventListener('click', () => applyFilters(1));

    this.root.querySelectorAll('.logs-page-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = parseInt(e.currentTarget.dataset.page);
        if (page && page !== res.currentPage && page >= 1 && page <= res.pages) {
          applyFilters(page);
        }
      });
    });
  }

  renderReportsPage(container) {
    container.innerHTML = this.templates.reportsPage();
    
    const exportCidadaosBtn = this.root.querySelector('#export-cidadaos-btn');
    const exportSolicitacoesBtn = this.root.querySelector('#export-solicitacoes-btn');
    const exportPontoBtn = this.root.querySelector('#export-ponto-btn');

    exportCidadaosBtn?.addEventListener('click', () => {
      const format = this.root.querySelector('#report-format').value;
      const search = this.root.querySelector('#report-search').value;
      window.open(`/api/cidadaos/export?format=${format}&q=${encodeURIComponent(search)}`, '_blank');
    });

    exportSolicitacoesBtn?.addEventListener('click', () => {
      const format = this.root.querySelector('#report-format').value;
      const modulo = this.root.querySelector('#report-modulo').value;
      const status = this.root.querySelector('#report-status').value;
      const search = this.root.querySelector('#report-search').value;
      window.open(`/api/solicitacoes/export?format=${format}&modulo=${modulo}&status=${status}&q=${encodeURIComponent(search)}`, '_blank');
    });

    exportPontoBtn?.addEventListener('click', () => {
      const format = this.root.querySelector('#report-format').value;
      const status = this.root.querySelector('#report-ponto-status').value;
      const startDate = this.root.querySelector('#report-ponto-start').value;
      const endDate = this.root.querySelector('#report-ponto-end').value;
      const search = this.root.querySelector('#report-search').value;
      
      let url = `/api/ponto/export?format=${format}&q=${encodeURIComponent(search)}&status=${status}`;
      if (startDate) url += `&startDate=${startDate}`;
      if (endDate) url += `&endDate=${endDate}`;
      window.open(url, '_blank');
    });
  }

  async renderSettingsPage(container) {
    container.innerHTML = this.templates.loadingDashboard();
    try {
      const res = await this.api.fetch('/config');
      if (!res.success) {
        container.innerHTML = this.templates.errorPage('Erro ao carregar configurações do bot.');
        return;
      }
      const config = res.config || {
        channels: {},
        roles: {},
        modules: { tickets: true, ponto: true, edital: true },
        embeds: { design: { logo: '', colors: {} }, tickets: { panel: {} }, ponto: { panel: {} }, edital: { panel: {} } }
      };
      container.innerHTML = this.templates.settingsPage(config, res.pmesp, res.pcesp);
      this.setupSettingsListeners(config);
    } catch (err) {
      console.error(err);
      container.innerHTML = this.templates.errorPage('Erro crítico de conexão com a API de configurações.');
    }
  }

  setupSettingsListeners(config) {
    const form = this.root.querySelector('#settings-form');
    const saveBtn = this.root.querySelector('#save-settings-btn');
    const channelInputs = this.root.querySelectorAll('.discord-channel-input');
    const roleInputs = this.root.querySelectorAll('.discord-role-input');

    const updateChannelName = async (inputEl) => {
      const badgeId = 'name-' + inputEl.id;
      const badgeEl = this.root.querySelector('#' + badgeId);
      if (!badgeEl) return;

      const val = inputEl.value.trim();
      if (!val) {
        badgeEl.innerHTML = '';
        return;
      }

      if (!/^\d{17,20}$/.test(val)) {
        badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-times-circle"></i> ID inválido</span>';
        return;
      }

      badgeEl.innerHTML = '<span class="text-zinc-500 font-medium text-[10px]"><i class="fas fa-spinner fa-spin"></i> Buscando...</span>';

      try {
        const res = await this.api.fetch('/discord/channels/' + val);
        if (res && res.success && res.name) {
          let badgeHtml = '';
          if (res.type === 4) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold text-[10px] border border-blue-500/20"><i class="fas fa-folder"></i> Categoria: ${res.name}</span>`;
          } else if (res.type === 0 || res.type === 5) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold text-[10px] border border-emerald-500/20"><i class="fas fa-hashtag"></i> Canal de Texto: ${res.name}</span>`;
          } else if (res.type === 2) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-semibold text-[10px] border border-purple-500/20"><i class="fas fa-volume-up"></i> Canal de Voz: ${res.name}</span>`;
          } else if (res.type === 15) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-semibold text-[10px] border border-indigo-500/20"><i class="fas fa-comments"></i> Fórum: ${res.name}</span>`;
          } else {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400 font-semibold text-[10px] border border-zinc-500/20"><i class="fas fa-hashtag"></i> Canal: ${res.name}</span>`;
          }
          badgeEl.innerHTML = badgeHtml;
        } else {
          badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-exclamation-triangle"></i> Não encontrado</span>';
        }
      } catch (err) {
        badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-exclamation-triangle"></i> Erro de rede</span>';
      }
    };

    const updateRoleName = async (inputEl) => {
      const badgeId = 'name-' + inputEl.id;
      const badgeEl = this.root.querySelector('#' + badgeId);
      if (!badgeEl) return;

      const val = inputEl.value.trim();
      if (!val) {
        badgeEl.innerHTML = '';
        return;
      }

      if (!/^\d{17,20}$/.test(val)) {
        badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-times-circle"></i> ID de cargo inválido</span>';
        return;
      }

      badgeEl.innerHTML = '<span class="text-zinc-500 font-medium text-[10px]"><i class="fas fa-spinner fa-spin"></i> Buscando...</span>';

      try {
        const res = await this.api.fetch('/discord/roles/' + val);
        if (res && res.success && res.name) {
          const hexColor = res.color && res.color !== 0 ? '#' + res.color.toString(16).padStart(6, '0') : '#a1a1aa';
          badgeEl.innerHTML = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold text-[10px] border" style="background-color: ${hexColor}15; color: ${hexColor}; border-color: ${hexColor}30"><i class="fas fa-user-shield"></i> Cargo: ${res.name}</span>`;
        } else {
          badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-exclamation-triangle"></i> Cargo não encontrado</span>';
        }
      } catch (err) {
        badgeEl.innerHTML = '<span class="text-red-400 font-medium text-[10px]"><i class="fas fa-exclamation-triangle"></i> Erro de rede</span>';
      }
    };

    channelInputs.forEach(input => {
      updateChannelName(input);
      input.addEventListener('input', () => {
        const val = input.value.trim();
        if (val === '' || /^\d{17,20}$/.test(val)) {
          updateChannelName(input);
        }
      });
    });

    roleInputs.forEach(input => {
      updateRoleName(input);
      input.addEventListener('input', () => {
        const val = input.value.trim();
        if (val === '' || /^\d{17,20}$/.test(val)) {
          updateRoleName(input);
        }
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Salvando...`;

      const body = {
        modules: {
          tickets: this.root.querySelector('#mod-tickets').checked,
          ponto: this.root.querySelector('#mod-ponto').checked,
          edital: this.root.querySelector('#mod-edital').checked,
          ausencia: this.root.querySelector('#mod-ausencia').checked,
          warning: this.root.querySelector('#mod-warning').checked
        },
        channels: {
          pontoPanel: this.root.querySelector('#ch-pontoPanel')?.value.trim() || null,
          ausenciaPanel: this.root.querySelector('#ch-ausenciaPanel')?.value.trim() || null,
          editalPanel: this.root.querySelector('#ch-editalPanel')?.value.trim() || null,
          copomLogs: this.root.querySelector('#ch-copomLogs')?.value.trim() || null,
          adminLogs: this.root.querySelector('#ch-adminLogs')?.value.trim() || null,
          corregedoriaCategory: this.root.querySelector('#ch-corregedoriaCategory')?.value.trim() || null,
          corregedoriaResults: this.root.querySelector('#ch-corregedoriaResults')?.value.trim() || null,
          memberLogsEntrada: this.root.querySelector('#ch-memberLogsEntrada')?.value.trim() || null,
          memberLogsSaida: this.root.querySelector('#ch-memberLogsSaida')?.value.trim() || null,
          exoneracoes: this.root.querySelector('#ch-exoneracoes')?.value.trim() || null,
          transferencias: this.root.querySelector('#ch-transferencias')?.value.trim() || null,
          solicitacoesInternas: this.root.querySelector('#ch-solicitacoesInternas')?.value.trim() || null,
          blacklist: this.root.querySelector('#ch-blacklist')?.value.trim() || null,
          sugestoes: this.root.querySelector('#ch-sugestoes')?.value.trim() || null,
          hierarchy: this.root.querySelector('#ch-hierarchy')?.value.trim() || null,
          avaliacaoPanel: this.root.querySelector('#ch-avaliacaoPanel')?.value.trim() || null,
          avaliacaoLogs: this.root.querySelector('#ch-avaliacaoLogs')?.value.trim() || null,
          academiaPanel: this.root.querySelector('#ch-academiaPanel')?.value.trim() || null,
          academiaAvisos: this.root.querySelector('#ch-academiaAvisos')?.value.trim() || null
        },
        roles: {
          setupAuthorized: this.root.querySelector('#rl-setupAuthorized')?.value.trim() || null,
          cidadao: this.root.querySelector('#rl-cidadao')?.value.trim() || null
        },
        pmesp: {
          channels: {
            ticketsPanel: this.root.querySelector('#pmesp-ch-ticketsPanel')?.value.trim() || null,
            ticketsCategory: this.root.querySelector('#pmesp-ch-ticketsCategory')?.value.trim() || null,
            warningPanel: this.root.querySelector('#pmesp-ch-warningPanel')?.value.trim() || null,
            pontoLogsPmesp: this.root.querySelector('#pmesp-ch-pontoLogsPmesp')?.value.trim() || null,
            ausenciaLogsPmesp: this.root.querySelector('#pmesp-ch-ausenciaLogsPmesp')?.value.trim() || null,
            editalAvaliacaoPmesp: this.root.querySelector('#pmesp-ch-editalAvaliacaoPmesp')?.value.trim() || null,
            editalResultadosPmesp: this.root.querySelector('#pmesp-ch-editalResultadosPmesp')?.value.trim() || null
          },
          roles: {
            geral: this.root.querySelector('#pmesp-rl-geral')?.value.trim() || null,
            comando: this.root.querySelector('#pmesp-rl-comando')?.value.trim() || null,
            staff: this.root.querySelector('#pmesp-rl-staff')?.value.trim() || null,
            recruta: this.root.querySelector('#pmesp-rl-recruta')?.value.trim() || null,
            preAprovado: this.root.querySelector('#pmesp-rl-preAprovado')?.value.trim() || null,
            advVerbal: this.root.querySelector('#pmesp-rl-advVerbal')?.value.trim() || null,
            adv1: this.root.querySelector('#pmesp-rl-adv1')?.value.trim() || null,
            adv2: this.root.querySelector('#pmesp-rl-adv2')?.value.trim() || null,
            adv3: this.root.querySelector('#pmesp-rl-adv3')?.value.trim() || null,
            administrativo: this.root.querySelector('#pmesp-rl-administrativo')?.value.trim() || null,
            ministrador: this.root.querySelector('#pmesp-rl-ministrador')?.value.trim() || null,
            caboRole: this.root.querySelector('#pmesp-rl-caboRole')?.value.trim() || null
          }
        },
        pcesp: {
          channels: {
            ticketsPanel: this.root.querySelector('#pcesp-ch-ticketsPanel')?.value.trim() || null,
            ticketsCategory: this.root.querySelector('#pcesp-ch-ticketsCategory')?.value.trim() || null,
            warningPanel: this.root.querySelector('#pcesp-ch-warningPanel')?.value.trim() || null,
            pontoLogsPcesp: this.root.querySelector('#pcesp-ch-pontoLogsPcesp')?.value.trim() || null,
            ausenciaLogsPcesp: this.root.querySelector('#pcesp-ch-ausenciaLogsPcesp')?.value.trim() || null,
            editalAvaliacaoPcesp: this.root.querySelector('#pcesp-ch-editalAvaliacaoPcesp')?.value.trim() || null,
            editalResultadosPcesp: this.root.querySelector('#pcesp-ch-editalResultadosPcesp')?.value.trim() || null
          },
          roles: {
            geral: this.root.querySelector('#pcesp-rl-geral')?.value.trim() || null,
            comando: this.root.querySelector('#pcesp-rl-comando')?.value.trim() || null,
            staff: this.root.querySelector('#pcesp-rl-staff')?.value.trim() || null,
            recruta: this.root.querySelector('#pcesp-rl-recruta')?.value.trim() || null,
            preAprovado: this.root.querySelector('#pcesp-rl-preAprovado')?.value.trim() || null,
            advVerbal: this.root.querySelector('#pcesp-rl-advVerbal')?.value.trim() || null,
            adv1: this.root.querySelector('#pcesp-rl-adv1')?.value.trim() || null,
            adv2: this.root.querySelector('#pcesp-rl-adv2')?.value.trim() || null,
            adv3: this.root.querySelector('#pcesp-rl-adv3')?.value.trim() || null,
            administrativo: this.root.querySelector('#pcesp-rl-administrativo')?.value.trim() || null,
            ministrador: this.root.querySelector('#pcesp-rl-ministrador')?.value.trim() || null
          }
        }
      };

      try {
        const res = await this.api.fetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res && res.success) {
          this.showToast('Configurações salvas com sucesso!', 'success');
          this.renderSettingsPage(this.root.querySelector('#page-content'));
        } else {
          this.showToast(res.message || 'Erro ao salvar configurações.', 'error');
        }
      } catch (err) {
        this.showToast('Erro de conexão ao salvar configurações.', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `Salvar Configurações`;
      }
    });
  }

  async renderAusenciasPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const filterStatus = this.state.ausenciasFilters?.status || '';
    const filterQ = this.state.ausenciasFilters?.q || '';
    
    const res = await this.api.getAusencias(filterStatus, filterQ);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar banco de dados de ausências.');
      return;
    }

    container.innerHTML = this.templates.ausenciasPage(res.ausencias || [], this.state.ausenciasFilters);
    this.setupAusenciasListeners(res.ausencias || []);
  }

  setupAusenciasListeners(ausencias) {
    const statusSelect = this.root.querySelector('#aus-status');
    const textSearch = this.root.querySelector('#aus-search');
    const filterBtn = this.root.querySelector('#aus-apply-filter');

    const applyFilters = () => {
      this.state.ausenciasFilters.status = statusSelect.value;
      this.state.ausenciasFilters.q = textSearch.value;
      this.renderAusenciasPage(this.root.querySelector('#page-content'));
    };

    statusSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    filterBtn?.addEventListener('click', applyFilters);

    this.root.querySelectorAll('.analyse-aus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const aus = ausencias.find(a => a._id === id);
        if (aus) this.openAnalyseAusenciaModal(aus);
      });
    });
  }

  openAnalyseAusenciaModal(aus) {
    const statusBadges = {
      pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
      aprovado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
      reprovado: 'bg-rose-500/10 text-rose-500 border-rose-500/15'
    };

    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-brand-500/10 text-brand-500 border border-[var(--border-subtle)] flex items-center justify-center text-sm">
                <i class="fas fa-calendar-days"></i>
              </div>
              <div>
                <h3 class="text-lg font-bold tracking-tight">Análise de Ausência</h3>
                <p class="text-xs text-[var(--text-muted)] mt-0.5">Enviado em ${this.formatDateTime(aus.createdAt)}</p>
              </div>
            </div>
            <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="flex-grow overflow-y-auto p-6 space-y-6">
            <div class="grid grid-cols-3 gap-4 text-xs bg-[var(--card-bg-soft)] p-4 rounded-xl border border-[var(--border-subtle)]">
              <div>
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Oficial</p>
                <p class="font-bold text-sm mt-0.5 text-zinc-200">${aus.nomeRp || aus.username}</p>
              </div>
              <div>
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Passaporte</p>
                <p class="font-bold text-sm mt-0.5 text-zinc-200">#${aus.passaporte}</p>
              </div>
              <div>
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Período</p>
                <p class="font-bold text-xs mt-0.5 text-zinc-200">${aus.dataInicio} a ${aus.dataFim} (${aus.duracaoDias} dias)</p>
              </div>
            </div>

            <div>
              <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-2">Motivo do Afastamento</h4>
              <p class="text-sm text-zinc-200 font-medium pl-3 border-l-2 border-brand-500 whitespace-pre-wrap leading-relaxed">${aus.motivo}</p>
            </div>

            ${aus.status !== 'pendente' ? `
              <div class="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 text-sm space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-bold">Decisão Final:</span>
                  <span class="px-2 py-0.5 text-xs font-bold uppercase rounded border ${statusBadges[aus.status]}">${aus.status}</span>
                </div>
                ${aus.status === 'aprovado' ? `
                  <p class="text-xs text-[var(--text-muted)]">Aprovado por: <strong>${aus.aprovadoPor || 'Comando SSP'}</strong></p>
                ` : `
                  <p class="text-xs text-[var(--text-muted)]">Reprovado por: <strong>${aus.aprovadoPor || 'Comando SSP'}</strong></p>
                  <div class="p-2 rounded-lg border border-rose-500/10 bg-rose-500/5 text-rose-500 text-xs mt-1">
                    <strong>Justificativa:</strong> ${aus.motivoReprovacao || 'Nenhum motivo informado.'}
                  </div>
                `}
              </div>
            ` : `
              <div class="border-t border-[var(--border-subtle)] pt-4 space-y-3">
                <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em]">Motivo do Indeferimento (Obrigatório apenas para reprovação)</label>
                <input type="text" id="aus-reject-reason" placeholder="Justifique a reprovação..." class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-sm text-zinc-100">
              </div>
            `}
          </div>

          <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end gap-2 flex-shrink-0">
            <button class="close-modal-btn btn-soft px-5 py-2.5 rounded-xl text-xs font-semibold">Fechar</button>
            ${aus.status === 'pendente' ? `
              <button id="aus-reject-btn" class="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-colors">Reprovar Pedido</button>
              <button id="aus-approve-btn" class="btn-brand text-xs px-5 py-2.5 rounded-xl transition-all">Aprovar Pedido</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
    
    this.setupModalClose();

    if (aus.status === 'pendente') {
      const approveBtn = this.modalRoot.querySelector('#aus-approve-btn');
      const rejectBtn = this.modalRoot.querySelector('#aus-reject-btn');
      const rejectReasonInput = this.modalRoot.querySelector('#aus-reject-reason');

      approveBtn?.addEventListener('click', async () => {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        const res = await this.api.approveAusencia(aus._id);
        this.showToast(res.message || 'Ausência aprovada!', res.success ? 'success' : 'error');
        this.modalRoot.innerHTML = '';
        if (res.success) {
          this.renderAusenciasPage(this.root.querySelector('#page-content'));
        }
      });

      rejectBtn?.addEventListener('click', async () => {
        const reason = rejectReasonInput.value.trim();
        if (!reason) {
          this.showToast('Insira uma justificativa para reprovar.', 'error');
          rejectReasonInput.classList.add('border-rose-500');
          return;
        }
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        const res = await this.api.rejectAusencia(aus._id, reason);
        this.showToast(res.message || 'Ausência reprovada!', res.success ? 'success' : 'error');
        this.modalRoot.innerHTML = '';
        if (res.success) {
          this.renderAusenciasPage(this.root.querySelector('#page-content'));
        }
      });
    }
  }

  async renderWarningsPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    const filterStatus = this.state.warningsFilters?.status || '';
    const filterQ = this.state.warningsFilters?.q || '';
    
    const res = await this.api.getWarnings(filterStatus, filterQ);

    if (!res.success) {
      container.innerHTML = this.templates.errorPage('Erro ao carregar base de advertências.');
      return;
    }

    container.innerHTML = this.templates.warningsPage(res.warnings || [], this.state.warningsFilters);
    this.setupWarningsListeners(res.warnings || []);
  }

  setupWarningsListeners(warnings) {
    const statusSelect = this.root.querySelector('#warn-status');
    const textSearch = this.root.querySelector('#warn-search');
    const filterBtn = this.root.querySelector('#warn-apply-filter');
    const applyWarningBtn = this.root.querySelector('#apply-warning-btn');

    const applyFilters = () => {
      this.state.warningsFilters.status = statusSelect.value;
      this.state.warningsFilters.q = textSearch.value;
      this.renderWarningsPage(this.root.querySelector('#page-content'));
    };

    statusSelect?.addEventListener('change', applyFilters);
    textSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
    filterBtn?.addEventListener('click', applyFilters);

    applyWarningBtn?.addEventListener('click', () => {
      this.openApplyWarningModal();
    });

    this.root.querySelectorAll('.view-warn-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const warn = warnings.find(w => w._id === id);
        if (warn) this.openViewWarningModal(warn);
      });
    });
  }

  openViewWarningModal(warn) {
    const statusColors = {
      active: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
      expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    };

    const levelLabels = {
      verbal: 'Advertência Verbal',
      adv1: 'ADV 1',
      adv2: 'ADV 2',
      adv3: 'ADV 3'
    };

    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-rose-500/10 text-rose-500 border border-[var(--border-subtle)] flex items-center justify-center text-sm">
                <i class="fas fa-triangle-exclamation"></i>
              </div>
              <div>
                <h3 class="text-lg font-bold tracking-tight">Detalhes da Advertência</h3>
                <p class="text-xs text-[var(--text-muted)] mt-0.5">Caso ${warn.caseNumber}</p>
              </div>
            </div>
            <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="flex-grow overflow-y-auto p-6 space-y-6">
            <div class="grid grid-cols-2 gap-4 text-xs bg-[var(--card-bg-soft)] p-4 rounded-xl border border-[var(--border-subtle)]">
              <div>
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Policial Punido</p>
                <p class="font-bold text-sm mt-0.5 text-zinc-200">${warn.officerName}</p>
                <p class="text-[10px] text-[var(--text-muted)] mt-0.5">ID Discord: ${warn.userId}</p>
              </div>
              <div>
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Nível da Punição</p>
                <p class="font-bold text-sm mt-0.5 text-zinc-200">${levelLabels[warn.penalty] || warn.penalty}</p>
                <span class="mt-1 inline-block px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${statusColors[warn.status]}">
                  ${warn.status === 'active' ? 'Ativa' : 'Expirada'}
                </span>
              </div>
              <div class="col-span-2 border-t border-[var(--border-subtle)] pt-3">
                <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Período de Vigência</p>
                <p class="text-xs text-zinc-200 mt-1 font-medium">
                  Aplicado em: <strong>${this.formatDateTime(warn.createdAt)}</strong><br>
                  Expiração: <strong>${warn.permanent ? 'Permanente' : this.formatDateTime(warn.expiresAt)}</strong>
                </p>
              </div>
            </div>

            <div>
              <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-rose-500 mb-2">Motivo Administrativo</h4>
              <p class="text-sm text-zinc-200 font-medium pl-3 border-l-2 border-rose-500 whitespace-pre-wrap leading-relaxed">${warn.reason || 'Nenhum motivo registrado.'}</p>
            </div>
          </div>

          <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end gap-2 flex-shrink-0">
            <button class="close-modal-btn btn-soft px-5 py-2.5 rounded-xl text-xs font-semibold">Fechar</button>
          </div>
        </div>
      </div>
    `;
    
    this.setupModalClose();
  }

  async openApplyWarningModal() {
    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl p-8 max-w-lg w-full text-center">
          <i class="fas fa-circle-notch fa-spin text-3xl text-brand-500"></i>
          <p class="text-sm mt-3 text-[var(--text-muted)]">Carregando oficiais para aplicação...</p>
        </div>
      </div>
    `;

    const res = await this.api.fetch('/officers');
    if (!res.success) {
      this.showToast('Erro ao carregar lista de oficiais.', 'error');
      this.modalRoot.innerHTML = '';
      return;
    }

    const officers = res.officers || [];

    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-brand-500/10 text-brand-500 border border-[var(--border-subtle)] flex items-center justify-center text-sm">
                <i class="fas fa-plus"></i>
              </div>
              <div>
                <h3 class="text-lg font-bold tracking-tight">Aplicar Advertência</h3>
                <p class="text-xs text-[var(--text-muted)] mt-0.5">Registre uma nova advertência e aplique o cargo no Discord do oficial.</p>
              </div>
            </div>
            <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <form id="apply-warning-form" class="flex-grow overflow-y-auto p-6 space-y-4">
            <div>
              <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Oficial (Discord ID)</label>
              <select id="warn-user-id" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-semibold">
                <option value="">Selecione o oficial...</option>
                ${officers.map(o => `
                  <option value="${o.id}">${o.displayName || o.username} (${o.username} - ID: ${o.id})</option>
                `).join('')}
              </select>
              <p class="text-[10px] text-[var(--text-muted)] mt-1.5">Ou digite o Discord ID manualmente caso não encontre na lista:</p>
              <input type="text" id="warn-user-id-manual" placeholder="ID do Discord (ex: 1507372654892417075)" class="w-full mt-1.5 px-3 py-2 bg-[var(--card-bg-soft)] rounded-xl text-xs text-zinc-100">
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Nível da Punição</label>
                <select id="warn-level" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-semibold" required>
                  <option value="verbal">Advertência Verbal</option>
                  <option value="adv1">ADV 1</option>
                  <option value="adv2">ADV 2</option>
                  <option value="adv3">ADV 3</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Duração da Advertência</label>
                <select id="warn-duration" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-semibold" required>
                  <option value="d7">7 dias</option>
                  <option value="d15">15 dias</option>
                  <option value="d30">30 dias</option>
                  <option value="d60">60 dias</option>
                  <option value="permanent">Permanente</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Motivo Administrativo</label>
              <textarea id="warn-reason" rows="4" placeholder="Descreva detalhadamente o motivo da punição..." class="w-full px-3 py-2 bg-[var(--card-bg-soft)] rounded-xl text-xs text-zinc-100" required></textarea>
            </div>

            <div class="p-4 rounded-xl border border-rose-500/10 bg-rose-500/5 text-[11px] text-rose-500 leading-relaxed flex gap-2">
              <i class="fas fa-circle-exclamation mt-0.5 flex-shrink-0"></i>
              <span><strong>Atenção:</strong> Ao aplicar, o bot automaticamente atribuirá o cargo correspondente à advertência no Discord do oficial e enviará uma notificação por mensagem privada (DM).</span>
            </div>
          </form>

          <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end gap-2 flex-shrink-0">
            <button class="close-modal-btn btn-soft px-5 py-2.5 rounded-xl text-xs font-semibold">Cancelar</button>
            <button type="submit" form="apply-warning-form" id="submit-warn-btn" class="btn-brand text-xs px-5 py-2.5 rounded-xl transition-all">Aplicar Punição</button>
          </div>
        </div>
      </div>
    `;

    this.setupModalClose();

    const form = this.modalRoot.querySelector('#apply-warning-form');
    const submitBtn = this.modalRoot.querySelector('#submit-warn-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      let userId = this.modalRoot.querySelector('#warn-user-id').value;
      const manualUserId = this.modalRoot.querySelector('#warn-user-id-manual').value.trim();
      
      if (manualUserId) {
        userId = manualUserId;
      }

      if (!userId) {
        this.showToast('Selecione ou digite o Discord ID do oficial.', 'error');
        return;
      }

      const level = this.modalRoot.querySelector('#warn-level').value;
      const duration = this.modalRoot.querySelector('#warn-duration').value;
      const reason = this.modalRoot.querySelector('#warn-reason').value.trim();

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Aplicando...';

      try {
        const res = await this.api.applyWarning(userId, level, duration, reason);

        this.showToast(res.message || 'Advertência aplicada com sucesso!', res.success ? 'success' : 'error');
        if (res.success) {
          this.modalRoot.innerHTML = '';
          this.renderWarningsPage(this.root.querySelector('#page-content'));
        } else {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Aplicar Punição';
        }
      } catch (err) {
        this.showToast('Erro ao comunicar com o servidor.', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Aplicar Punição';
      }
    });
  }

  async renderOfficersPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    try {
      const res = await this.api.fetch('/officers');
      if (!res.success) {
        container.innerHTML = this.templates.errorPage('Erro ao carregar lista de oficiais.');
        return;
      }
      
      const q = this.state.officersSearch || '';
      const filtered = q
        ? res.officers.filter(o => 
            o.displayName.toLowerCase().includes(q.toLowerCase()) || 
            o.username.toLowerCase().includes(q.toLowerCase()) ||
            o.id.includes(q)
          )
        : res.officers;

      container.innerHTML = this.templates.officersPage(filtered, q);
      this.setupOfficersListeners(filtered);
    } catch (err) {
      console.error(err);
      container.innerHTML = this.templates.errorPage('Erro de conexão ao carregar policiais.');
    }
  }

  setupOfficersListeners(officers) {
    const searchInput = this.root.querySelector('#officers-search');
    searchInput?.addEventListener('input', (e) => {
      this.state.officersSearch = e.target.value;
      if (this.state.timers.officersDebounce) clearTimeout(this.state.timers.officersDebounce);
      this.state.timers.officersDebounce = setTimeout(() => {
        this.renderOfficersPage(this.root.querySelector('#page-content'));
      }, 300);
    });

    this.root.querySelectorAll('.view-officer-profile-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.userid;
        await this.openOfficerProfileModal(userId);
      });
    });
  }

  async openOfficerProfileModal(userId, useFilters = false) {
    this.state.lastProfileFiltered = useFilters;
    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl p-8 max-w-lg w-full text-center">
          <i class="fas fa-circle-notch fa-spin text-3xl text-brand-500"></i>
          <p class="text-sm mt-3 text-[var(--text-muted)]">Carregando dossiê de carreira...</p>
        </div>
      </div>
    `;
    try {
      let url = '/officers/' + userId;
      if (useFilters) {
        const { startDate, endDate } = this.state.pontoFilters;
        const params = [];
        if (startDate) params.push(`startDate=${startDate}`);
        if (endDate) params.push(`endDate=${endDate}`);
        if (params.length > 0) {
          url += `?${params.join('&')}`;
        }
      }
      const res = await this.api.fetch(url);
      if (!res.success) {
        this.showToast(res.message || 'Erro ao carregar dossiê.', 'error');
        this.modalRoot.innerHTML = '';
        return;
      }

      this.modalRoot.innerHTML = this.templates.officerProfileModal(res.officer, this.formatDateTime.bind(this));
      this.setupModalClose();
      
      const tabs = this.modalRoot.querySelectorAll('.profile-tab-btn');
      const contents = this.modalRoot.querySelectorAll('.profile-tab-content');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => {
            t.classList.remove('active', 'border-brand-500', 'text-brand-500');
            t.classList.add('border-transparent');
            if (t.dataset.tab === 'admin') {
              t.classList.add('text-rose-400');
            } else {
              t.classList.add('text-[var(--text-muted)]');
            }
          });
          tab.classList.remove('border-transparent', 'text-[var(--text-muted)]', 'text-rose-400');
          tab.classList.add('active', 'border-brand-500', 'text-brand-500');
          
          const target = tab.dataset.tab;
          contents.forEach(c => {
            if (c.id === `tab-content-${target}`) {
              c.classList.remove('hidden');
            } else {
              c.classList.add('hidden');
            }
          });
        });
      });

      const noteForm = this.modalRoot.querySelector('#add-observation-form');
      noteForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textInput = this.modalRoot.querySelector('#obs-text');
        const text = textInput.value.trim();
        if (!text) return;

        const submitBtn = noteForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
          const postRes = await this.api.fetch(`/officers/${userId}/observations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
          });

          if (postRes.success) {
            this.showToast('Anotação registrada com sucesso!', 'success');
            await this.openOfficerProfileModal(userId, this.state.lastProfileFiltered);
          } else {
            this.showToast(postRes.message || 'Erro ao registrar anotação.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i>';
          }
        } catch (err) {
          this.showToast('Erro de rede.', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-plus"></i>';
        }
      });

      const countersForm = this.modalRoot.querySelector('#edit-counters-form');
      countersForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const acoes = parseInt(this.modalRoot.querySelector('#cnt-acoes').value) || 0;
        const apreensoes = parseInt(this.modalRoot.querySelector('#cnt-apreensoes').value) || 0;
        const avaliacoesRealizadas = parseInt(this.modalRoot.querySelector('#cnt-avaliacoesRealizadas').value) || 0;
        const avaliacoesRecebidas = parseInt(this.modalRoot.querySelector('#cnt-avaliacoesRecebidas').value) || 0;

        const submitBtn = countersForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Salvando...';

        try {
          const putRes = await this.api.fetch(`/officers/${userId}/counters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acoes, apreensoes, avaliacoesRealizadas, avaliacoesRecebidas })
          });

          if (putRes.success) {
            this.showToast('Contadores updated com sucesso!', 'success');
            await this.openOfficerProfileModal(userId, this.state.lastProfileFiltered);
          } else {
            this.showToast(putRes.message || 'Erro ao atualizar contadores.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Salvar Contadores';
          }
        } catch (err) {
          this.showToast('Erro de rede.', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Salvar Contadores';
        }
      });
      
    } catch (err) {
      console.error(err);
      this.showToast('Erro ao carregar dados do perfil.', 'error');
      this.modalRoot.innerHTML = '';
    }
  }

  async renderRankingPage(container, silent = false) {
    if (!silent) container.innerHTML = this.templates.loadingDashboard();
    try {
      const res = await this.api.fetch('/officers/ranking');
      if (!res.success) {
        container.innerHTML = this.templates.errorPage('Erro ao carregar rankings.');
        return;
      }
      container.innerHTML = this.templates.rankingPage(res);
      this.setupRankingListeners();
    } catch (err) {
      console.error(err);
      container.innerHTML = this.templates.errorPage('Erro de conexão ao carregar rankings.');
    }
  }

  setupRankingListeners() {
    const tabs = this.root.querySelectorAll('.ranking-tab-btn');
    const leaderboards = this.root.querySelectorAll('.ranking-board');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active', 'border-brand-500', 'text-brand-500', 'bg-brand-500/10'));
        tab.classList.add('active', 'border-brand-500', 'text-brand-500', 'bg-brand-500/10');
        
        const target = tab.dataset.board;
        leaderboards.forEach(board => {
          if (board.id === `board-${target}`) {
            board.classList.remove('hidden');
          } else {
            board.classList.add('hidden');
          }
        });
      });
    });
  }

  // ============================================
  // ACADEMIA / TRAINING MODULE PAGE
  // ============================================
  async renderAcademiaPage(container) {
    container.innerHTML = this.templates.loadingDashboard();
    try {
      const [coursesRes, statsRes, enrollRes] = await Promise.all([
        LSPD.api.getAcademyCourses(),
        LSPD.api.getAcademyStats(),
        LSPD.api.getMyEnrollments()
      ]);

      if (!coursesRes.success) {
        container.innerHTML = this.templates.errorPage('Erro ao carregar a academia.');
        return;
      }

      const stats = statsRes.stats || {};
      const courses = coursesRes.courses || [];
      const enrollments = enrollRes.enrollments || [];
      const enrollMap = {};
      enrollments.forEach(e => { enrollMap[e.courseId?._id || e.courseId] = e; });

      const catLabels = {
        basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado',
        especializacao: 'Especialização', reciclagem: 'Reciclagem'
      };
      const catColors = {
        basico: 'emerald', intermediario: 'brand', avancado: 'amber',
        especializacao: 'violet', reciclagem: 'indigo'
      };

      const statsHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          ${this.templates.summaryCard('Cursos Ativos', stats.totalCourses || 0, 'fa-graduation-cap', 'brand')}
          ${this.templates.summaryCard('Matrículas', stats.totalEnrollments || 0, 'fa-users', 'amber')}
          ${this.templates.summaryCard('Concluídos', stats.completions || 0, 'fa-check-circle', 'emerald')}
          ${this.templates.summaryCard('Taxa de Conclusão', `${stats.completionRate || 0}%`, 'fa-chart-pie', 'violet')}
        </div>
      `;

      const coursesHTML = courses.length === 0 ? `
        <div class="card-premium rounded-2xl p-12 text-center">
          <div class="w-16 h-16 bg-brand-500/10 text-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-graduation-cap text-2xl"></i>
          </div>
          <h3 class="text-lg font-bold mb-2">Nenhum curso cadastrado</h3>
          <p class="text-sm text-[var(--text-muted)] mb-4">Crie o primeiro curso para iniciar a Academia SSP.</p>
          ${this.state.user.isAdmin ? '<button id="create-course-btn" class="btn-brand px-6 py-2.5 rounded-xl text-sm"><i class="fas fa-plus mr-2"></i>Criar Curso</button>' : ''}
        </div>
      ` : `
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          ${courses.map(c => {
            const enr = enrollMap[c._id];
            const catColor = catColors[c.category] || 'brand';
            const catLabel = catLabels[c.category] || c.category;
            const progress = enr ? enr.progress : 0;
            const statusBadge = enr
              ? (enr.status === 'completed'
                ? '<span class="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">Concluído</span>'
                : `<span class="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase">Em progresso (${progress}%)</span>`)
              : '<span class="text-[9px] font-bold text-zinc-400 bg-zinc-500/10 px-2 py-0.5 rounded-full uppercase">Não matriculado</span>';

            return `
              <div class="card-premium rounded-2xl p-5 flex flex-col gap-3 hover:scale-[1.01] transition-transform">
                <div class="flex items-start justify-between">
                  <div class="w-11 h-11 rounded-xl bg-${catColor}-500/10 text-${catColor}-500 flex items-center justify-center">
                    <i class="fas ${c.icon || 'fa-graduation-cap'} text-lg"></i>
                  </div>
                  <span class="text-[9px] font-bold text-${catColor}-500 bg-${catColor}-500/10 px-2 py-0.5 rounded-full uppercase">${catLabel}</span>
                </div>
                <div>
                  <h3 class="text-sm font-bold">${LSPD.utils.escapeHtml(c.title)}</h3>
                  <p class="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">${LSPD.utils.escapeHtml(c.description || 'Sem descrição')}</p>
                </div>
                <div class="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-semibold">
                  <span><i class="fas fa-book-open mr-1"></i>${c.totalModules} módulo(s)</span>
                  <span><i class="fas fa-users mr-1"></i>${c.enrollments} aluno(s)</span>
                  <span><i class="fas fa-check mr-1"></i>${c.completions} concluído(s)</span>
                </div>
                ${enr ? `
                  <div class="w-full bg-[var(--border-subtle)] rounded-full h-1.5">
                    <div class="bg-${catColor}-500 h-1.5 rounded-full transition-all" style="width: ${progress}%"></div>
                  </div>
                ` : ''}
                <div class="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border-subtle)]">
                  ${statusBadge}
                  ${!enr ? `<button class="enroll-btn btn-brand px-3 py-1.5 rounded-lg text-[10px] font-bold" data-course="${c._id}"><i class="fas fa-plus mr-1"></i>Matricular</button>` : `<button class="view-course-btn btn-soft px-3 py-1.5 rounded-lg text-[10px] font-bold" data-course="${c._id}"><i class="fas fa-eye mr-1"></i>Acessar</button>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      container.innerHTML = `
        ${statsHTML}
        <div class="flex items-center justify-between mb-6">
          <div>
            <h3 class="text-base font-bold">Cursos Disponíveis</h3>
            <p class="text-xs text-[var(--text-muted)] mt-0.5">Catálogo de treinamentos e capacitações da corporação.</p>
          </div>
          ${this.state.user.isAdmin ? '<button id="create-course-btn" class="btn-brand px-4 py-2 rounded-xl text-xs font-bold"><i class="fas fa-plus mr-2"></i>Novo Curso</button>' : ''}
        </div>
        ${coursesHTML}
      `;

      this.setupAcademiaListeners();
    } catch (error) {
      console.error('Erro ao carregar academia:', error);
      container.innerHTML = this.templates.errorPage('Erro ao carregar a academia.');
    }
  }

  setupAcademiaListeners() {
    // Enroll buttons
    this.root.querySelectorAll('.enroll-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const courseId = btn.dataset.course;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Matriculando...';
        const res = await LSPD.api.enrollInCourse(courseId);
        if (res.success) {
          this.showToast('Matrícula realizada com sucesso!', 'success');
          await this.renderAcademiaPage(this.root.querySelector('#page-content'));
        } else {
          this.showToast(res.message || 'Erro ao matricular.', 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-plus mr-1"></i>Matricular';
        }
      });
    });

    // View course buttons
    this.root.querySelectorAll('.view-course-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const courseId = btn.dataset.course;
        await this.showCourseDetail(courseId);
      });
    });

    // Create course button
    const createBtn = this.root.querySelector('#create-course-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.showCreateCourseModal());
    }
  }

  async showCourseDetail(courseId) {
    LSPD.modal.showLoading(this.modalRoot, 'Carregando curso...');
    const res = await LSPD.api.getAcademyCourse(courseId);
    if (!res.success) {
      LSPD.modal.close(this.modalRoot);
      this.showToast('Erro ao carregar curso.', 'error');
      return;
    }

    const course = res.course;
    const enrollment = res.enrollment;
    const completedSet = new Set((enrollment?.completedModules || []).map(m => m.moduleIndex));

    const modulesHTML = (course.modules || []).map((mod, i) => {
      const done = completedSet.has(i);
      return `
        <div class="flex items-center gap-3 p-3 rounded-xl ${done ? 'bg-emerald-500/5 border border-emerald-500/15' : 'bg-[var(--card-bg-soft)] border border-[var(--border-subtle)]'}">
          <div class="w-8 h-8 rounded-lg ${done ? 'bg-emerald-500/15 text-emerald-500' : 'bg-[var(--border-subtle)] text-[var(--text-muted)]'} flex items-center justify-center flex-shrink-0 text-xs font-bold">
            ${done ? '<i class="fas fa-check"></i>' : i + 1}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold">${LSPD.utils.escapeHtml(mod.title)}</p>
            ${mod.duration ? `<p class="text-[10px] text-[var(--text-muted)]">${mod.duration} min</p>` : ''}
          </div>
          ${enrollment && !done ? `<button class="complete-module-btn btn-brand px-2.5 py-1 rounded-lg text-[9px] font-bold" data-course="${courseId}" data-module="${i}">Concluir</button>` : ''}
        </div>
      `;
    }).join('');

    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="text-lg font-bold">${LSPD.utils.escapeHtml(course.title)}</h3>
              <p class="text-xs text-[var(--text-muted)] mt-1">${LSPD.utils.escapeHtml(course.description || '')}</p>
            </div>
            <button class="close-modal-btn w-8 h-8 rounded-lg btn-soft flex items-center justify-center"><i class="fas fa-times"></i></button>
          </div>
          ${enrollment ? `
            <div class="mb-4 p-3 rounded-xl bg-brand-500/5 border border-brand-500/15">
              <div class="flex items-center justify-between text-xs mb-2">
                <span class="font-bold">Progresso</span>
                <span class="font-bold text-brand-500">${enrollment.progress}%</span>
              </div>
              <div class="w-full bg-[var(--border-subtle)] rounded-full h-2">
                <div class="bg-brand-500 h-2 rounded-full transition-all" style="width: ${enrollment.progress}%"></div>
              </div>
            </div>
          ` : ''}
          <div class="space-y-2">
            <p class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Módulos do Curso</p>
            ${modulesHTML || '<p class="text-xs text-[var(--text-muted)]">Nenhum módulo cadastrado.</p>'}
          </div>
        </div>
      </div>
    `;

    LSPD.modal.setupClose(this.modalRoot);

    // Complete module handlers
    this.modalRoot.querySelectorAll('.complete-module-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const cId = btn.dataset.course;
        const mIdx = btn.dataset.module;
        const res = await LSPD.api.completeModule(cId, mIdx);
        if (res.success) {
          this.showToast(res.message, 'success');
          await this.showCourseDetail(cId);
          // Refresh main page in background
          const pc = this.root.querySelector('#page-content');
          if (pc) this.renderAcademiaPage(pc);
        } else {
          this.showToast(res.message || 'Erro.', 'error');
          btn.disabled = false;
          btn.innerHTML = 'Concluir';
        }
      });
    });
  }

  showCreateCourseModal() {
    this.modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h3 class="text-lg font-bold">Criar Novo Curso</h3>
              <p class="text-xs text-[var(--text-muted)] mt-1">Preencha os dados do treinamento.</p>
            </div>
            <button class="close-modal-btn w-8 h-8 rounded-lg btn-soft flex items-center justify-center"><i class="fas fa-times"></i></button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1 block">Título</label>
              <input id="course-title" class="w-full px-4 py-2.5 rounded-xl text-sm" placeholder="Ex: Procedimentos de Patrulha" />
            </div>
            <div>
              <label class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1 block">Descrição</label>
              <textarea id="course-desc" rows="3" class="w-full px-4 py-2.5 rounded-xl text-sm" placeholder="Descreva o curso..."></textarea>
            </div>
            <div>
              <label class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1 block">Categoria</label>
              <select id="course-category" class="w-full px-4 py-2.5 rounded-xl text-sm">
                <option value="basico">Básico</option>
                <option value="intermediario">Intermediário</option>
                <option value="avancado">Avançado</option>
                <option value="especializacao">Especialização</option>
                <option value="reciclagem">Reciclagem</option>
              </select>
            </div>
            <div id="modules-container">
              <label class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2 block">Módulos</label>
              <div id="modules-list" class="space-y-2"></div>
              <button id="add-module-btn" class="mt-2 btn-soft px-3 py-1.5 rounded-lg text-[10px] font-bold w-full"><i class="fas fa-plus mr-1"></i>Adicionar Módulo</button>
            </div>
            <button id="save-course-btn" class="w-full btn-brand py-3 rounded-xl text-sm font-bold"><i class="fas fa-save mr-2"></i>Salvar Curso</button>
          </div>
        </div>
      </div>
    `;

    LSPD.modal.setupClose(this.modalRoot);

    let moduleCount = 0;
    const addModule = () => {
      moduleCount++;
      const modulesList = this.modalRoot.querySelector('#modules-list');
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2';
      div.innerHTML = `
        <span class="text-[10px] font-bold text-[var(--text-muted)] w-5">${moduleCount}</span>
        <input class="module-title flex-1 px-3 py-2 rounded-lg text-xs border border-[var(--border-subtle)] bg-transparent" placeholder="Título do módulo" />
        <button class="remove-module-btn w-7 h-7 rounded-lg btn-soft flex items-center justify-center text-rose-500"><i class="fas fa-times text-[10px]"></i></button>
      `;
      div.querySelector('.remove-module-btn').addEventListener('click', () => div.remove());
      modulesList.appendChild(div);
    };

    this.modalRoot.querySelector('#add-module-btn').addEventListener('click', addModule);
    addModule(); // Start with 1 module

    this.modalRoot.querySelector('#save-course-btn').addEventListener('click', async () => {
      const title = this.modalRoot.querySelector('#course-title').value.trim();
      const description = this.modalRoot.querySelector('#course-desc').value.trim();
      const category = this.modalRoot.querySelector('#course-category').value;
      const moduleTitles = [...this.modalRoot.querySelectorAll('.module-title')].map((inp, i) => ({
        title: inp.value.trim(), order: i
      })).filter(m => m.title);

      if (!title) {
        this.showToast('O título é obrigatório.', 'error');
        return;
      }

      const saveBtn = this.modalRoot.querySelector('#save-course-btn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Salvando...';

      const res = await LSPD.api.createAcademyCourse({ title, description, category, modules: moduleTitles });
      if (res.success) {
        this.showToast('Curso criado com sucesso!', 'success');
        LSPD.modal.close(this.modalRoot);
        await this.renderAcademiaPage(this.root.querySelector('#page-content'));
      } else {
        this.showToast(res.message || 'Erro ao criar curso.', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Salvar Curso';
      }
    });
  }

  renderNotFoundPage(container) {
    container.innerHTML = this.templates.notFoundPage();
  }

  // Toast — delegate to LSPD.toast (core/core.js)
  showToast(message, type = 'info') {
    LSPD.toast.show(this.toastRoot, message, type);
  }

  defineTemplates() {
    this.templates = {
      appShell: (user) => {
        const navItems = `
          <a href="#dashboard" class="nav-item flex items-center px-4 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)]">
            <i class="fas fa-chart-line w-5 mr-3"></i> Visão Geral
          </a>
          <a href="#ponto" class="nav-item flex items-center px-4 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)]">
            <i class="fas fa-clock w-5 mr-3"></i> Bate-Ponto
          </a>
          <a href="#ranking" class="nav-item flex items-center px-4 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)]">
            <i class="fas fa-trophy w-5 mr-3"></i> Ranking de Atividade
          </a>
          <a href="#tickets" class="nav-item flex items-center px-4 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)]">
            <i class="fas fa-headset w-5 mr-3"></i> Tickets
          </a>
          <a href="#transcripts" class="nav-item flex items-center px-4 py-3 rounded-xl text-sm font-medium text-[var(--text-muted)]">
            <i class="fas fa-file-invoice w-5 mr-3"></i> Transcripts
          </a>
        `;

        const userCard = `
          <div class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)] px-4 py-4">
            <div class="flex items-center gap-3">
              <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="w-11 h-11 rounded-xl bg-zinc-900 border border-[var(--border-subtle)] flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate">${user.displayName}</p>
                <p class="text-[10px] text-[var(--text-muted)] truncate font-semibold uppercase">${user.isAdmin ? 'Administração SSP' : 'Oficial SSP'}</p>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <button id="logout-btn" class="w-full btn-soft py-1.5 rounded-lg text-xs font-bold hover:text-rose-500 flex items-center justify-center gap-1.5 transition-colors">
                <i class="fas fa-sign-out-alt"></i> Sair
              </button>
            </div>
            <div class="mt-4 flex items-center justify-between text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3">
              <span class="inline-flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Painel Online
              </span>
              <span>v3.0</span>
            </div>
          </div>
        `;

        return `
        <!-- Mobile Sidebar Overlay -->
        <div id="sidebar-overlay" class="sidebar-overlay lg:hidden"></div>

        <!-- Mobile Sidebar (Slide-in) -->
        <aside id="mobile-sidebar" class="mobile-sidebar lg:hidden flex flex-col">
          <div class="h-16 flex items-center justify-between px-5 border-b border-[var(--border-subtle)]">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/25">
                <i class="fas fa-shield-halved text-sm"></i>
              </div>
              <div>
                <h1 class="text-base font-bold tracking-tight">SSP</h1>
                <p class="text-[8px] text-brand-500 font-bold tracking-wider uppercase">Sec. Segurança Pública</p>
              </div>
            </div>
            <button id="mobile-sidebar-close" class="w-8 h-8 rounded-lg btn-soft flex items-center justify-center">
              <i class="fas fa-times text-sm"></i>
            </button>
          </div>
          <div class="p-4 flex-1 overflow-y-auto no-scrollbar">
            <div class="mb-3 px-3"><p class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.25em]">Serviços</p></div>
            <nav class="space-y-1.5">${navItems}</nav>
          </div>
          <div class="p-4 border-t border-[var(--border-subtle)]">${userCard}</div>
        </aside>

        <div class="flex h-screen overflow-hidden">
          <!-- Desktop Sidebar -->
          <aside class="w-72 flex-shrink-0 hidden lg:flex flex-col border-r border-[var(--border-subtle)] bg-[var(--card-bg)]/95 z-20">
            <div class="h-20 flex items-center px-6 border-b border-[var(--border-subtle)]">
              <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white mr-4 shadow-lg shadow-brand-500/25 animate-pulse-slow">
                <i class="fas fa-shield-halved text-lg"></i>
              </div>
              <div>
                <h1 class="text-lg font-bold tracking-tight">SSP</h1>
                <p class="text-[9px] text-brand-500 font-bold tracking-wider uppercase">Secretaria de Segurança Pública</p>
              </div>
            </div>
            <div class="p-5 flex-1 overflow-y-auto no-scrollbar">
              <div class="mb-4 px-3"><p class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.25em] mb-3">Serviços</p></div>
              <nav id="main-nav" class="space-y-2">${navItems}</nav>
            </div>
            <div class="p-5 border-t border-[var(--border-subtle)]">${userCard}</div>
          </aside>

          <!-- Main Content Area -->
          <main class="flex-1 flex flex-col overflow-hidden">
            <header class="h-16 lg:h-20 glass-topbar border-b border-[var(--border-subtle)] flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30 flex-shrink-0">
              <div class="flex items-center gap-3 min-w-0">
                <!-- Mobile Hamburger -->
                <button id="mobile-menu-btn" class="lg:hidden w-10 h-10 rounded-xl btn-soft flex items-center justify-center">
                  <i class="fas fa-bars text-sm"></i>
                </button>
                <div class="min-w-0">
                  <h2 id="page-title" class="text-lg lg:text-2xl font-bold tracking-tight truncate"></h2>
                  <p id="page-subtitle" class="text-[10px] lg:text-xs text-[var(--text-muted)] mt-0.5 font-medium hidden sm:block"></p>
                </div>
              </div>

              <div class="flex items-center gap-2 lg:gap-3">
                ${LSPD.notifications.renderBellHTML()}
                <button id="theme-toggle" class="w-10 h-10 rounded-xl btn-soft flex items-center justify-center shadow-sm" title="Alternar Tema"></button>
              </div>
            </header>

            <div id="page-content" class="flex-1 overflow-y-auto px-4 lg:px-8 pb-10 pt-6 fade-in"></div>
          </main>
        </div>
        `;
      },

      loadingDashboard: () => `
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 playbook-pulse mb-8">
          <div class="h-28 bg-[var(--border-subtle)] rounded-2xl opacity-40 animate-pulse"></div>
          <div class="h-28 bg-[var(--border-subtle)] rounded-2xl opacity-40 animate-pulse"></div>
          <div class="h-28 bg-[var(--border-subtle)] rounded-2xl opacity-40 animate-pulse"></div>
          <div class="h-28 bg-[var(--border-subtle)] rounded-2xl opacity-40 animate-pulse"></div>
        </div>
        <div class="flex flex-col items-center justify-center h-64 text-brand-500">
          <i class="fas fa-circle-notch fa-spin text-3xl"></i>
          <span class="text-xs uppercase tracking-widest font-bold mt-3 text-[var(--text-muted)]">Carregando dados operacionais...</span>
        </div>
      `,

      errorPage: (message) => `
        <div class="flex flex-col items-center justify-center h-72 text-center">
          <div class="w-14 h-14 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mb-4 border border-rose-500/15">
            <i class="fas fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 class="text-lg font-bold mb-1">Falha na consulta</h3>
          <p class="text-sm text-[var(--text-muted)]">${message}</p>
        </div>
      `,

      dashboardPage: (summary) => `
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          ${this.templates.summaryCard('Oficiais em Serviço', summary.pontosAbertos || 0, 'fa-user-clock', 'emerald')}
          ${this.templates.summaryCard('Tickets Abertos', summary.ticketsAbertos || 0, 'fa-headset', 'brand')}
          ${this.templates.summaryCard('Transcripts Salvos', summary.totalTranscripts, 'fa-file-invoice', 'indigo')}
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="xl:col-span-2 card-premium rounded-2xl p-6">
            <div class="mb-4">
              <h3 class="font-bold text-base">Solicitações Recentes (Últimos 7 dias)</h3>
              <p class="text-xs text-[var(--text-muted)] mt-1">Estatísticas consolidadas de formulários submetidos.</p>
            </div>
            <div class="h-80">
              <canvas id="activity-chart"></canvas>
            </div>
          </div>

          <div class="card-premium rounded-2xl p-6 flex flex-col">
            <div class="mb-4">
              <h3 class="font-bold text-base">Distribuição de Serviços</h3>
              <p class="text-xs text-[var(--text-muted)] mt-1">Proporção dos tipos de serviço demandados.</p>
            </div>
            <div class="h-60 relative flex items-center justify-center">
              <canvas id="distribution-chart"></canvas>
            </div>
          </div>
        </div>

        <div class="mt-6 card-premium rounded-2xl p-6">
          <div class="mb-4">
            <h3 class="font-bold text-base">Registro de Atividades Recentes</h3>
            <p class="text-xs text-[var(--text-muted)] mt-1">Últimas transações administrativas e novos registros inseridos no banco.</p>
          </div>
          <div id="activity-feed" class="space-y-4 pr-1 max-h-[350px] overflow-y-auto"></div>
        </div>
      `,

      summaryCard: (title, value, icon, tone) => {
        const toneMap = {
          brand: 'bg-brand-500/10 text-brand-500 border-brand-500/20',
          amber: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
          emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
          violet: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
          indigo: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
          rose: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
        };

        return `
          <div class="card-premium rounded-2xl p-5 animate-fade-in-up" data-summary-title="${title}">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] mb-2">${title}</p>
                <h4 class="text-3xl font-extrabold tracking-tight summary-value">${value}</h4>
              </div>
              <div class="w-12 h-12 rounded-2xl border flex items-center justify-center ${toneMap[tone]}">
                <i class="fas ${icon} text-lg"></i>
              </div>
            </div>
          </div>
        `;
      },

      activityFeedItem: (item, formatDateTime) => {
        const typeConfig = {
          cadastro: { icon: 'fa-user-plus', color: 'bg-brand-500/10 text-brand-500 border-brand-500/20' },
          solicitacao_enviada: { icon: 'fa-paper-plane', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
          solicitacao_decidida: { icon: 'fa-gavel', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
          ticket_aberto: { icon: 'fa-folder-open', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
          ticket_fechado: { icon: 'fa-folder', color: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' },
          ticket_assumido: { icon: 'fa-user-check', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
          ticket_editado: { icon: 'fa-pen-to-square', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
          ticket_reaberto: { icon: 'fa-folder-open', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
          ticket_excluido: { icon: 'fa-trash', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
          ticket_mensagem: { icon: 'fa-message', color: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
          ticket_agendado: { icon: 'fa-calendar-days', color: 'bg-violet-500/10 text-violet-500 border-violet-500/20' },
          transcript_visualizado: { icon: 'fa-file-code', color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
          transcript_excluido: { icon: 'fa-file-circle-xmark', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
          relatorio_exportado: { icon: 'fa-file-export', color: 'bg-teal-500/10 text-teal-500 border-teal-500/20' },
          voz_criada: { icon: 'fa-microphone', color: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
          membro_gerenciado: { icon: 'fa-users-gear', color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
          config_atualizada: { icon: 'fa-sliders', color: 'bg-violet-500/10 text-violet-500 border-violet-500/20' },
          ponto_criado: { icon: 'fa-clock', color: 'bg-brand-500/10 text-brand-500 border-brand-500/20' },
          ponto_editado: { icon: 'fa-clock-rotate-left', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
          ponto_fechado: { icon: 'fa-stopwatch', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
          ponto_excluido: { icon: 'fa-trash-can', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
          corregedoria_fechada: { icon: 'fa-scale-balanced', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
          corregedoria_editada: { icon: 'fa-file-pen', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
          corregedoria_excluida: { icon: 'fa-file-circle-xmark', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
          painel_acao: { icon: 'fa-terminal', color: 'bg-teal-500/10 text-teal-500 border-teal-500/20' },
          auth: { icon: 'fa-key', color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' },
          ausencia_decidida: { icon: 'fa-calendar-check', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
          warning_aplicada: { icon: 'fa-triangle-exclamation', color: 'bg-rose-500/10 text-rose-500 border-rose-500/20' }
        };
        const config = typeConfig[item.type] || { icon: 'fa-clipboard-list', color: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' };

        return `
          <div class="flex items-start gap-3 border-b border-[var(--border-subtle)] pb-3 last:border-0 last:pb-0">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${config.color}">
              <i class="fas ${config.icon} text-xs"></i>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm leading-relaxed">
                <span class="font-bold text-zinc-200">${item.title}</span>
                <span class="text-[var(--text-muted)]">- ${item.description}</span>
              </p>
              <p class="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-2">
                <span class="inline-flex items-center gap-1"><i class="far fa-user text-[10px]"></i> @${item.username || 'Sistema'}</span>
                <span>•</span>
                <span class="inline-flex items-center gap-1"><i class="far fa-clock text-[10px]"></i> ${formatDateTime(item.timestamp)}</span>
              </p>
            </div>
          </div>
        `;
      },

      cidadaosPage: (cidadaos, search) => `
        <div class="card-premium rounded-2xl overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 class="text-xl font-bold tracking-tight">Banco de Fichas de Oficiais e Cidadãos</h3>
              <p class="text-sm text-[var(--text-muted)] mt-1">Busque registros, visualize dados cadastrais e o histórico de solicitações.</p>
            </div>
            <div class="flex items-center gap-2 p-1.5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] w-full sm:w-80">
              <i class="fas fa-magnifying-glass text-[var(--text-muted)] ml-2 text-xs"></i>
              <input type="text" id="cidadaos-search" placeholder="Buscar por Nome ou Discord..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-full" value="${search || ''}">
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Cidadão / Policial</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Corporação</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Batalhão</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Citizen ID</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Discord</th>
                  <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                ${cidadaos.length
                  ? cidadaos.map(c => `
                    <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                      <td class="p-4 px-6 font-semibold text-zinc-200">
                        ${c.nomeSobrenome || c.username}
                      </td>
                      <td class="p-4 px-6 font-semibold text-zinc-200">
                        ${c.corporacao === 'PMESP' 
                          ? '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-blue-500/10 text-blue-400 border-blue-500/20 inline-flex items-center gap-1"><i class="fas fa-shield-halved"></i> PMESP</span>'
                          : (c.corporacao === 'PCESP'
                            ? '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-red-500/10 text-red-400 border-red-500/20 inline-flex items-center gap-1"><i class="fas fa-shield-halved"></i> PCESP</span>'
                            : `<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-zinc-500/10 text-zinc-400 border-zinc-500/20 inline-flex items-center gap-1">${c.corporacao || 'SSP'}</span>`
                          )
                        }
                      </td>
                      <td class="p-4 px-6 font-semibold text-zinc-200">
                        ${c.batalhao
                          ? (() => {
                              const bat = c.batalhao.toUpperCase();
                              if (bat.includes('ROTA')) return '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-zinc-800 text-zinc-200 border-zinc-700 inline-flex items-center gap-1"><i class="fas fa-crosshairs text-[10px]"></i> ROTA</span>';
                              if (bat.includes('BAEP')) return '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-amber-500/10 text-amber-400 border-amber-500/20 inline-flex items-center gap-1"><i class="fas fa-burst text-[10px]"></i> BAEP</span>';
                              if (bat.includes('BPRV')) return '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1"><i class="fas fa-road text-[10px]"></i> BPRV</span>';
                              if (bat.includes('CAV')) return '<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-sky-500/10 text-sky-400 border-sky-500/20 inline-flex items-center gap-1"><i class="fas fa-helicopter text-[10px]"></i> CAvPM</span>';
                              return `<span class="px-2.5 py-0.5 text-[9px] font-extrabold uppercase rounded-lg border bg-indigo-500/10 text-indigo-400 border-indigo-500/20 inline-flex items-center gap-1"><i class="fas fa-bookmark text-[10px]"></i> ${c.batalhao}</span>`;
                            })()
                          : '<span class="text-[var(--text-muted)] font-medium">-</span>'
                        }
                      </td>
                      <td class="p-4 px-6 text-sm text-[var(--text-muted)] font-mono">${c.idCidade || 'N/A'}</td>
                      <td class="p-4 px-6 text-sm text-zinc-300 font-medium">@${c.username}</td>
                      <td class="p-4 px-6 text-right">
                        <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button class="view-dossier-btn btn-brand text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-userid="${c.userId}">
                            <i class="fas fa-folder-open text-[10px]"></i> Ver Dossiê
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')
                  : `
                    <tr>
                      <td colspan="6" class="text-center p-12 text-[var(--text-muted)]">
                        <i class="fas fa-inbox text-3xl mb-3 block opacity-30"></i>
                        Nenhum oficial SSP encontrado.
                      </td>
                    </tr>
                  `
                }
              </tbody>
            </table>
          </div>
        </div>
      `,

      solicitacoesPage: (sols, filters) => `
        <div class="card-premium rounded-2xl overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h3 class="text-xl font-bold tracking-tight">Mesa de Análise Operacional</h3>
              <p class="text-sm text-[var(--text-muted)] mt-1">Revise as respostas e altere o status das solicitações recebidas.</p>
            </div>

            <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
              <select id="sol-modulo" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                <option value="" ${filters.modulo === '' ? 'selected' : ''}>Todos os Módulos</option>
                <option value="porte" ${filters.modulo === 'porte' ? 'selected' : ''}>Porte de Arma</option>
                <option value="paraguaio" ${filters.modulo === 'paraguaio' ? 'selected' : ''}>Passaporte Paraguaio</option>
                <option value="recrutamento" ${filters.modulo === 'recrutamento' ? 'selected' : ''}>Recrutamento (Edital)</option>
              </select>
              <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
              <select id="sol-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                <option value="pendente" ${filters.status === 'pendente' ? 'selected' : ''}>Pendentes</option>
                <option value="aprovado" ${filters.status === 'aprovado' ? 'selected' : ''}>Aprovados</option>
                <option value="reprovado" ${filters.status === 'reprovado' ? 'selected' : ''}>Reprovados</option>
              </select>
              <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
              <input type="text" id="sol-search" placeholder="Buscar por cidadão..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-40 px-2" value="${filters.q || ''}">
              <button id="sol-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Cidadão</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Módulo</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Sub-Tipo</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Status</th>
                  <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Gestão</th>
                </tr>
              </thead>
              <tbody id="solicitacoes-table-body" class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                ${sols.length
                  ? sols.map(s => {
                      const statusColors = {
                        pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
                        aprovado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                        reprovado: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                      };

                      let moduleHtml = '';
                      if (s.modulo === 'porte') {
                        moduleHtml = `<i class="fas fa-gun mr-1 text-brand-400"></i> Porte de Arma`;
                      } else if (s.modulo === 'recrutamento') {
                        moduleHtml = `<i class="fas fa-user-tie mr-1 text-indigo-400"></i> Recrutamento`;
                      } else {
                        moduleHtml = `<i class="fas fa-passport mr-1 text-violet-400"></i> Visto Paraguaio`;
                      }

                      return `
                        <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                          <td class="p-4 px-6 font-semibold">
                            <div class="font-semibold text-sm text-zinc-200">${s.nomeSobrenome}</div>
                            <div class="text-xs text-[var(--text-muted)]">Citizen: ${s.idCidade}</div>
                          </td>
                          <td class="p-4 px-6 text-sm text-zinc-300 font-medium">
                            ${moduleHtml}
                          </td>
                          <td class="p-4 px-6 text-sm text-[var(--text-muted)]">${s.tipo}</td>
                          <td class="p-4 px-6 text-center">
                            <span class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] rounded-xl border ${statusColors[s.status]}">
                              ${s.status}
                            </span>
                          </td>
                          <td class="p-4 px-6 text-right">
                            <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                              ${s.status === 'aprovado' && s.ticketChannelId && s.ticketChannelId !== 'reprovado_discord_done' && s.ticketChannelId !== 'finalizado_done' ? `
                                <button class="open-chat-btn w-9 h-9 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-brand-500 hover:bg-brand-500/10 inline-flex items-center justify-center transition-colors" data-channel-id="${s.ticketChannelId}" data-title="${s.nomeSobrenome}">
                                  <i class="fas fa-comments text-xs"></i>
                                </button>
                              ` : ''}
                              <button class="analyse-sol-btn btn-brand text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-id="${s._id}">
                                <i class="fas fa-magnifying-glass"></i> ${s.status === 'pendente' ? 'Analisar' : 'Visualizar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')
                  : `
                    <tr>
                      <td colspan="5" class="text-center p-12 text-[var(--text-muted)]">
                        <i class="fas fa-file-signature text-3xl mb-3 block opacity-30"></i>
                        Nenhuma solicitação nesta categoria.
                      </td>
                    </tr>
                  `
                }
              </tbody>
            </table>
          </div>
        </div>
      `,

      dossierModal: (cidadao, sols, formatDateTime) => `
        <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
          <div class="card-premium rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
            <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-500 border border-[var(--border-subtle)] flex items-center justify-center text-lg">
                  <i class="fas fa-id-card-clip"></i>
                </div>
                <div>
                  <h3 class="text-lg font-bold tracking-tight">${cidadao.nomeSobrenome}</h3>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">Citizen: <span id="modal-display-citizen-id">${cidadao.idCidade}</span> | Discord: @${cidadao.username}</p>
                </div>
              </div>
              <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="flex-grow overflow-y-auto p-6 space-y-6">
              <div>
                <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-3">Informações Cadastrais</h4>
                <div class="grid grid-cols-2 gap-4 text-xs bg-[var(--card-bg-soft)] p-4 rounded-xl border border-[var(--border-subtle)]">
                  <div>
                    <p class="text-xs text-[var(--text-muted)]">Discord ID</p>
                    <p class="font-semibold text-zinc-200 mt-0.5">${cidadao.userId}</p>
                  </div>
                  <div>
                    <p class="text-xs text-[var(--text-muted)]">Data de Registro</p>
                    <p class="font-semibold text-zinc-200 mt-0.5">${formatDateTime(cidadao.createdAt)}</p>
                  </div>
                  <div class="col-span-2 border-t border-[var(--border-subtle)]/50 pt-3">
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-bold mb-2">Passaporte / Citizen ID</p>
                    <div class="flex gap-2">
                      <input type="text" id="edit-dossier-citizen-id" value="${cidadao.idCidade && cidadao.idCidade !== 'N/A' && cidadao.idCidade !== 'Discord' ? cidadao.idCidade : ''}" placeholder="Preencha o ID do passaporte..." class="w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100 font-semibold" />
                      <button id="save-dossier-citizen-id-btn" class="bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-500/10 active:scale-98 flex items-center justify-center gap-1.5" data-userid="${cidadao.userId}">
                        <i class="fas fa-save"></i> Salvar
                      </button>
                    </div>
                    <p class="text-[9px] text-[var(--text-muted)] mt-1.5"><i class="fas fa-circle-info"></i> Preencha o passaporte do oficial SSP para permitir a sincronização e identificação correta.</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-3">Histórico de Solicitações</h4>
                <div class="space-y-3">
                  ${sols.length
                    ? sols.map(s => {
                        const statusBadges = {
                          pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/10',
                          aprovado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/10',
                          reprovado: 'bg-rose-500/10 text-rose-500 border-rose-500/10'
                        };

                        return `
                          <div class="border border-[var(--border-subtle)] p-4 rounded-xl space-y-2 bg-[var(--card-bg)] shadow-sm">
                            <div class="flex justify-between items-center">
                              <span class="font-semibold text-xs text-zinc-200">
                                ${s.modulo === 'porte' ? 'Porte de Arma' : (s.modulo === 'recrutamento' ? 'Recrutamento' : 'Visto Paraguaio')} (${s.tipo})
                              </span>
                              <span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${statusBadges[s.status]}">
                                ${s.status}
                              </span>
                            </div>
                            <p class="text-[10px] text-[var(--text-muted)] font-medium">Submetida em: ${formatDateTime(s.createdAt)}</p>
                            ${s.status === 'reprovado' ? `
                              <div class="mt-2 text-xs text-rose-500 bg-rose-500/5 p-2 rounded-lg border border-rose-500/10">
                                <strong>Motivo da Reprovação:</strong> ${s.motivoReprovacao || 'Nenhum motivo informado.'}
                              </div>
                            ` : ''}
                          </div>
                        `;
                      }).join('')
                    : `
                      <p class="text-center py-6 text-[var(--text-muted)] text-sm border border-dashed border-[var(--border-subtle)] rounded-xl">
                        Nenhum formulário submetido por este cidadão.
                      </p>
                    `
                  }
                </div>
              </div>
            </div>

            <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end flex-shrink-0">
              <button class="close-modal-btn btn-soft px-5 py-2 rounded-xl text-xs font-semibold">Fechar Dossiê</button>
            </div>
          </div>
        </div>
      `,

      analyseModal: (sol, formatDateTime) => {
        const statusBadges = {
          pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
          aprovado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          reprovado: 'bg-rose-500/10 text-rose-500 border-rose-500/15'
        };

        return `
          <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
            <div class="card-premium rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
              <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
                <div class="flex items-center gap-3">
                  <div class="w-11 h-11 rounded-xl bg-brand-500/10 text-brand-500 border border-[var(--border-subtle)] flex items-center justify-center text-sm">
                    <i class="fas fa-file-lines"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold tracking-tight">Análise de Pedido</h3>
                    <p class="text-xs text-[var(--text-muted)] mt-0.5">Enviado em ${formatDateTime(sol.createdAt)}</p>
                  </div>
                </div>
                <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
                  <i class="fas fa-times"></i>
                </button>
              </div>

              <div class="flex-grow overflow-y-auto p-6 space-y-6">
                <div class="grid grid-cols-3 gap-4 text-xs bg-[var(--card-bg-soft)] p-4 rounded-xl border border-[var(--border-subtle)]">
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Nome Completo</p>
                    <p class="font-bold text-sm mt-0.5 text-zinc-200">${sol.nomeSobrenome}</p>
                  </div>
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Citizen</p>
                    <p class="font-bold text-sm mt-0.5 text-zinc-200">${sol.idCidade}</p>
                  </div>
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Serviço Solicitado</p>
                    <p class="font-bold text-sm mt-0.5 capitalize text-zinc-200">${sol.modulo === 'porte' ? 'Porte de Arma' : (sol.modulo === 'recrutamento' ? 'Recrutamento (Edital)' : 'Passaporte/Visto')}</p>
                  </div>
                </div>

                <div>
                  <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-3">Respostas do Formulário</h4>
                  <div class="space-y-4">
                    ${sol.respostas.map((r, i) => `
                      <div class="border-b border-[var(--border-subtle)] pb-3 last:border-0">
                        <p class="text-xs font-semibold text-zinc-300">Questão ${i + 1}: ${r.pergunta}</p>
                        <p class="text-sm mt-1.5 text-zinc-200 font-medium pl-3 border-l-2 border-brand-500 whitespace-pre-wrap leading-relaxed">${r.resposta}</p>
                      </div>
                    `).join('')}
                  </div>
                </div>

                ${sol.status !== 'pendente' ? `
                  <div class="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 text-sm space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="font-bold">Decisão Final:</span>
                      <span class="px-2 py-0.5 text-xs font-bold uppercase rounded border ${statusBadges[sol.status]}">${sol.status}</span>
                    </div>
                    ${sol.status === 'aprovado' ? `
                      <p class="text-xs text-[var(--text-muted)]">Aprovado por: <strong>${sol.aprovadoPor || 'Oficial SSP'}</strong></p>
                    ` : `
                      <p class="text-xs text-[var(--text-muted)]">Reprovado por: <strong>${sol.reprovadoPor || 'Oficial SSP'}</strong></p>
                      <div class="p-2 rounded-lg border border-rose-500/10 bg-rose-500/5 text-rose-500 text-xs mt-1">
                        <strong>Motivo informado:</strong> ${sol.motivoReprovacao || 'Nenhum motivo informado.'}
                      </div>
                    `}
                  </div>
                ` : `
                  <div class="border-t border-[var(--border-subtle)] pt-4 space-y-3">
                    <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em]">Motivo da Reprovação (Obrigatório apenas caso reprove)</label>
                    <input type="text" id="reject-reason-input" placeholder="Justifique a reprovação aqui..." class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-sm text-zinc-100">
                  </div>
                `}
              </div>

              <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end gap-2 flex-shrink-0">
                <button class="close-modal-btn btn-soft px-5 py-2.5 rounded-xl text-xs font-semibold">Fechar</button>
                ${sol.status === 'pendente' ? `
                  <button id="reject-btn" class="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-colors">Reprovar Pedido</button>
                  <button id="approve-btn" class="btn-brand text-xs px-5 py-2.5 rounded-xl transition-all">Aprovar Pedido</button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      },

      pontoPage: (stats, pontos, filters, officers = [], roles = []) => {
        const ranking = stats.ranking || [];
        return `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            ${this.templates.summaryCard('Oficiais em Serviço', stats.activeOfficers || 0, 'fa-user-clock', 'brand')}
            ${this.templates.summaryCard('Total Patrulhado (Horas)', stats.totalPatrolTimeHours || 0, 'fa-clock', 'emerald')}
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div class="card-premium rounded-2xl p-6 flex flex-col h-fit">
              <div class="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <h3 class="font-bold text-base"><i class="fas fa-trophy text-amber-500 mr-2"></i>Top 10 Patrulha</h3>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">Carga horária acumulada dos oficiais.</p>
                </div>
              </div>
              <div class="space-y-3.5">
                ${ranking.length 
                  ? ranking.map((r, i) => {
                      const trophyColors = ['text-amber-400', 'text-zinc-400', 'text-amber-600'];
                      const trophy = i < 3 
                        ? `<i class="fas fa-trophy ${trophyColors[i]} text-xs mr-1"></i>` 
                        : `<span class="text-zinc-500 font-bold text-xs mr-2 w-4 inline-block">#${i+1}</span>`;
                      return `
                        <div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
                          <div class="flex items-center min-w-0">
                            ${trophy}
                            <span class="font-semibold text-xs text-zinc-200 truncate">${r.username}</span>
                          </div>
                          <div class="text-right flex-shrink-0 ml-2">
                            <span class="text-xs font-bold text-brand-400">${this.formatDuration(r.totalMs)}</span>
                            <p class="text-[9px] text-[var(--text-muted)]">${r.shiftsCount} turnos</p>
                          </div>
                        </div>
                      `;
                    }).join('')
                  : `<p class="text-xs text-[var(--text-muted)] text-center py-6">Nenhum dado de ranking acumulado.</p>`
                }
              </div>
            </div>

            <div class="xl:col-span-2 card-premium rounded-2xl overflow-hidden flex flex-col">
              <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <h3 class="text-base font-bold tracking-tight">Histórico de Turnos</h3>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">Histórico eletrônico detalhado de entrada e saída.</p>
                </div>
                <!-- Toggle Tab Buttons -->
                <div class="flex bg-zinc-950/40 p-1 rounded-xl border border-[var(--border-subtle)] w-fit self-start sm:self-center">
                  <button id="ponto-btn-records" class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${this.state.pontoActiveTab !== 'officers' ? 'bg-brand-500 text-white shadow-md' : 'text-[var(--text-muted)] hover:text-zinc-200'}">Registros</button>
                  <button id="ponto-btn-officers" class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${this.state.pontoActiveTab === 'officers' ? 'bg-brand-500 text-white shadow-md' : 'text-[var(--text-muted)] hover:text-zinc-200'}">Fichas de Oficiais</button>
                </div>
              </div>

              <!-- Filtros Avançados -->
              <div class="p-5 border-b border-[var(--border-subtle)]/70 bg-zinc-950/10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                
                <!-- Oficial -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Filtrar Oficial</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1 flex items-center">
                    <i class="fas fa-user-shield text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <select id="ponto-officer" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1 w-full pl-0 focus:outline-none select-clean">
                      <option value="" ${filters.userId === '' ? 'selected' : ''}>Todos os Membros</option>
                      ${officers.map(o => `
                        <option value="${o.id}" ${filters.userId === o.id ? 'selected' : ''}>${o.displayName} (${o.username})</option>
                      `).join('')}
                    </select>
                  </div>
                </div>

                <!-- Patente -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Filtrar Patente</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1 flex items-center">
                    <i class="fas fa-tags text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <select id="ponto-role" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1 w-full pl-0 focus:outline-none select-clean">
                      <option value="" ${filters.roleId === '' ? 'selected' : ''}>Todas as Patentes</option>
                      ${roles.map(r => `
                        <option value="${r.id}" ${filters.roleId === r.id ? 'selected' : ''}>${r.name}</option>
                      `).join('')}
                    </select>
                  </div>
                </div>

                <!-- Corporação -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Corporação</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1 flex items-center">
                    <i class="fas fa-shield-halved text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <select id="ponto-corporation" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1 w-full pl-0 focus:outline-none select-clean">
                      <option value="" ${filters.corporationSlug === '' ? 'selected' : ''}>Todas</option>
                      <option value="pmesp" ${filters.corporationSlug === 'pmesp' ? 'selected' : ''}>PMESP</option>
                      <option value="pcesp" ${filters.corporationSlug === 'pcesp' ? 'selected' : ''}>PCESP</option>
                    </select>
                  </div>
                </div>

                <!-- Status -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Filtrar Status</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1 flex items-center">
                    <i class="fas fa-toggle-on text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <select id="ponto-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1 w-full pl-0 focus:outline-none select-clean">
                      <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                      <option value="aberto" ${filters.status === 'aberto' ? 'selected' : ''}>Abertos</option>
                      <option value="fechado" ${filters.status === 'fechado' ? 'selected' : ''}>Fechados</option>
                    </select>
                  </div>
                </div>

                <!-- Período De -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Período: De</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 flex items-center">
                    <i class="fas fa-calendar-alt text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <input type="date" id="ponto-start-date" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-0.5 w-full pl-0 focus:outline-none" value="${filters.startDate || ''}">
                  </div>
                </div>

                <!-- Período Até -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Período: Até</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 flex items-center">
                    <i class="fas fa-calendar-alt text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <input type="date" id="ponto-end-date" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-0.5 w-full pl-0 focus:outline-none" value="${filters.endDate || ''}">
                  </div>
                </div>

                <!-- Pesquisa -->
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Buscar Texto</label>
                  <div class="bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)] px-3 py-1 flex items-center">
                    <i class="fas fa-search text-[var(--text-muted)] mr-2 flex-shrink-0"></i>
                    <input type="text" id="ponto-search" placeholder="Policial ou ID..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1 w-full pl-0 focus:outline-none" value="${filters.q || ''}">
                  </div>
                </div>

                <!-- Botão Filtrar -->
                <div class="sm:col-span-2 md:col-span-3 flex justify-end mt-2">
                  <button id="ponto-apply-filter" class="w-full sm:w-auto bg-brand-500 hover:bg-brand-600 text-white text-xs px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all">
                    <i class="fas fa-filter"></i> Aplicar Filtros Avançados
                  </button>
                </div>
              </div>

              <div class="p-4 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/30 flex gap-2 justify-end">
                <button id="export-ponto-xlsx" class="btn-soft text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:text-emerald-500">
                  <i class="fas fa-file-excel"></i> Exportar XLSX
                </button>
                <button id="export-ponto-pdf" class="btn-soft text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:text-rose-500">
                  <i class="fas fa-file-pdf"></i> Exportar PDF
                </button>
              </div>

              ${this.state.pontoActiveTab === 'officers'
                ? `
                  <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto no-scrollbar">
                    ${(() => {
                      // Filter officers
                      let filtered = officers;
                      if (filters.userId) {
                        filtered = filtered.filter(o => o.id === filters.userId);
                      }
                      if (filters.roleId) {
                        filtered = filtered.filter(o => o.roles && o.roles.includes(filters.roleId));
                      }
                      if (filters.q) {
                        const query = filters.q.toLowerCase();
                        filtered = filtered.filter(o => 
                          o.displayName.toLowerCase().includes(query) || 
                          o.username.toLowerCase().includes(query) || 
                          o.id.includes(query)
                        );
                      }
                      if (filters.status) {
                        const activeUserIds = new Set(pontos.filter(p => p.status === filters.status).map(p => p.userId));
                        filtered = filtered.filter(o => activeUserIds.has(o.id));
                      }

                      // Calculate filtered stats
                      const statsMap = {};
                      filtered.forEach(o => {
                        statsMap[o.id] = { durationMs: 0, shiftsCount: 0 };
                      });
                      pontos.forEach(p => {
                        if (statsMap[p.userId]) {
                          if (p.status === 'fechado' && p.durationMs) {
                            statsMap[p.userId].durationMs += p.durationMs;
                          }
                          statsMap[p.userId].shiftsCount += 1;
                        }
                      });

                      if (!filtered.length) {
                        return `
                          <div class="col-span-full text-center py-12 text-[var(--text-muted)]">
                            <i class="fas fa-users-slash text-3xl mb-2 block opacity-30"></i>
                            Nenhum oficial encontrado com os filtros aplicados.
                          </div>
                        `;
                      }

                      return filtered.map(o => {
                        const oStats = statsMap[o.id] || { durationMs: 0, shiftsCount: 0 };
                        const totalHours = oStats.durationMs / (1000 * 60 * 60);
                        const avatarUrl = o.avatar ? `https://cdn.discordapp.com/avatars/${o.id}/${o.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
                        const officerRoles = o.roles.map(roleId => roles.find(r => r.id === roleId)).filter(Boolean);
                        
                        return `
                          <div class="view-ponto-officer-btn cursor-pointer card-premium rounded-xl p-5 flex flex-col justify-between border border-[var(--border-subtle)] bg-[var(--card-bg)] hover:border-brand-500/50 hover:shadow-lg transition-all duration-300 relative group animate-fade-in" data-user-id="${o.id}">
                            <div class="absolute top-4 right-4 text-zinc-500 group-hover:text-brand-400 transition-colors">
                              <i class="fas fa-arrow-up-right-from-square text-xs"></i>
                            </div>
                            
                            <div class="flex items-center gap-3 min-w-0">
                              <img src="${avatarUrl}" class="w-12 h-12 rounded-xl object-cover border border-[var(--border-subtle)] shadow-md group-hover:border-brand-500/40 transition-all flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                              <div class="min-w-0 flex-1">
                                <h4 class="font-bold text-zinc-100 group-hover:text-brand-400 transition-colors text-sm truncate">${o.displayName}</h4>
                                <p class="text-[10px] text-[var(--text-muted)] truncate">@${o.username}</p>
                                <p class="text-[9px] text-[var(--text-muted)] font-mono">ID: ${o.id}</p>
                              </div>
                            </div>
                            
                            <div class="flex flex-wrap gap-1 mt-3">
                              ${officerRoles.length 
                                ? officerRoles.map(r => {
                                    const color = r.color ? '#' + r.color.toString(16).padStart(6, '0') : '#949ba4';
                                    return `<span class="px-2 py-0.5 text-[9px] font-extrabold rounded-md border" style="color: ${color}; background-color: ${color}15; border-color: ${color}25">${r.name}</span>`;
                                  }).join('')
                                : `<span class="px-2 py-0.5 text-[9px] font-extrabold rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)]">Sem Cargo</span>`
                              }
                            </div>
                            
                            <div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-[var(--border-subtle)]/40">
                              <div class="bg-zinc-950/20 rounded-lg p-2 text-center">
                                <p class="text-[8px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Total Horas</p>
                                <p class="text-xs font-black text-emerald-400 mt-0.5">${totalHours.toFixed(1)}h</p>
                              </div>
                              <div class="bg-zinc-950/20 rounded-lg p-2 text-center">
                                <p class="text-[8px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Turnos</p>
                                <p class="text-xs font-black text-brand-400 mt-0.5">${oStats.shiftsCount}</p>
                              </div>
                            </div>
                          </div>
                        `;
                      }).join('');
                    })()}
                  </div>
                `
                : `
                  <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                        <tr>
                          <th class="px-5 py-3 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Oficial</th>
                          <th class="px-5 py-3 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Corp.</th>
                          <th class="px-5 py-3 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Entrada</th>
                          <th class="px-5 py-3 text-left font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Saída</th>
                          <th class="px-5 py-3 text-center font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Duração</th>
                          <th class="px-5 py-3 text-right font-bold text-[var(--text-muted)] uppercase tracking-wider text-[9px]">Status</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                        ${pontos.length
                          ? pontos.map(p => {
                              const badge = p.status === 'aberto'
                                ? `<span class="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Em patrulha</span>`
                                : `<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-zinc-500/10 text-zinc-400 border-zinc-500/20">Fechado</span>`;
                              return `
                                <tr class="hover:bg-[var(--card-bg-soft)]/50 transition-colors">
                                  <td class="p-3 px-5 font-semibold text-zinc-200">
                                    <button class="view-ponto-officer-btn text-brand-400 hover:text-brand-300 font-bold hover:underline text-left focus:outline-none" data-user-id="${p.userId}">
                                      ${p.username}
                                    </button>
                                    <p class="text-[9px] text-[var(--text-muted)] font-normal">${p.userId}</p>
                                  </td>
                                  <td class="p-3 px-5">${(p.corporationSlug || 'pmesp') === 'pmesp' ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">PMESP</span>' : '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-red-500/10 text-red-400 border-red-500/20">PCESP</span>'}</td>
                                  <td class="p-3 px-5 text-[var(--text-muted)]">${this.formatDateTime(p.entrada)}</td>
                                  <td class="p-3 px-5 text-[var(--text-muted)]">${p.saida ? this.formatDateTime(p.saida) : '---'}</td>
                                  <td class="p-3 px-5 text-center font-semibold text-zinc-300">${p.status === 'fechado' ? this.formatDuration(p.durationMs) : '<span class="text-emerald-500 font-bold">Em Serviço</span>'}</td>
                                  <td class="p-3 px-5 text-right">${badge}</td>
                                </tr>
                              `;
                            }).join('')
                          : `
                            <tr>
                              <td colspan="6" class="text-center p-8 text-[var(--text-muted)]">
                                <i class="fas fa-user-clock text-2xl mb-2 block opacity-30"></i>
                                Nenhum registro de ponto encontrado nesta consulta.
                              </td>
                            </tr>
                          `
                        }
                      </tbody>
                    </table>
                  </div>
                `
              }
            </div>
          </div>
        `;
      },

      ticketsPage: (tickets, stats, filters) => {
        const openCount = stats.openCount || 0;
        const closedCount = stats.closedCount || 0;
        const transcriptCount = stats.transcriptCount || 0;
        return `
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            ${this.templates.summaryCard('Tickets Abertos', openCount, 'fa-headset', 'brand')}
            ${this.templates.summaryCard('Tickets Fechados', closedCount, 'fa-folder-closed', 'indigo')}
            ${this.templates.summaryCard('Transcripts', transcriptCount, 'fa-file-invoice', 'emerald')}
          </div>

          <div class="card-premium rounded-2xl overflow-hidden">
            <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div>
                <h3 class="text-xl font-bold tracking-tight">Central de Tickets</h3>
                <p class="text-sm text-[var(--text-muted)] mt-1">Ações espelhadas do Discord: conversar, assumir e fechar com transcript/log.</p>
              </div>

              <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
                <select id="tickets-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                  <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                  <option value="open" ${filters.status === 'open' ? 'selected' : ''}>Abertos</option>
                  <option value="closed" ${filters.status === 'closed' ? 'selected' : ''}>Fechados</option>
                </select>
                <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
                <input type="text" id="tickets-search" placeholder="Nome, canal ou motivo..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-44 px-2" value="${this.escapeHtml(filters.q || '')}">
                <button id="tickets-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Cidadão</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Departamento</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Canal</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Responsável</th>
                    <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Status</th>
                    <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ações</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                  ${tickets.length
                    ? tickets.map(t => {
                        const isOpen = t.status === 'open';
                        const badge = isOpen
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
                        return `
                          <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                            <td class="p-4 px-6">
                              <div class="font-semibold text-sm text-zinc-200">${this.escapeHtml(t.username || 'N/A')}</div>
                              <div class="text-xs text-[var(--text-muted)]">${this.escapeHtml(t.userId || 'N/A')}</div>
                            </td>
                            <td class="p-4 px-6">
                              <div class="text-sm font-semibold text-zinc-300">${this.escapeHtml(t.reason || 'Suporte Geral')}</div>
                              <div class="text-xs text-[var(--text-muted)] truncate max-w-[260px]">${this.escapeHtml(t.description || '')}</div>
                            </td>
                            <td class="p-4 px-6 text-xs font-mono text-[var(--text-muted)]">${this.escapeHtml(t.channelId || 'N/A')}</td>
                            <td class="p-4 px-6 text-xs text-[var(--text-muted)]">${this.escapeHtml(t.claimedBy || 'Não assumido')}</td>
                            <td class="p-4 px-6 text-center">
                              <span class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] rounded-xl border ${badge}">
                                ${isOpen ? 'Aberto' : 'Fechado'}
                              </span>
                              <div class="text-[10px] text-[var(--text-muted)] mt-1">${this.formatDateTime(isOpen ? t.createdAt : t.closedAt || t.updatedAt)}</div>
                            </td>
                            <td class="p-4 px-6 text-right">
                              <div class="flex justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                ${isOpen && t.channelId ? `
                                  <button class="ticket-chat-btn btn-soft w-9 h-9 rounded-xl inline-flex items-center justify-center" data-channel-id="${this.escapeHtml(t.channelId)}" data-title="${this.escapeHtml(t.username || t.channelId)}" title="Abrir chat">
                                    <i class="fas fa-comments text-xs"></i>
                                  </button>
                                ` : ''}
                                ${isOpen ? `
                                  <button class="ticket-claim-btn btn-soft w-9 h-9 rounded-xl inline-flex items-center justify-center" data-id="${t._id}" title="Assumir ticket">
                                    <i class="fas fa-user-check text-xs"></i>
                                  </button>
                                  <button class="ticket-close-btn w-9 h-9 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 inline-flex items-center justify-center transition-colors" data-id="${t._id}" title="Fechar ticket">
                                    <i class="fas fa-lock text-xs"></i>
                                  </button>
                                ` : ''}
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')
                    : `
                      <tr>
                        <td colspan="6" class="text-center p-12 text-[var(--text-muted)]">
                          <i class="fas fa-headset text-3xl mb-3 block opacity-30"></i>
                          Nenhum ticket encontrado.
                        </td>
                      </tr>
                    `
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
      },

      corregedoriaPage: (casos, filters) => `
        <div class="card-premium rounded-2xl overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h3 class="text-xl font-bold tracking-tight">Ocorrências da Corregedoria</h3>
              <p class="text-sm text-[var(--text-muted)] mt-1">Gerencie denúncias, reclamações e condutas registradas por cidadãos.</p>
            </div>

            <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
              <select id="corregedoria-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                <option value="aberto" ${filters.status === 'aberto' ? 'selected' : ''}>Abertos</option>
                <option value="fechado" ${filters.status === 'fechado' ? 'selected' : ''}>Arquivados</option>
              </select>
              <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
              <input type="text" id="corregedoria-search" placeholder="Cidadão ou assunto..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-40 px-2" value="${filters.q || ''}">
              <button id="corregedoria-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Cidadão</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Categoria</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Assunto</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Status</th>
                  <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                ${casos.length
                  ? casos.map(c => {
                      const statusColors = {
                        aberto: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
                        fechado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      };

                      return `
                        <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                          <td class="p-4 px-6">
                            <div class="font-semibold text-sm">${c.nomeSobrenome || 'N/A'}</div>
                            <div class="text-xs text-[var(--text-muted)]">Citizen: ${c.idCidade || 'N/A'}</div>
                          </td>
                          <td class="p-4 px-6 text-sm text-[var(--text-muted)] capitalize">${c.opcao}</td>
                          <td class="p-4 px-6 text-sm font-medium text-zinc-200">${c.assunto}</td>
                          <td class="p-4 px-6 text-center">
                            <span class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] rounded-xl border ${statusColors[c.status]}">
                              ${c.status}
                            </span>
                          </td>
                          <td class="p-4 px-6 text-right">
                            <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                              ${c.status === 'aberto' && c.ticketChannelId ? `
                                <button class="open-chat-btn w-9 h-9 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-brand-500 hover:bg-brand-500/10 inline-flex items-center justify-center transition-colors" data-channel-id="${c.ticketChannelId}" data-title="${c.nomeSobrenome || 'Corregedoria'}">
                                  <i class="fas fa-comments text-xs"></i>
                                </button>
                              ` : ''}
                              <button class="analyse-corregedoria-btn btn-brand text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-id="${c._id}">
                                <i class="fas fa-eye text-[10px]"></i> Detalhes
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')
                  : `
                    <tr>
                      <td colspan="5" class="text-center p-12 text-[var(--text-muted)]">
                        <i class="fas fa-building-shield text-3xl mb-3 block opacity-30"></i>
                        Nenhuma ocorrência encontrada.
                      </td>
                    </tr>
                  `
                }
              </tbody>
            </table>
          </div>
        </div>
      `,

      corregedoriaModal: (caso, formatDateTime) => {
        const statusBadges = {
          aberto: 'bg-rose-500/10 text-rose-500 border-rose-500/15',
          fechado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15'
        };

        return `
          <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
            <div class="card-premium rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col fade-in overflow-hidden">
              <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between flex-shrink-0">
                <div class="flex items-center gap-3">
                  <div class="w-11 h-11 rounded-xl bg-rose-500/10 text-rose-500 border border-[var(--border-subtle)] flex items-center justify-center text-sm">
                    <i class="fas fa-building-shield"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold tracking-tight">Ocorrência Corregedoria</h3>
                    <p class="text-xs text-[var(--text-muted)] mt-0.5">Enviada em ${formatDateTime(caso.createdAt)}</p>
                  </div>
                </div>
                <button class="close-modal-btn btn-soft w-9 h-9 rounded-xl flex items-center justify-center">
                  <i class="fas fa-times"></i>
                </button>
              </div>

              <div class="flex-grow overflow-y-auto p-6 space-y-6">
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-[var(--card-bg-soft)] p-4 rounded-xl border border-[var(--border-subtle)]">
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Cidadão</p>
                    <p class="font-bold text-sm mt-0.5">${caso.nomeSobrenome || 'N/A'}</p>
                  </div>
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Citizen</p>
                    <p class="font-bold text-sm mt-0.5">${caso.idCidade || 'N/A'}</p>
                  </div>
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Opção</p>
                    <p class="font-bold text-sm mt-0.5 capitalize">${caso.opcao}</p>
                  </div>
                  <div>
                    <p class="text-[var(--text-muted)] uppercase tracking-wider font-semibold">Discord</p>
                    <p class="font-bold text-sm mt-0.5 truncate">@${caso.username || caso.userId}</p>
                  </div>
                </div>

                <div>
                  <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-2">Assunto da Ocorrência</h4>
                  <p class="text-sm font-semibold text-zinc-100">${caso.assunto}</p>
                </div>

                <div>
                  <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-2">Relato do Cidadão</h4>
                  <div class="p-4 bg-[var(--card-bg-soft)] rounded-xl border border-[var(--border-subtle)] text-sm text-zinc-300 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">${caso.relato}</div>
                </div>

                <div>
                  <h4 class="font-bold text-xs uppercase tracking-[0.16em] text-brand-500 mb-2">Anexos / Provas</h4>
                  ${caso.provas
                    ? `
                      <div class="flex items-center gap-2 p-3 bg-[var(--card-bg-soft)] rounded-xl border border-[var(--border-subtle)]">
                        <i class="fas fa-paperclip text-[var(--text-muted)] text-sm"></i>
                        <a href="${caso.provas}" target="_blank" class="text-xs text-brand-400 hover:text-brand-500 font-semibold underline truncate flex-1">${caso.provas}</a>
                        <i class="fas fa-arrow-up-right-from-square text-[var(--text-muted)] text-[10px]"></i>
                      </div>
                    `
                    : `<p class="text-xs text-[var(--text-muted)]">Nenhuma prova anexada.</p>`
                  }
                </div>

                ${caso.status === 'fechado' ? `
                  <div class="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 text-sm space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="font-bold">Status:</span>
                      <span class="px-2 py-0.5 text-xs font-bold uppercase rounded border ${statusBadges[caso.status]}">${caso.status}</span>
                    </div>
                    <p class="text-xs text-[var(--text-muted)]">Encerrado por: <strong>${caso.fechadoPor || 'Corregedor SSP'}</strong></p>
                    <div class="p-3 rounded-lg border border-emerald-500/10 bg-emerald-500/5 text-emerald-400 text-xs mt-1 leading-relaxed">
                      <strong>Motivo de Encerramento:</strong> ${caso.motivoFechamento || 'Nenhum informado.'}
                    </div>
                  </div>
                ` : ''}
              </div>

              <div class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex justify-end gap-2 flex-shrink-0">
                <button class="close-modal-btn btn-soft px-5 py-2.5 rounded-xl text-xs font-semibold">Fechar</button>
              </div>
            </div>
          </div>
        `;
      },

      transcriptsPage: (transcripts, filters) => {
        const items = transcripts || [];
        const activeFilters = filters || {};
        const atendimentoCount = items.filter(t => t.modulo === 'atendimento').length;
        const corregedoriaCount = items.filter(t => t.modulo === 'corregedoria').length;
        const totalMessages = items.reduce((sum, t) => sum + (Number(t.messageCount) || 0), 0);
        const moduleLabels = {
          atendimento: 'Atendimento Geral',
          corregedoria: 'Corregedoria'
        };

        return `
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            ${this.templates.summaryCard('Transcripts', items.length, 'fa-file-invoice', 'brand')}
            ${this.templates.summaryCard('Atendimento', atendimentoCount, 'fa-headset', 'indigo')}
            ${this.templates.summaryCard('Corregedoria', corregedoriaCount, 'fa-scale-balanced', 'rose')}
            ${this.templates.summaryCard('Mensagens', totalMessages, 'fa-comments', 'emerald')}
          </div>

          <div class="card-premium rounded-2xl overflow-hidden">
            <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div>
                <h3 class="text-xl font-bold tracking-tight">Transcripts de Atendimentos</h3>
                <p class="text-sm text-[var(--text-muted)] mt-1">Histórico completo com protocolo, canal, cidadão, oficial responsável, tamanho do HTML e quantidade de mensagens.</p>
              </div>

              <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
                <select id="transcripts-modulo" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                  <option value="" ${activeFilters.modulo === '' ? 'selected' : ''}>Todos os Módulos</option>
                  <option value="atendimento" ${activeFilters.modulo === 'atendimento' ? 'selected' : ''}>Atendimento Geral</option>
                  <option value="corregedoria" ${activeFilters.modulo === 'corregedoria' ? 'selected' : ''}>Corregedoria</option>
                </select>
                <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
                <input type="text" id="transcripts-search" placeholder="Cidadão, canal, protocolo ou oficial..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-64 px-2" value="${this.escapeHtml(activeFilters.q || '')}">
                <button id="transcripts-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Protocolo</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ticket</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Cidadão</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Encerramento</th>
                    <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Arquivo</th>
                    <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ações</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                  ${items.length
                    ? items.map(t => {
                        const modColors = {
                          atendimento: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                          corregedoria: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                        };
                        const modulo = moduleLabels[t.modulo] || t.modulo || 'N/A';

                        return `
                          <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                            <td class="p-4 px-6">
                              <span class="inline-flex items-center px-2 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--card-bg-soft)] text-[11px] font-mono text-zinc-300">
                                ${this.escapeHtml(t.protocolo || 'N/A')}
                              </span>
                            </td>
                            <td class="p-4 px-6">
                              <div class="font-mono text-sm text-zinc-300">#${this.escapeHtml(t.channelName || 'N/A')}</div>
                              <div class="text-xs text-[var(--text-muted)] mt-1">ID: ${this.escapeHtml(t.ticketId || 'N/A')}</div>
                              <span class="inline-flex mt-2 px-2 py-0.5 rounded border text-[11px] ${modColors[t.modulo] || 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'}">
                                ${this.escapeHtml(modulo)}
                              </span>
                            </td>
                            <td class="p-4 px-6">
                              <div class="font-semibold text-sm">${this.escapeHtml(t.citizenName || 'N/A')}</div>
                              <div class="text-xs text-[var(--text-muted)]">Discord: ${this.escapeHtml(t.citizenId || 'N/A')}</div>
                            </td>
                            <td class="p-4 px-6 text-sm">
                              <div class="font-semibold text-zinc-300">${this.escapeHtml(t.closedByName || 'Painel Web')}</div>
                              <div class="text-xs text-[var(--text-muted)]">ID: ${this.escapeHtml(t.closedBy || 'N/A')}</div>
                              <div class="text-xs text-[var(--text-muted)] mt-1">${this.formatDateTime(t.createdAt)}</div>
                            </td>
                            <td class="p-4 px-6 text-sm">
                              <div class="font-semibold text-zinc-300">${Number(t.messageCount) || 0} mensagens</div>
                              <div class="text-xs text-[var(--text-muted)]">${this.formatBytes(t.htmlSize)}</div>
                            </td>
                            <td class="p-4 px-6 text-right">
                              <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                <button class="view-transcript-btn btn-brand text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-id="${this.escapeHtml(t._id)}">
                                  <i class="fas fa-file-code"></i> Visualizar
                                </button>
                                <button class="download-transcript-btn btn-soft w-9 h-9 rounded-xl inline-flex items-center justify-center" data-id="${this.escapeHtml(t._id)}" title="Abrir HTML bruto">
                                  <i class="fas fa-arrow-up-right-from-square text-xs"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')
                    : `
                      <tr>
                        <td colspan="6" class="text-center p-12 text-[var(--text-muted)]">
                          <i class="fas fa-file-invoice text-3xl mb-3 block opacity-30"></i>
                          Nenhum transcript arquivado.
                        </td>
                      </tr>
                    `
                  }
                </tbody>
              </table>
            </div>
          </div>
        `;
      },

      transcriptModal: (t, formatDateTime) => {
        const moduleLabels = {
          atendimento: 'Atendimento Geral',
          corregedoria: 'Corregedoria'
        };
        const modulo = moduleLabels[t.modulo] || t.modulo || 'N/A';

        return `
          <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
            <div class="card-premium rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col fade-in overflow-hidden border border-[#27272a] bg-[#111214]">
              <div class="bg-[#0f1011] border-b border-[#1f2023] flex items-center justify-between px-4 py-3 flex-shrink-0">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="flex items-center gap-1.5 flex-shrink-0">
                    <div class="w-3 h-3 rounded-full bg-rose-500/70"></div>
                    <div class="w-3 h-3 rounded-full bg-amber-500/70"></div>
                    <div class="w-3 h-3 rounded-full bg-emerald-500/70"></div>
                  </div>
                  <i class="fab fa-discord text-[#5865F2] text-lg flex-shrink-0"></i>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-zinc-300 font-mono truncate">#${this.escapeHtml(t.channelName || 'N/A')}</div>
                    <div class="text-[11px] text-[var(--text-muted)] truncate">Protocolo ${this.escapeHtml(t.protocolo || 'N/A')} • ${this.escapeHtml(modulo)}</div>
                  </div>
                </div>
                <button class="close-modal-btn text-zinc-400 hover:text-white transition-colors p-1 flex items-center justify-center rounded-lg hover:bg-zinc-800">
                  <i class="fas fa-times text-sm"></i>
                </button>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3 p-4 border-b border-[#1f2023] bg-[#151619] flex-shrink-0">
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Cidadão</p>
                  <p class="text-xs text-zinc-200 font-semibold truncate">${this.escapeHtml(t.citizenName || 'N/A')}</p>
                  <p class="text-[11px] text-zinc-500 truncate">${this.escapeHtml(t.citizenId || 'N/A')}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Fechado por</p>
                  <p class="text-xs text-zinc-200 font-semibold truncate">${this.escapeHtml(t.closedByName || 'Painel Web')}</p>
                  <p class="text-[11px] text-zinc-500 truncate">${this.escapeHtml(t.closedBy || 'N/A')}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Encerramento</p>
                  <p class="text-xs text-zinc-200 font-semibold">${formatDateTime(t.createdAt)}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Ticket ID</p>
                  <p class="text-xs text-zinc-200 font-mono truncate">${this.escapeHtml(t.ticketId || 'N/A')}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Mensagens</p>
                  <p class="text-xs text-zinc-200 font-semibold">${Number(t.messageCount) || 0}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Arquivo</p>
                  <p class="text-xs text-zinc-200 font-semibold">${this.formatBytes(t.htmlSize)}</p>
                </div>
              </div>
              <div class="flex-grow bg-[#313338]">
                <iframe src="/api/transcripts/${this.escapeHtml(t._id)}/raw" class="w-full h-full border-0" loading="lazy"></iframe>
              </div>
            </div>
          </div>
        `;
      },

      chatModal: (title, channelId) => `
        <div id="chat-modal-container" class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
          <div class="card-premium rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col fade-in overflow-hidden border border-[var(--border-subtle)] bg-[var(--card-bg)]">
            <div class="p-4 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-500 border border-[var(--border-subtle)] flex items-center justify-center text-md">
                  <i class="fas fa-comments"></i>
                </div>
                <div>
                  <h3 class="text-sm font-bold tracking-tight text-zinc-100">Atendimento em Tempo Real</h3>
                  <p class="text-[11px] text-[var(--text-muted)] mt-0.5">Canal: <span class="font-semibold text-brand-400">#${title}</span></p>
                </div>
              </div>
              <button class="close-modal-btn w-8 h-8 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-zinc-100 hover:bg-[var(--card-bg-soft)] flex items-center justify-center transition-colors">
                <i class="fas fa-times text-xs"></i>
              </button>
            </div>

            <div id="chat-messages-feed" class="flex-grow overflow-y-auto p-4 space-y-4 bg-zinc-950/20 scrollbar-thin">
              <div class="flex justify-center py-8">
                <i class="fas fa-circle-notch fa-spin text-2xl text-brand-500"></i>
              </div>
            </div>

            <form id="chat-input-form" class="p-4 border-t border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex gap-2">
              <input type="text" id="chat-message-input" placeholder="Digite sua resposta aqui..." autocomplete="off" class="flex-1 bg-zinc-900/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500/50 text-zinc-100 transition-colors" />
              <button type="submit" class="bg-brand-500 hover:bg-brand-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 transition-all shadow-lg shadow-brand-500/10 active:scale-95">
                <span>Enviar</span>
                <i class="fas fa-paper-plane text-xs"></i>
              </button>
            </form>
          </div>
        </div>
      `,

      logsPage: (res, filters) => {
        const logs = res.logs || [];
        const currentPage = res.currentPage || 1;
        const totalPages = res.pages || 1;
        const totalLogs = res.total || 0;

        const logTypes = {
          '': 'Todos os Eventos',
          cadastro: 'Novos Cadastros',
          solicitacao_enviada: 'Pedidos Enviados',
          solicitacao_decidida: 'Pedidos Operados',
          ticket_aberto: 'Tickets Abertos',
          ticket_fechado: 'Tickets Fechados',
          ticket_assumido: 'Tickets Assumidos',
          ticket_editado: 'Tickets Editados',
          ticket_reaberto: 'Tickets Reabertos',
          ticket_excluido: 'Tickets Excluídos',
          ticket_mensagem: 'Mensagens do Painel',
          ticket_agendado: 'Agendamentos',
          transcript_visualizado: 'Transcripts Visualizados',
          transcript_excluido: 'Transcripts Excluídos',
          relatorio_exportado: 'Relatórios Exportados',
          voz_criada: 'Salas de Voz',
          membro_gerenciado: 'Gestão de Membros',
          config_atualizada: 'Configurações',
          ponto_criado: 'Ponto Criado',
          ponto_editado: 'Ponto Editado',
          ponto_fechado: 'Ponto Fechado',
          ponto_excluido: 'Ponto Excluído',
          corregedoria_fechada: 'Corregedoria Fechada',
          corregedoria_editada: 'Corregedoria Editada',
          corregedoria_excluida: 'Corregedoria Excluída',
          painel_acao: 'Ações do Painel',
          auth: 'Autenticação',
          ausencia_decidida: 'Ausências Decididas',
          warning_aplicada: 'Advertências Aplicadas'
        };

        const typeTones = {
          cadastro: 'bg-brand-500/10 text-brand-500 border-brand-500/15',
          solicitacao_enviada: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
          solicitacao_decidida: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          ticket_aberto: 'bg-blue-500/10 text-blue-500 border-blue-500/15',
          ticket_fechado: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/15',
          ticket_assumido: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          ticket_editado: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
          ticket_reaberto: 'bg-blue-500/10 text-blue-500 border-blue-500/15',
          ticket_excluido: 'bg-rose-500/10 text-rose-500 border-rose-500/15',
          ticket_mensagem: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/15',
          ticket_agendado: 'bg-violet-500/10 text-violet-500 border-violet-500/15',
          transcript_visualizado: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/15',
          transcript_excluido: 'bg-rose-500/10 text-rose-500 border-rose-500/15',
          relatorio_exportado: 'bg-teal-500/10 text-teal-500 border-teal-500/15',
          voz_criada: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/15',
          membro_gerenciado: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/15',
          config_atualizada: 'bg-violet-500/10 text-violet-500 border-violet-500/15',
          ponto_criado: 'bg-brand-500/10 text-brand-500 border-brand-500/15',
          ponto_editado: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
          ponto_fechado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          ponto_excluido: 'bg-rose-500/10 text-rose-500 border-rose-500/15',
          corregedoria_fechada: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          corregedoria_editada: 'bg-amber-500/10 text-amber-500 border-amber-500/15',
          corregedoria_excluida: 'bg-rose-500/10 text-rose-500 border-rose-500/15',
          painel_acao: 'bg-teal-500/10 text-teal-500 border-teal-500/15',
          auth: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/15',
          ausencia_decidida: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/15',
          warning_aplicada: 'bg-rose-500/10 text-rose-500 border-rose-500/15'
        };

        return `
          <div class="card-premium rounded-2xl overflow-hidden">
            <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div>
                <h3 class="text-xl font-bold tracking-tight">Registro de Auditoria</h3>
                <p class="text-sm text-[var(--text-muted)] mt-1">Linha do tempo consolidada e auditável de ações da SSP.</p>
              </div>

              <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
                <select id="logs-type" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                  ${Object.entries(logTypes).map(([val, label]) => `
                    <option value="${val}" ${filters.type === val ? 'selected' : ''}>${label}</option>
                  `).join('')}
                </select>
                <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
                <input type="text" id="logs-search" placeholder="Usuário, tipo, título ou ID..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-56 px-2" value="${this.escapeHtml(filters.q || '')}">
                <button id="logs-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Filtrar</button>
              </div>
            </div>

            <div class="p-6">
              <div class="space-y-4">
                ${logs.length
                  ? logs.map(log => {
                      const toneClass = typeTones[log.type] || 'bg-zinc-500/10 text-zinc-500 border-zinc-500/15';
                      const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details)
                        ? Object.entries(log.details).filter(([, value]) => value !== undefined && value !== null && value !== '')
                        : [];
                      return `
                        <div class="flex items-start gap-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/40 hover:bg-[var(--card-bg-soft)]/80 transition-all">
                          <div class="px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider ${toneClass}">
                            ${this.escapeHtml(String(log.type || 'log').replace(/_/g, ' '))}
                          </div>
                          <div class="min-w-0 flex-1">
                            <h4 class="text-sm font-bold text-zinc-200">${this.escapeHtml(log.title || 'Evento')}</h4>
                            <p class="text-xs text-[var(--text-muted)] mt-1">${this.escapeHtml(log.description || '')}</p>
                            ${details.length ? `
                              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
                                ${details.slice(0, 9).map(([key, value]) => `
                                  <div class="rounded-lg border border-[var(--border-subtle)] bg-[var(--card-bg)]/70 px-3 py-2 min-w-0">
                                    <p class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] font-bold truncate">${this.escapeHtml(this.formatLogDetailKey(key))}</p>
                                    <p class="text-xs text-zinc-300 mt-0.5 break-words">${this.escapeHtml(this.formatLogDetailValue(value))}</p>
                                  </div>
                                `).join('')}
                              </div>
                            ` : ''}
                            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-[var(--text-muted)] font-medium">
                              <span class="flex items-center gap-1"><i class="far fa-user"></i> @${this.escapeHtml(log.username || 'Sistema')} (${this.escapeHtml(log.userId || '0')})</span>
                              <span>•</span>
                              <span class="flex items-center gap-1"><i class="far fa-clock"></i> ${new Date(log.createdAt).toLocaleString('pt-BR')}</span>
                            </div>
                          </div>
                        </div>
                      `;
                    }).join('')
                  : `
                    <div class="text-center p-12 text-[var(--text-muted)]">
                      <i class="fas fa-list-check text-3xl mb-3 block opacity-30"></i>
                      Nenhum registro de log encontrado na busca.
                    </div>
                  `
                }
              </div>

              ${totalPages > 1 ? `
                <div class="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-subtle)] text-xs">
                  <div class="text-[var(--text-muted)]">Mostrando página <strong>${currentPage}</strong> de <strong>${totalPages}</strong> (${totalLogs} logs)</div>
                  <div class="flex gap-1.5">
                    <button class="logs-page-btn btn-soft px-3 py-1.5 rounded-lg font-bold ${currentPage <= 1 ? 'opacity-40 cursor-not-allowed' : ''}" data-page="${currentPage - 1}">Anterior</button>
                    ${Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                      let pageNum = currentPage - 2 + idx;
                      if (pageNum < 1) pageNum = idx + 1;
                      if (pageNum > totalPages) return '';
                      return `
                        <button class="logs-page-btn px-3 py-1.5 rounded-lg font-bold border ${currentPage === pageNum ? 'bg-brand-500 text-white border-brand-500' : 'btn-soft'}" data-page="${pageNum}">${pageNum}</button>
                      `;
                    }).join('')}
                    <button class="logs-page-btn btn-soft px-3 py-1.5 rounded-lg font-bold ${currentPage >= totalPages ? 'opacity-40 cursor-not-allowed' : ''}" data-page="${currentPage + 1}">Próximo</button>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      },

      reportsPage: () => `
        <div class="card-premium rounded-2xl p-6 max-w-3xl mx-auto mt-6">
          <div class="border-b border-[var(--border-subtle)] pb-4 mb-6">
            <h3 class="text-xl font-bold tracking-tight">Central de Exportação de Dados</h3>
            <p class="text-sm text-[var(--text-muted)] mt-1">Gere relatórios customizados para fins de auditoria interna da SSP.</p>
          </div>

          <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Formato de Saída</label>
                <select id="report-format" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-medium">
                  <option value="xlsx">Planilha Excel (XLSX)</option>
                  <option value="pdf">Documento PDF</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Filtro de Texto (Nome / ID)</label>
                <input type="text" id="report-search" placeholder="Filtrar por nome ou ID..." class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-medium">
              </div>
            </div>

            <div class="border-t border-[var(--border-subtle)] pt-6">
              <h4 class="font-bold text-sm text-zinc-300 mb-4"><i class="fas fa-users text-brand-500 mr-2"></i> Relatórios de Cidadãos</h4>
              <p class="text-xs text-[var(--text-muted)] mb-4">Exporta a listagem de todos os oficiais/cidadãos cadastrados no banco de dados.</p>
              <button id="export-cidadaos-btn" class="btn-brand px-5 py-2.5 rounded-xl text-xs">Exportar Dados de Cidadãos</button>
            </div>

            <div class="border-t border-[var(--border-subtle)] pt-6">
              <h4 class="font-bold text-sm text-zinc-300 mb-4"><i class="fas fa-file-invoice text-brand-500 mr-2"></i> Relatórios de Solicitações (Armas / Vistos / Recrutamento)</h4>
              <p class="text-xs text-[var(--text-muted)] mb-4">Selecione filtros específicos para o relatório de solicitações submetidas.</p>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Módulo</label>
                  <select id="report-modulo" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-medium">
                    <option value="">Todos</option>
                    <option value="porte">Porte de Arma</option>
                    <option value="paraguaio">Passaporte Paraguaio</option>
                    <option value="recrutamento">Recrutamento (Edital)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Status</label>
                  <select id="report-status" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-medium">
                    <option value="">Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="aprovado">Aprovado</option>
                    <option value="reprovado">Reprovado</option>
                  </select>
                </div>
              </div>
              
              <button id="export-solicitacoes-btn" class="btn-brand px-5 py-2.5 rounded-xl text-xs">Exportar Dados de Solicitações</button>
            </div>

            <div class="border-t border-[var(--border-subtle)] pt-6">
              <h4 class="font-bold text-sm text-zinc-300 mb-4"><i class="fas fa-user-clock text-brand-500 mr-2"></i> Relatórios de Bate-Ponto / Horas de Turno</h4>
              <p class="text-xs text-[var(--text-muted)] mb-4">Exporta os turnos registrados pelos oficiais com filtro de datas.</p>
              
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Status do Turno</label>
                  <select id="report-ponto-status" class="w-full px-3 py-2.5 bg-[var(--card-bg-soft)] rounded-xl text-xs font-medium">
                    <option value="">Todos</option>
                    <option value="aberto">Em aberto (Em serviço)</option>
                    <option value="fechado">Encerrado</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Data Inicial</label>
                  <input type="date" id="report-ponto-start" class="w-full px-3 py-2 bg-[var(--card-bg-soft)] rounded-xl text-xs text-zinc-300 font-medium">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.18em] mb-2">Data Final</label>
                  <input type="date" id="report-ponto-end" class="w-full px-3 py-2 bg-[var(--card-bg-soft)] rounded-xl text-xs text-zinc-300 font-medium">
                </div>
              </div>
              
              <button id="export-ponto-btn" class="btn-brand px-5 py-2.5 rounded-xl text-xs">Exportar Horas de Patrulha</button>
            </div>
          </div>
        </div>
      `,

      settingsPage: (c, pmespDoc, pcespDoc) => {
        const ch = c.channels || {};
        const rl = c.roles || {};
        const md = c.modules || { tickets: true, ponto: true, edital: true, ausencia: true, warning: true, avaliacao: true };

        // Obter roles e channels das corporações
        const pmesp = pmespDoc || { roles: {}, channels: {} };
        const pmCh = pmesp.channels || {};
        const pmRl = pmesp.roles || {};

        const pcesp = pcespDoc || { roles: {}, channels: {} };
        const pcCh = pcesp.channels || {};
        const pcRl = pcesp.roles || {};

        return `
          <div class="max-w-4xl mx-auto space-y-6">
            <form id="settings-form" class="space-y-6">
              
              <!-- ATIVAÇÃO DE MÓDULOS -->
              <div class="card-premium rounded-2xl p-6">
                <h3 class="font-bold text-base text-zinc-100 border-b border-[var(--border-subtle)] pb-3 mb-4 flex items-center gap-2">
                  <i class="fas fa-toggle-on text-brand-500"></i> Ativação de Módulos Globais
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <label class="flex items-center gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 cursor-pointer hover:border-brand-500/35 transition-colors">
                    <input type="checkbox" id="mod-tickets" class="w-4 h-4 rounded text-brand-500 focus:ring-brand-500 accent-brand-500" ${md.tickets ? 'checked' : ''}>
                    <div>
                      <p class="text-xs font-bold text-zinc-200">Módulo de Tickets</p>
                      <p class="text-[10px] text-[var(--text-muted)]">Criação de chats privados de ajuda.</p>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 cursor-pointer hover:border-brand-500/35 transition-colors">
                    <input type="checkbox" id="mod-ponto" class="w-4 h-4 rounded text-brand-500 focus:ring-brand-500 accent-brand-500" ${md.ponto ? 'checked' : ''}>
                    <div>
                      <p class="text-xs font-bold text-zinc-200">Módulo Bate-Ponto</p>
                      <p class="text-[10px] text-[var(--text-muted)]">Registro eletrônico de patrulhas.</p>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 cursor-pointer hover:border-brand-500/35 transition-colors">
                    <input type="checkbox" id="mod-edital" class="w-4 h-4 rounded text-brand-500 focus:ring-brand-500 accent-brand-500" ${md.edital ? 'checked' : ''}>
                    <div>
                      <p class="text-xs font-bold text-zinc-200">Módulo Recrutamento</p>
                      <p class="text-[10px] text-[var(--text-muted)]">Fichas de admissão de cadetes.</p>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 cursor-pointer hover:border-brand-500/35 transition-colors">
                    <input type="checkbox" id="mod-ausencia" class="w-4 h-4 rounded text-brand-500 focus:ring-brand-500 accent-brand-500" ${md.ausencia ? 'checked' : ''}>
                    <div>
                      <p class="text-xs font-bold text-zinc-200">Módulo Ausências</p>
                      <p class="text-[10px] text-[var(--text-muted)]">Gerenciamento de licenças.</p>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 cursor-pointer hover:border-brand-500/35 transition-colors">
                    <input type="checkbox" id="mod-warning" class="w-4 h-4 rounded text-brand-500 focus:ring-brand-500 accent-brand-500" ${md.warning ? 'checked' : ''}>
                    <div>
                      <p class="text-xs font-bold text-zinc-200">Módulo Advertências</p>
                      <p class="text-[10px] text-[var(--text-muted)]">Punições disciplinares.</p>
                    </div>
                  </label>
                </div>
              </div>

              <!-- CONFIGURAÇÕES GLOBAIS SSP -->
              <div class="card-premium rounded-2xl p-6">
                <h3 class="font-bold text-base text-zinc-100 border-b border-[var(--border-subtle)] pb-3 mb-4 flex items-center gap-2">
                  <i class="fas fa-globe text-brand-500"></i> Configurações Globais (SSP)
                </h3>
                <div class="space-y-6">
                  <div>
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Canais SSP</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Bate-Ponto</label>
                        <input type="text" id="ch-pontoPanel" value="${ch.pontoPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-pontoPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Ausências</label>
                        <input type="text" id="ch-ausenciaPanel" value="${ch.ausenciaPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-ausenciaPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel do Edital</label>
                        <input type="text" id="ch-editalPanel" value="${ch.editalPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-editalPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de COPOM</label>
                        <input type="text" id="ch-copomLogs" value="${ch.copomLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-copomLogs" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de Admin</label>
                        <input type="text" id="ch-adminLogs" value="${ch.adminLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-adminLogs" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Categoria Corregedoria</label>
                        <input type="text" id="ch-corregedoriaCategory" value="${ch.corregedoriaCategory || ''}" placeholder="ID da categoria" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-corregedoriaCategory" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Resultados Corregedoria</label>
                        <input type="text" id="ch-corregedoriaResults" value="${ch.corregedoriaResults || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-corregedoriaResults" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs Entrada Membros</label>
                        <input type="text" id="ch-memberLogsEntrada" value="${ch.memberLogsEntrada || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-memberLogsEntrada" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs Saída Membros</label>
                        <input type="text" id="ch-memberLogsSaida" value="${ch.memberLogsSaida || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-memberLogsSaida" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs Exonerações</label>
                        <input type="text" id="ch-exoneracoes" value="${ch.exoneracoes || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-exoneracoes" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs Transferências</label>
                        <input type="text" id="ch-transferencias" value="${ch.transferencias || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-transferencias" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Solicitações Internas</label>
                        <input type="text" id="ch-solicitacoesInternas" value="${ch.solicitacoesInternas || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-solicitacoesInternas" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Canal Blacklist</label>
                        <input type="text" id="ch-blacklist" value="${ch.blacklist || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-blacklist" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Canal Sugestões</label>
                        <input type="text" id="ch-sugestoes" value="${ch.sugestoes || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-sugestoes" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Canal Hierarquia</label>
                        <input type="text" id="ch-hierarchy" value="${ch.hierarchy || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-hierarchy" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Avaliações</label>
                        <input type="text" id="ch-avaliacaoPanel" value="${ch.avaliacaoPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-avaliacaoPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs Avaliações</label>
                        <input type="text" id="ch-avaliacaoLogs" value="${ch.avaliacaoLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-avaliacaoLogs" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Academia</label>
                        <input type="text" id="ch-academiaPanel" value="${ch.academiaPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-academiaPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Avisos Academia</label>
                        <input type="text" id="ch-academiaAvisos" value="${ch.academiaAvisos || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-ch-academiaAvisos" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>

                  <div class="border-t border-[var(--border-subtle)] pt-4">
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Cargos SSP Globais</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Autorizado Setup</label>
                        <input type="text" id="rl-setupAuthorized" value="${rl.setupAuthorized || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-rl-setupAuthorized" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Cidadão</label>
                        <input type="text" id="rl-cidadao" value="${rl.cidadao || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-rl-cidadao" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- CONFIGURAÇÕES PMESP -->
              <div class="card-premium rounded-2xl p-6 border-l-4 border-blue-500/50">
                <h3 class="font-bold text-base text-zinc-100 border-b border-[var(--border-subtle)] pb-3 mb-4 flex items-center gap-2">
                  <i class="fas fa-shield-alt text-blue-500"></i> Configurações PMESP (Polícia Militar)
                </h3>
                <div class="space-y-6">
                  <div>
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Canais Exclusivos PMESP</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel de Tickets</label>
                        <input type="text" id="pmesp-ch-ticketsPanel" value="${pmCh.ticketsPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-ticketsPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Categoria de Tickets</label>
                        <input type="text" id="pmesp-ch-ticketsCategory" value="${pmCh.ticketsCategory || ''}" placeholder="ID da categoria" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-ticketsCategory" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Advertências</label>
                        <input type="text" id="pmesp-ch-warningPanel" value="${pmCh.warningPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-warningPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de Ponto</label>
                        <input type="text" id="pmesp-ch-pontoLogsPmesp" value="${pmCh.pontoLogsPmesp || pmCh.pontoLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-pontoLogsPmesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de Ausência</label>
                        <input type="text" id="pmesp-ch-ausenciaLogsPmesp" value="${pmCh.ausenciaLogsPmesp || pmCh.ausenciaLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-ausenciaLogsPmesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Edital Avaliação</label>
                        <input type="text" id="pmesp-ch-editalAvaliacaoPmesp" value="${pmCh.editalAvaliacaoPmesp || pmCh.editalAvaliacao || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-editalAvaliacaoPmesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Edital Resultados</label>
                        <input type="text" id="pmesp-ch-editalResultadosPmesp" value="${pmCh.editalResultadosPmesp || pmCh.editalResultados || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-ch-editalResultadosPmesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>

                  <div class="border-t border-[var(--border-subtle)] pt-4">
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Cargos Exclusivos PMESP</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Geral</label>
                        <input type="text" id="pmesp-rl-geral" value="${pmRl.geral || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-geral" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Comando</label>
                        <input type="text" id="pmesp-rl-comando" value="${pmRl.comando || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-comando" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Staff Tickets</label>
                        <input type="text" id="pmesp-rl-staff" value="${pmRl.staff || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-staff" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Recruta</label>
                        <input type="text" id="pmesp-rl-recruta" value="${pmRl.recruta || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-recruta" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Pré-Aprovado</label>
                        <input type="text" id="pmesp-rl-preAprovado" value="${pmRl.preAprovado || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-preAprovado" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV Verbal</label>
                        <input type="text" id="pmesp-rl-advVerbal" value="${pmRl.advVerbal || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-advVerbal" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 1</label>
                        <input type="text" id="pmesp-rl-adv1" value="${pmRl.adv1 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-adv1" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 2</label>
                        <input type="text" id="pmesp-rl-adv2" value="${pmRl.adv2 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-adv2" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 3</label>
                        <input type="text" id="pmesp-rl-adv3" value="${pmRl.adv3 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-adv3" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Administrativo</label>
                        <input type="text" id="pmesp-rl-administrativo" value="${pmRl.administrativo || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-administrativo" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Ministrador</label>
                        <input type="text" id="pmesp-rl-ministrador" value="${pmRl.ministrador || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-ministrador" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Cabo PMESP</label>
                        <input type="text" id="pmesp-rl-caboRole" value="${rl.caboRole || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pmesp-rl-caboRole" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- CONFIGURAÇÕES PCESP -->
              <div class="card-premium rounded-2xl p-6 border-l-4 border-red-500/50">
                <h3 class="font-bold text-base text-zinc-100 border-b border-[var(--border-subtle)] pb-3 mb-4 flex items-center gap-2">
                  <i class="fas fa-id-badge text-red-500"></i> Configurações PCESP (Polícia Civil)
                </h3>
                <div class="space-y-6">
                  <div>
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Canais Exclusivos PCESP</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel de Tickets</label>
                        <input type="text" id="pcesp-ch-ticketsPanel" value="${pcCh.ticketsPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-ticketsPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Categoria de Tickets</label>
                        <input type="text" id="pcesp-ch-ticketsCategory" value="${pcCh.ticketsCategory || ''}" placeholder="ID da categoria" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-ticketsCategory" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Painel Advertências</label>
                        <input type="text" id="pcesp-ch-warningPanel" value="${pcCh.warningPanel || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-warningPanel" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de Ponto</label>
                        <input type="text" id="pcesp-ch-pontoLogsPcesp" value="${pcCh.pontoLogsPcesp || pcCh.pontoLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-pontoLogsPcesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Logs de Ausência</label>
                        <input type="text" id="pcesp-ch-ausenciaLogsPcesp" value="${pcCh.ausenciaLogsPcesp || pcCh.ausenciaLogs || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-ausenciaLogsPcesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Edital Avaliação</label>
                        <input type="text" id="pcesp-ch-editalAvaliacaoPcesp" value="${pcCh.editalAvaliacaoPcesp || pcCh.editalAvaliacao || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-editalAvaliacaoPcesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Edital Resultados</label>
                        <input type="text" id="pcesp-ch-editalResultadosPcesp" value="${pcCh.editalResultadosPcesp || pcCh.editalResultados || ''}" placeholder="ID do canal" class="discord-channel-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-ch-editalResultadosPcesp" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>

                  <div class="border-t border-[var(--border-subtle)] pt-4">
                    <h4 class="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">Cargos Exclusivos PCESP</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Geral</label>
                        <input type="text" id="pcesp-rl-geral" value="${pcRl.geral || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-geral" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Comando</label>
                        <input type="text" id="pcesp-rl-comando" value="${pcRl.comando || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-comando" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Staff Tickets</label>
                        <input type="text" id="pcesp-rl-staff" value="${pcRl.staff || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-staff" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Recruta</label>
                        <input type="text" id="pcesp-rl-recruta" value="${pcRl.recruta || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-recruta" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Pré-Aprovado</label>
                        <input type="text" id="pcesp-rl-preAprovado" value="${pcRl.preAprovado || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-preAprovado" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV Verbal</label>
                        <input type="text" id="pcesp-rl-advVerbal" value="${pcRl.advVerbal || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-advVerbal" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 1</label>
                        <input type="text" id="pcesp-rl-adv1" value="${pcRl.adv1 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-adv1" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 2</label>
                        <input type="text" id="pcesp-rl-adv2" value="${pcRl.adv2 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-adv2" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo ADV 3</label>
                        <input type="text" id="pcesp-rl-adv3" value="${pcRl.adv3 || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-adv3" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Administrativo</label>
                        <input type="text" id="pcesp-rl-administrativo" value="${pcRl.administrativo || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-administrativo" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Cargo Ministrador</label>
                        <input type="text" id="pcesp-rl-ministrador" value="${pcRl.ministrador || ''}" placeholder="ID do cargo" class="discord-role-input w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        <div id="name-pcesp-rl-ministrador" class="mt-1.5 min-h-[15px]"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- BOTÃO SALVAR -->
              <div class="flex justify-end gap-3 card-premium rounded-2xl p-4">
                <button type="submit" id="save-settings-btn" class="bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs px-6 py-3 rounded-xl transition-all shadow-lg shadow-brand-500/10 active:scale-98">Salvar Configurações</button>
              </div>
              
            </form>
          </div>
        `;
      },

      ausenciasPage: (ausencias, filters) => `
        <div class="card-premium rounded-2xl overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h3 class="text-xl font-bold tracking-tight">Gerenciamento de Ausências</h3>
              <p class="text-sm text-[var(--text-muted)] mt-1">Monitore e analise os pedidos de licença e afastamento dos oficiais da SSP.</p>
            </div>

            <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto p-2 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-subtle)]">
              <select id="aus-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                <option value="pendente" ${filters.status === 'pendente' ? 'selected' : ''}>Pendentes</option>
                <option value="aprovado" ${filters.status === 'aprovado' ? 'selected' : ''}>Aprovados</option>
                <option value="reprovado" ${filters.status === 'reprovado' ? 'selected' : ''}>Reprovados</option>
              </select>
              <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
              <input type="text" id="aus-search" placeholder="Policial ou Passaporte..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-40 px-2" value="${filters.q || ''}">
              <button id="aus-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Policial</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Período</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Duração</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Status</th>
                  <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Gestão</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                ${ausencias.length
                  ? ausencias.map(a => {
                      const statusColors = {
                        pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
                        aprovado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                        reprovado: 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                      };

                      return `
                        <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                          <td class="p-4 px-6 font-semibold">
                            <div class="font-semibold text-sm text-zinc-200">${a.nomeRp || a.username}</div>
                            <div class="text-xs text-[var(--text-muted)]">Passaporte: ${a.passaporte || 'N/A'} | Discord: @${a.username}</div>
                          </td>
                          <td class="p-4 px-6 text-sm text-zinc-300 font-medium">
                            <div>de <strong>${a.dataInicio}</strong></div>
                            <div class="text-xs text-[var(--text-muted)]">até <strong>${a.dataFim}</strong></div>
                          </td>
                          <td class="p-4 px-6 text-center text-sm font-semibold text-zinc-300">
                            ${a.duracaoDias} dia(s)
                          </td>
                          <td class="p-4 px-6 text-center">
                            <span class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] rounded-xl border ${statusColors[a.status]}">
                              ${a.status}
                            </span>
                          </td>
                          <td class="p-4 px-6 text-right">
                            <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                              <button class="analyse-aus-btn btn-brand text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-id="${a._id}">
                                <i class="fas fa-magnifying-glass text-[10px]"></i> ${a.status === 'pendente' ? 'Analisar' : 'Visualizar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')
                  : `
                    <tr>
                      <td colspan="5" class="text-center p-12 text-[var(--text-muted)]">
                        <i class="fas fa-calendar-xmark text-3xl mb-3 block opacity-30"></i>
                        Nenhum pedido de ausência cadastrado.
                      </td>
                    </tr>
                  `
                }
              </tbody>
            </table>
          </div>
        </div>
      `,

      warningsPage: (warnings, filters) => `
        <div class="card-premium rounded-2xl overflow-hidden">
          <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/70 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h3 class="text-xl font-bold tracking-tight">Advertências Disciplinares</h3>
              <p class="text-sm text-[var(--text-muted)] mt-1">Visualize e aplique punições administrativas e advertências aos oficiais.</p>
            </div>

            <div class="flex flex-wrap items-center gap-3 w-full xl:w-auto">
              <div class="flex items-center gap-2 p-1.5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-subtle)]">
                <select id="warn-status" class="bg-transparent border-0 focus:ring-0 text-xs font-semibold py-1">
                  <option value="" ${filters.status === '' ? 'selected' : ''}>Todos os Status</option>
                  <option value="active" ${filters.status === 'active' ? 'selected' : ''}>Ativas</option>
                  <option value="expired" ${filters.status === 'expired' ? 'selected' : ''}>Expiradas</option>
                </select>
                <div class="w-px h-4 bg-[var(--border-subtle)]"></div>
                <input type="text" id="warn-search" placeholder="Policial ou Caso..." class="bg-transparent border-0 focus:ring-0 text-xs font-semibold w-40 px-2" value="${filters.q || ''}">
                <button id="warn-apply-filter" class="bg-brand-500 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-brand-600 transition-colors">Buscar</button>
              </div>

              <button id="apply-warning-btn" class="btn-brand text-xs px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-brand-500/10 active:scale-98">
                <i class="fas fa-plus"></i> Aplicar Advertência
              </button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-[var(--card-bg-soft)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Identificador</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Policial</th>
                  <th class="px-6 py-4 text-left font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Punição</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Validade</th>
                  <th class="px-6 py-4 text-center font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Status</th>
                  <th class="px-6 py-4 text-right font-bold text-[var(--text-muted)] uppercase tracking-[0.16em] text-[10px]">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--card-bg)]">
                ${warnings.length
                  ? warnings.map(w => {
                      const statusColors = {
                        active: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
                        expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                      };

                      const levelLabels = {
                        verbal: 'Advertência Verbal',
                        adv1: 'ADV 1',
                        adv2: 'ADV 2',
                        adv3: 'ADV 3'
                      };

                      return `
                        <tr class="hover:bg-[var(--card-bg-soft)]/55 transition-colors group">
                          <td class="p-4 px-6 font-mono font-bold text-xs text-brand-400">
                            ${w.caseNumber}
                          </td>
                          <td class="p-4 px-6 font-semibold">
                            <div class="font-semibold text-sm text-zinc-200">${w.officerName}</div>
                            <div class="text-xs text-[var(--text-muted)]">ID Discord: ${w.userId}</div>
                          </td>
                          <td class="p-4 px-6 text-sm text-zinc-300 font-semibold">
                            ${levelLabels[w.penalty] || w.penalty}
                          </td>
                          <td class="p-4 px-6 text-center text-xs text-[var(--text-muted)]">
                            ${w.permanent ? '<strong>Permanente</strong>' : `Expira em:<br><strong>${this.formatDateTime(w.expiresAt)}</strong>`}
                          </td>
                          <td class="p-4 px-6 text-center">
                            <span class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] rounded-xl border ${statusColors[w.status]}">
                              ${w.status === 'active' ? 'Ativa' : 'Expirada'}
                            </span>
                          </td>
                          <td class="p-4 px-6 text-right">
                            <div class="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                              <button class="view-warn-btn btn-soft text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5" data-id="${w._id}">
                                <i class="fas fa-eye text-[10px]"></i> Detalhes
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')
                  : `
                    <tr>
                      <td colspan="6" class="text-center p-12 text-[var(--text-muted)]">
                        <i class="fas fa-triangle-exclamation text-3xl mb-3 block opacity-30"></i>
                        Nenhuma advertência cadastrada no sistema.
                      </td>
                    </tr>
                  `
                }
              </tbody>
            </table>
          </div>
        </div>
      `,

      officersPage: (list, searchVal) => `
        <div class="space-y-6">
          <div class="card-premium rounded-2xl p-6 bg-[var(--card-bg-soft)]/50 border border-[var(--border-subtle)]">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 class="text-xl font-bold tracking-tight">Dossiê de Carreira</h3>
                <p class="text-xs text-[var(--text-muted)] mt-1">Consulte as fichas individuais, contadores e anotações administrativas dos policiais.</p>
              </div>
              <div class="flex items-center gap-2 max-w-sm w-full">
                <div class="relative w-full">
                  <i class="fas fa-search absolute left-3.5 top-3 text-[var(--text-muted)] text-xs"></i>
                  <input type="text" id="officers-search" value="${searchVal || ''}" placeholder="Buscar por policial ou ID..." class="w-full pl-9 pr-4 py-2.5 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all" />
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            ${list.length > 0 ? list.map(o => {
              const avatarUrl = o.avatar ? `https://cdn.discordapp.com/avatars/${o.id}/${o.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
              return `
                <div class="card-premium rounded-2xl p-5 flex flex-col justify-between hover:border-brand-500/40 transition-all duration-300 relative group">
                  <div class="absolute top-4 right-4 bg-brand-500/10 text-brand-400 border border-brand-500/20 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    ${o.shiftsCount} plantões
                  </div>
                  
                  <div class="flex items-center gap-4 mb-4">
                    <img src="${avatarUrl}" class="w-14 h-14 rounded-2xl bg-zinc-950 border border-[var(--border-subtle)] object-cover shadow-md" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                    <div class="min-w-0">
                      <h4 class="font-bold text-sm text-zinc-100 truncate">${o.displayName}</h4>
                      <p class="text-[10px] text-[var(--text-muted)] truncate">@${o.username}</p>
                    </div>
                  </div>

                  <div class="grid grid-cols-3 gap-1 bg-zinc-950/20 rounded-xl p-2.5 border border-[var(--border-subtle)]/30 mb-4 text-center">
                    <div>
                      <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Horas</p>
                      <p class="text-xs font-bold text-zinc-200 mt-0.5">${o.totalHours}h</p>
                    </div>
                    <div>
                      <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Ações</p>
                      <p class="text-xs font-bold text-zinc-200 mt-0.5">${o.acoes}</p>
                    </div>
                    <div>
                      <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Apreensões</p>
                      <p class="text-xs font-bold text-zinc-200 mt-0.5">${o.apreensoes}</p>
                    </div>
                  </div>

                  <button data-userid="${o.id}" class="view-officer-profile-btn w-full btn-soft py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 group-hover:bg-brand-500 group-hover:text-white transition-all">
                    <i class="fas fa-id-badge"></i> Ver Dossiê Completo
                  </button>
                </div>
              `;
            }).join('') : `
              <div class="col-span-full card-premium rounded-2xl p-12 text-center text-[var(--text-muted)]">
                <i class="fas fa-users-slash text-4xl mb-3 opacity-30"></i>
                <p class="text-sm">Nenhum oficial encontrado.</p>
              </div>
            `}
          </div>
        </div>
      `,

      officerProfileModal: (o, formatDateTime) => {
        const avatarUrl = o.avatar ? `https://cdn.discordapp.com/avatars/${o.id}/${o.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
        const user = this.state.user || {};
        return `
          <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
            <div class="card-premium rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden bg-[var(--card-bg)] shadow-2xl relative">
              <button class="absolute top-4 right-4 text-[var(--text-muted)] hover:text-white close-modal-btn z-10 p-2">
                <i class="fas fa-times text-lg"></i>
              </button>

              <!-- Profile Header -->
              <div class="p-6 border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/50 flex flex-col sm:flex-row items-center gap-4">
                <img src="${avatarUrl}" class="w-16 h-16 rounded-2xl border border-[var(--border-subtle)] shadow-xl" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                <div class="text-center sm:text-left min-w-0 flex-1">
                  <h3 class="text-lg font-extrabold text-zinc-100 truncate">${o.displayName}</h3>
                  <p class="text-xs text-[var(--text-muted)]">@${o.username} • ID: ${o.id}</p>
                  ${o.joinedAt ? `<p class="text-[10px] text-[var(--text-muted)] mt-1"><i class="fab fa-discord mr-1.5"></i>Entrou no Discord: <strong>${formatDateTime(o.joinedAt)}</strong></p>` : ''}
                  <div class="flex flex-wrap gap-1 mt-2 justify-center sm:justify-start">
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">${o.shiftsCount} Turnos</span>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">${o.totalHours} Horas</span>
                    ${o.warnings.length > 0 ? `<span class="text-[9px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">${o.warnings.length} Advertências</span>` : ''}
                  </div>
                </div>
              </div>

              <!-- Tab Nav -->
              <div class="flex border-b border-[var(--border-subtle)] bg-[var(--card-bg-soft)]/20 px-6 overflow-x-auto no-scrollbar">
                <button data-tab="general" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-brand-500 text-brand-500 active">Resumo</button>
                <button data-tab="shifts" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-transparent text-[var(--text-muted)] hover:text-zinc-200">Plantões</button>
                <button data-tab="penal" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-transparent text-[var(--text-muted)] hover:text-zinc-200">Prontuário</button>
                <button data-tab="leaves" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-transparent text-[var(--text-muted)] hover:text-zinc-200">Ausências</button>
                <button data-tab="notes" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-transparent text-[var(--text-muted)] hover:text-zinc-200">Observações</button>
                ${user.isAdmin ? `<button data-tab="admin" class="profile-tab-btn px-4 py-3 text-xs font-bold border-b-2 border-transparent text-rose-400 hover:text-rose-300">Administração</button>` : ''}
              </div>

              <!-- Tab Contents -->
              <div class="flex-1 overflow-y-auto p-6 space-y-6 max-h-[50vh] no-scrollbar">
                
                <!-- Geral Tab -->
                <div id="tab-content-general" class="profile-tab-content space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div class="grid grid-cols-2 gap-3">
                      <div class="p-3 bg-zinc-950/20 border border-[var(--border-subtle)] rounded-xl text-center flex flex-col justify-center">
                        <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold mb-0.5">Ações Policiais</p>
                        <p class="text-2xl font-black text-brand-400 mt-0.5">${o.acoes}</p>
                      </div>
                      <div class="p-3 bg-zinc-950/20 border border-[var(--border-subtle)] rounded-xl text-center flex flex-col justify-center">
                        <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold mb-0.5">Apreensões</p>
                        <p class="text-2xl font-black text-brand-400 mt-0.5">${o.apreensoes}</p>
                      </div>
                      <div class="p-3 bg-zinc-950/20 border border-[var(--border-subtle)] rounded-xl text-center flex flex-col justify-center">
                        <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold mb-0.5">Avaliações Feitas</p>
                        <p class="text-2xl font-black text-brand-400 mt-0.5">${o.avaliacoesRealizadas}</p>
                      </div>
                      <div class="p-3 bg-zinc-950/20 border border-[var(--border-subtle)] rounded-xl text-center flex flex-col justify-center">
                        <p class="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold mb-0.5">Avaliações Recebidas</p>
                        <p class="text-2xl font-black text-brand-400 mt-0.5">${o.avaliacoesRecebidas}</p>
                      </div>
                    </div>

                    <!-- Ficha de Recrutamento -->
                    <div class="p-4 bg-zinc-950/20 border border-[var(--border-subtle)] rounded-xl text-left text-xs space-y-2">
                      <p class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-bold border-b border-[var(--border-subtle)] pb-1 mb-1.5"><i class="fas fa-file-signature text-brand-400 mr-1.5"></i>Recrutamento SSP</p>
                      ${o.recruitment ? `
                        <div class="space-y-1">
                          <div class="flex justify-between"><span class="text-[var(--text-muted)] font-semibold">Submissão:</span> <span class="font-bold text-zinc-200">${formatDateTime(o.recruitment.createdAt)}</span></div>
                          <div class="flex justify-between"><span class="text-[var(--text-muted)] font-semibold">Decisão:</span> <span class="font-bold text-zinc-200">${formatDateTime(o.recruitment.updatedAt)}</span></div>
                          <div class="flex justify-between"><span class="text-[var(--text-muted)] font-semibold">Autor:</span> <span class="font-bold text-zinc-200">@${o.recruitment.aprovadoPor || o.recruitment.reprovadoPor || 'Comando'}</span></div>
                          <div class="flex justify-between items-center"><span class="text-[var(--text-muted)] font-semibold">Status:</span> <span class="uppercase text-[9px] px-1.5 py-0.5 rounded font-extrabold ${o.recruitment.status === 'aprovado' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">${o.recruitment.status}</span></div>
                        </div>
                      ` : `
                        <p class="text-[11px] text-[var(--text-muted)] italic py-2">Nenhum formulário de recrutamento encontrado no sistema.</p>
                      `}
                    </div>
                  </div>
                </div>

                <!-- Shifts Tab -->
                <div id="tab-content-shifts" class="profile-tab-content hidden space-y-4">
                  ${this.state.lastProfileFiltered && (this.state.pontoFilters.startDate || this.state.pontoFilters.endDate) ? `
                    <div class="p-3.5 bg-brand-500/10 border border-brand-500/20 rounded-xl flex items-center justify-between text-xs animate-fade-in">
                      <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-400">
                          <i class="fas fa-calendar-alt text-sm"></i>
                        </div>
                        <div>
                          <p class="font-bold text-zinc-200">Período Filtrado</p>
                          <p class="text-[10px] text-[var(--text-muted)]">
                            ${this.state.pontoFilters.startDate ? `De <strong>${this.state.pontoFilters.startDate}</strong>` : ''} 
                            ${this.state.pontoFilters.endDate ? `Até <strong>${this.state.pontoFilters.endDate}</strong>` : ''}
                          </p>
                        </div>
                      </div>
                      <div class="text-right">
                        <span class="text-[10px] font-extrabold text-emerald-400 block">${o.totalHours.toFixed(1)}h Patrulhadas</span>
                        <span class="text-[9px] text-[var(--text-muted)]">${o.shiftsCount} turnos no período</span>
                      </div>
                    </div>
                  ` : ''}
                  <div class="overflow-x-auto no-scrollbar">
                    <table class="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr class="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase tracking-wider font-bold text-[9px]">
                          <th class="py-2.5 pb-2">Entrada</th>
                          <th class="py-2.5 pb-2">Saída</th>
                          <th class="py-2.5 pb-2 text-right">Duração</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[var(--border-subtle)]/30 text-zinc-300">
                        ${o.shifts.length > 0 ? o.shifts.map(s => `
                          <tr class="hover:bg-[var(--card-bg-soft)]/30 transition-colors">
                            <td class="py-2.5 font-semibold">${formatDateTime(s.entrada)}</td>
                            <td class="py-2.5">${s.saida ? formatDateTime(s.saida) : 'Em andamento'}</td>
                            <td class="py-2.5 text-right font-bold text-emerald-400">${s.status === 'fechado' ? `${(s.durationMs / (1000 * 60 * 60)).toFixed(1)}h` : '---'}</td>
                          </tr>
                        `).join('') : `
                          <tr>
                            <td colspan="3" class="py-8 text-center text-[var(--text-muted)]">
                              <i class="fas fa-history text-2xl mb-2 block opacity-30"></i>
                              Nenhum turno finalizado registrado ${this.state.lastProfileFiltered ? 'neste período' : ''}.
                            </td>
                          </tr>
                        `}
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Penal Tab -->
                <div id="tab-content-penal" class="profile-tab-content hidden space-y-4">
                  ${o.warnings.length > 0 ? o.warnings.map(w => {
                    const statusClass = w.status === 'ativo' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
                    return `
                      <div class="p-4 border border-[var(--border-subtle)] bg-zinc-950/10 rounded-xl relative">
                        <span class="absolute top-4 right-4 text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${statusClass}">
                          ${w.status}
                        </span>
                        <h4 class="font-bold text-xs text-zinc-200">Protocolo: ${w.caseNumber || 'N/A'}</h4>
                        <p class="text-[10px] text-[var(--text-muted)] mt-1">Punição: <strong class="text-zinc-300">${w.penalty}</strong></p>
                        <p class="text-xs text-zinc-300 mt-2 italic">"${w.reason}"</p>
                        <p class="text-[9px] text-[var(--text-muted)] mt-3">Aplicado em: ${formatDateTime(w.createdAt)} • Validade: ${w.expiryDate ? formatDateTime(w.expiryDate) : 'Permanente'}</p>
                      </div>
                    `;
                  }).join('') : `
                    <div class="p-8 text-center text-[var(--text-muted)] card-premium rounded-xl border border-[var(--border-subtle)]/40">
                      <i class="fas fa-shield text-3xl text-emerald-500 mb-2"></i>
                      <p class="text-sm font-semibold">Oficial com ficha limpa!</p>
                      <p class="text-xs">Nenhuma advertência disciplinar ativa ou arquivada.</p>
                    </div>
                  `}
                </div>

                <!-- Ausências Tab -->
                <div id="tab-content-leaves" class="profile-tab-content hidden space-y-4">
                  <div class="overflow-x-auto no-scrollbar">
                    <table class="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr class="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                          <th class="py-2.5">Período</th>
                          <th class="py-2.5">Motivo</th>
                          <th class="py-2.5 text-center">Dias</th>
                          <th class="py-2.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[var(--border-subtle)]/30 text-zinc-300">
                        ${o.ausencias && o.ausencias.length > 0 ? o.ausencias.map(a => {
                          const statusBadge = a.status === 'aprovado'
                            ? `<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Aprovada</span>`
                            : a.status === 'reprovado'
                            ? `<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">Reprovada</span>`
                            : `<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">Pendente</span>`;
                          return `
                            <tr>
                              <td class="py-2.5 font-semibold">${a.dataInicio} até ${a.dataFim}</td>
                              <td class="py-2.5 max-w-[200px] truncate" title="${a.motivo}">${a.motivo}</td>
                              <td class="py-2.5 text-center font-bold text-zinc-300">${a.duracaoDias} dias</td>
                              <td class="py-2.5 text-right">${statusBadge}</td>
                            </tr>
                          `;
                        }).join('') : `
                          <tr>
                            <td colspan="4" class="py-8 text-center text-[var(--text-muted)]">Nenhum pedido de ausência/licença registrado.</td>
                          </tr>
                        `}
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Notes Tab -->
                <div id="tab-content-notes" class="profile-tab-content hidden space-y-4">
                  <div class="space-y-3">
                    ${o.observations.length > 0 ? o.observations.map(obs => `
                      <div class="p-3 bg-[var(--card-bg-soft)] rounded-xl border border-[var(--border-subtle)]/30 text-xs">
                        <p class="text-zinc-300">${obs.text}</p>
                        <div class="flex justify-between items-center text-[9px] text-[var(--text-muted)] mt-2 font-semibold uppercase">
                          <span>Por: ${obs.author}</span>
                          <span>${formatDateTime(obs.date)}</span>
                        </div>
                      </div>
                    `).join('') : `
                      <p class="text-xs text-[var(--text-muted)] text-center py-6">Nenhuma anotação registrada.</p>
                    `}
                  </div>

                  ${user.isAdmin ? `
                    <form id="add-observation-form" class="border-t border-[var(--border-subtle)]/40 pt-4 flex gap-2">
                      <input type="text" id="obs-text" placeholder="Adicionar anotação de comando..." class="flex-1 px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100 placeholder-zinc-500 focus:outline-none" required />
                      <button type="submit" class="bg-brand-500 hover:bg-brand-600 text-white rounded-xl px-3 flex items-center justify-center active:scale-95 transition-all">
                        <i class="fas fa-plus"></i>
                      </button>
                    </form>
                  ` : ''}
                </div>

                <!-- Admin Tab (Command Settings) -->
                ${user.isAdmin ? `
                  <div id="tab-content-admin" class="profile-tab-content hidden space-y-4">
                    <form id="edit-counters-form" class="space-y-4 card-premium p-4 rounded-xl border border-rose-500/20 bg-zinc-950/10">
                      <h4 class="text-xs font-extrabold text-zinc-300 uppercase tracking-wider border-b border-[var(--border-subtle)] pb-2 mb-3">
                        Ajuste de Contadores Operacionais
                      </h4>
                      <div class="grid grid-cols-2 gap-4">
                        <div>
                          <label class="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Ações Policiais</label>
                          <input type="number" id="cnt-acoes" value="${o.acoes}" min="0" class="w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        </div>
                        <div>
                          <label class="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Apreensões</label>
                          <input type="number" id="cnt-apreensoes" value="${o.apreensoes}" min="0" class="w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        </div>
                        <div>
                          <label class="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Avaliações Realizadas</label>
                          <input type="number" id="cnt-avaliacoesRealizadas" value="${o.avaliacoesRealizadas}" min="0" class="w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        </div>
                        <div>
                          <label class="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Avaliações Recebidas</label>
                          <input type="number" id="cnt-avaliacoesRecebidas" value="${o.avaliacoesRecebidas}" min="0" class="w-full px-3 py-2 bg-zinc-950/40 rounded-xl text-xs border border-[var(--border-subtle)] focus:border-brand-500 text-zinc-100" />
                        </div>
                      </div>
                      <button type="submit" class="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs py-2 rounded-xl active:scale-95 transition-all shadow-md mt-2">
                        Salvar Contadores
                      </button>
                    </form>
                  </div>
                ` : ''}

              </div>
            </div>
          </div>
        `;
      },

      rankingPage: (data) => {
        const rHours = data.rankingHours || [];
        const rAcoes = data.rankingAcoes || [];
        const rApreensoes = data.rankingApreensoes || [];

        const renderPodium = (list, unit = 'h') => {
          if (!list || list.length === 0) return '<div class="text-center py-6 text-[var(--text-muted)] text-xs">Sem dados suficientes para o pódio.</div>';
          
          const first = list[0];
          const second = list[1];
          const third = list[2];

          const getAvatar = (item) => {
            if (item && item.avatarUrl) return item.avatarUrl;
            const id = item ? item.userId : '0';
            return `https://cdn.discordapp.com/embed/avatars/${parseInt(id) % 5}.png`;
          };

          return `
            <div class="flex items-end justify-center gap-4 sm:gap-8 pt-8 pb-4">
              
              <!-- 2º Lugar (Silver) -->
              ${second ? `
                <div class="flex flex-col items-center">
                  <div class="relative mb-2">
                    <img src="${getAvatar(second)}" class="w-14 h-14 rounded-2xl border-2 border-zinc-400 bg-zinc-900 object-cover shadow-lg" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                    <span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-zinc-500 text-[9px] font-black px-2 py-0.5 rounded-full text-white uppercase border border-zinc-400">2º</span>
                  </div>
                  <p class="text-xs font-bold text-zinc-200 max-w-[80px] truncate text-center">${second.username}</p>
                  <p class="text-[10px] text-zinc-400 font-extrabold">${second.totalHours !== undefined ? second.totalHours : second.value}${unit}</p>
                  <div class="w-16 sm:w-20 bg-zinc-600/40 border border-zinc-500/30 rounded-t-lg h-20 mt-2 flex items-center justify-center">
                    <i class="fas fa-award text-2xl text-zinc-400"></i>
                  </div>
                </div>
              ` : ''}

              <!-- 1º Lugar (Gold) -->
              ${first ? `
                <div class="flex flex-col items-center -translate-y-4">
                  <div class="relative mb-2 animate-bounce-slow">
                    <img src="${getAvatar(first)}" class="w-16 h-16 rounded-2xl border-2 border-amber-400 bg-zinc-900 object-cover shadow-2xl" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                    <span class="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-[10px] font-black px-2.5 py-0.5 rounded-full text-white uppercase border border-amber-400">1º</span>
                    <i class="fas fa-crown absolute -top-8 left-1/2 -translate-x-1/2 text-xl text-amber-400"></i>
                  </div>
                  <p class="text-xs font-black text-zinc-100 max-w-[90px] truncate text-center">${first.username}</p>
                  <p class="text-[11px] text-amber-400 font-black">${first.totalHours !== undefined ? first.totalHours : first.value}${unit}</p>
                  <div class="w-20 sm:w-24 bg-amber-500/20 border border-amber-500/40 rounded-t-lg h-28 mt-2 flex items-center justify-center">
                    <i class="fas fa-trophy text-3xl text-amber-400"></i>
                  </div>
                </div>
              ` : ''}

              <!-- 3º Lugar (Bronze) -->
              ${third ? `
                <div class="flex flex-col items-center">
                  <div class="relative mb-2">
                    <img src="${getAvatar(third)}" class="w-14 h-14 rounded-2xl border-2 border-amber-800 bg-zinc-900 object-cover shadow-lg" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                    <span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-800 text-[9px] font-black px-2 py-0.5 rounded-full text-white uppercase border border-amber-700">3º</span>
                  </div>
                  <p class="text-xs font-bold text-zinc-200 max-w-[80px] truncate text-center">${third.username}</p>
                  <p class="text-[10px] text-zinc-400 font-extrabold">${third.totalHours !== undefined ? third.totalHours : third.value}${unit}</p>
                  <div class="w-16 sm:w-20 bg-amber-900/30 border border-amber-800/30 rounded-t-lg h-16 mt-2 flex items-center justify-center">
                    <i class="fas fa-medal text-xl text-amber-700"></i>
                  </div>
                </div>
              ` : ''}

            </div>
          `;
        };

        const renderTableList = (list, unit = 'h') => {
          if (!list || list.length <= 3) return '';
          const remainder = list.slice(3);
          const maxVal = list[0].totalHours !== undefined ? list[0].totalHours : list[0].value;

          const getAvatar = (item) => {
            if (item && item.avatarUrl) return item.avatarUrl;
            const id = item ? item.userId : '0';
            return `https://cdn.discordapp.com/embed/avatars/${parseInt(id) % 5}.png`;
          };

          return `
            <div class="mt-6 border-t border-[var(--border-subtle)]/40 pt-4 space-y-3">
              <h5 class="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider px-2">Demais Colocações</h5>
              <div class="space-y-2">
                ${remainder.map((item, index) => {
                  const val = item.totalHours !== undefined ? item.totalHours : item.value;
                  const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                  return `
                    <div class="flex items-center gap-3 px-3 py-2 bg-zinc-950/10 border border-[var(--border-subtle)]/30 rounded-xl text-xs hover:border-brand-500/20 transition-all">
                      <span class="font-extrabold text-[var(--text-muted)] w-5">${index + 4}º</span>
                      <img src="${getAvatar(item)}" class="w-7 h-7 rounded-lg bg-zinc-900 border border-[var(--border-subtle)] object-cover flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                      <div class="flex-1 min-w-0">
                        <div class="flex justify-between mb-1">
                          <span class="font-bold text-zinc-200 truncate">${item.username}</span>
                          <span class="font-bold text-brand-400">${val}${unit}</span>
                        </div>
                        <div class="w-full bg-zinc-950/50 h-1.5 rounded-full overflow-hidden">
                          <div class="bg-brand-500 h-full rounded-full" style="width: ${pct}%"></div>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        };

        return `
          <div class="space-y-6">
            <div id="board-hours" class="ranking-board card-premium rounded-2xl p-6 bg-[var(--card-bg-soft)]/20">
              <div class="border-b border-[var(--border-subtle)] pb-3 mb-4 flex justify-between items-center">
                <h4 class="font-extrabold text-sm text-zinc-200 uppercase tracking-wider">Top 15 - Horas Trabalhadas</h4>
                <span class="text-[10px] text-[var(--text-muted)] font-semibold">Atualizado dinamicamente</span>
              </div>
              ${renderPodium(rHours, 'h')}
              ${renderTableList(rHours, 'h')}
            </div>
          </div>
        `;
      },

      notFoundPage: () => `
        <div class="flex flex-col items-center justify-center h-full text-center py-20 animate-fade-in">
          <h1 class="text-7xl font-black text-[var(--border-subtle)] mb-2">404</h1>
          <p class="text-lg font-bold">Página não encontrada</p>
          <p class="text-sm text-[var(--text-muted)] mt-1">A rota solicitada não existe no Painel da LSPD.</p>
        </div>
      `
    };
  }
}

new PfPanelApp(document.getElementById('app-root'));

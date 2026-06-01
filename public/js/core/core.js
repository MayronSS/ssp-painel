/**
 * LSPD Panel — Namespace & Core Utilities
 * All modules register under the global LSPD namespace.
 */
window.LSPD = window.LSPD || {};

LSPD.utils = {
  formatDateTime(value) {
    if (!value) return '---';
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  },

  formatDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  },

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatDuration(ms) {
    if (!ms) return '---';
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  },

  formatBytes(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size <= 0) return '---';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  },

  formatLogDetailKey(key = '') {
    const labels = {
      origem: 'Origem', ticketId: 'Ticket', channelId: 'Canal',
      channelName: 'Nome do canal', transcriptId: 'Transcript',
      protocolo: 'Protocolo', citizenId: 'Cidadão', citizenName: 'Nome',
      claimedBy: 'Assumido por', closedBy: 'Fechado por',
      discordChannelDeleted: 'Canal excluído', voiceChannelDeleted: 'Rádio excluído',
      discordMessageId: 'Mensagem Discord', formato: 'Formato',
      relatorio: 'Relatório', total: 'Total', filtro: 'Filtro',
      status: 'Status', modulo: 'Módulo', inicio: 'Início', fim: 'Fim',
      tamanho: 'Tamanho', preview: 'Prévia', ausenciaId: 'ID Ausência',
      caseNumber: 'ID Caso', userId: 'ID Discord', level: 'Nível', duration: 'Duração'
    };
    return labels[key] || String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  },

  formatLogDetailValue(value) {
    if (value === true) return 'Sim';
    if (value === false) return 'Não';
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '---');
  }
};

LSPD.createState = function() {
  return {
    user: null,
    theme: localStorage.getItem('theme') || 'dark',
    currentPage: '',
    timers: {},
    charts: {},
    cidadaosSearch: '',
    officersSearch: '',
    lastProfileFiltered: false,
    pontoActiveTab: 'records',
    solicitacoesFilters: { status: '', modulo: '', q: '' },
    pontoFilters: { status: '', q: '', userId: '', roleId: '', startDate: '', endDate: '', corporationSlug: '' },
    ticketsFilters: { status: '', q: '' },
    corregedoriaFilters: { status: '', q: '' },
    transcriptsFilters: { modulo: '', q: '' },
    logsFilters: { type: '', q: '', page: 1 },
    ausenciasFilters: { status: '', q: '' },
    warningsFilters: { status: '', q: '' }
  };
};

LSPD.toast = {
  show(toastRoot, message, type = 'info') {
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const colors = { success: 'bg-emerald-500', error: 'bg-rose-500', info: 'bg-brand-500' };
    const toast = document.createElement('div');
    toast.className = `flex items-center w-full max-w-sm p-4 text-white ${colors[type]} rounded-2xl shadow-2xl fade-in`;
    toast.innerHTML = `
      <div class="text-xl"><i class="fas ${icons[type]}"></i></div>
      <div class="ml-4 flex-1 text-sm font-semibold tracking-wide">${message}</div>
    `;
    toastRoot.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all .35s ease';
      setTimeout(() => toast.remove(), 350);
    }, 3800);
  }
};

LSPD.modal = {
  setupClose(modalRoot) {
    modalRoot.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => { modalRoot.innerHTML = ''; });
    });
    const backdrop = modalRoot.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) modalRoot.innerHTML = '';
      });
    }
  },
  close(modalRoot) {
    modalRoot.innerHTML = '';
  },
  showLoading(modalRoot, message = 'Carregando...') {
    modalRoot.innerHTML = `
      <div class="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
        <div class="card-premium rounded-2xl p-8 max-w-lg w-full text-center">
          <i class="fas fa-circle-notch fa-spin text-3xl text-brand-500"></i>
          <p class="text-sm mt-3 text-[var(--text-muted)]">${message}</p>
        </div>
      </div>
    `;
  }
};

LSPD.api = {
  _onUnauthorized: null,

  async fetch(endpoint, options = {}) {
    try {
      const response = await fetch(`/api${endpoint}`, options);
      if (response.status === 401) {
        if (this._onUnauthorized) this._onUnauthorized();
        return { success: false, message: 'Sessão expirada.' };
      }
      return await response.json();
    } catch (error) {
      console.error('Erro de rede:', error);
      return { success: false, message: 'Erro de rede ao comunicar com a API.' };
    }
  },

  _buildParams(filters) {
    return new URLSearchParams(
      Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== undefined && v !== null && v !== '')
      )
    ).toString();
  },

  getDashboardSummary() { return this.fetch('/dashboard/summary'); },
  getCidadaos(q = '') { return this.fetch(`/cidadaos?q=${encodeURIComponent(q)}`); },
  getCidadaoDetails(userId) { return this.fetch(`/cidadaos/${userId}`); },
  getSolicitacoes(filters = {}) { return this.fetch(`/solicitacoes?${this._buildParams(filters)}`); },
  approveSolicitacao(id) { return this.fetch(`/solicitacoes/${id}/approve`, { method: 'PUT' }); },
  rejectSolicitacao(id, reason) {
    return this.fetch(`/solicitacoes/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
  },
  getTickets(filters = {}) { return this.fetch(`/tickets?${this._buildParams(filters)}`); },
  claimTicket(id, claimedBy = '') {
    return this.fetch(`/tickets/${id}/claim`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimedBy })
    });
  },
  closeTicket(id, deleteChannel = false) {
    return this.fetch(`/tickets/${id}/close`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteChannel })
    });
  },
  getCorregedoria(filters = {}) { return this.fetch(`/corregedoria?${this._buildParams(filters)}`); },
  getTranscripts(filters = {}) { return this.fetch(`/transcripts?${this._buildParams(filters)}`); },
  getLogs(filters = {}) { return this.fetch(`/logs?${this._buildParams(filters)}`); },
  getAusencias(status = '', q = '') {
    return this.fetch(`/ausencias?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  },
  approveAusencia(id) { return this.fetch(`/ausencias/${id}/approve`, { method: 'PUT' }); },
  rejectAusencia(id, reason) {
    return this.fetch(`/ausencias/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
  },
  getWarnings(status = '', q = '') {
    return this.fetch(`/warnings?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  },
  applyWarning(userId, level, duration, reason) {
    return this.fetch('/warnings/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, level, duration, reason })
    });
  },

  // --- Notification API ---
  getNotifications(page = 1) { return this.fetch(`/notifications?page=${page}`); },
  getUnreadCount() { return this.fetch('/notifications/unread-count'); },
  markNotificationRead(id) { return this.fetch(`/notifications/${id}/read`, { method: 'PUT' }); },
  markAllNotificationsRead() { return this.fetch('/notifications/read-all', { method: 'PUT' }); },

  // --- Academy API ---
  getAcademyCourses(category = '') { return this.fetch(`/academy/courses${category ? `?category=${category}` : ''}`); },
  getAcademyCourse(id) { return this.fetch(`/academy/courses/${id}`); },
  createAcademyCourse(data) {
    return this.fetch('/academy/courses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },
  updateAcademyCourse(id, data) {
    return this.fetch(`/academy/courses/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },
  deleteAcademyCourse(id) { return this.fetch(`/academy/courses/${id}`, { method: 'DELETE' }); },
  enrollInCourse(courseId) { return this.fetch(`/academy/enroll/${courseId}`, { method: 'POST' }); },
  completeModule(courseId, moduleIndex) { return this.fetch(`/academy/enroll/${courseId}/complete-module/${moduleIndex}`, { method: 'PUT' }); },
  getMyEnrollments() { return this.fetch('/academy/my-enrollments'); },
  getAcademyStats() { return this.fetch('/academy/stats'); },

  // --- Ticket Categorization API ---
  getTicketCategories() { return this.fetch('/tickets/categories'); },
  categorizeAllTickets() { return this.fetch('/tickets/categorize-all', { method: 'POST' }); }
};

LSPD.charts = {
  render(app, summary) {
    Object.values(app.state.charts).forEach(chart => chart?.destroy?.());
    app.state.charts = {};
    const isDark = app.state.theme === 'dark';
    const labelColor = isDark ? '#a1a1aa' : '#71717a';
    const gridColor = isDark ? '#27272a' : '#e4e4e7';
    const cardBg = isDark ? '#18181b' : '#ffffff';

    const activityCanvas = app.root.querySelector('#activity-chart');
    if (activityCanvas) {
      const ctx = activityCanvas.getContext('2d');
      const labels = Object.keys(summary.weeklyActivity).reverse();
      const values = Object.values(summary.weeklyActivity).reverse();
      app.state.charts.activity = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels.map(l => { const p = l.split('-'); return `${p[2]}/${p[1]}`; }),
          datasets: [{
            label: 'Enviadas', data: values,
            borderColor: '#1b52f1', borderWidth: 2, fill: true, tension: 0.35,
            pointRadius: 4, pointBackgroundColor: '#1b52f1',
            backgroundColor: (context) => {
              const g = context.chart.ctx.createLinearGradient(0, 0, 0, 240);
              g.addColorStop(0, 'rgba(27, 82, 241, 0.25)');
              g.addColorStop(1, 'rgba(27, 82, 241, 0)');
              return g;
            }
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: cardBg, titleColor: isDark ? '#fff' : '#000', bodyColor: labelColor, borderColor: gridColor, borderWidth: 1, cornerRadius: 8 }
          },
          scales: {
            x: { ticks: { color: labelColor }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: labelColor, stepSize: 1 }, grid: { color: gridColor } }
          }
        }
      });
    }

    const distCanvas = app.root.querySelector('#distribution-chart');
    if (distCanvas) {
      const ctx = distCanvas.getContext('2d');
      app.state.charts.distribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Porte de Arma', 'Passaporte Paraguaio', 'Recrutamento (Edital)'],
          datasets: [{
            data: [summary.moduloDistribution.porte || 0, summary.moduloDistribution.paraguaio || 0, summary.moduloDistribution.recrutamento || 0],
            backgroundColor: ['#1b52f1', '#8b5cf6', '#6366f1'],
            borderColor: gridColor, borderWidth: 1
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: labelColor, padding: 15, font: { size: 11 } } },
            tooltip: { backgroundColor: cardBg, titleColor: isDark ? '#fff' : '#000', bodyColor: labelColor, borderColor: gridColor, borderWidth: 1, cornerRadius: 8 }
          },
          cutout: '65%'
        }
      });
    }
  }
};

// ============================================
// NOTIFICATION UI MANAGER
// ============================================
LSPD.notifications = {
  _pollInterval: null,
  _open: false,

  /**
   * Initialize notification polling — call once after login.
   */
  init() {
    this.updateBadge();
    // Poll every 30 seconds
    this._pollInterval = setInterval(() => this.updateBadge(), 30000);
  },

  destroy() {
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._pollInterval = null;
  },

  async updateBadge() {
    const res = await LSPD.api.getUnreadCount();
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = res.success ? res.count : 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  async toggle() {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    this._open = !this._open;
    if (this._open) {
      dropdown.classList.remove('hidden');
      await this.loadNotifications();
    } else {
      dropdown.classList.add('hidden');
    }
  },

  close() {
    this._open = false;
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  },

  async loadNotifications(page = 1) {
    const container = document.getElementById('notif-list');
    if (!container) return;
    container.innerHTML = '<div class="flex justify-center p-4"><i class="fas fa-circle-notch fa-spin text-brand-500"></i></div>';
    
    const res = await LSPD.api.getNotifications(page);
    if (!res.success || !res.notifications.length) {
      container.innerHTML = `
        <div class="text-center p-8 text-[var(--text-muted)]">
          <i class="fas fa-bell-slash text-2xl mb-2 opacity-30"></i>
          <p class="text-xs">Nenhuma notificação por enquanto.</p>
        </div>
      `;
      return;
    }

    const toneColors = {
      brand: 'text-brand-500 bg-brand-500/10',
      emerald: 'text-emerald-500 bg-emerald-500/10',
      amber: 'text-amber-500 bg-amber-500/10',
      rose: 'text-rose-500 bg-rose-500/10',
      indigo: 'text-indigo-500 bg-indigo-500/10',
      violet: 'text-violet-500 bg-violet-500/10',
      zinc: 'text-zinc-400 bg-zinc-500/10'
    };

    container.innerHTML = res.notifications.map(n => {
      const tc = toneColors[n.tone] || toneColors.brand;
      const timeAgo = LSPD.utils.formatDateTime(n.createdAt);
      return `
        <div class="notif-item flex items-start gap-3 p-3 hover:bg-[var(--card-bg-soft)] transition-colors cursor-pointer border-b border-[var(--border-subtle)]/50 ${n.read ? 'opacity-60' : ''}" data-id="${n._id}" data-link="${n.link || ''}">
          <div class="w-8 h-8 rounded-lg ${tc} flex items-center justify-center flex-shrink-0 mt-0.5">
            <i class="fas ${n.icon} text-xs"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-[var(--text-main)] leading-tight">${n.title}</p>
            <p class="text-[10px] text-[var(--text-muted)] mt-0.5 line-clamp-2">${n.message}</p>
            <p class="text-[9px] text-[var(--text-muted)] mt-1 font-semibold">${timeAgo}</p>
          </div>
          ${!n.read ? '<div class="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-2"></div>' : ''}
        </div>
      `;
    }).join('');

    // Click handlers
    container.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const link = item.dataset.link;
        await LSPD.api.markNotificationRead(id);
        item.classList.add('opacity-60');
        item.querySelector('.bg-brand-500')?.remove();
        this.updateBadge();
        if (link) {
          window.location.hash = link;
          this.close();
        }
      });
    });
  },

  async markAllRead() {
    await LSPD.api.markAllNotificationsRead();
    this.updateBadge();
    await this.loadNotifications();
  },

  /**
   * Returns the HTML for the notification bell button and dropdown.
   */
  renderBellHTML() {
    return `
      <div class="relative" id="notif-wrapper">
        <button id="notif-bell-btn" class="w-10 h-10 rounded-xl btn-soft flex items-center justify-center shadow-sm relative" title="Notificações">
          <i class="fas fa-bell text-sm"></i>
          <span id="notif-badge" class="notif-badge hidden">0</span>
        </button>
        <div id="notif-dropdown" class="notif-dropdown hidden">
          <div class="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
            <h4 class="text-sm font-bold">Notificações</h4>
            <button id="notif-mark-all" class="text-[10px] font-bold text-brand-500 hover:text-brand-400 transition-colors uppercase tracking-wider">
              Marcar todas como lidas
            </button>
          </div>
          <div id="notif-list" class="max-h-[340px] overflow-y-auto no-scrollbar"></div>
        </div>
      </div>
    `;
  },

  /**
   * Setup event listeners for notification bell/dropdown after DOM injection.
   */
  setupListeners() {
    const bellBtn = document.getElementById('notif-bell-btn');
    const markAllBtn = document.getElementById('notif-mark-all');

    bellBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    markAllBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.markAllRead();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('notif-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        this.close();
      }
    });
  }
};

// ============================================
// MOBILE SIDEBAR MANAGER
// ============================================
LSPD.mobileSidebar = {
  open() {
    document.getElementById('mobile-sidebar')?.classList.add('active');
    document.getElementById('sidebar-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  },
  close() {
    document.getElementById('mobile-sidebar')?.classList.remove('active');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
  },
  setupListeners() {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => this.open());
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => this.close());
    document.getElementById('mobile-sidebar-close')?.addEventListener('click', () => this.close());
    // Close sidebar when a nav item is clicked
    document.querySelectorAll('#mobile-sidebar .nav-item').forEach(item => {
      item.addEventListener('click', () => this.close());
    });
  }
};

// Page registry — each page module registers itself here
LSPD.pages = {};


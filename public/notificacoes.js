// =============================================
// COMPONENTE COMPARTILHADO DE NOTIFICAÇÕES
// =============================================

(function () {
  function escaparHtmlNotif(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function montarMarkupSino(container) {
    container.innerHTML = `
      <div class="relative">
        <button id="btnNotificacoes" type="button" onclick="toggleDropdownNotificacoes()" class="relative p-2 bg-slate-900 border border-slate-700 hover:border-yellow-500/50 rounded-full text-slate-300 hover:text-yellow-500 transition-all focus:outline-none" title="Notificações">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
          <span id="badgeNotificacoes" class="absolute -top-1 -right-1 bg-yellow-500 text-slate-900 text-[10px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center hidden">0</span>
        </button>

        <div id="dropdownNotificacoes" class="hidden absolute right-0 mt-3 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
          <div class="p-3 bg-slate-900 border-b border-slate-700 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold uppercase tracking-wider text-yellow-500">Notificações</span>
              <span id="txtQtdNotificacoes" class="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">0 novas</span>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="marcarTodasNotificacoesLidas()" class="text-[10px] text-yellow-400 hover:text-yellow-300 font-semibold">Marcar lidas</button>
              <button type="button" onclick="limparNotificacoesLidas()" class="text-[10px] text-slate-400 hover:text-red-400 font-semibold">Limpar</button>
            </div>
          </div>
          <div id="containerListaNotificacoes" class="max-h-72 overflow-y-auto divide-y divide-slate-700/50">
            <div class="p-6 text-center text-slate-500 italic text-xs">
              Nenhuma notificação no momento.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  window.toggleDropdownNotificacoes = function () {
    const dropdown = document.getElementById('dropdownNotificacoes');
    if (dropdown) dropdown.classList.toggle('hidden');
  };

  window.carregarNotificacoes = async function (tokenParam) {
    const token = tokenParam || localStorage.getItem('token');
    if (!token) return;

    const container = document.getElementById('containerListaNotificacoes');
    const badge = document.getElementById('badgeNotificacoes');
    const txtQtd = document.getElementById('txtQtdNotificacoes');
    if (!container || !badge || !txtQtd) return;

    try {
      const response = await fetch('/notificacoes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const notificacoes = await response.json();
        const naoLidas = notificacoes.filter(n => !n.lida).length;

        if (naoLidas > 0) {
          badge.textContent = naoLidas > 9 ? '9+' : naoLidas;
          badge.classList.remove('hidden');
          txtQtd.textContent = `${naoLidas} nova(s)`;
        } else {
          badge.classList.add('hidden');
          txtQtd.textContent = '0 novas';
        }

        if (notificacoes.length > 0) {
          container.innerHTML = notificacoes.map(n => `
            <div onclick="marcarNotificacaoLida(${n.id})"
              class="p-3 cursor-pointer transition-colors ${n.lida ? 'hover:bg-slate-700/20 opacity-70' : 'bg-yellow-500/5 hover:bg-yellow-500/10'}">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-semibold ${n.lida ? 'text-slate-300' : 'text-yellow-400'}">${escaparHtmlNotif(n.titulo)}</p>
                ${n.lida ? '' : '<span class="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0 mt-1"></span>'}
              </div>
              <p class="text-[11px] text-slate-400 mt-0.5">${escaparHtmlNotif(n.mensagem)}</p>
              <span class="text-[9px] text-slate-500 mt-1 block">${n.data_formatada || ''}</span>
            </div>
          `).join('');
          return;
        }
      }
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
    }

    badge.classList.add('hidden');
    txtQtd.textContent = '0 novas';
    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 italic text-xs">
        Nenhuma notificação no momento.
      </div>
    `;
  };

  window.marcarNotificacaoLida = async function (id) {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch(`/notificacoes/${id}/lida`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await window.carregarNotificacoes(token);
    } catch (err) {}
  };

  window.marcarTodasNotificacoesLidas = async function () {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch('/notificacoes/ler-todas', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await window.carregarNotificacoes(token);
    } catch (err) {}
  };

  window.limparNotificacoesLidas = async function () {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch('/notificacoes/limpar', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await window.carregarNotificacoes(token);
    } catch (err) {}
  };

  document.addEventListener('click', (e) => {
    const btn = document.getElementById('btnNotificacoes');
    const dropdown = document.getElementById('dropdownNotificacoes');
    if (btn && dropdown && !btn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const slot = document.getElementById('slotNotificacoes');
    if (slot) montarMarkupSino(slot);

    const token = localStorage.getItem('token');
    if (token) {
      window.carregarNotificacoes(token);
      setInterval(() => window.carregarNotificacoes(token), 30000);
    }
  });
})();

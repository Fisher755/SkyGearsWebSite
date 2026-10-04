(() => {
  'use strict';

  const cfg = window.SKYGearsConfig || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const api = (path) => `${String(cfg.apiBase || '').replace(/\/$/, '')}${path}`;

  let statusLoading = false;
  let newsLoading = false;
  let lastStatusOkAt = 0;
  let lastStatusPayload = null;
  let statusTimer = null;
  let newsTimer = null;
  let ageTimer = null;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setLinks() {
    $$('[data-discord-link]').forEach((a) => { a.href = cfg.discordUrl || '#'; });
    ['#server-address', '#footer-copy-server'].forEach((sel) => {
      const el = $(sel);
      if (el) el.textContent = cfg.serverAddress || 'skygears.mcmem.ru';
    });
  }

  async function copyServer() {
    const address = cfg.serverAddress || 'skygears.mcmem.ru';
    try {
      await navigator.clipboard.writeText(address);
      toast(`IP скопирован: ${address}`);
    } catch {
      window.prompt('Скопируй адрес сервера:', address);
    }
  }

  function downloadLauncher() {
    if (cfg.launcherDownloadUrl) {
      window.open(cfg.launcherDownloadUrl, '_blank', 'noopener');
      return;
    }
    toast('Добавь прямую ссылку на лаунчер в config.js');
    if (cfg.discordUrl) setTimeout(() => window.open(cfg.discordUrl, '_blank', 'noopener'), 900);
  }

  function downloadPack() {
    if (cfg.manualPackUrl) window.open(cfg.manualPackUrl, '_blank', 'noopener');
    else toast('Ссылка на ручную сборку пока не задана.');
  }

  function parseDateMs(value) {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : Date.now();
  }

  function formatAge(ms) {
    if (!ms) return 'Ожидаем данные…';
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 5) return 'Обновлено только что';
    if (seconds < 60) return `Обновлено ${seconds} сек. назад`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Обновлено ${minutes} мин. назад`;
    return 'Данные давно не обновлялись';
  }

  function updateAgeLabel() {
    const el = $('#status-updated');
    if (!el) return;
    el.textContent = formatAge(lastStatusOkAt);
    el.classList.toggle('stale', Boolean(lastStatusOkAt && Date.now() - lastStatusOkAt > 45000));
  }

  function setStatusUI(status, { apiError = false } = {}) {
    if (status) lastStatusPayload = status;
    const current = status || lastStatusPayload || {};
    const online = Boolean(current?.online);
    const players = Number.isFinite(Number(current?.players)) ? Number(current.players) : null;
    const maxPlayers = Number.isFinite(Number(current?.maxPlayers)) ? Number(current.maxPlayers) : null;
    const state = online ? 'Онлайн' : (current?.status === 'starting' ? 'Запускается' : 'Офлайн');

    $('#hero-status-dot')?.classList.toggle('online', online && !apiError);
    $('#hero-status-dot')?.classList.toggle('offline', !online || apiError);

    const heroText = $('#hero-status-text');
    if (heroText) {
      if (apiError) heroText.textContent = lastStatusPayload ? 'Связь с API потеряна — показаны последние данные' : 'API временно недоступен';
      else heroText.textContent = online ? `Сервер онлайн${players !== null ? ` • ${players} игроков` : ''}` : state;
    }

    const pill = $('#status-pill');
    if (pill) {
      pill.className = `status-pill ${apiError ? 'warning' : (online ? 'online' : 'offline')}`;
      pill.textContent = apiError ? 'Нет связи' : state;
    }

    if ($('#players-value')) $('#players-value').textContent = players === null ? '—' : `${players}${maxPlayers !== null ? ` / ${maxPlayers}` : ''}`;
    if ($('#stat-online')) $('#stat-online').textContent = players ?? '—';
    if ($('#stat-max')) $('#stat-max').textContent = maxPlayers ?? '—';
    if ($('#node-value')) $('#node-value').textContent = current?.node || 'Node-FSN8';
    if ($('#version-value')) $('#version-value').textContent = current?.minecraft || '1.21.1';
    if ($('#loader-value')) $('#loader-value').textContent = current?.loader || 'NeoForge';

    const note = $('#status-note');
    if (note) {
      if (apiError) note.textContent = lastStatusPayload
        ? 'Сохранили последние успешные данные. Повторим запрос автоматически.'
        : 'Не удалось получить статус. Сайт продолжает работать и повторит запрос автоматически.';
      else note.textContent = current?.motd || (online ? 'Сервер готов принимать игроков.' : 'Проверь новости Discord, если сервер сейчас на обслуживании.');
    }

    const footer = $('#footer-state');
    if (footer) footer.textContent = apiError ? 'API недоступен' : (online ? '● Онлайн' : '● Офлайн');
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadStatus({ manual = false } = {}) {
    if (statusLoading || !cfg.apiBase) {
      if (!cfg.apiBase) setStatusUI({ online: false });
      return;
    }

    statusLoading = true;
    const refreshButton = $('#status-refresh');
    refreshButton?.classList.add('loading');
    refreshButton?.setAttribute('disabled', '');

    try {
      const data = await fetchJsonWithTimeout(
        api(`/status?_=${Date.now()}`),
        { cache: 'no-store', headers: { Accept: 'application/json' } }
      );
      lastStatusOkAt = parseDateMs(data.updatedAt);
      setStatusUI(data);
      updateAgeLabel();
      if (manual) toast('Статус сервера обновлён');
    } catch (err) {
      console.warn('SkyGears status API:', err);
      setStatusUI(null, { apiError: true });
      if (manual) toast('Не удалось получить свежий статус');
    } finally {
      statusLoading = false;
      refreshButton?.classList.remove('loading');
      refreshButton?.removeAttribute('disabled');
    }
  }

  function newsFallback(message = 'Пока нет опубликованных новостей.') {
    const grid = $('#news-grid');
    if (!grid) return;
    grid.innerHTML = `<article class="news-card"><span class="news-date">SkyGears</span><h3>Новости скоро появятся</h3><p>${escapeHtml(message)}</p><a class="news-link" href="${escapeAttr(cfg.discordUrl || '#')}" target="_blank" rel="noopener noreferrer">Открыть Discord →</a></article>`;
    setupTilt();
  }

  function renderNews(items) {
    const grid = $('#news-grid');
    if (!grid) return;
    if (!Array.isArray(items) || items.length === 0) return newsFallback();
    grid.innerHTML = items.slice(0, 6).map((item) => {
      const date = item.date ? new Date(item.date) : null;
      const dateText = date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
        : 'SkyGears';
      const link = item.url || cfg.discordUrl || '#';
      return `<article class="news-card">${item.image ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy">` : ''}<span class="news-date">${escapeHtml(dateText)}</span><h3>${escapeHtml(item.title || 'Новость SkyGears')}</h3><p>${escapeHtml(item.text || '')}</p><a class="news-link" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">Читать в Discord →</a></article>`;
    }).join('');
    setupTilt();
  }

  async function loadNews({ manual = false } = {}) {
    if (newsLoading || !cfg.apiBase) {
      if (!cfg.apiBase) newsFallback('API новостей не настроен.');
      return;
    }
    newsLoading = true;
    const btn = $('#news-refresh');
    btn?.classList.add('loading');
    btn?.setAttribute('disabled', '');
    try {
      const data = await fetchJsonWithTimeout(
        api(`/news?_=${Date.now()}`),
        { cache: 'no-store', headers: { Accept: 'application/json' } },
        10000
      );
      renderNews(data.news);
      if ($('#news-hint')) $('#news-hint').textContent = 'Новости синхронизированы с Discord.';
      if (manual) toast('Новости обновлены');
    } catch (err) {
      console.warn('SkyGears news API:', err);
      newsFallback('Endpoint /news сейчас недоступен. Последние объявления всегда есть в Discord.');
      if ($('#news-hint')) $('#news-hint').textContent = 'Не удалось обновить новости — попробуем ещё раз автоматически.';
      if (manual) toast('Не удалось обновить новости');
    } finally {
      newsLoading = false;
      btn?.classList.remove('loading');
      btn?.removeAttribute('disabled');
    }
  }

  async function submitApplication(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const status = $('#application-status');
    const button = $('#application-submit');
    const raw = Object.fromEntries(new FormData(form).entries());

    // Honeypot против простых спам-ботов. Обычный пользователь это поле не видит.
    if (String(raw.website || '').trim()) return;

    if (!cfg.apiBase) {
      if (status) status.textContent = 'API заявок не настроен.';
      return;
    }

    // Отправляем только поля, которые ожидает Cloudflare Worker /apply.
    const payload = {
      nickname: String(raw.nickname || '').trim(),
      age: String(raw.age || '').trim(),
      discordProfile: String(raw.discordProfile || '').trim(),
      experience: String(raw.experience || '').trim(),
      playtime: String(raw.playtime || '').trim(),
      plans: String(raw.plans || '').trim(),
      content: String(raw.content || '').trim(),
      source: String(raw.source || '').trim(),
      reason: String(raw.reason || '').trim(),
      website: ''
    };

    if (!payload.nickname || !payload.age || !payload.discordProfile) {
      if (status) status.textContent = 'Заполни ник Minecraft, возраст и ссылку на Discord.';
      return;
    }

    const discordProfilePattern = /^https:\/\/(?:www\.)?(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/users\/\d{17,20}\/?$/i;
    if (!discordProfilePattern.test(payload.discordProfile)) {
      if (status) status.textContent = 'Вставь ссылку на профиль Discord вида https://discord.com/users/123456789012345678';
      return;
    }

    if (button) {
      button.disabled = true;
      button.dataset.originalText ||= button.textContent;
      button.textContent = 'Отправляем…';
    }
    if (status) status.textContent = 'Отправляем заявку и проверяем связь с Discord…';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(api('/apply'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawBody = await res.text();
      let body = {};

      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = { message: rawBody };
        }
      }

      if (!res.ok) {
        const apiMessage = [body?.error, body?.detail].filter(Boolean).join(' — ') || body?.message || `HTTP ${res.status}`;
        throw new Error(apiMessage);
      }

      form.reset();
      if (status) status.textContent = 'Заявка отправлена! Проверь личные сообщения Discord — туда придёт подтверждение и итоговое решение.';
      toast('Заявка отправлена ✓');
      setTimeout(closeApplication, 1800);

    } catch (err) {
      console.error('SkyGears application API:', err);

      let message = `Не удалось отправить заявку: ${String(err?.message || 'неизвестная ошибка')}`;

      if (err?.name === 'AbortError') {
        message = 'Сервер слишком долго отвечает. Попробуй ещё раз через несколько секунд.';
      } else if (/webhook.*not configured|delivery is not configured|application.*not configured/i.test(String(err?.message || ''))) {
        message = 'Канал заявок Discord ещё не подключён к API.';
      } else if (/DISCORD_DM_UNAVAILABLE|личн.*сообщ|direct message|dm unavailable/i.test(String(err?.message || ''))) {
        message = 'Бот не может написать тебе в Discord. Вступи в Discord SkyGears, разреши личные сообщения от участников сервера и проверь ссылку на профиль.';
      } else if (/discord profile|profile url|ссылк.*discord/i.test(String(err?.message || ''))) {
        message = 'Проверь ссылку на профиль Discord. Нужен адрес вида https://discord.com/users/123456789012345678';
      } else if (/Failed to fetch|NetworkError|Load failed/i.test(String(err?.message || ''))) {
        message = 'Не удалось связаться с API. Проверь интернет или настройку Worker.';
      }

      if (status) status.textContent = message;
      toast('Ошибка отправки заявки');

    } finally {
      clearTimeout(timeout);

      if (button) {
        button.disabled = false;
        if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      }
    }
  }

  function openApplication() {
    const m = $('#application-modal');
    m?.classList.add('open');
    m?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeApplication() {
    const m = $('#application-modal');
    m?.classList.remove('open');
    m?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function openLightbox(src) {
    const m = $('#lightbox');
    const img = $('#lightbox-image');
    if (img) img.src = src;
    m?.classList.add('open');
    m?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    const m = $('#lightbox');
    m?.classList.remove('open');
    m?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function escapeAttr(value = '') { return escapeHtml(value); }

  function setupReveal() {
    const items = $$('.reveal');
    // Stagger delays for cards inside the same parent grid
    const groups = new Map();
    items.forEach((el) => {
      const parent = el.parentElement;
      if (!parent) return;
      const list = groups.get(parent) || [];
      list.push(el);
      groups.set(parent, list);
    });
    groups.forEach((list) => {
      if (list.length < 2) return;
      list.forEach((el, i) => {
        el.style.setProperty('--delay', `${Math.min(i * 0.08, 0.4)}s`);
      });
    });

    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }

  function setupNavSpy() {
    const links = $$('.desktop-nav a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const map = new Map();
    links.forEach((a) => {
      const id = a.getAttribute('href')?.slice(1);
      const section = id ? document.getElementById(id) : null;
      if (section) map.set(section, a);
    });
    if (!map.size) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const link = map.get(e.target);
        if (!link) return;
        if (e.isIntersecting) {
          links.forEach((l) => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });
    map.forEach((_, section) => io.observe(section));
  }

  function startAutoRefresh() {
    const statusRefresh = Math.max(10000, Number(cfg.statusRefreshMs) || 15000);
    const newsRefresh = Math.max(60000, Number(cfg.newsRefreshMs) || 120000);

    clearInterval(statusTimer);
    clearInterval(newsTimer);
    clearInterval(ageTimer);

    statusTimer = setInterval(() => {
      if (!document.hidden) loadStatus();
    }, statusRefresh);

    newsTimer = setInterval(() => {
      if (!document.hidden) loadNews();
    }, newsRefresh);

    ageTimer = setInterval(updateAgeLabel, 1000);
  }

  function setupTopbarScroll() {
    const topbar = $('.topbar');
    if (!topbar) return;
    const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function smoothScrollTo(target) {
    if (typeof target === 'number') {
      window.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  function setupScrollControls() {
    $$('.brand, #brand-top').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        smoothScrollTo(0);
      });
    });

    const down = $('#scroll-down');
    down?.addEventListener('click', (e) => {
      e.preventDefault();
      smoothScrollTo('#about');
    });

    $$('a[href^="#"]').forEach((a) => {
      const id = a.getAttribute('href');
      if (!id || id === '#' || id === '#top') return;
      if (a.id === 'scroll-down' || a.classList.contains('brand')) return;
      a.addEventListener('click', (e) => {
        const section = $(id);
        if (!section) return;
        e.preventDefault();
        smoothScrollTo(section);
        $('#mobile-nav')?.classList.remove('open');
        $('#menu-button')?.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function setupButtonFeedback() {
    $$('.button').forEach((btn) => {
      btn.addEventListener('pointerdown', () => btn.classList.add('is-pressed'));
      btn.addEventListener('pointerup', () => btn.classList.remove('is-pressed'));
      btn.addEventListener('pointerleave', () => btn.classList.remove('is-pressed'));
    });
  }

  function hideLoader() {
    const loader = $('#page-loader');
    if (!loader) return;
    const done = () => loader.classList.add('is-done');
    if (document.readyState === 'complete') setTimeout(done, 450);
    else window.addEventListener('load', () => setTimeout(done, 450));
    setTimeout(done, 2500);
  }

  function setupParticles() {
    const canvas = $('#particles');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.display = 'none';
      return;
    }

    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let particles = [];
    let raf = 0;
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const count = isMobile ? 28 : 55;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }

    function create() {
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -Math.random() * 0.45 - 0.1,
        a: Math.random() * 0.45 + 0.15,
        g: Math.random() > 0.7
      }));
    }

    function step() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.g
          ? `rgba(226, 180, 86, ${p.a})`
          : `rgba(200, 210, 220, ${p.a * 0.7})`;
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 110) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(226, 180, 86, ${0.08 * (1 - d / 110)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(step);
    }

    resize();
    create();
    step();
    window.addEventListener('resize', () => {
      resize();
      create();
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(step);
    });
  }

  function setupTilt() {
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const max = 11;
    const selectors = '.feature-card, .team-card, .news-card:not(.skeleton), .status-card, .join-card, .gallery-item';

    $$('.feature-grid, .team-grid, .news-grid, .gallery-grid, .hero-panel, .start-layout').forEach((el) => {
      el.classList.add('tilt-scene');
    });

    $$(selectors).forEach((card) => {
      if (card.dataset.tiltBound === '1') return;
      card.dataset.tiltBound = '1';
      card.classList.add('tilt-card');

      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const rx = (0.5 - y) * max;
        const ry = (x - 0.5) * max;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(8px) scale3d(1.03, 1.03, 1.03)`;
        card.style.setProperty('--glow-x', `${x * 100}%`);
        card.style.setProperty('--glow-y', `${y * 100}%`);
        card.classList.add('is-tilting');
      });

      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
        card.classList.remove('is-tilting');
      });
    });
  }

  function init() {
    setLinks();
    setupReveal();
    setupNavSpy();
    setupTopbarScroll();
    setupScrollControls();
    setupButtonFeedback();
    setupTilt();
    setupParticles();
    hideLoader();
    loadStatus();
    loadNews();
    startAutoRefresh();

    $('#copy-server')?.addEventListener('click', copyServer);
    $('#footer-copy-server')?.addEventListener('click', copyServer);
    $('#download-launcher')?.addEventListener('click', downloadLauncher);
    $('#download-launcher-secondary')?.addEventListener('click', downloadLauncher);
    $('#download-pack')?.addEventListener('click', downloadPack);
    $('#open-application')?.addEventListener('click', openApplication);
    $('#close-application')?.addEventListener('click', closeApplication);
    $('#application-form')?.addEventListener('submit', submitApplication);
    $('#status-refresh')?.addEventListener('click', () => loadStatus({ manual: true }));
    $('#news-refresh')?.addEventListener('click', () => loadNews({ manual: true }));

    const menuBtn = $('#menu-button');
    const menu = $('#mobile-nav');
    menuBtn?.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    $$('#mobile-nav a').forEach(a => a.addEventListener('click', () => {
      menu?.classList.remove('open');
      menuBtn?.setAttribute('aria-expanded', 'false');
    }));

    $$('[data-lightbox]').forEach(btn => btn.addEventListener('click', () => openLightbox(btn.dataset.lightbox)));
    $('[data-close-lightbox]')?.addEventListener('click', closeLightbox);
    $('#lightbox')?.addEventListener('click', (e) => { if (e.target === $('#lightbox')) closeLightbox(); });
    $('#application-modal')?.addEventListener('click', (e) => { if (e.target === $('#application-modal')) closeApplication(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLightbox(); closeApplication(); } });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        loadStatus();
        if (Date.now() - lastStatusOkAt > 60000) loadNews();
      }
    });

    window.addEventListener('online', () => {
      toast('Интернет снова доступен — обновляем данные');
      loadStatus();
      loadNews();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

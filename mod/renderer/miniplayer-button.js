'use strict';
// Кнопка вызова мини-плеера.
//
// Полосу заголовка на Windows рисует система, нажатия по ней страница
// не получает, поэтому кнопку ставим в углу страницы — слева от плашки
// с версией клиента.

const { ipcRenderer } = require('electron');

const MARK = 'kotamusic-miniplayer-button';
const LOCK_MARK = 'kotamusic-miniplayer-lock';
const UPDATE_MARK = 'kotamusic-update-button';
const VERSION = /^\d+\.\d+\.\d+$/;

// Пока плеер не нарисован, интерфейс клиента ещё собирается — до этого
// момента на странице нам делать нечего.
const PLAYERBAR = '[data-test-id="PLAYERBAR_DESKTOP"],[data-test-id="VIBE_PLAYERBAR"]';
const PLAY_CONTROL = '[data-test-id="PLAY_BUTTON"],[data-test-id="PAUSE_BUTTON"]';

// Замок рисуем сами: у эмодзи открытый и закрытый висят почти одинаково.
const LOCK_ICON = (closed) =>
  '<svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden="true">' +
  (closed
    ? '<path d="M2.6 5V3.4a2.9 2.9 0 0 1 5.8 0V5" stroke="currentColor" stroke-width="1.4" fill="none"/>'
    : '<path d="M2.6 5V3.4a2.9 2.9 0 0 1 5.6-1" stroke="currentColor" stroke-width="1.4" fill="none"/>') +
  '<rect x="1" y="5" width="9" height="7" rx="1.6" fill="currentColor"/></svg>';

// Две стрелки по кругу — «проверить обновления».
const UPDATE_ICON =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M13.5 6.5A5.6 5.6 0 0 0 3.2 4.6M2.5 9.5a5.6 5.6 0 0 0 10.3 1.9" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M3 1.8v3.1h3.1M13 14.2v-3.1H9.9" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Отступ от плашки версии.
const GAP = 8;

// Насколько близко к правому нижнему углу должна лежать плашка версии,
// чтобы считаться той самой.
const CORNER_ZONE = 260;

/**
 * Плашка версии не просто есть в разметке, а действительно видна: над ней
 * нет заставки клиента. Разметку клиент собирает заранее, а рисует окно
 * на несколько секунд позже, и наши кнопки иначе появляются раньше всего.
 */
function badgeOnTop(badge) {
  const rect = badge.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const top = document.elementFromPoint(
    Math.round(rect.left + rect.width / 2),
    Math.round(rect.top + rect.height / 2)
  );

  return Boolean(top) && (badge.contains(top) || top.contains(badge));
}

/** Сколько размеченных элементов клиента реально видно на экране. */
function visibleCount() {
  let count = 0;

  for (const node of document.querySelectorAll('[data-test-id]')) {
    const rect = node.getBoundingClientRect();

    if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
      count += 1;
    }

    if (count >= 12) break;
  }

  return count;
}

let enabled = true;
let button = null;
let lock = null;
let updater = null;
let locked = false;

/**
 * Плашка с версией клиента в правом нижнем углу. Номер лежит во вложенном
 * узле, а фон и скругление — на внешнем, поэтому поднимаемся до того
 * предка, который и есть видимая плашка.
 */
function versionBadge() {
  const candidates = [];

  for (const node of document.body.querySelectorAll('div, span, p')) {
    if (node.children.length) continue;
    if (!VERSION.test(node.textContent.trim())) continue;

    let badge = node;

    for (let i = 0; i < 3; i += 1) {
      const parent = badge.parentElement;
      if (!parent || parent === document.body) break;
      if (parent.textContent.trim() !== node.textContent.trim()) break;

      const background = getComputedStyle(parent).backgroundColor;
      badge = parent;

      if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
    }

    candidates.push(badge);
  }

  // Номер версии встречается не только в углу: на странице настроек он
  // стоит строкой посреди списка, и кнопка уезжала туда же. Берём только
  // тот, что и правда лежит в правом нижнем углу окна.
  const corner = candidates.filter((badge) => {
    const rect = badge.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    return (
      rect.bottom > window.innerHeight - CORNER_ZONE &&
      rect.right > window.innerWidth - CORNER_ZONE
    );
  });

  if (!corner.length) return null;

  // Если их вдруг несколько — самый нижний и самый правый.
  return corner.sort(
    (a, b) =>
      b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom ||
      b.getBoundingClientRect().right - a.getBoundingClientRect().right
  )[0];
}

/**
 * Держим кнопку слева от плашки и в точности такой же: размер, скругление
 * и шрифт берём у самой плашки, чтобы пара выглядела единым целым.
 */
function place() {
  if (!button) return;

  const badge = versionBadge();

  // Плашки версии на странице нет — например, в настройках. Тогда обе
  // кнопки просто стоят в углу, но именно обе: раньше замок оставался
  // там, где его положили в прошлый раз, и пара разъезжалась.
  if (!badge) {
    // Над панелью плеера, а не поверх её кнопок.
    const bar = document.querySelector(PLAYERBAR);
    const barRect = bar?.getBoundingClientRect();
    const bottom =
      barRect && barRect.height
        ? Math.round(window.innerHeight - barRect.top + 12)
        : 12;

    for (const node of [button, lock, updater]) {
      if (!node) continue;
      node.style.bottom = `${bottom}px`;
      node.style.height = '22px';
      node.style.borderRadius = '11px';
      node.style.font = '';
    }

    button.style.right = '12px';
    button.style.paddingLeft = '12px';
    button.style.paddingRight = '12px';

    placeSquares(12 + (button.getBoundingClientRect().width || 0) + GAP, 22);
    return;
  }

  const rect = badge.getBoundingClientRect();
  const style = getComputedStyle(badge);
  const height = Math.round(rect.height);

  for (const node of [button, lock, updater]) {
    if (!node) continue;
    node.style.bottom = `${Math.round(window.innerHeight - rect.bottom)}px`;
    node.style.height = `${height}px`;

    // Скругление как у плашки, но не меньше полной «таблетки».
    node.style.borderRadius = `${Math.max(parseFloat(style.borderRadius) || 0, height / 2)}px`;

    // Шрифт берём у плашки целиком, вместе с размером и начертанием.
    node.style.font = style.font;
    node.style.fontFamily = style.fontFamily;
    node.style.fontSize = style.fontSize;
    node.style.fontWeight = style.fontWeight;
    node.style.lineHeight = style.lineHeight;
    node.style.letterSpacing = style.letterSpacing;
  }

  button.style.right = `${Math.round(window.innerWidth - rect.left + GAP)}px`;
  button.style.paddingLeft = style.paddingLeft;
  button.style.paddingRight = style.paddingRight;

  placeSquares(window.innerWidth - rect.left + GAP * 2 + (button.getBoundingClientRect().width || 0), height);
}

/** Квадратные кнопки — замок и обновление — встают цепочкой левее. */
function placeSquares(right, size) {
  for (const node of [lock, updater]) {
    if (!node) continue;
    node.style.right = `${Math.round(right)}px`;
    node.style.width = `${size}px`;
    node.style.padding = '0';
    right += size + GAP;
  }
}

function build() {
  if (document.querySelector(`[data-${MARK}]`)) return;

  button = document.createElement('button');
  button.setAttribute(`data-${MARK}`, '1');
  button.type = 'button';
  button.textContent = 'Мини-плеер';
  button.title = 'Открыть или закрыть мини-плеер';

  button.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483646;' +
    'height:22px;padding:0 12px;border-radius:6px;white-space:nowrap;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:none;background:rgba(255,255,255,.1);cursor:pointer;' +
    'color:rgba(255,255,255,.75);' +
    'transition:background .12s,color .12s;-webkit-app-region:no-drag';

  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255,255,255,.22)';
    button.style.color = '#fff';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = 'rgba(255,255,255,.1)';
    button.style.color = 'rgba(255,255,255,.75)';
  });

  button.addEventListener('click', () => ipcRenderer.send('kotamusic:miniplayer:show'));

  document.body.appendChild(button);
  buildLock();
  buildUpdater();
  place();
}

/** Замок слева от кнопки: фиксирует мини-плеер и делает его прозрачным. */
function buildLock() {
  if (document.querySelector(`[data-${LOCK_MARK}]`)) return;

  lock = document.createElement('button');
  lock.setAttribute(`data-${LOCK_MARK}`, '1');
  lock.type = 'button';

  lock.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483646;' +
    'height:22px;border-radius:6px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:none;background:rgba(255,255,255,.1);cursor:pointer;' +
    'color:rgba(255,255,255,.75);' +
    'transition:background .12s,color .12s;-webkit-app-region:no-drag';

  lock.addEventListener('mouseenter', () => (lock.style.background = 'rgba(255,255,255,.22)'));
  lock.addEventListener('mouseleave', () => {
    lock.style.background = lock.dataset.locked === '1' ? 'rgba(255,219,77,.18)' : 'rgba(255,255,255,.1)';
  });

  lock.addEventListener('click', () => {
    setLocked(!locked);
    ipcRenderer.invoke('kotamusic:settings:set', { miniplayerLocked: locked });
  });

  document.body.appendChild(lock);
  setLocked(locked);
}

/** Проверка обновлений вручную — если сообщение об обновлении закрыли. */
function buildUpdater() {
  if (document.querySelector(`[data-${UPDATE_MARK}]`)) return;

  updater = document.createElement('button');
  updater.setAttribute(`data-${UPDATE_MARK}`, '1');
  updater.type = 'button';
  updater.title = 'Проверить обновления KotaMusic';
  updater.innerHTML = UPDATE_ICON;

  updater.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483646;' +
    'height:22px;border-radius:6px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:none;background:rgba(255,255,255,.1);cursor:pointer;' +
    'color:rgba(255,255,255,.75);' +
    'transition:background .12s,color .12s,opacity .12s;-webkit-app-region:no-drag';

  updater.addEventListener('mouseenter', () => (updater.style.background = 'rgba(255,255,255,.22)'));
  updater.addEventListener('mouseleave', () => (updater.style.background = 'rgba(255,255,255,.1)'));

  updater.addEventListener('click', async () => {
    if (updater.disabled) return;
    updater.disabled = true;
    updater.style.opacity = '.5';

    let result = null;
    try {
      result = await ipcRenderer.invoke('kotamusic:update:check');
    } catch {}

    updater.disabled = false;
    updater.style.opacity = '';

    // Если обновление есть, главный процесс сам покажет окно обновления.
    if (result?.found) return;
    showToast(result?.error ? 'Не удалось проверить обновления. Попробуйте позже.' : 'Обновлений нет — у вас последняя версия.');
  });

  document.body.appendChild(updater);
}

function setLocked(value) {
  locked = Boolean(value);

  if (!lock) return;

  lock.innerHTML = LOCK_ICON(locked);

  // Состояние видно и по цвету: закреплён — жёлтый, открыт — приглушённый.
  lock.style.color = locked ? '#ffdb4d' : 'rgba(255,255,255,.45)';
  lock.dataset.locked = locked ? '1' : '0';
  lock.style.background = locked ? 'rgba(255,219,77,.18)' : 'rgba(255,255,255,.1)';
  lock.title = locked
    ? 'Мини-плеер закреплён и не ловит нажатия: снять фиксацию'
    : 'Закрепить мини-плеер: станет прозрачным и перестанет ловить нажатия';
}

/** Короткое сообщение в том же углу. */
function showToast(message) {
  document.querySelector('[data-kotamusic-toast]')?.remove();

  const toast = document.createElement('div');
  toast.setAttribute('data-kotamusic-toast', '1');
  toast.style.cssText =
    'position:fixed;right:12px;bottom:48px;z-index:2147483646;max-width:260px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag';

  toast.innerHTML = '<b style="display:block;margin-bottom:4px">KotaMusic</b>';
  toast.appendChild(document.createTextNode(message));
  document.body.appendChild(toast);
  requestAnimationFrame(() => (toast.style.opacity = '1'));

  const hide = () => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  };
  toast.addEventListener('click', hide);
  setTimeout(hide, 4000);
}

/** Короткая подсказка о кнопке — показывается один раз. */
function showHint() {
  const hint = document.createElement('div');
  hint.setAttribute('data-kotamusic-hint', '1');
  hint.style.cssText =
    'position:fixed;right:12px;bottom:48px;z-index:2147483646;max-width:250px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag';

  hint.innerHTML =
    '<b style="display:block;margin-bottom:4px">KotaMusic</b>' +
    'Кнопка <b>Мини-плеер</b> рядом с версией открывает и закрывает ' +
    'маленькое окно поверх остальных. Оно запоминает, куда вы его поставили.';

  document.body.appendChild(hint);
  requestAnimationFrame(() => (hint.style.opacity = '1'));

  const hide = () => {
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 300);
  };

  hint.addEventListener('click', hide);
  setTimeout(hide, 9000);
}

function start() {
  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    enabled = state?.values?.miniplayerButton !== false;
    if (!enabled) return;

    locked = Boolean(state?.values?.miniplayerLocked);

    // Пока клиент не нарисовал свой интерфейс, лезть на страницу незачем:
    // ждём и плашку версии, и панель плеера.
    const waitingSince = Date.now();

    const ready = setInterval(() => {
      // Страховка: если клиент разметку поменяет, кнопку всё равно покажем.
      const waitedTooLong = Date.now() - waitingSince > 25000;

      const bar = document.querySelector(PLAYERBAR);

      // Плашка версии и панель плеера появляются раньше, чем клиент
      // дорисовывает окно. Ждём живую панель с кнопкой воспроизведения
      // и боковое меню — к этому моменту интерфейс уже собран.
      const badge = versionBadge();
      if (!badge) return;

      if (!waitedTooLong) {
        if (!badgeOnTop(badge)) return;
        if (document.readyState !== 'complete') return;
        if (!bar || !bar.offsetHeight) return;
        if (!bar.querySelector(PLAY_CONTROL)) return;

        // На заставке разметка клиента уже есть, но ничего не показано.
        // Считаем именно видимые элементы: их становится много только
        // после того, как окно нарисовано целиком.
        if (visibleCount() < 12) return;
      }

      clearInterval(ready);
      build();

      // Подсказку показываем один раз: дальше она только мешала бы.
      if (!state.values.hintShown) {
        setTimeout(showHint, 1500);
        ipcRenderer.invoke('kotamusic:settings:set', { hintShown: true });
      }

      // Клиент перерисовывает страницу целиком при переходах — возвращаем
      // кнопку на место и заново примеряемся к плашке версии.
      new MutationObserver(() => {
        if (!enabled) return;
        build();
        place();
      }).observe(document.body, { childList: true, subtree: true });

      window.addEventListener('resize', place);
    }, 200);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

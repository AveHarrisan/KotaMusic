'use strict';
// Раздел мода в настройках клиента.
//
// Свои элементы собираем сами и вставляем рядом с родными: врезаться
// в минифицированный React-код ради переключателей — верный способ
// ломаться на каждом обновлении. Классы берём у соседней строки,
// чтобы отступы и типографика совпадали с остальными настройками.

const { ipcRenderer } = require('electron');

const MARK = 'kotamusic-settings';
const ANCHOR_TEXT = 'О приложении';

let config = null;
let defaults = {};
let busy = [];
let meta = { name: 'KotaMusic', version: '' };

const el = (tag, style, text) => {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text) node.textContent = text;
  return node;
};

/** Переключатель в духе клиента: жёлтый когда включён. */
function toggle(value, onChange) {
  const track = el(
    'button',
    `width:40px;height:24px;border-radius:12px;border:none;cursor:pointer;` +
      `padding:0;flex:none;transition:background .15s;` +
      `background:${value ? 'var(--ym-controls-color-primary-text-enabled,#ffdb4d)' : 'rgba(255,255,255,.2)'}`
  );
  track.type = 'button';

  const knob = el(
    'span',
    `display:block;width:18px;height:18px;border-radius:50%;background:#000;` +
      `transform:translateX(${value ? 19 : 3}px);transition:transform .15s`
  );
  track.appendChild(knob);

  track.addEventListener('click', () => onChange(!value));
  return track;
}

/** Поле ввода: применяем по Enter и при уходе фокуса. */
function textField(value, onChange) {
  const input = el(
    'input',
    'width:190px;flex:none;padding:8px 10px;border-radius:8px;font-size:13px;' +
      'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);' +
      'color:inherit;font-family:inherit'
  );
  input.value = value || '';
  input.spellcheck = false;

  const apply = () => {
    const next = input.value.trim();
    if (next !== (value || '')) onChange(next);
  };

  input.addEventListener('blur', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    e.stopPropagation(); // иначе клиент ловит буквы как горячие клавиши
  });

  return input;
}

/** Поле, которое запоминает нажатое сочетание клавиш. */
function hotkeyField(value, onChange) {
  const button = el(
    'button',
    'flex:none;min-width:190px;padding:8px 10px;border-radius:8px;cursor:pointer;' +
      'text-align:center;font-size:13px;color:inherit;' +
      'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06)'
  );
  button.type = 'button';
  button.textContent = value || 'Не задано';

  let listening = false;

  const stop = () => {
    listening = false;
    button.textContent = value || 'Не задано';
    document.removeEventListener('keydown', onKey, true);
  };

  function onKey(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') return stop();

    // Одни модификаторы сочетанием не считаются.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    // Без модификатора клавиша перехватывалась бы во всей системе —
    // например, цифра перестала бы печататься где угодно.
    if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      button.textContent = 'Нужен Ctrl, Alt или Win';
      return;
    }

    const parts = [];
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Super');

    if (event.key === 'Backspace' && !parts.length) {
      stop();
      return onChange('');
    }

    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    parts.push(key);

    stop();
    onChange(parts.join('+'));
  }

  button.addEventListener('click', () => {
    if (listening) return stop();

    listening = true;
    button.textContent = 'Нажмите сочетание…';
    document.addEventListener('keydown', onKey, true);
  });

  return button;
}

/** Обычная кнопка действия. */
function actionButton(label, onClick) {
  const button = el(
    'button',
    'flex:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;' +
      'color:inherit;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06)'
  );
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** Заголовок группы настроек. */
function group(title) {
  const node = el(
    'div',
    'margin:18px 0 2px;font-size:12px;font-weight:700;letter-spacing:.04em;' +
      'text-transform:uppercase;opacity:.45'
  );
  node.textContent = title;
  return node;
}

function row(title, description, control) {
  const wrap = el('div', 'display:flex;align-items:center;gap:16px;padding:12px 0');
  const texts = el('div', 'flex:1;min-width:0');

  texts.appendChild(el('div', 'font-size:15px;font-weight:500', title));
  if (description) {
    const warning = description.includes('занято');
    texts.appendChild(
      el(
        'div',
        'font-size:13px;margin-top:2px;line-height:1.3;' +
          (warning ? 'color:#ff8a80' : 'opacity:.6'),
        description
      )
    );
  }

  wrap.append(texts, control);
  return wrap;
}

async function update(patch) {
  config = await ipcRenderer.invoke('kotamusic:settings:set', patch);
  render();
}

/** Собирает содержимое раздела заново — проще, чем обновлять по кусочкам. */
function fill(container) {
  container.textContent = '';

  const header = el('div', 'display:flex;align-items:baseline;gap:8px;padding-top:8px');
  header.appendChild(el('div', 'font-size:20px;font-weight:700', meta.name));
  header.appendChild(el('div', 'font-size:13px;opacity:.5', meta.version));
  container.appendChild(header);

  const add = (...nodes) => nodes.forEach((node) => container.appendChild(node));

  // --- Discord -----------------------------------------------------------

  add(
    group('Discord'),
    row(
      'Rich Presence',
      'Показывать в Discord, что вы слушаете',
      toggle(config.richPresence, (value) => update({ richPresence: value }))
    )
  );

  const counter = config.progress === 'counter';
  add(
    row(
      'Счётчик времени вместо полосы',
      counter
        ? 'Время видно и в профиле, и в карточке голосового канала'
        : 'Полоса с началом и концом трека — видна только в карточке профиля',
      toggle(counter, (value) => update({ progress: value ? 'counter' : 'bar' }))
    ),
    row(
      'Время в строке исполнителя',
      'Единственный способ показать секунды при наведении в голосовом канале',
      toggle(config.timeInState, (value) => update({ timeInState: value }))
    ),
    row(
      'Название трека в списке участников',
      'Вместо названия приложения',
      toggle(config.showTrackInMemberList, (value) => update({ showTrackInMemberList: value }))
    ),
    row(
      'Кнопки под статусом',
      'Переход к треку и к автору мода',
      toggle(config.showButtons, (value) => update({ showButtons: value }))
    ),
    row(
      'Показывать альбом',
      'Третьей строкой статуса вместо надписи «Яндекс Музыка»',
      toggle(config.showAlbum, (value) => update({ showAlbum: value }))
    )
  );

  // --- Мини-плеер --------------------------------------------------------

  add(
    group('Мини-плеер'),
    row(
      'Показывать мини-плеер',
      'Маленькое окно поверх других',
      toggle(config.miniplayer, (value) => update({ miniplayer: value }))
    ),
    row(
      'Перемотка',
      'Щелчок по полосе задаёт позицию в треке',
      toggle(config.miniplayerSeek, (value) => update({ miniplayerSeek: value }))
    ),
    row(
      'Громкость',
      'Ползунок рядом с кнопками',
      toggle(config.miniplayerVolume, (value) => update({ miniplayerVolume: value }))
    ),
    row(
      'Кнопка закрытия',
      'Крестик в углу окна',
      toggle(config.miniplayerClose, (value) => update({ miniplayerClose: value }))
    ),
    row(
      'Кнопка «!» в окне клиента',
      'Вызывает мини-плеер на прежнем месте; применяется после перезапуска',
      toggle(config.miniplayerButton, (value) => update({ miniplayerButton: value }))
    ),
    row(
      'Показать подсказку снова',
      'Короткое пояснение о кнопке при следующем запуске',
      toggle(!config.hintShown, (value) => update({ hintShown: !value }))
    ),
    row(
      'Компактный вид',
      'Окно ниже: обложка меньше, исполнитель скрыт',
      toggle(config.miniplayerCompact, (value) => update({ miniplayerCompact: value }))
    ),
    row(
      'Зафиксировать окно',
      'Окно становится полупрозрачным и не ловит мышь — только смотреть',
      toggle(config.miniplayerLocked, (value) => update({ miniplayerLocked: value }))
    ),
    row(
      'Разблокировка на, секунд',
      'На столько горячая клавиша снимает фиксацию; отсчёт виден в окне',
      textField(String(config.miniplayerUnlockSeconds ?? 30), (value) =>
        update({ miniplayerUnlockSeconds: Math.min(300, Math.max(5, Number(value) || 30)) })
      )
    )
  );

  // --- Горячие клавиши ---------------------------------------------------

  const hotkeys = config.hotkeys || {};
  const actions = {
    play: 'Пауза и воспроизведение',
    next: 'Следующий трек',
    previous: 'Предыдущий трек',
    volumeUp: 'Громче',
    volumeDown: 'Тише',
    like: 'Лайк',
    miniplayer: 'Показать мини-плеер',
    miniplayerUnlock: 'Снять фиксацию мини-плеера',
  };

  add(group('Горячие клавиши'));

  for (const [action, title] of Object.entries(actions)) {
    const combination = hotkeys[action];
    const taken = combination && busy.includes(combination);

    add(
      row(
        title,
        taken ? 'Сочетание занято другой программой — выберите другое' : '',
        hotkeyField(combination, (value) =>
          update({ hotkeys: { ...hotkeys, [action]: value } })
        )
      )
    );
  }

  const isDefault =
    JSON.stringify(hotkeys) === JSON.stringify(defaults.hotkeys ?? {});

  const reset = actionButton('Вернуть по умолчанию', () =>
    update({ hotkeys: { ...defaults.hotkeys } })
  );
  reset.disabled = isDefault;
  reset.style.opacity = isDefault ? '.4' : '1';
  reset.style.cursor = isDefault ? 'default' : 'pointer';

  add(row('Сбросить сочетания', 'Вернуть набор, который идёт с модом', reset));

  // --- Клиент ------------------------------------------------------------

  add(
    group('Клиент'),
    row(
      'Кнопки на панели задач',
      'Управление из миниатюры окна, только в Windows',
      toggle(config.taskbarButtons, (value) => update({ taskbarButtons: value }))
    ),
    row(
      'Процент при изменении громкости',
      'Короткая подсказка рядом с ползунком',
      toggle(config.showVolumePercent, (value) => update({ showVolumePercent: value }))
    ),
    row(
      'Шаг громкости колесом, %',
      'На столько меняется громкость за одно движение колеса',
      textField(String(config.volumeStep ?? 1), (value) =>
        update({ volumeStep: Math.min(25, Math.max(1, Number(value) || 1)) })
      )
    ),
    row(
      'Не гасить экран во время музыки',
      'Пока идёт воспроизведение',
      toggle(config.preventSleep, (value) => update({ preventSleep: value }))
    ),
    row(
      'Масштаб интерфейса',
      'В процентах, от 50 до 200',
      textField(String(config.zoom ?? 100), (value) => {
        const percent = Math.min(200, Math.max(50, Number(value) || 100));
        update({ zoom: percent });
      })
    ),
    row(
      'Папка кеша',
      'Пусто — стандартная. Применяется при следующем запуске',
      textField(config.cacheDir || '', (value) => update({ cacheDir: value }))
    ),
    row(
      'Проверять обновления мода',
      'Сообщать, когда вышла сборка под свежую версию клиента',
      toggle(config.updateCheck !== false, (value) => update({ updateCheck: value }))
    ),
    row(
      'Подробный журнал',
      'Записывать в файл, что уходит в Discord',
      toggle(config.debug, (value) => update({ debug: value }))
    )
  );
}

/** Строка «О приложении» — единственная надёжная привязка на странице. */
function findAnchor() {
  const nodes = document.querySelectorAll('li, div');
  for (const node of nodes) {
    if (node.children.length) continue;
    if (node.textContent.trim() !== ANCHOR_TEXT) continue;

    const item = node.closest('li');
    if (item?.parentElement) return item;
  }
  return null;
}

function render() {
  if (!config) return;

  const existing = document.querySelector(`[data-${MARK}]`);
  if (existing) return fill(existing);

  const anchor = findAnchor();
  if (!anchor) return;

  const item = document.createElement(anchor.tagName);
  item.className = anchor.className;
  item.setAttribute(`data-${MARK}`, '1');
  item.style.cssText = 'display:block;margin-top:8px';

  fill(item);
  anchor.parentElement.insertBefore(item, anchor.nextSibling);
}

async function start() {
  const state = await ipcRenderer.invoke('kotamusic:settings:get');
  config = state.values;
  defaults = state.defaults || {};
  busy = state.busy || [];
  meta = { name: state.name, version: state.version };

  // Страница настроек — часть одностраничного приложения: она появляется
  // и исчезает без перезагрузки, поэтому просто следим за деревом.
  new MutationObserver(() => {
    if (!document.querySelector(`[data-${MARK}]`)) render();
  }).observe(document.body, { subtree: true, childList: true });

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

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

function row(title, description, control) {
  const wrap = el('div', 'display:flex;align-items:center;gap:16px;padding:12px 0');
  const texts = el('div', 'flex:1;min-width:0');

  texts.appendChild(el('div', 'font-size:15px;font-weight:500', title));
  if (description) {
    texts.appendChild(
      el('div', 'font-size:13px;opacity:.6;margin-top:2px;line-height:1.3', description)
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

  container.appendChild(
    row(
      'Discord Rich Presence',
      'Показывать в Discord, что вы слушаете',
      toggle(config.richPresence, (value) => update({ richPresence: value }))
    )
  );

  const counter = config.progress === 'counter';
  container.appendChild(
    row(
      'Счётчик времени вместо полосы',
      counter
        ? 'Время видно и в профиле, и в карточке голосового канала'
        : 'Полоса с началом и концом трека — видна только в карточке профиля',
      toggle(counter, (value) => update({ progress: value ? 'counter' : 'bar' }))
    )
  );

  container.appendChild(
    row(
      'Время в строке исполнителя',
      'Единственный способ показать секунды при наведении в голосовом канале',
      toggle(config.timeInState, (value) => update({ timeInState: value }))
    )
  );

  container.appendChild(
    row(
      'Название трека в списке участников',
      'Вместо названия приложения',
      toggle(config.showTrackInMemberList, (value) =>
        update({ showTrackInMemberList: value })
      )
    )
  );

  container.appendChild(
    row(
      'Кнопки под статусом',
      'Переход к треку и к автору мода',
      toggle(config.showButtons, (value) => update({ showButtons: value }))
    )
  );

  container.appendChild(
    row(
      'Показывать альбом',
      'Третьей строкой статуса вместо надписи «Яндекс Музыка»',
      toggle(config.showAlbum, (value) => update({ showAlbum: value }))
    )
  );

  container.appendChild(
    row(
      'Мини-плеер',
      'Маленькое окно поверх других, Ctrl+Alt+M',
      toggle(config.miniplayer, (value) => update({ miniplayer: value }))
    )
  );

  container.appendChild(
    row(
      'Кнопки на панели задач',
      'Управление из миниатюры окна, только в Windows',
      toggle(config.taskbarButtons, (value) => update({ taskbarButtons: value }))
    )
  );

  container.appendChild(
    row(
      'Глобальные горячие клавиши',
      'Ctrl+Alt и пробел, стрелки, L — работают поверх других окон',
      toggle(config.hotkeys, (value) => update({ hotkeys: value }))
    )
  );

  container.appendChild(
    row(
      'Процент при изменении громкости',
      'Короткая подсказка рядом с ползунком',
      toggle(config.showVolumePercent, (value) => update({ showVolumePercent: value }))
    )
  );

  container.appendChild(
    row(
      'Не гасить экран во время музыки',
      'Пока идёт воспроизведение',
      toggle(config.preventSleep, (value) => update({ preventSleep: value }))
    )
  );

  container.appendChild(
    row(
      'Масштаб интерфейса',
      'В процентах, от 50 до 200',
      textField(String(config.zoom ?? 100), (value) => {
        const percent = Math.min(200, Math.max(50, Number(value) || 100));
        update({ zoom: percent });
      })
    )
  );

  container.appendChild(
    row(
      'Папка кеша',
      'Пусто — стандартная. Применяется при следующем запуске',
      textField(config.cacheDir || '', (value) => update({ cacheDir: value }))
    )
  );

  container.appendChild(
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

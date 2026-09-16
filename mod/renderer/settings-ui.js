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
let links = {};

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

// Какие разделы человек раскрыл. Держим на своей стороне и запоминаем:
// содержимое пересобирается на каждое изменение настройки, и без этого
// раздел схлопывался бы от щелчка по переключателю внутри него.
const OPEN_KEY = 'kotamusic:settings:open';

const openSections = (() => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY)) || {};
  } catch {
    return {};
  }
})();

function rememberOpen() {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(openSections));
  } catch {
    // Запрет на хранилище — не повод ломать настройки.
  }
}

/** «7 настроек»: без этого получалось бы «7 настройка». */
function countLabel(count) {
  const two = count % 100;
  const one = count % 10;

  if (two >= 11 && two <= 14) return `${count} настроек`;
  if (one === 1) return `${count} настройка`;
  if (one >= 2 && one <= 4) return `${count} настройки`;
  return `${count} настроек`;
}

/**
 * Раздел настроек: заголовок, по которому раскрывается содержимое.
 * Полотно из трёх десятков строк иначе приходится пролистывать целиком.
 */
function section(title, rows) {
  const open = Boolean(openSections[title]);

  const wrap = el('div', 'border-top:1px solid rgba(255,255,255,.08)');

  const header = el(
    'button',
    'display:flex;align-items:center;gap:12px;width:100%;padding:14px 0;' +
      'background:none;border:none;cursor:pointer;color:inherit;font-family:inherit;text-align:left'
  );
  header.type = 'button';

  header.appendChild(
    el(
      'div',
      'flex:1;min-width:0;font-size:13px;font-weight:700;letter-spacing:.04em;' +
        'text-transform:uppercase;opacity:.75',
      title
    )
  );

  header.appendChild(el('div', 'font-size:13px;opacity:.4;flex:none', countLabel(rows.length)));

  const arrow = el(
    'div',
    'flex:none;font-size:11px;opacity:.5;transition:transform .15s;' +
      `transform:rotate(${open ? 0 : -90}deg)`,
    '▼'
  );
  header.appendChild(arrow);

  const body = el('div', `padding-bottom:8px;${open ? '' : 'display:none'}`);
  rows.forEach((node) => body.appendChild(node));

  header.addEventListener('click', () => {
    const next = body.style.display === 'none';

    body.style.display = next ? '' : 'none';
    arrow.style.transform = `rotate(${next ? 0 : -90}deg)`;

    openSections[title] = next;
    rememberOpen();
  });

  wrap.append(header, body);
  return wrap;
}

/**
 * Предпросмотр плашки для трансляции: та же карточка, что видит OBS, но
 * с выдуманным треком. Собирается здесь же, а не тянется со страницы
 * плашки: показать надо и когда трансляция выключена.
 */
function streamPreview(config) {
  const width = Math.min(1920, Math.max(240, Number(config.streamWidth) || 560));
  const size = Math.min(160, Math.max(32, Number(config.streamCoverSize) || 56));
  const font = Math.min(48, Math.max(10, Number(config.streamFontSize) || 16));
  const accent = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(config.streamAccent || ''))
    ? config.streamAccent
    : '#ffdb4d';

  const background = ['dark', 'light', 'none'].includes(config.streamBackground)
    ? config.streamBackground
    : 'dark';

  const light = background === 'light';
  const plain = background === 'none';

  // Кадр с клеткой: на нём видно, что фон плашки прозрачный.
  const frame = el(
    'div',
    'margin:6px 0 4px;padding:16px;border-radius:12px;overflow:hidden;' +
      'background-color:#3a3a3a;background-image:' +
      'linear-gradient(45deg,#2f2f2f 25%,transparent 25%,transparent 75%,#2f2f2f 75%),' +
      'linear-gradient(45deg,#2f2f2f 25%,transparent 25%,transparent 75%,#2f2f2f 75%);' +
      'background-size:20px 20px;background-position:0 0,10px 10px'
  );

  const card = el(
    'div',
    `display:flex;align-items:center;gap:${Math.round(font * 0.9)}px;box-sizing:border-box;` +
      `width:${width}px;padding:12px 18px 12px 12px;border-radius:14px;` +
      `font:${font}px/1.3 "Segoe UI",system-ui,sans-serif;` +
      (plain
        ? 'text-shadow:0 2px 6px rgba(0,0,0,.85);color:#fff'
        : light
          ? 'background:rgba(245,245,245,.9);color:#141414'
          : 'background:rgba(20,20,20,.82);color:#fff')
  );

  if (config.streamCover !== false) {
    card.appendChild(
      el(
        'div',
        `width:${size}px;height:${size}px;flex:none;border-radius:10px;` +
          'background:linear-gradient(135deg,#7c5cff,#ff5c8a)'
      )
    );
  }

  const text = el('div', 'flex:1;min-width:0');
  const custom = config.streamCustomColors;
  const titleColor = custom ? hexColor(config.streamTitleColor, '') : '';
  const artistColor = custom ? hexColor(config.streamArtistColor, '') : '';
  const timeColor = custom ? hexColor(config.streamTimeColor, '') : '';

  text.appendChild(
    el(
      'div',
      'font-weight:700;font-size:1.06em;white-space:nowrap;overflow:hidden' +
        (titleColor ? `;color:${titleColor}` : ''),
      'Кукушка'
    )
  );
  text.appendChild(
    el(
      'div',
      'margin-top:2px;font-size:.88em;white-space:nowrap;overflow:hidden' +
        (artistColor ? `;color:${artistColor};opacity:1` : `;opacity:${light ? '.6' : '.75'}`),
      'Кино'
    )
  );

  if (config.streamBar !== false) {
    const bar = el(
      'div',
      `margin-top:8px;height:3px;border-radius:2px;overflow:hidden;` +
        `background:${light ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.18)'}`
    );
    bar.appendChild(el('div', `height:100%;width:36%;background:${accent}`));
    text.appendChild(bar);
  }

  if (config.streamTime) {
    text.appendChild(
      el(
        'div',
        'margin-top:6px;font-size:.8em' +
          (timeColor ? `;color:${timeColor};opacity:1` : ';opacity:.7'),
        '2:12 / 6:06'
      )
    );
  }

  card.appendChild(text);

  // Плашка бывает шире окна настроек — показываем её целиком, уменьшив.
  const scaler = el('div', 'transform-origin:left top');
  scaler.appendChild(card);
  frame.appendChild(scaler);

  // Пока раздел свёрнут, ширины у кадра нет — считать масштаб не по чему.
  // Поэтому пересчитываем каждый раз, когда кадр меняет размер: при
  // раскрытии раздела и при изменении окна.
  const fit = () => {
    const room = frame.clientWidth - 32;
    if (room <= 0) return;

    const scale = Math.min(1, room / width);

    scaler.style.transform = scale < 1 ? `scale(${scale})` : '';
    scaler.style.height = scale < 1 ? `${card.offsetHeight * scale}px` : '';
  };

  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(frame);
  requestAnimationFrame(fit);

  return frame;
}

/** Цвет принимаем только в виде #rgb или #rrggbb. */
const hexColor = (value, fallback) =>
  /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value || '')) ? value : fallback;

/** Поле цвета: рядом с вводом — образец, чтобы видеть, что набрал. */
function colorField(value, onChange) {
  const wrap = el('div', 'display:flex;align-items:center;gap:8px;flex:none');

  const sample = el(
    'div',
    'width:22px;height:22px;flex:none;border-radius:6px;' +
      'border:1px solid rgba(255,255,255,.2);' +
      `background:${/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value)) ? value : 'transparent'}`
  );

  const input = textField(value, onChange);
  input.style.width = '120px';

  wrap.append(sample, input);
  return wrap;
}

/** Кнопка «Скопировать»: подтверждает нажатие подписью. */
function copyButton(text) {
  const button = actionButton('Скопировать', () => {
    ipcRenderer.send('kotamusic:copy', text);

    button.textContent = 'Скопировано';
    setTimeout(() => (button.textContent = 'Скопировать'), 2000);
  });

  return button;
}

/** Выбор одного значения из нескольких — вместо выпадающего списка. */
function choice(options, value, onChange) {
  const row = el('div', 'display:flex;gap:6px;flex:none');

  for (const [key, label] of options) {
    const active = key === value;

    const button = el(
      'button',
      'padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;' +
        'border:1px solid rgba(255,255,255,.15);' +
        (active
          ? 'background:var(--ym-controls-color-primary-text-enabled,#ffdb4d);color:#1a1a1a;font-weight:600'
          : 'background:rgba(255,255,255,.06);color:inherit')
    );

    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => !active && onChange(key));
    row.appendChild(button);
  }

  return row;
}

/** Ссылка наружу: клиент открывает её в браузере. */
function linkButton(label, url) {
  const node = el(
    'button',
    'flex:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;' +
      'color:inherit;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06)'
  );
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', () => ipcRenderer.send('kotamusic:open-url', url));
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

  const header = el('div', 'display:flex;align-items:baseline;gap:8px;padding:8px 0 14px');
  header.appendChild(el('div', 'font-size:20px;font-weight:700', meta.name));
  header.appendChild(el('div', 'font-size:13px;opacity:.5', meta.version));
  container.appendChild(header);

  const add = (...nodes) => nodes.forEach((node) => container.appendChild(node));

  // --- Discord -----------------------------------------------------------

  const counter = config.progress === 'counter';

  add(
    section('Discord', [
      row(
        'Rich Presence',
        'Показывать в Discord, что вы слушаете',
        toggle(config.richPresence, (value) => update({ richPresence: value }))
      ),
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
        'Снимать статус на паузе',
        'Пока пауза короче этого срока, в статусе написано «на паузе»',
        choice(
          [[0, 'Сразу'], [1, '1 мин'], [5, '5 мин'], [15, '15 мин'], [60, '1 час']],
          config.pauseClearMinutes,
          (value) => update({ pauseClearMinutes: value })
        )
      ),
      row(
        'Показывать альбом',
        'Третьей строкой статуса вместо надписи «Яндекс Музыка»',
        toggle(config.showAlbum, (value) => update({ showAlbum: value }))
      ),
    ])
  );

  // --- Мини-плеер --------------------------------------------------------

  add(
    section('Мини-плеер', [
      row(
        'Показывать мини-плеер',
        'Маленькое окно поверх других',
        toggle(config.miniplayer, (value) => update({ miniplayer: value }))
      ),
      row(
        'Прятать, когда ничего не играет',
        'Окно исчезает вместо надписи «Ничего не играет» и возвращается с первым треком',
        toggle(config.miniplayerHideIdle, (value) => update({ miniplayerHideIdle: value }))
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
      ),
      row(
        'Менять размер окна',
        'Окно можно тянуть за край, размер запоминается',
        toggle(config.miniplayerResizable, (value) => update({ miniplayerResizable: value }))
      ),
      row(
        'Показывать в панели задач',
        'Обычно мини-плеер там не нужен',
        toggle(config.miniplayerTaskbar, (value) => update({ miniplayerTaskbar: value }))
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
    ]),
    section('Кнопки в мини-плеере', [
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
    ])
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
    repeat: 'Повтор',
    shuffle: 'Перемешать',
  };

  const keyRows = Object.entries(actions).map(([action, title]) => {
    const combination = hotkeys[action];
    const taken = combination && busy.includes(combination);

    return row(
      title,
      taken ? 'Сочетание занято другой программой — выберите другое' : '',
      hotkeyField(combination, (value) => update({ hotkeys: { ...hotkeys, [action]: value } }))
    );
  });

  const isDefault = JSON.stringify(hotkeys) === JSON.stringify(defaults.hotkeys ?? {});

  const reset = actionButton('Вернуть по умолчанию', () =>
    update({ hotkeys: { ...defaults.hotkeys } })
  );
  reset.disabled = isDefault;
  reset.style.opacity = isDefault ? '.4' : '1';
  reset.style.cursor = isDefault ? 'default' : 'pointer';

  keyRows.push(row('Сбросить сочетания', 'Вернуть набор, который идёт с модом', reset));

  add(section('Горячие клавиши', keyRows));

  // --- Трансляция --------------------------------------------------------

  const streamAddress = `http://127.0.0.1:${config.streamPort ?? 8462}/`;

  const background = ['dark', 'light', 'none'].includes(config.streamBackground)
    ? config.streamBackground
    : 'dark';

  add(
    section('Трансляция', [
      row(
        'Плашка «сейчас играет»',
        'Компактный плеер по локальному адресу — для OBS и других программ',
        toggle(config.stream, (value) => update({ stream: value }))
      ),
      row(
        'Порт',
        'Номер порта, на котором мод отдаёт плашку',
        textField(String(config.streamPort ?? 8462), (value) =>
          update({ streamPort: Math.min(65535, Math.max(1024, Number(value) || 8462)) })
        )
      ),
      row(
        'Адрес для OBS',
        streamAddress,
        copyButton(streamAddress)
      ),
      row(
        'Показывать обложку',
        'Без неё плашка становится узкой строкой',
        toggle(config.streamCover !== false, (value) => update({ streamCover: value }))
      ),
      row(
        'Размер обложки',
        'В пикселях, от 32 до 160',
        textField(String(config.streamCoverSize ?? 56), (value) =>
          update({ streamCoverSize: Math.min(160, Math.max(32, Number(value) || 56)) })
        )
      ),
      row(
        'Подложка',
        background === 'none'
          ? 'Карточки нет — только текст с обводкой, как картинка с прозрачным фоном'
          : background === 'light'
            ? 'Светлая карточка — для светлого видео'
            : 'Тёмная карточка — привычный вид',
        choice(
          [
            ['dark', 'Тёмная'],
            ['light', 'Светлая'],
            ['none', 'Прозрачная'],
          ],
          background,
          (value) => update({ streamBackground: value })
        )
      ),
      row(
        'Полоса времени',
        'Показывает, сколько трека прошло',
        toggle(config.streamBar !== false, (value) => update({ streamBar: value }))
      ),
      row(
        'Время числами',
        'Строка вида «1:23 / 4:21» под полосой',
        toggle(config.streamTime, (value) => update({ streamTime: value }))
      ),
      row(
        'Цвет полосы',
        'Шестнадцатеричный цвет, например #ffdb4d',
        colorField(String(config.streamAccent ?? '#ffdb4d'), (value) =>
          update({ streamAccent: hexColor(value, '#ffdb4d') })
        )
      ),
      row(
        'Свои цвета текста',
        'Иначе плашка красит текст сама, под выбранную подложку',
        toggle(config.streamCustomColors, (value) => update({ streamCustomColors: value }))
      ),
      ...(config.streamCustomColors
        ? [
            row(
              'Цвет названия',
              'Строка с названием трека',
              colorField(String(config.streamTitleColor ?? '#ffffff'), (value) =>
                update({ streamTitleColor: hexColor(value, '#ffffff') })
              )
            ),
            row(
              'Цвет исполнителя',
              'Строка под названием',
              colorField(String(config.streamArtistColor ?? '#cccccc'), (value) =>
                update({ streamArtistColor: hexColor(value, '#cccccc') })
              )
            ),
            row(
              'Цвет времени',
              'Строка «1:23 / 4:21», если она включена',
              colorField(String(config.streamTimeColor ?? '#cccccc'), (value) =>
                update({ streamTimeColor: hexColor(value, '#cccccc') })
              )
            ),
            row(
              'Вернуть цвета по умолчанию',
              'Сбросит полосу, название, исполнителя и время',
              actionButton('Сбросить', () =>
                update({
                  streamAccent: defaults.streamAccent,
                  streamTitleColor: defaults.streamTitleColor,
                  streamArtistColor: defaults.streamArtistColor,
                  streamTimeColor: defaults.streamTimeColor,
                })
              )
            ),
          ]
        : []),
      row(
        'Размер текста',
        'В пикселях, от 10 до 48',
        textField(String(config.streamFontSize ?? 16), (value) =>
          update({ streamFontSize: Math.min(48, Math.max(10, Number(value) || 16)) })
        )
      ),
      row(
        'Ширина плашки',
        'В пикселях. Ширина не меняется от длины названия: длинное едет строкой',
        textField(String(config.streamWidth ?? 560), (value) =>
          update({ streamWidth: Math.min(1920, Math.max(240, Number(value) || 560)) })
        )
      ),
      row(
        'Открыть в браузере',
        'Посмотреть плашку живьём, с настоящим треком',
        linkButton('Открыть', streamAddress)
      ),
    ])
  );

  // Предпросмотр идёт отдельным блоком: строка «подпись — управление»
  // для него слишком тесная.
  const preview = section('Предпросмотр плашки', [
    row('Так она выглядит в кадре', 'Клетка показывает прозрачный фон', el('div')),
    streamPreview(config),
  ]);

  add(preview);

  // --- Ссылки ------------------------------------------------------------

  add(
    section('Ссылки', [
      row('Сайт', 'Гайды и вики по играм', linkButton('lvl.su', links.site)),
      row('Телеграм-канал', 'Новости про игры', linkButton('Котамарин', links.channel)),
      row('Discord', 'Сервер мода: вопросы и ошибки', linkButton('Сервер', links.discord)),
      row('Автор', 'Личный телеграм', linkButton('AveHarrisan', links.author)),
      row('Исходный код', 'Репозиторий мода на GitHub', linkButton('GitHub', links.repository)),
      row('Поддержать', 'Разовая или регулярная поддержка', linkButton('Boosty', links.boosty)),
    ])
  );

  // --- Панель плеера -----------------------------------------------------

  add(
    section('Панель плеера', [
      row(
        'Всегда показывать время трека',
        'Обычно время видно только при наведении',
        toggle(config.playerAlwaysTimecode, (value) => update({ playerAlwaysTimecode: value }))
      ),
      row(
        'Не перекрашивать под обложку',
        'Панель остаётся тёмной, а не берёт цвет у картинки альбома',
        toggle(config.playerFlatColors, (value) => update({ playerFlatColors: value }))
      ),
      row(
        'Полоса времени толще',
        'По ней же перематывают — в неё проще попасть',
        toggle(config.playerThickBar, (value) => update({ playerThickBar: value }))
      ),
    ])
  );

  // --- Окно и система ----------------------------------------------------

  add(
    section('Окно и система', [
      row(
        'Сворачивать в трей вместо закрытия',
        'Крестик прячет окно, музыка играет дальше; вернуть — значок у часов',
        toggle(config.closeToTray, (value) => update({ closeToTray: value }))
      ),
      row(
        'Запускать вместе с системой',
        'Клиент откроется сам после входа в Windows',
        toggle(config.autoStart, (value) => update({ autoStart: value }))
      ),
      row(
        'Запускаться свёрнутым',
        'Окно не будет выскакивать при старте',
        toggle(config.startMinimized, (value) => update({ startMinimized: value }))
      ),
      row(
        'Запоминать размер окна',
        'Клиент откроется того же размера, каким его закрыли',
        toggle(config.rememberWindowSize, (value) => update({ rememberWindowSize: value }))
      ),
      row(
        'Стартовая страница',
        'Адрес внутри клиента: /search, /collection, /non-music; пусто — как обычно',
        textField(String(config.startupPage ?? ''), (value) => update({ startupPage: value }))
      ),
      row(
        'Аппаратное ускорение',
        'Выключайте только при полосах и мигании картинки; мод предложит перезапуск',
        toggle(config.hardwareAcceleration !== false, (value) =>
          update({ hardwareAcceleration: value })
        )
      ),
      row(
        'Управлять этим компьютером с других устройств',
        'Телефон и колонка смогут переключать музыку здесь; мод предложит перезапуск',
        toggle(config.ynisonRemote, (value) => update({ ynisonRemote: value }))
      ),
    ])
  );

  // --- Клиент ------------------------------------------------------------

  add(
    section('Клиент', [
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
        'Статичная заставка вместо анимации Волны',
        'Моя Волна перестанет переливаться — заметно легче для слабых машин',
        toggle(config.liteVibeAnimation, (value) => update({ liteVibeAnimation: value }))
      ),
      row(
        'Не гасить экран во время музыки',
        'Пока идёт воспроизведение',
        toggle(config.preventSleep, (value) => update({ preventSleep: value }))
      ),
      row(
        'Масштаб интерфейса',
        'В процентах, от 50 до 200',
        textField(String(config.zoom ?? 100), (value) =>
          update({ zoom: Math.min(200, Math.max(50, Number(value) || 100)) })
        )
      ),
      row(
        'Проверять обновления мода',
        'Сообщать, когда вышла сборка под свежую версию клиента',
        toggle(config.updateCheck !== false, (value) => update({ updateCheck: value }))
      ),
      row(
        'Обновлять клиент вместе с модом',
        'Иначе Яндекс Музыка обновится сама и сотрёт мод',
        toggle(config.holdClientUpdates !== false, (value) =>
          update({ holdClientUpdates: value })
        )
      ),
      row(
        'Подробный журнал',
        'Записывать в файл, что уходит в Discord',
        toggle(config.debug, (value) => update({ debug: value }))
      ),
    ])
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

// Пришли из сообщения мода: раскрываем названный раздел и показываем его.
ipcRenderer.on('kotamusic:settings:section', (_event, section) => {
  if (!section) return;

  openSections[section] = true;
  rememberOpen();

  // Настройки могут ещё открываться — ищем раздел, пока он не появится.
  let tries = 0;

  const timer = setInterval(() => {
    render();

    const heading = [...document.querySelectorAll(`[data-${MARK}] button`)].find(
      (node) => node.textContent.startsWith(section)
    );

    if (heading) {
      heading.scrollIntoView({ block: 'center', behavior: 'smooth' });
      clearInterval(timer);
      return;
    }

    if ((tries += 1) > 20) clearInterval(timer);
  }, 500);
});

async function start() {
  const state = await ipcRenderer.invoke('kotamusic:settings:get');
  config = state.values;
  defaults = state.defaults || {};
  busy = state.busy || [];
  meta = { name: state.name, version: state.version };
  links = state.links || {};

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

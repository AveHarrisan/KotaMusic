'use strict';
// Скачивание в файл: кнопка в панели плеера, пункты в меню альбома,
// плейлиста и трека, полоска хода дела и подпись с качеством.
//
// Всё держится на метках `data-test-id` — это метки автотестов клиента,
// они переживают обновления лучше классов и разметки.

const { ipcRenderer } = require('electron');

const BAR = '[data-test-id="PLAYERBAR_DESKTOP"],[data-test-id="VIBE_PLAYERBAR"]';
const QUALITY_BUTTON = '[data-test-id="SOUND_QUALITY_BUTTON"]';

// Меню у клиента размечены одинаково: имя заканчивается на CONTEXT_MENU,
// а начало говорит, о чём оно — о треке, альбоме или плейлисте.
function menuKind(id) {
  if (id.startsWith('ALBUM')) return 'album';
  if (id.startsWith('PLAYLIST')) return 'playlist';
  if (id.startsWith('ARTIST')) return 'artist';
  return 'track';
}

const MARK = 'data-kotamusic-download';

const ICON_PATH = 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14';
const LYRICS_PATH = 'M5 6h14M5 11h9M5 16h11M5 21h7';
const FOLDER_PATH = 'M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z';

// Значок скачивания из набора клиента: так кнопка совпадает с соседними
// по размеру и цвету, что бы клиент им ни задавал.
const SPRITE_DOWNLOAD = 'download_l';

// Те же значки, что клиент ставит в меню. Папки в наборе клиента нет,
// её рисуем сами.
const SPRITE_DOWNLOAD_MENU = 'download_xxs';
const SPRITE_LYRICS_MENU = 'lyrics_xxs';

/**
 * Подменяет картинку у клонированного значка клиента. Возвращает false,
 * если у образца свой рисунок, а не ссылка на общий набор.
 */
function useSprite(node, name) {
  const use = node.querySelector('use');
  if (!use) return false;

  use.setAttribute('xlink:href', `/icons/sprite.svg#${name}`);
  use.setAttribute('href', `/icons/sprite.svg#${name}`);
  return true;
}

/** Стрелка вниз. Рисунок строим узлами: разметкой он бы не появился. */
function iconNode(size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(path);
  return svg;
}

let settings = {};
let lastTarget = null;

/** Разбирает ссылку клиента: /album/track?albumId=..&trackId=.. */
function idsFrom(href) {
  if (!href) return {};

  try {
    const url = new URL(href, 'https://music.yandex.ru/');
    const get = (name) => url.searchParams.get(name);

    // Ссылки бывают и обычными (/album/123/track/456), и с параметрами.
    const plain = /\/album\/(\d+)(?:\/track\/(\d+))?/.exec(url.pathname);
    const list = /\/users\/([^/]+)\/playlists\/(\d+)/.exec(url.pathname);

    return {
      albumId: get('albumId') || plain?.[1] || null,
      trackId: get('trackId') || plain?.[2] || null,
      owner: get('owner') || list?.[1] || null,
      kind: get('kind') || list?.[2] || null,
    };
  } catch {
    return {};
  }
}

/** Что играет сейчас: номер трека из ссылки в панели. */
function currentTrackId() {
  const bar = document.querySelector(BAR);
  if (!bar) return null;

  const link = bar.querySelector('a[href*="trackId="],a[href*="/track/"]');
  return idsFrom(link?.getAttribute('href')).trackId;
}

/** Бегущая строка дублирует текст — берём самый короткий повтор. */
function clean(node) {
  const value = (node?.textContent || '').trim();
  if (!value) return '';

  for (let size = 1; size <= value.length / 2; size += 1) {
    if (value.length % size) continue;
    const piece = value.slice(0, size);
    if (piece.repeat(value.length / size) === value) return piece;
  }

  return value;
}

/**
 * Что играет: номер, а если его нет — название с исполнителем.
 * В «Моей волне» ссылки на трек в панели не бывает вовсе.
 */
function currentTrack() {
  const bar = document.querySelector(BAR);
  if (!bar) return null;

  const title = clean(bar.querySelector('[data-test-id="TRACK_TITLE"],[data-test-id="VIBE_PLAYERBAR_TRACK_NAME"]'));
  const artists = [...bar.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]')].map(clean);
  const album = bar.querySelector('a[href*="albumId="],a[href*="/album/"]');

  return {
    trackId: currentTrackId(),
    title,
    artist: artists.filter(Boolean).join(', '),
    albumId: idsFrom(album?.getAttribute('href')).albumId,
  };
}

/**
 * Своё окно с вопросом: клиентские окна нам недоступны, а решение
 * человека нужно до начала скачивания.
 */
function ask(title, text, buttons) {
  return new Promise((resolve) => {
    document.querySelector('[data-kotamusic-ask]')?.remove();

    const shade = document.createElement('div');
    shade.setAttribute('data-kotamusic-ask', '1');
    shade.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.55);-webkit-app-region:no-drag';

    const box = document.createElement('div');
    box.style.cssText =
      'min-width:320px;max-width:min(520px,90vw);padding:20px 22px;border-radius:16px;' +
      'background:#242424;color:#fff;font:14px/1.45 system-ui,sans-serif;' +
      'box-shadow:0 16px 48px rgba(0,0,0,.6)';

    const head = document.createElement('div');
    head.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:8px';
    head.textContent = title;

    const body = document.createElement('div');
    body.style.cssText = 'opacity:.75;white-space:pre-wrap;word-break:break-word';
    body.textContent = text;

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap';

    const finish = (value) => {
      shade.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    function onKey(event) {
      if (event.key === 'Escape') finish(null);
      event.stopPropagation();
    }

    for (const item of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.style.cssText =
        'padding:9px 14px;border-radius:10px;cursor:pointer;font:600 13px system-ui,sans-serif;' +
        (item.main
          ? 'border:none;background:#ffdb4d;color:#1a1a1a'
          : 'border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit');

      button.addEventListener('click', () => finish(item.value));
      row.appendChild(button);
    }

    box.append(head, body, row);
    shade.appendChild(box);
    shade.addEventListener('click', (event) => event.target === shade && finish(null));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(shade);
  });
}

/** «18.09.2026 в 14:12» — когда файл появился. */
function whenText(at) {
  const date = new Date(at || Date.now());
  const two = (value) => String(value).padStart(2, '0');

  return (
    `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `в ${two(date.getHours())}:${two(date.getMinutes())}`
  );
}

/** Куда класть на этот раз: спрашиваем, если человек попросил. */
async function whereTo(kind) {
  if (!settings.downloadAsk) return {};

  const buttons =
    kind === 'track'
      ? [
          { label: 'В общую папку', value: {}, main: true },
          { label: 'Выбрать другую…', value: { pick: true } },
          { label: 'Отмена', value: null },
        ]
      : [
          { label: 'В папку альбома', value: { ownFolder: true }, main: true },
          { label: 'В общую папку', value: { ownFolder: false } },
          { label: 'Выбрать другую…', value: { pick: true } },
          { label: 'Отмена', value: null },
        ];

  const choice = await ask(
    'Куда сохранить?',
    'Выбор действует только для этого скачивания.',
    buttons
  );

  if (!choice) return null;

  if (choice.pick) {
    const dir = await ipcRenderer.invoke('kotamusic:download:pick');
    return dir ? { dir, ownFolder: false } : null;
  }

  return choice;
}

/** Такой файл уже есть — спрашиваем, качать ли заново. */
async function askAgain(answer) {
  const choice = await ask(
    'Трек уже скачан',
    `${answer.title}\nФайл создан ${whenText(answer.at)}.\n${answer.file}`,
    [
      { label: 'Скачать заново', value: 'again', main: true },
      { label: 'Отмена', value: null },
    ]
  );

  return choice === 'again';
}

/** Скачивание трека по номеру: с вопросами о папке и о повторе. */
async function downloadTrackById(trackId) {
  const where = await whereTo('track');
  if (!where) return;

  let result = await ipcRenderer.invoke('kotamusic:download:track', trackId, where);

  if (result?.exists) {
    // Вопрос про уже скачанный файл приходит раньше самой загрузки,
    // поэтому «Скачиваю…» показываем только когда она правда началась.
    if (!(await askAgain(result))) return toast('Оставил как есть');

    toast('Скачиваю заново…', { progress: 0, actions: stopAction() });
    result = await ipcRenderer.invoke('kotamusic:download:track', trackId, { ...where, force: true });
  }

  if (!result?.ok && !result?.stopped) toast(`Не вышло: ${result?.error || 'неизвестная ошибка'}`);
}

/** Скачать то, что играет: по номеру, а если его нет — по названию. */
async function downloadCurrent() {
  const about = currentTrack();
  if (!about?.trackId && !about?.title) return toast('Не понял, какой трек играет');

  const where = await whereTo('track');
  if (!where) return;

  const run = async (options) =>
    about.trackId
      ? ipcRenderer.invoke('kotamusic:download:track', about.trackId, options)
      : ipcRenderer.invoke('kotamusic:download:current', { track: about, options });

  let result = await run(where);

  if (result?.exists) {
    if (!(await askAgain(result))) return toast('Оставил как есть');

    toast('Скачиваю заново…', { progress: 0, actions: stopAction() });
    result = await run({ ...where, force: true });
  }

  if (!result?.ok) toast(`Не вышло: ${result?.error || 'неизвестная ошибка'}`);
}

/** Скачивание ходовых треков исполнителя — с вопросом перед началом. */
async function downloadArtist(artistId = null) {
  const who = artistId || artistFromPage();
  if (!who) return toast('Не понял, чьи треки скачивать');

  const about = await ipcRenderer.invoke('kotamusic:artist:count', who);
  if (about?.error) return toast(`Не вышло: ${about.error}`);

  const yes = await ask(
    'Скачать треки исполнителя?',
    `${about.title}: ходовых треков — ${about.count}. Пойдут в файлы, как альбом.`,
    [
      { label: 'Скачать', value: true, main: true },
      { label: 'Отмена', value: null },
    ]
  );

  if (!yes) return;

  const where = await whereTo('album');
  if (!where) return;

  toast('Собираю треки исполнителя…', { progress: 0, actions: stopAction() });
  const result = await ipcRenderer.invoke('kotamusic:download:artist', who, where);
  if (!result?.ok && !result?.stopped) toast(`Не вышло: ${result?.error || 'ошибка'}`);
}

/**
 * Кнопка скачивания в шапке исполнителя: своей у клиента там нет вовсе,
 * а скачать ходовые треки хочется одним нажатием, не открывая меню.
 */
function buildArtistButton() {
  const head = document.querySelector('[data-test-id="ENTITY_HEADER"]');
  const menu = head?.querySelector('[data-test-id="ARTIST_HEADER_CONTEXT_MENU_BUTTON"]');
  const shown = document.querySelector(`[${MARK}-artist]`);

  if (!menu?.parentElement) {
    shown?.remove();
    return;
  }

  if (shown && shown.parentElement === menu.parentElement) return;
  shown?.remove();

  const button = menu.cloneNode(true);
  button.setAttribute(`${MARK}-artist`, '1');

  for (const name of ['data-test-id', 'aria-haspopup', 'aria-expanded', 'aria-pressed', 'disabled', 'aria-disabled', 'data-disabled']) {
    button.removeAttribute(name);
  }

  button.disabled = false;
  button.title = 'Скачать треки исполнителя в файлы';
  button.setAttribute('aria-label', 'Скачать треки исполнителя в файлы');
  if (!useSprite(button, SPRITE_DOWNLOAD_MENU)) button.replaceChildren(iconNode());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadArtist();
  });

  menu.insertAdjacentElement('afterend', button);
}

/**
 * Кнопка в панели плеера.
 *
 * В обычной панели она встаёт рядом с выбором качества. В «Моей волне»
 * такой кнопки у клиента нет вовсе, поэтому там становимся слева от «…»:
 * раньше в «Моей волне» кнопки не появлялось совсем и скачивать можно
 * было только из меню.
 */
function whereToPut() {
  const quality = document.querySelector(QUALITY_BUTTON);
  if (quality?.parentElement) return { anchor: quality, sample: quality };

  const bar = document.querySelector('[data-test-id="VIBE_PLAYERBAR"]');
  const menu = bar?.querySelector('[data-test-id="VIBE_CONTEXT_MENU_BUTTON"]');
  if (!menu?.parentElement) return null;

  // За образец берём «нравится»: у неё тот же размер и поведение,
  // а у «…» внутри лишние признаки открывающегося меню.
  const like = bar.querySelector('[data-test-id="LIKE_BUTTON"]') || menu;
  return { anchor: menu, sample: like };
}

function buildButton() {
  const place = whereToPut();
  if (!place) {
    // Панель сменилась и якоря больше нет — свою кнопку убираем,
    // иначе она повиснет в чужом месте.
    document.querySelector(`[${MARK}]`)?.remove();
    return;
  }

  const { anchor, sample } = place;

  const shown = document.querySelector(`[${MARK}]`);
  if (shown && shown.parentElement === anchor.parentElement) return;
  shown?.remove();

  // Берём соседнюю кнопку целиком: так наша совпадёт по размеру,
  // отступам и поведению при наведении, чем бы их клиент ни задавал.
  const button = sample.cloneNode(true);
  button.setAttribute(MARK, '1');
  button.removeAttribute('data-test-id');
  button.removeAttribute('aria-haspopup');
  button.removeAttribute('aria-expanded');
  button.removeAttribute('aria-checked');
  button.removeAttribute('aria-pressed');

  // ⚠️Образец мог быть выключен (в «Моей волне» «нравится» временами
  // неактивна). Выключенная кнопка не отдаёт нажатий вовсе, а по метке
  // `data-disabled` клиент ещё и красит её в еле видимый серый — снимаем
  // всё это, иначе кнопка выглядит блёкло и не работает.
  button.disabled = false;
  button.removeAttribute('disabled');
  button.removeAttribute('aria-disabled');
  button.removeAttribute('data-disabled');

  button.title = 'Скачать трек в файл';
  button.setAttribute('aria-label', 'Скачать трек в файл');

  // Значок берём из набора самого клиента: свой рисунок был другого
  // размера и цвета, из-за чего кнопка выбивалась из ряда соседних.
  if (!useSprite(button, SPRITE_DOWNLOAD)) button.replaceChildren(iconNode());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadCurrent();
  });

  anchor.parentElement.insertBefore(button, anchor);
}

/** Пункт «Скачать в файл» в открывшемся меню. */
/** Меняет подпись пункта, не трогая значок рядом с ней. */
function setLabel(item, text) {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let found = null;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim()) found = walker.currentNode;
  }

  if (found) found.nodeValue = text;
  else item.append(text);
}

/** Подменяет рисунок значка своим. */
function setIcon(item, shape, sprite = null) {
  // Если у клона значок берётся из общего набора клиента, подменяем
  // картинку там же: так наши пункты выглядят как родные.
  if (sprite && useSprite(item, sprite)) return;

  const picture = item.querySelector('svg');
  if (!picture) return;

  picture.setAttribute('viewBox', '0 0 24 24');
  picture.setAttribute('fill', 'none');
  picture.replaceChildren();

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shape);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  picture.appendChild(path);
}

function addMenuItem({ node, items }, kind, from) {
  if (node.querySelector(`[${MARK}-item]`)) return;

  // Клонируем настоящий пункт меню: так наш получает и значок, и отступы,
  // и подсветку при наведении, чем бы их клиент ни задавал. Если в меню
  // есть «Скачать» — берём его: значок со стрелкой там уже нужный.
  const sample = items.find((node) => /^Скачать/i.test(node.textContent.trim())) || items[0];
  if (!sample?.parentElement) return;

  const item = sample.cloneNode(true);
  item.setAttribute(`${MARK}-item`, '1');
  item.removeAttribute('data-test-id');
  item.removeAttribute('aria-haspopup');
  item.removeAttribute('aria-expanded');

  // У пункта-образца справа могла быть стрелка подменю. Наши пункты ничего
  // не раскрывают, а со стрелкой выглядели так, будто раскрывают.
  const pictures = item.querySelectorAll('svg');
  for (let i = 1; i < pictures.length; i += 1) pictures[i].remove();

  // Если за образец взяли не «Скачать», значок у клона чужой — рисуем свой.
  setIcon(item, ICON_PATH, SPRITE_DOWNLOAD_MENU);

  setLabel(item, 'Скачать в файл');

  item.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const ids = kind === 'track' ? { trackId: currentMenuTrackId(from) } : targetIds(from);

    if (kind === 'album' && ids.albumId) {
      const where = await whereTo('album');
      if (where) {
        toast('Собираю список альбома…', { progress: 0, actions: stopAction() });
        const result = await ipcRenderer.invoke('kotamusic:download:album', ids.albumId, where);
        if (!result?.ok) toast(`Не вышло: ${result?.error || 'ошибка'}`);
      }
    } else if (kind === 'playlist' && (ids.uuid || (ids.owner && ids.kind))) {
      const where = await whereTo('playlist');
      if (where) {
        toast('Собираю список плейлиста…', { progress: 0, actions: stopAction() });
        const result = await ipcRenderer.invoke(
          'kotamusic:download:playlist',
          ids.uuid ? 'uuid' : ids.owner,
          ids.uuid || ids.kind,
          where
        );
        if (!result?.ok) toast(`Не вышло: ${result?.error || 'ошибка'}`);
      }
    } else if (kind === 'artist') {
      await downloadArtist(ids.artistId);
    } else if (kind !== 'track') {
      // Раньше здесь молча качался играющий трек — не то, чего просили.
      toast(kind === 'album' ? 'Не понял, какой альбом скачивать' : 'Не понял, какой плейлист скачивать');
    } else if (ids.trackId) {
      await downloadTrackById(ids.trackId);
    } else {
      // Меню «Моей волны» ссылок не содержит — качаем то, что играет.
      await downloadCurrent();
    }

    document.body.click(); // меню закрывается само, как после своих пунктов
  });

  // Ставим последним пунктом, после всех настоящих.
  items[items.length - 1].insertAdjacentElement('afterend', item);

  // Над скачиванием — текст песни: в «Моей волне» кнопки текста нет,
  // а посмотреть слова хочется и там.
  if (settings.lyricsButton !== false) {
    const words = item.cloneNode(true);
    words.setAttribute(`${MARK}-item`, '1');
    setLabel(words, 'Текст песни');
    setIcon(words, LYRICS_PATH, SPRITE_LYRICS_MENU);

    words.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('kotamusic:lyrics:toggle'));
      document.body.click();
    });

    item.insertAdjacentElement('beforebegin', words);
  }

  // Над «Скачать в файл» — родное скачивание клиента: его кнопка спрятана
  // в шапке, а из меню до неё ближе.
  // Если клиент сам предлагает скачивание в этом меню, своего не добавляем:
  // в меню трека и альбома у него есть «Скачать» («Удалить с устройства»,
  // когда уже скачано).
  const hasOwn = items.some((node) => /^(Скачать|Удалить с устройства)$/i.test(node.textContent.trim()));

  const own = hasOwn ? null : offlineButton(from);
  if (own) {
    const offline = item.cloneNode(true);
    offline.setAttribute(`${MARK}-item`, '1');
    setLabel(offline, offlineDone(own) ? 'Убрать из скачанного' : 'Скачать офлайн');
    setIcon(offline, ICON_PATH, offlineDone(own) ? 'downloaded_xxs' : SPRITE_DOWNLOAD_MENU);

    offline.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      pressLikeMouse(own);
      document.body.click();
    });

    item.insertAdjacentElement('beforebegin', offline);
  }

  // Следом — «Открыть папку»: сразу после скачивания это первое,
  // что хочется сделать.
  const open = item.cloneNode(true);
  open.setAttribute(`${MARK}-item`, '1');
  setLabel(open, 'Открыть папку со скачанным');
  setIcon(open, FOLDER_PATH);

  open.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke('kotamusic:download:folder');
    document.body.click();
  });

  item.insertAdjacentElement('afterend', open);

}

/** Короткое сообщение в углу — своё, чтобы не спорить с клиентом. */
function toast(text, { progress = null, id = 'kotamusic-toast', actions = null } = {}) {
  let box = document.querySelector(`[data-kotamusic-progress="${id}"]`);

  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-kotamusic-progress', id);
    box.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:92px;z-index:2147483646;' +
      'min-width:260px;max-width:min(520px,90vw);padding:10px 14px;border-radius:12px;' +
      'background:#2a2a2a;color:#fff;font:13px/1.35 system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.45);-webkit-app-region:no-drag';

    const row = document.createElement('div');
    row.setAttribute('data-role', 'row');
    row.style.cssText = 'display:flex;align-items:center;gap:10px';

    const label = document.createElement('div');
    label.setAttribute('data-role', 'label');
    label.style.cssText = 'flex:1;min-width:0';
    row.appendChild(label);

    const buttons = document.createElement('div');
    buttons.setAttribute('data-role', 'buttons');
    buttons.style.cssText = 'display:flex;gap:6px;flex:none';
    row.appendChild(buttons);

    box.appendChild(row);

    const track = document.createElement('div');
    track.setAttribute('data-role', 'track');
    track.style.cssText =
      'margin-top:8px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden';

    const fill = document.createElement('div');
    fill.setAttribute('data-role', 'fill');
    fill.style.cssText = 'height:100%;width:0;background:#ffdb4d;transition:width .2s';

    track.appendChild(fill);
    box.appendChild(track);
    document.body.appendChild(box);
  }

  box.querySelector('[data-role="label"]').textContent = text;

  // Кнопки пересобираем, только когда они поменялись: иначе нажатие
  // не успевало бы сработать — сообщение обновляется несколько раз в секунду.
  const buttons = box.querySelector('[data-role="buttons"]');
  const names = (actions || []).map((item) => item.label).join('|');

  if (buttons.dataset.names !== names) {
    buttons.dataset.names = names;
    buttons.replaceChildren();

    for (const item of actions || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.style.cssText =
        'padding:5px 10px;border-radius:8px;cursor:pointer;font:600 12px system-ui,sans-serif;' +
        'border:1px solid rgba(255,255,255,.22);background:transparent;color:inherit';

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        item.run();
      });

      buttons.appendChild(button);
    }
  }

  const track = box.querySelector('[data-role="track"]');
  const fill = box.querySelector('[data-role="fill"]');

  track.style.display = progress === null ? 'none' : '';
  if (progress !== null) fill.style.width = `${Math.round(progress * 100)}%`;

  clearTimeout(box.dataset.timer);
  if (progress === null) {
    box.dataset.timer = setTimeout(() => box.remove(), actions?.length ? 8000 : 4000);
  }

  return box;
}

/** Убирает сообщение сразу, не дожидаясь срока. */
function hideToast(id = 'kotamusic-toast') {
  const box = document.querySelector(`[data-kotamusic-progress="${id}"]`);
  if (box) {
    clearTimeout(box.dataset.timer);
    box.remove();
  }
}

/** Кнопка «Остановить» рядом с ходом дела. */
function stopAction() {
  return [
    {
      label: 'Остановить',
      run: () => {
        ipcRenderer.invoke('kotamusic:download:stop');
        toast('Останавливаю…');
      },
    },
  ];
}

/** Кнопка «Открыть папку» под готовым скачиванием. */
function folderAction() {
  return [
    {
      label: 'Открыть папку',
      run: () => ipcRenderer.invoke('kotamusic:download:folder'),
    },
  ];
}

/**
 * Что лежит под кнопкой, которой открыли меню: альбом, плейлист или трек.
 *
 * ⚠️Искать ссылку «где-нибудь выше по дереву» нельзя: поднявшись до общего
 * слоя страницы, поиск хватал первую попавшуюся ссылку — однажды так вместо
 * альбома скачалась книга из бокового списка. Поэтому на каждом уровне
 * ссылки берём, только пока их мало: много ссылок — значит, мы уже в списке
 * чужих карточек, и гадать не надо.
 */
function targetIds(from) {
  let node = from;

  for (let depth = 0; node && depth < 12; depth += 1) {
    const links = node.matches?.('a[href]')
      ? [node]
      : [...(node.querySelectorAll?.('a[href*="albumId="],a[href*="/album/"],a[href*="/playlists/"],a[href*="kind="]') || [])];

    if (links.length > 3) break;

    for (const link of links) {
      const ids = idsFrom(link.getAttribute('href'));
      if (ids.albumId || ids.owner) return ids;
    }

    node = node.parentElement;
  }

  return headerIds(from);
}

/**
 * Страница альбома или плейлиста: ссылки на саму себя у неё нет, зато есть
 * шапка. Номер альбома лежит в адресе обложки (`…/xxxx.a.<номер>-1/…`),
 * а плейлист выдаёт ссылка на владельца.
 */
function headerIds(from) {
  const head = from?.closest?.('[data-test-id="ENTITY_HEADER"]')
    || document.querySelector('[data-test-id="ENTITY_HEADER"]');

  if (!head || (from && !head.contains(from))) return {};

  // ⚠️Собираем всё, что нашли, и отдаём разом. Раньше отдавали первое
  // попавшееся, и на странице альбома ссылка на исполнителя перебивала
  // номер альбома: «Не понял, какой альбом скачивать».
  const found = { albumId: null, trackId: null, owner: null, kind: null, artistId: null, uuid: null };

  const list = head.querySelector('a[href*="/playlists/"],a[href*="kind="]');
  if (list) {
    const ids = idsFrom(list.getAttribute('href'));
    if (ids.owner) {
      found.owner = ids.owner;
      found.kind = ids.kind;
    }
  }

  const artist = head.querySelector('a[href*="artistId="]');
  const artistId = artist && /artistId=(\d+)/.exec(artist.getAttribute('href') || '');
  if (artistId) found.artistId = artistId[1];

  // Адрес страницы клиента: с 5.120 плейлист открывается по опознавателю
  // (`/playlists?playlistUuid=…`), пары «владелец и номер» там больше нет.
  const here = new URLSearchParams(location.search);
  found.uuid = here.get('playlistUuid') || null;

  const inUrl = idsFrom(location.pathname + location.search);
  if (inUrl.albumId) found.albumId = inUrl.albumId;
  if (!found.owner && inUrl.owner) {
    found.owner = inUrl.owner;
    found.kind = inUrl.kind;
  }

  // Номер альбома виден в адресе обложки: `…/xxxx.a.<номер>-1/…`.
  // Первая картинка в шапке — обложка самой сущности.
  if (!found.albumId) {
    for (const picture of head.querySelectorAll('img')) {
      const cover = /\.a\.(\d+)-/.exec(picture.getAttribute('src') || '');
      if (cover) {
        found.albumId = cover[1];
        break;
      }
    }
  }

  return found;
}

/**
 * Родная кнопка клиента «Скачать» — та, что кладёт треки в память клиента
 * для прослушивания без интернета. Ищем рядом с кнопкой, открывшей меню,
 * а если её там нет — в шапке страницы.
 */
function offlineButton(from) {
  const near = from?.parentElement?.querySelector('[data-test-id$="_DOWNLOAD_BUTTON"]');
  if (near) return near;

  const head = from?.closest?.('[data-test-id="ENTITY_HEADER"]')
    || document.querySelector('[data-test-id="ENTITY_HEADER"]');

  const found = head?.querySelector('[data-test-id$="_DOWNLOAD_BUTTON"]');
  return found && found.getBoundingClientRect().width > 0 ? found : null;
}

/** Уже скачано в клиент? Клиент рисует это своим значком. */
function offlineDone(button) {
  const use = button.querySelector('use');
  const name = use?.getAttribute('xlink:href') || use?.getAttribute('href') || '';
  return /downloaded/i.test(name);
}

/** Нажатие как настоящей мышью: кнопки клиента ждут именно такого. */
function pressLikeMouse(node) {
  const rect = node.getBoundingClientRect();
  const where = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  node.dispatchEvent(new PointerEvent('pointerdown', where));
  node.dispatchEvent(new MouseEvent('mousedown', where));
  node.dispatchEvent(new PointerEvent('pointerup', where));
  node.dispatchEvent(new MouseEvent('mouseup', where));
  node.dispatchEvent(new MouseEvent('click', where));
}

/** Номер исполнителя со страницы, на которой мы стоим. */
function artistFromPage() {
  const here = new URLSearchParams(location.search).get('artistId');
  if (here) return here;

  const head = document.querySelector('[data-test-id="ENTITY_HEADER"]');
  const found = /artistId=(\d+)/.exec(head?.innerHTML || '');
  return found ? found[1] : null;
}

/** Номер трека, по которому открыли меню. */
function currentMenuTrackId(from) {
  const ids = targetIds(from);
  return ids.trackId || currentTrackId();
}

/**
 * Само меню метки не имеет, поэтому находим его по виду: отдельный слой
 * поверх страницы, внутри которого несколько строк с подписями.
 */
function openMenu() {
  const bar = document.querySelector(BAR);

  for (const node of document.querySelectorAll('div,ul,section,nav')) {
    if (bar?.contains(node) || node.hasAttribute(`${MARK}-item`)) continue;

    // Окна вроде «Настроек звука» — не меню: туда наши пункты не нужны.
    if (node.closest('[role="dialog"],[aria-modal="true"]')) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 140 || rect.width > 380 || rect.height < 100) continue;

    const items = [...node.children].filter((child) => {
      const size = child.getBoundingClientRect();
      if (!child.textContent.trim() || size.height < 24 || size.height > 52) return false;

      // У пунктов меню всегда есть значок и короткая подпись в одну строку.
      return Boolean(child.querySelector('svg')) && child.textContent.trim().length < 40;
    });

    if (items.length < 4) continue;

    // Меню лежит поверх страницы: в его середине нет ничего чужого.
    const top = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + rect.height / 2)
    );

    if (top && node.contains(top)) return { node, items };
  }

  return null;
}


function watchMenus() {
  const menu = openMenu();
  if (!menu) return;


  const opener = lastTarget?.closest?.('[data-test-id$="CONTEXT_MENU_BUTTON"]');
  addMenuItem(menu, menuKind(opener?.getAttribute('data-test-id') || ''), opener);
}

function start() {
  document.addEventListener('pointerdown', (event) => (lastTarget = event.target), true);

  document.addEventListener('contextmenu', (event) => (lastTarget = event.target), true);

  ipcRenderer.on('kotamusic:download:progress', (_event, state) => {
    if (!state) return;

    if (state.error) return toast(`Не вышло: ${state.error}`);

    if (state.stopped) {
      toast(
        state.saved ? `Остановил. Успело скачаться: ${state.saved}` : 'Остановил, ничего не скачано',
        { actions: state.saved ? folderAction() : null }
      );
      return;
    }

    if (state.done) {
      toast(state.folder ? `Готово: ${state.folder}` : `Скачано: ${state.title}`, {
        actions: folderAction(),
      });
      return;
    }

    const parts = [state.title, state.text, state.speed].filter(Boolean);
    toast(`Скачиваю: ${parts.join(' · ')}`, { progress: state.share || 0, actions: stopAction() });
  });

  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    settings = state?.values || {};

    const tick = () => {
      if (settings.downloadButton !== false) {
        buildButton();
        buildArtistButton();
      }
      watchMenus();
    };

    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 1000);
    tick();
  });

  ipcRenderer.on('kotamusic:settings:changed', (_event, values) => {
    settings = values || settings;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

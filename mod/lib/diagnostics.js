'use strict';
// Понятные ошибки и отчёт для задачи на GitHub.
//
// «fetch failed» человеку ничего не говорит, а по нему одному не понять,
// что сломалось: 25.09.2026 обновление не шло неделю, и причину нашли
// только разбором сети руками — в hosts были вписаны адреса GitHub,
// один медленный, другой нерабочий. Поэтому:
//  - каждая ошибка переводится на понятный язык с адресом, который
//    не ответил, и с пометкой, если этот адрес вписан в hosts;
//  - кнопка «Собрать логи» складывает в один файл версии, проверку сети
//    до GitHub и Яндекса и хвосты журналов — его прикладывают к задаче.

const dns = require('dns');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { app, ipcMain, shell } = require('electron');

const branding = require('../branding');
const log = require('./log');
const settings = require('./settings');

// Куда ходит мод: релизы на GitHub и раздача клиента у Яндекса.
const HOSTS = [
  'github.com',
  'api.github.com',
  'release-assets.githubusercontent.com',
  'music-desktop-application.s3.yandex.net',
  'desktop.app.music.yandex.net',
];

const PROBE_URL = `${branding.repositoryUrl}/releases/latest`;

const HOSTS_FILE =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';

/** Последняя ошибка — чтобы попасть в отчёт, даже если её уже закрыли. */
let lastError = null;

/** Строки hosts, где упомянут этот адрес. */
function hostsEntries(host) {
  try {
    return fs
      .readFileSync(HOSTS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, '').trim())
      .filter((line) => line && line.split(/\s+/).slice(1).includes(host));
  } catch {
    return [];
  }
}

/** Код ошибки сети: у fetch он лежит в cause, иногда в целой пачке попыток. */
function netCode(error) {
  const cause = error?.cause;
  return (
    cause?.code ||
    cause?.errors?.find((e) => e?.code)?.code ||
    error?.code ||
    null
  );
}

/** Адрес, до которого не достучались: из запроса или из самой ошибки. */
function failedHost(error) {
  const attempted = /attempted address: ([^:,\s]+)/.exec(String(error?.cause?.message))?.[1];
  if (attempted) return attempted;

  try {
    return new URL(error?.url).hostname;
  } catch {
    return null;
  }
}

/** Ошибку в текст для человека: что случилось и что с этим делать. */
function explain(error) {
  if (!error) return 'непонятная ошибка';

  const host = failedHost(error) || 'сервер';
  const code = netCode(error);
  const status = error.status;

  let text;

  if (status === 403 || status === 429) {
    text = `${host} временно ограничил запросы (HTTP ${status}). Попробуйте через час`;
  } else if (status === 404) {
    text = `на ${host} нет нужного файла (HTTP 404). Сборка, возможно, ещё выкладывается — попробуйте через несколько минут`;
  } else if (status >= 500) {
    text = `${host} сбоит (HTTP ${status}). Попробуйте позже`;
  } else if (status) {
    text = `${host} ответил HTTP ${status}`;
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    text = `не удаётся найти адрес ${host}: нет интернета или сбоит DNS`;
  } else if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'ECONNREFUSED'
  ) {
    text = `${host} не отвечает. Возможно, его блокирует провайдер — попробуйте с VPN`;
  } else if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
    text = `соединение с ${host} обрывается. Похоже на блокировку у провайдера или вмешательство антивируса`;
  } else if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    text = `нет маршрута до ${host}: сеть недоступна`;
  } else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code || '')) {
    text = `не удалось проверить сертификат ${host}: его подменяет антивирус или прокси`;
  } else if (code === 'ENOSPC') {
    text = 'на диске не хватает места';
  } else if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
    text = 'нет доступа к файлам клиента. Закройте все окна Яндекс Музыки и попробуйте снова';
  } else if (error.message === 'fetch failed') {
    text = `нет связи с ${host}${code ? ` (${code})` : ''}`;
  } else {
    text = error.message;
  }

  // Вписанный руками адрес — частая причина: списки «обхода блокировок»
  // приносят адреса, которые со временем перестают работать.
  if (!status && host !== 'сервер' && hostsEntries(host).length) {
    text += `. Адрес ${host} вписан в файл hosts — возможно, дело в нём`;
  }

  return text;
}

/** Запоминает ошибку для отчёта и возвращает её понятное описание. */
function remember(error, context) {
  const text = explain(error);
  lastError = {
    at: new Date().toISOString(),
    context,
    text,
    code: netCode(error),
    status: error?.status || null,
    url: error?.url || null,
    stack: error?.stack || String(error),
    cause: error?.cause ? String(error.cause.stack || error.cause) : null,
  };
  return text;
}

/**
 * fetch, который помнит адрес: без этого ошибка сети не говорит, куда
 * именно мы не достучались. Ответ не 2xx тоже превращаем в ошибку
 * с кодом — так её можно объяснить, а не показывать «HTTP 404».
 */
async function request(url, options, { allowStatus = false } = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (e) {
    e.url ??= url;
    throw e;
  }

  if (!response.ok && !allowStatus) {
    const error = new Error(`${new URL(response.url || url).hostname} ответил HTTP ${response.status}`);
    error.status = response.status;
    error.url = response.url || url;
    throw error;
  }

  return response;
}

// ——— Отчёт ———

/** Прячет имя пользователя и то, что похоже на ключи. */
function mask(text) {
  let out = String(text);

  const home = os.homedir();
  const user = os.userInfo().username;

  if (home) out = out.split(home).join('~');

  // Имя прячем только в путях: целиком по тексту нельзя — оно бывает
  // частью других слов (так из адреса репозитория AveHarrisan вышло
  // «Ave<пользователь>»).
  if (user) {
    const name = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`((?:Users|home)(?:\\\\|\\\\\\\\|/))${name}(?=\\\\|/|"|\\s|$)`, 'gi'), '$1<пользователь>');
  }

  return out
    .replace(/(OAuth|Bearer)\s+[\w.-]+/gi, '$1 <скрыто>')
    .replace(/((?:token|access_token|authorization|session_id|Session_id)["'=:\s]+)[\w.%-]{12,}/gi, '$1<скрыто>');
}

/** Последние строки файла, без чтения всего: журнал бывает на десятки МБ. */
function tail(file, lines, filter) {
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);

    let rows = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (size > length) rows.shift(); // первая строка обрезана посередине
    if (filter) rows = rows.filter(filter);

    // Бывают строки длиной в весь чанк клиента — режем.
    return rows.slice(-lines).map((row) => (row.length > 600 ? `${row.slice(0, 600)}…` : row));
  } catch (e) {
    return [`(не прочитать: ${e.code || e.message})`];
  }
}

/** Соединение с одним адресом: сколько мс или почему нет. */
function connect(address, port = 443, timeout = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: address, port, timeout, autoSelectFamily: false });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.on('connect', () => done(`${Date.now() - started} мс`));
    socket.on('timeout', () => done('не отвечает'));
    socket.on('error', (e) => done(e.code || e.message));
  });
}

/** Что с сетью до одного адреса: hosts, DNS, соединение с каждым IP. */
async function probeHost(host) {
  const lines = [`${host}`];

  const entries = hostsEntries(host);
  if (entries.length) lines.push(`  ⚠ вписан в hosts: ${entries.join(' | ')}`);

  let addresses = [];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch (e) {
    lines.push(`  адрес не найден: ${e.code || e.message}`);
    return lines;
  }

  const results = await Promise.all(addresses.map((a) => connect(a.address)));
  addresses.forEach((a, i) => lines.push(`  ${a.address} (IPv${a.family}): ${results[i]}`));

  return lines;
}

/** Настоящий запрос тем же fetch, что и мод, — с тем же итогом. */
async function probeFetch(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': branding.name },
      signal: AbortSignal.timeout(20000),
    });
    await response.arrayBuffer();
    return `${url}\n  HTTP ${response.status}, ${Date.now() - started} мс, итоговый адрес ${new URL(response.url).hostname}`;
  } catch (e) {
    e.url ??= url;
    return `${url}\n  ошибка через ${Date.now() - started} мс: ${explain(e)}\n  ${netCode(e) || ''} ${e.cause?.message || e.message}`;
  }
}

/** Собирает отчёт в файл и возвращает путь к нему и короткую сводку. */
async function collect() {
  const now = new Date();
  const out = [];
  const add = (...lines) => out.push(...lines);
  const title = (name) => add('', `=== ${name} ===`);

  add(`Отчёт ${branding.name} — ${now.toISOString()}`);
  add('Приложите этот файл к задаче на GitHub: перетащите его в поле описания.');

  title('Версии');
  add(
    `Мод: ${branding.version}, собран под клиент ${branding.builtForClient || '?'}`,
    `Клиент: ${app.getVersion()}`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node}`,
    `Система: ${os.type()} ${os.release()} ${os.arch()}, язык ${app.getLocale?.() || '?'}`
  );

  title('Последняя ошибка');
  if (lastError) {
    add(
      `${lastError.at} — ${lastError.context}`,
      `Для человека: ${lastError.text}`,
      `Код: ${lastError.code || '-'}, HTTP: ${lastError.status || '-'}, адрес: ${lastError.url || '-'}`,
      lastError.stack,
      lastError.cause ? `Причина: ${lastError.cause}` : ''
    );
  } else {
    add('за этот запуск ошибок не было');
  }

  title('Сеть');
  const [probes, fetched] = await Promise.all([
    Promise.all(HOSTS.map(probeHost)),
    Promise.all([probeFetch(PROBE_URL), probeFetch(`${branding.repositoryUrl}/releases/latest/download/build-info.json`)]),
  ]);
  probes.forEach((lines) => add(...lines));
  add('', 'Запросы так же, как их делает мод:', ...fetched);

  try {
    const proxy = await require('electron').session.defaultSession.resolveProxy('https://github.com');
    add('', `Прокси для браузерной части: ${proxy}`);
  } catch {}
  const envProxy = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']
    .filter((name) => process.env[name] || process.env[name.toLowerCase()])
    .map((name) => `${name}=${process.env[name] || process.env[name.toLowerCase()]}`);
  if (envProxy.length) add(`Прокси из окружения: ${envProxy.join(' ')}`);

  title('Настройки мода');
  add(JSON.stringify(settings.get(), null, 2));

  title('Журнал мода (последние строки)');
  add(...tail(log.file, 300));

  title('Журнал обновления');
  add(...tail(path.join(os.tmpdir(), 'kotamusic-update.log'), 60));

  // Из журнала клиента берём только предупреждения и ошибки: в остальном
  // много лишнего, и к нам оно отношения не имеет.
  title('Журнал клиента (ошибки и предупреждения)');
  add(
    ...tail(path.join(app.getPath('userData'), 'logs', 'main.log'), 80, (row) =>
      /\b(error|warn)/i.test(row)
    )
  );

  // Время в имени файла — местное: человек ищет файл по своим часам.
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const dir = app.getPath('downloads');
  const file = path.join(dir, `KotaMusic-отчёт-${stamp}.txt`);
  fs.writeFileSync(file, mask(out.join('\n')) + '\n');

  log.info('Отчёт собран:', file);
  shell.showItemInFolder(file);

  return { file, issueUrl: issueUrl(file) };
}

/** Новая задача на GitHub с уже заполненными версиями и ошибкой. */
function issueUrl(file) {
  const body = [
    '**Что случилось:** ',
    '',
    `Мод ${branding.version}, клиент ${app.getVersion()}, ${os.type()} ${os.release()}`,
    lastError ? `Ошибка: ${lastError.text}` : '',
    '',
    `Отчёт: перетащите сюда файл \`${path.basename(file || 'KotaMusic-отчёт.txt')}\` из папки «Загрузки».`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const params = new URLSearchParams({
    title: lastError ? `Ошибка: ${lastError.text.slice(0, 80)}` : '',
    body: mask(body),
  });

  return `${branding.repositoryUrl}/issues/new?${params}`;
}

function start() {
  ipcMain.handle('kotamusic:diagnostics:collect', async () => {
    try {
      return await collect();
    } catch (e) {
      log.error('Отчёт не собрался:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('kotamusic:diagnostics:issue-url', () => issueUrl(null));
}

module.exports = { start, explain, remember, request, collect, mask };

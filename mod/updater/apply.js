'use strict';
// Подмена app.asar после выхода клиента.
//
// Пока клиент работает, его собственный архив занят, поэтому мод скачивает
// новую сборку, а замену выполняет этот сценарий: клиент запускает его
// отдельным процессом (своим же Electron в режиме Node), закрывается,
// сценарий дожидается освобождения файла, подменяет архив, обновляет
// проверку целостности и запускает клиент обратно.
//
// Если передан установщик клиента, сначала выполняется он: так клиент
// обновляется вместе с модом, и мод не стирается новым архивом.
//
// Запуск: apply.js <новый asar> <app.asar клиента> <файл целостности>
//         <исполняемый файл> <pid клиента> [<установщик клиента>]

const path = require('path');
const { spawn } = require('child_process');

const fs = require('./fs');
const { patchIntegrity } = require('./integrity');

const [source, target, integrityTarget, executable, pid, clientArg] = process.argv.slice(2);

// Седьмым доводом приходит либо путь к установщику клиента (его надо
// выполнить самим), либо слово «refresh-backup» — так cmd сообщает, что
// клиент он уже переустановил и резервные копии пора сделать заново.
const clientInstaller = clientArg && clientArg !== 'refresh-backup' ? clientArg : '';
const clientReinstalled = Boolean(clientArg);

const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try {
    fs.appendFileSync(path.join(require('os').tmpdir(), 'kotamusic-update.log'), line);
  } catch {}
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Запуск клиента обратно. Этот сценарий работает под тем же Electron
 * в режиме Node, и переменную этого режима нельзя передавать дальше —
 * иначе клиент запустится как обычный Node и сразу закроется.
 */
function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KOTAMUSIC_UPDATE_TEST;
  delete env.KOTAMUSIC_UPDATE_ASSET;

  spawn(executable, [], { detached: true, stdio: 'ignore', env }).unref();
}

/** Клиент закрывается не мгновенно — ждём, пока процесс исчезнет. */
async function waitForExit() {
  // Ноль означает, что ждать нечего: клиент закрыт раньше нас.
  if (!pid || pid === '0') return true;

  for (let i = 0; i < 60; i += 1) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      return true;
    }
    await sleep(500);
  }

  return false;
}

/** Файл освобождается позже самого процесса — пробуем, пока не выйдет. */
async function replace() {
  for (let i = 0; i < 30; i += 1) {
    try {
      fs.copyFileSync(source, target);
      return true;
    } catch (e) {
      log('архив занят:', e.message);
      await sleep(1000);
    }
  }

  return false;
}

/**
 * Обновление самого клиента его же установщиком. На Windows он умеет
 * тихую установку, на остальных системах открываем файл и ждём человека.
 */
async function updateClient() {
  log('ставлю клиент из', clientInstaller);

  if (process.platform !== 'win32') {
    spawn('xdg-open', [clientInstaller], { detached: true, stdio: 'ignore' }).unref();
    log('установщик клиента открыт, дальше решает человек');
    return false;
  }

  // /D задаёт папку установки и должен идти последним без кавычек:
  // так клиент вернётся ровно туда, где стоял.
  const dir = path.dirname(executable);

  await new Promise((done) => {
    const child = spawn(clientInstaller, ['/S', `/D=${dir}`], { stdio: 'ignore' });
    log('установщик клиента запущен, pid', child.pid, 'папка', dir);

    child.on('exit', (code) => {
      log('установщик клиента завершился с кодом', code);
      done();
    });
    child.on('error', (e) => {
      log('установщик клиента не запустился:', e.message);
      done();
    });
  });

  // Клиент после тихой установки запускается сам — закрываем его,
  // иначе он держит файлы, которые нам нужно подменить.
  await sleep(4000);

  for (const name of [path.basename(executable)]) {
    try {
      spawn('taskkill', ['/IM', name, '/F'], { stdio: 'ignore' });
    } catch {}
  }

  await sleep(3000);
  return true;
}

async function main() {
  log('жду выхода клиента', pid);

  if (!(await waitForExit())) {
    log('клиент не закрылся, обновление отменено');
    return;
  }

  if (clientInstaller) {
    const ok = await updateClient();
    if (!ok) return;
  }

  if (clientReinstalled) {
    // Установщик клиента переписывает папку целиком и уносит с собой
    // резервную копию, сделанную при установке мода. Свежие файлы —
    // как раз нетронутый оригинал: сохраняем их заново, иначе потом
    // нечем будет откатиться.
    for (const file of [target, integrityTarget]) {
      try {
        fs.copyFileSync(file, `${file}.original`);
        log('резервная копия обновлена:', `${file}.original`);
      } catch (e) {
        log('резервную копию сделать не вышло:', e.message);
      }
    }
  }

  const backup = `${target}.before-update`;
  const integrityBackup = `${integrityTarget}.before-update`;

  try {
    fs.copyFileSync(target, backup);
    fs.copyFileSync(integrityTarget, integrityBackup);
  } catch (e) {
    log('не удалось сделать копию:', e.message);
    return;
  }

  if (!(await replace())) {
    log('подменить архив не вышло, возвращаю прежний');
    try {
      fs.copyFileSync(backup, target);
    } catch {}
    return;
  }

  // Исправляем отдельную копию до замены exe. Краткая блокировка
  // антивирусом после установки не должна оставлять клиент без мода.
  const staged = path.join(path.dirname(integrityTarget),
    `.kotamusic-${Date.now()}-${path.basename(integrityTarget)}`);
  try {
    fs.copyFileSync(integrityTarget, staged);
    const result = patchIntegrity(staged, target);
    let installed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        fs.copyFileSync(staged, integrityTarget);
        installed = true;
        break;
      } catch (e) {
        log('файл целостности занят, повторяю:', e.message);
        await sleep(1000);
      }
    }
    if (!installed) throw new Error('Не удалось заменить файл целостности за 30 попыток');
    // Повторное чтение подтверждает соответствие exe установленному архиву.
    const verified = patchIntegrity(integrityTarget, target);
    if (verified.patched) throw new Error('Файл целостности изменился во время обновления');
    log('проверка целостности:', JSON.stringify(result));
  } catch (e) {
    log('целостность не обновилась, возвращаю прежний архив:', e.message);
    // Возвращаем согласованную пару, если запись exe успела начаться.
    try {
      fs.copyFileSync(integrityBackup, integrityTarget);
    } finally {
      fs.copyFileSync(backup, target);
    }
    throw e;
  }

  log('готово, запускаю клиент');

  launch();
}

main().catch((e) => log('ошибка:', e.stack || e.message));

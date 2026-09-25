'use strict';
// Где стоят всплывающие сообщения мода: в правом нижнем углу, но над
// панелью плеера, а не на ней, и поверх кнопок мода.
//
// Раньше сообщения висели на фиксированных 48 пикселях от низа и заезжали
// на панель плеера: кнопки «HQ+», «Мини-плеер» просвечивали сквозь
// сообщение и перекрывали его кнопки. Высота панели зависит от вида
// плеера и масштаба, поэтому меряем её, а не угадываем.
//
// Файл называется с подчёркивания, чтобы подключиться раньше остальных:
// сценарии идут по алфавиту, а помощник нужен им всем.

const BAR = '[data-test-id="PLAYERBAR_DESKTOP"]';

// Ряд кнопок мода в углу («HQ+», обновление, замок, «Мини-плеер») стоит
// над панелью плеера — сообщение встаёт ещё выше, чтобы их не закрывать.
const MOD_BUTTONS = [
  '[data-kotamusic-miniplayer-button]',
  '[data-kotamusic-miniplayer-lock]',
  '[data-kotamusic-update-button]',
  '[data-kotamusic-quality]',
].join(',');

const GAP = 10;

/** Верх того, что занято внизу окна: панель плеера и кнопки мода. */
function barTop() {
  let top = innerHeight - 12;

  for (const node of document.querySelectorAll(`${BAR},${MOD_BUTTONS}`)) {
    const rect = node.getBoundingClientRect();
    if (rect.height > 0 && rect.width > 0) top = Math.min(top, rect.top);
  }

  return top;
}

function place(box) {
  const top = barTop();
  box.style.bottom = `${Math.max(12, innerHeight - top + GAP)}px`;
  // Длинное сообщение не должно уезжать под заголовок окна.
  box.style.maxHeight = `${Math.max(120, top - GAP * 2)}px`;
  box.style.overflowY = 'auto';
}

window.__kotamusicPopup = (box) => {
  box.style.zIndex = '2147483647';
  place(box);

  // Панель меняет высоту (вид плеера, масштаб, окно) — следим, пока
  // сообщение на экране.
  const follow = () => place(box);
  const timer = setInterval(() => {
    if (!box.isConnected) {
      clearInterval(timer);
      removeEventListener('resize', follow);
      return;
    }
    follow();
  }, 500);
  addEventListener('resize', follow);
};

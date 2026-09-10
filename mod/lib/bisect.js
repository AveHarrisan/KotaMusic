'use strict';
// Поиск поля, из-за которого Discord перестаёт рассылать статус.
//
// По очереди отправляем варианты кадра, отличающиеся ровно одним полем
// от рабочего. Номер варианта пишем в название трека — тогда снаружи
// видно, какой именно дошёл, и сверять журналы не нужно.

const VARIANTS = [
  {
    id: 1,
    name: 'как у автора (эталон)',
    apply: () => {},
  },
  {
    id: 2,
    name: 'добавлен small_text без картинки',
    apply: (a) => {
      a.assets.small_text = 'KotaMusic 1.0.0';
    },
  },
  {
    id: 3,
    name: 'убран status_display_type',
    apply: (a) => {
      delete a.status_display_type;
    },
  },
  {
    id: 4,
    name: 'status_display_type = 2 (трек в списке участников)',
    apply: (a) => {
      a.status_display_type = 2;
    },
  },
  {
    id: 5,
    name: 'убраны ссылки на строках',
    apply: (a) => {
      delete a.details_url;
      delete a.state_url;
    },
  },
  {
    id: 6,
    name: 'время только с началом',
    apply: (a) => {
      if (a.timestamps) delete a.timestamps.end;
    },
  },
  {
    id: 7,
    name: 'наши кнопки (русские подписи, Telegram)',
    apply: (a, { branding }) => {
      a.buttons = [
        { label: 'Открыть в Яндекс Музыке', url: a.details_url || branding.repositoryUrl },
        { label: 'Автор', url: branding.authorUrl },
      ];
    },
  },
  {
    id: 8,
    name: 'всё наше сразу',
    apply: (a, { branding }) => {
      a.assets.small_text = 'KotaMusic 1.0.0';
      a.status_display_type = 2;
      if (a.timestamps) delete a.timestamps.end;
      a.buttons = [
        { label: 'Открыть в Яндекс Музыке', url: a.details_url || branding.repositoryUrl },
        { label: 'Автор', url: branding.authorUrl },
      ];
    },
  },
  {
    id: 9,
    name: 'короткая русская подпись + GitHub',
    apply: (a, { branding }) => {
      a.buttons = [
        { label: 'Слушать', url: a.details_url || branding.repositoryUrl },
        { label: 'Install from GitHub', url: branding.repositoryUrl },
      ];
    },
  },
  {
    id: 10,
    name: 'английские подписи + ссылка на Telegram',
    apply: (a, { branding }) => {
      a.buttons = [
        { label: 'Listen in Yandex Music', url: a.details_url || branding.repositoryUrl },
        { label: 'Author', url: branding.authorUrl },
      ];
    },
  },
  {
    id: 11,
    name: 'длинная русская подпись + GitHub',
    apply: (a, { branding }) => {
      a.buttons = [
        { label: 'Открыть в Яндекс Музыке', url: a.details_url || branding.repositoryUrl },
        { label: 'Install from GitHub', url: branding.repositoryUrl },
      ];
    },
  },
];

let index = 0;

const current = () => VARIANTS[index % VARIANTS.length];

function next() {
  index++;
  return current();
}

/** Помечаем название номером варианта — так его видно снаружи. */
function decorate(activity, context) {
  const variant = current();
  variant.apply(activity, context);
  activity.details = `#${variant.id} ${activity.details}`.slice(0, 128);
  return activity;
}

module.exports = { decorate, next, current, VARIANTS };

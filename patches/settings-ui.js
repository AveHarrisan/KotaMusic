'use strict';
// Врезка раздела мода в окно «О программе».
//
// Имя чанка настроек содержит хеш и меняется каждую версию, а имена
// переменных внутри — плод минификации. Поэтому файл ищем по содержимому,
// а имена компонентов вытаскиваем из самого кода рядом с точкой врезки.

const fs = require('fs/promises');
const path = require('path');

const CHUNKS_DIR = 'app/_next/static/chunks';
const MARKER = 'settings.about-app';

// (0,n.jsxs)("ul",{className:w().list,children:[(0,n.jsx)("li",{className:w().item,
//   children:(0,n.jsx)(j.N,{className:w().link,target:"_blank",href:...,
//     children:(0,n.jsx)(c.HL,{type:"controls",...
// (0,n.jsx)(c.HL,{className:w().versionText,...,children:e({id:"desktop.app-version-short"},...)})
const VERSION_ANCHOR =
  /\(0,(\w+)\.jsx\)\((\w+\.\w+),\{className:(\w+)\(\)\.versionText,type:"controls",variant:"div",size:"xs",children:[^]*?\}\)\}\),/;

const ANCHOR =
  /\(0,(\w+)\.jsxs\)\("ul",\{className:(\w+)\(\)\.list,children:\[\(0,\1\.jsx\)\("li",\{className:\2\(\)\.item,children:\(0,\1\.jsx\)\((\w+\.\w+),\{className:\2\(\)\.link,target:"_blank",href:[^]*?children:\(0,\1\.jsx\)\((\w+\.\w+),\{type:"controls"/;

/** Ссылка в списке — теми же компонентами, что и родные пункты. */
function linkItem({ jsx, styles, Link, Caption }, href, text, style) {
  const styleProp = style ? `style:${style},` : '';
  return (
    `(0,${jsx}.jsx)("li",{className:${styles}().item,${styleProp}` +
    `children:(0,${jsx}.jsx)(${Link},{className:${styles}().link,target:"_blank",` +
    `href:${JSON.stringify(href)},` +
    `children:(0,${jsx}.jsx)(${Caption},{type:"controls",variant:"span",size:"l",` +
    `weight:"medium",children:${JSON.stringify(text)}})})}),`
  );
}

/** Конец массива, открытого на позиции start (индекс закрывающей скобки). */
function findArrayEnd(code, start) {
  let depth = 1;
  let quote = null;

  for (let i = start; i < code.length; i++) {
    const ch = code[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) return ch === ']' ? i : -1;
    }
  }
  return -1;
}

module.exports = {
  id: 'settings-ui',

  async findFiles(root) {
    const dir = path.join(root, CHUNKS_DIR);
    const hits = [];

    const walk = async (d) => {
      for (const entry of await fs.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.js')) {
          const code = await fs.readFile(full, 'utf8');
          if (code.includes(MARKER) && ANCHOR.test(code)) hits.push(full);
        }
      }
    };

    await walk(dir);
    return hits;
  },

  apply(code, { branding }) {
    if (code.includes(branding.supportUrl)) return code; // уже наложен

    const found = ANCHOR.exec(code);
    if (!found) return null;

    const ctx = {
      jsx: found[1],
      styles: found[2],
      Link: found[3],
      Caption: found[4],
    };

    // Отделяем блок мода от ссылок Яндекса чертой.
    const divider =
      '{marginTop:"12px",paddingTop:"12px",borderTop:"1px solid rgba(255,255,255,0.12)"}';

    const items =
      linkItem(ctx, branding.repositoryUrl, branding.labels.repository, divider) +
      linkItem(ctx, branding.supportUrl, branding.labels.support);

    // Пункты мода идут ПОСЛЕ родных: ищем конец массива children.
    const listStart = code.indexOf('children:[', found.index) + 'children:['.length;
    const listEnd = findArrayEnd(code, listStart);
    if (listEnd < 0) return null;

    let patched = code.slice(0, listEnd) + ',' + items.replace(/,$/, '') + code.slice(listEnd);

    // Строка с версией мода — под версией клиента.
    const ver = VERSION_ANCHOR.exec(patched);
    if (!ver) return null;

    const versionLine =
      `(0,${ver[1]}.jsx)(${ver[2]},{className:${ver[3]}().versionText,type:"controls",` +
      `variant:"div",size:"xs",children:${JSON.stringify(
        `${branding.name} ${branding.version}`
      )}}),`;

    const insertAt = ver.index + ver[0].length;
    patched = patched.slice(0, insertAt) + versionLine + patched.slice(insertAt);

    // Версия мода в свёрнутой строке настроек «О приложении».
    const rowLabel = ` + " · ${branding.name} ${branding.version}"`;
    const rowRe = /(\{id:"settings\.about-app"\}\),description:)(\w+)(,onClick:)/;
    if (!rowRe.test(patched)) return null;
    patched = patched.replace(rowRe, (m, a, v, b) => `${a}${v}&&${v}${rowLabel}${b}`);

    return patched;
  },
};

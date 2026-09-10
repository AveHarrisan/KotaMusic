'use strict';
// Свой журнал: у собранного клиента консоли нет, а разбираться надо.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.tmpdir(), 'kotamusic.log');

function write(level, args) {
  const line = args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');

  try {
    fs.appendFileSync(FILE, `[${new Date().toISOString()}] ${level} ${line}\n`);
  } catch {}
  console.log(`[KotaMusic] ${line}`);
}

let verbose = true;

module.exports = {
  file: FILE,
  setVerbose: (value) => {
    verbose = Boolean(value);
  },
  debug: (...a) => verbose && write('DEBUG', a),
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};

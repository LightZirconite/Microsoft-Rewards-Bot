'use strict';
require('bytenode');
const path = require('path');
const fs = require('fs');

// Pre-flight checks before loading bytecode
const distDir = __dirname;
const configPath = path.join(distDir, 'config.json');
const accountsPath = path.join(distDir, 'accounts.json');

function fatal(msg) {
    console.error('\n============================================');
    console.error('  ERROR');
    console.error('============================================');
    console.error(msg);
    console.error('============================================\n');
    if (process.platform === 'win32') {
        require('child_process').spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
    }
    process.exit(1);
}

if (!fs.existsSync(configPath)) {
    fatal('  config.json not found!\n\n  Copy dist/config.example.json to dist/config.json\n  and edit it with your preferences.');
}
if (!fs.existsSync(accountsPath)) {
    fatal('  accounts.json not found!\n\n  Copy dist/accounts.example.json to dist/accounts.json\n  and add your Microsoft account credentials.');
}

// Load the bytecode entry point with global error handling
process.on('uncaughtException', function(err) {
    fatal('  Unexpected error:\n\n  ' + (err.stack || err.message || err));
});
process.on('unhandledRejection', function(reason) {
    fatal('  Unexpected error:\n\n  ' + (reason && reason.stack ? reason.stack : reason));
});

module.exports = require('./index.jsc');

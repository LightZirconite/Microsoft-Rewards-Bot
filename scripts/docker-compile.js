/**
 * Docker Bytecode Compiler
 *
 * Runs INSIDE the Docker builder stage on the target Linux platform.
 * Reads obfuscated .js files from docker-src/ and compiles them to Linux-native
 * V8 bytecode (.jsc), which is then copied to the runtime stage.
 *
 * This ensures that .jsc files are always compiled on the platform where they
 * will run — eliminating the Windows-built-jsc-on-Linux segfault problem.
 *
 * Usage (called from Dockerfile):
 *   node scripts/docker-compile.js [--src <dir>] [--out <dir>]
 *
 *   --src   Source directory with obfuscated .js files  (default: ./docker-src)
 *   --out   Output directory for .js stubs + .jsc files (default: ./dist)
 */

'use strict'

const fs = require('fs')
const path = require('path')
const bytenode = require('bytenode')

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(flag) {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : null
}

const SRC_DIR = path.resolve(getArg('--src') || './docker-src')
const OUT_DIR = path.resolve(getArg('--out') || './dist')

// ─── Open-core manifest ───────────────────────────────────────────────────────
// When Phase 2 is active, build-release.js writes open-core-manifest.json into
// docker-src/ to mark files that must stay as plain .js (not compiled to .jsc).
// This ensures the Docker image matches bare-metal: open-core source is readable.

function loadOpenCoreManifest() {
    const manifestPath = path.join(SRC_DIR, 'open-core-manifest.json')
    if (!fs.existsSync(manifestPath)) return new Set()
    try {
        const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const entries = Array.isArray(data.openCoreFiles) ? data.openCoreFiles : []
        console.log(`  ▶ Open-core manifest loaded: ${entries.length} file(s) will remain as plain JS`)
        return new Set(entries.map(p => p.replace(/\\/g, '/')))
    } catch (err) {
        console.warn(`  ⚠ Could not parse open-core-manifest.json: ${err.message}`)
        return new Set()
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAllFiles(dir, base = dir) {
    const results = []
    if (!fs.existsSync(dir)) return results
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            results.push(...getAllFiles(fullPath, base))
        } else {
            results.push({ fullPath, relativePath: path.relative(base, fullPath) })
        }
    }
    return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  Docker Bytecode Compiler')
    console.log(`  Platform: ${process.platform} — Node.js ${process.version}`)
    console.log(`  Source:   ${SRC_DIR}`)
    console.log(`  Output:   ${OUT_DIR}`)
    console.log('═══════════════════════════════════════════════════════════')
    console.log()

    if (!fs.existsSync(SRC_DIR)) {
        console.error(`✘ Source directory not found: ${SRC_DIR}`)
        process.exit(1)
    }

    fs.mkdirSync(OUT_DIR, { recursive: true })

    // Load open-core manifest (may be empty in Phase 1 — all files get compiled)
    const openCoreFiles = loadOpenCoreManifest()

    const files = getAllFiles(SRC_DIR)
    let compiled = 0
    let copied = 0
    let failed = 0

    for (const file of files) {
        const outPath = path.join(OUT_DIR, file.relativePath)
        const outDir = path.dirname(outPath)
        fs.mkdirSync(outDir, { recursive: true })

        // Skip the open-core manifest itself — it's a build artifact, not runtime code
        if (path.basename(file.fullPath) === 'open-core-manifest.json') continue

        // Non-JS files (JSON config templates, etc.) — copy as-is
        if (!file.fullPath.endsWith('.js')) {
            fs.copyFileSync(file.fullPath, outPath)
            copied++
            continue
        }

        // Open-core files must stay as plain .js (source is already public on GitHub).
        // Bytecoding them would create an inconsistency with the bare-metal release.
        const normRel = file.relativePath.replace(/\\/g, '/')
        if (openCoreFiles.has(normRel)) {
            fs.copyFileSync(file.fullPath, outPath)
            copied++
            process.stdout.write(`  ○ ${file.relativePath} (open-core — kept as plain JS)\n`)
            continue
        }

        const jscPath = outPath.replace(/\.js$/, '.jsc')
        const jscBasename = path.basename(outPath, '.js') + '.jsc'
        const isEntry = file.relativePath.replace(/\\/g, '/') === 'index.js'

        try {
            await bytenode.compileFile({
                filename: file.fullPath,
                compileAsModule: true,
                output: jscPath
            })

            // Write a minimal loader stub (.js) — the actual code is in the .jsc
            let stub
            if (isEntry) {
                // Entry point gets a pre-flight check loader (same as build-release.js)
                stub = [
                    "'use strict';",
                    "require('bytenode');",
                    "const path = require('path');",
                    "const fs = require('fs');",
                    '',
                    'const distDir = __dirname;',
                    "const configPath = path.join(distDir, 'config.json');",
                    "const accountsPath = path.join(distDir, 'accounts.json');",
                    '',
                    'function fatal(msg) {',
                    "    console.error('\\n============================================');",
                    "    console.error('  ERROR');",
                    "    console.error('============================================');",
                    '    console.error(msg);',
                    "    console.error('============================================\\n');",
                    '    process.exit(1);',
                    '}',
                    '',
                    'if (!fs.existsSync(configPath)) {',
                    "    fatal('config.json not found!\\n\\nMount your config.json via Docker volume:\\n  volumes:\\n    - ./src/config.json:/usr/src/microsoft-rewards-bot/dist/config.json:ro');",
                    '}',
                    'if (!fs.existsSync(accountsPath)) {',
                    "    fatal('accounts.json not found!\\n\\nMount your accounts.json via Docker volume:\\n  volumes:\\n    - ./src/accounts.json:/usr/src/microsoft-rewards-bot/dist/accounts.json:ro');",
                    '}',
                    '',
                    "process.on('uncaughtException', function(err) {",
                    "    fatal('Unexpected error:\\n\\n' + (err.stack || err.message || err));",
                    '});',
                    "process.on('unhandledRejection', function(reason) {",
                    "    fatal('Unexpected error:\\n\\n' + (reason && reason.stack ? reason.stack : reason));",
                    '});',
                    '',
                    `module.exports = require('./${jscBasename}');`,
                    ''
                ].join('\n')
            } else {
                stub = [
                    "'use strict';",
                    "require('bytenode');",
                    `module.exports = require('./${jscBasename}');`,
                    ''
                ].join('\n')
            }

            fs.writeFileSync(outPath, stub)
            compiled++
            process.stdout.write(`  ✔ ${file.relativePath} → .jsc\n`)
        } catch (err) {
            // Bytecode failed — keep the obfuscated .js as fallback (still protected)
            console.warn(`  ⚠ Bytecode failed for ${file.relativePath}: ${err.message}`)
            fs.copyFileSync(file.fullPath, outPath)
            failed++
        }
    }

    console.log()
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`  ✔ ${compiled} files compiled to Linux bytecode`)
    if (copied > 0) console.log(`  ○ ${copied} non-JS files copied as-is`)
    if (failed > 0) console.log(`  ⚠ ${failed} files kept as obfuscated JS (bytecode failed)`)
    console.log('═══════════════════════════════════════════════════════════')
    console.log()
}

main().catch(err => {
    console.error('\n✘ Docker compilation failed:', err.message)
    process.exit(1)
})

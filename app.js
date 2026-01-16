// Microsoft-Rewards-Bot, made by LightZirconite
// github.com/LightZirconite/Microsoft-Rewards-Bot

const fs = require("fs");
const cp = require("child_process");

console.log("🚀 Starting Microsoft Rewards Bot...");

// Check for module dependencies
if (!fs.existsSync("node_modules")) {
    console.log("📦 Installing dependencies...");
    cp.execSync("npm install", { stdio: "inherit" });
}

// Check for Playwright Chromium installation
if (!fs.existsSync(".playwright-chromium-installed")) {
    console.log("🌐 Installing Chromium browser...");
    cp.execSync("npx playwright install chromium --with-deps", { stdio: "inherit" });
    fs.writeFileSync(".playwright-chromium-installed", new Date().toISOString());
}

// Check for built TypeScript files
if (!fs.existsSync("dist/index.js")) {
    console.log("🔨 Building TypeScript project...");
    cp.execSync("npm run build", { stdio: "inherit" });
}

// All checks passed, launch the bot
console.log("✅ All checks passed! Launching bot...\\n");

// Launch the bot with source map support
cp.execSync("node --enable-source-maps ./dist/index.js", { stdio: "inherit" });
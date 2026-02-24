const fs = require('fs').promises; // Use promise-based FS
const path = require('path');

async function loadPlugins() {
    const pluginsDir = path.join(__dirname, 'plugins');
    
    try {
        // 1. Get all .js files
        const files = (await fs.readdir(pluginsDir))
            .filter(file => file.endsWith('.js'));

        if (files.length === 0) {
            console.log("No Plugins Detected");
            return start();
        }

        // 2. Load plugins and collect results
        let shouldStartDefault = true;

        for (const file of files) {
            try {
                const plugin = require(path.join(pluginsDir, file));
                const result = await plugin.init();
                
                console.log(`Plugin ${file} loaded successfully.`);

                if (result?.dodefault === false) {
                    console.log(`Plugin ${file} requested skipping default start.`);
                    shouldStartDefault = false;
                }
            } catch (err) {
                console.error(`Failed to load plugin ${file}:`, err);
            }
        }

        // 3. Final Decision
        if (shouldStartDefault) {
            start();
        }
    } catch (err) {
        console.error("Error accessing plugins directory:", err);
        start(); // Fallback to start if dir is missing
    }
}

function start() {
    require('./dist/index.js');
}

loadPlugins();
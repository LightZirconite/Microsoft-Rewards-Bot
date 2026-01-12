import fs from 'fs'
import path from 'path'
import { ConfigMerger } from './ConfigMerger'

/**
 * Bootstrap configuration files on startup
 * Automatically copies .example.jsonc files to .jsonc if they don't exist
 * On subsequent runs, intelligently merges new options from .example.jsonc
 * 
 * This ensures first-time users have working config/accounts files
 * without manual renaming steps, and keeps existing users up-to-date
 * without losing their customizations
 */
export class FileBootstrap {
    private static readonly FILES_TO_BOOTSTRAP = [
        {
            example: 'src/config.example.jsonc',
            target: 'src/config.jsonc',
            name: 'Configuration'
        },
        {
            example: 'src/accounts.example.jsonc',
            target: 'src/accounts.jsonc',
            name: 'Accounts'
        }
    ]

    /**
     * Bootstrap all necessary files
     * @returns Array of files that were created (first-time setup)
     */
    public static bootstrap(): string[] {
        const created: string[] = []

        for (const file of this.FILES_TO_BOOTSTRAP) {
            if (this.bootstrapFile(file.example, file.target, file.name)) {
                created.push(file.name)
            }
        }

        return created
    }

    /**
     * Smart merge: Update existing config files with new options
     * Preserves all user customizations and passwords
     * Only runs if files already exist (not first-time setup)
     * 
     * @returns Object with merge results
     */
    public static smartMerge(): {
        configChanged: boolean
        accountsChanged: boolean
        messages: string[]
    } {
        const rootDir = process.cwd()
        const messages: string[] = []
        let configChanged = false
        let accountsChanged = false

        // Only merge if both files exist (not first-time setup)
        const configExists = fs.existsSync(path.join(rootDir, 'src/config.jsonc'))
        const accountsExists = fs.existsSync(path.join(rootDir, 'src/accounts.jsonc'))

        if (!configExists || !accountsExists) {
            return { configChanged: false, accountsChanged: false, messages: [] }
        }

        // Merge config.jsonc
        const configResult = ConfigMerger.mergeConfigFile(
            path.join(rootDir, 'src/config.example.jsonc'),
            path.join(rootDir, 'src/config.jsonc')
        )

        if (configResult.success && configResult.changes.length > 0) {
            configChanged = true
            messages.push('📝 Configuration: ' + configResult.changes.join(', '))
        }

        // Merge accounts.jsonc
        const accountsResult = ConfigMerger.mergeAccountsFile(
            path.join(rootDir, 'src/accounts.example.jsonc'),
            path.join(rootDir, 'src/accounts.jsonc')
        )

        if (accountsResult.success && accountsResult.changes.length > 0) {
            accountsChanged = true
            messages.push('📝 Accounts: ' + accountsResult.changes.join(', '))
        }

        return { configChanged, accountsChanged, messages }
    }

    /**
     * Bootstrap a single file
     * @returns true if file was created, false if it already existed
     */
    private static bootstrapFile(examplePath: string, targetPath: string, name: string): boolean {
        const rootDir = process.cwd()
        const exampleFullPath = path.join(rootDir, examplePath)
        const targetFullPath = path.join(rootDir, targetPath)

        // Check if target already exists
        if (fs.existsSync(targetFullPath)) {
            return false
        }

        // Check if example exists
        if (!fs.existsSync(exampleFullPath)) {
            console.warn(`⚠️  Example file not found: ${examplePath}`)
            return false
        }

        try {
            // Copy example to target
            fs.copyFileSync(exampleFullPath, targetFullPath)
            console.log(`✅ Created ${name} file: ${targetPath}`)
            return true
        } catch (error) {
            console.error(`❌ Failed to create ${name} file:`, error instanceof Error ? error.message : String(error))
            return false
        }
    }

    /**
     * Check if all required files exist
     * @returns true if all files exist
     */
    public static checkFiles(): { allExist: boolean; missing: string[] } {
        const missing: string[] = []
        const rootDir = process.cwd()

        for (const file of this.FILES_TO_BOOTSTRAP) {
            const targetFullPath = path.join(rootDir, file.target)
            if (!fs.existsSync(targetFullPath)) {
                missing.push(file.name)
            }
        }

        return {
            allExist: missing.length === 0,
            missing
        }
    }

    /**
     * Display startup message if files were bootstrapped
     */
    public static displayStartupMessage(createdFiles: string[]): void {
        if (createdFiles.length === 0) {
            return
        }

        console.log('\n' + '='.repeat(70))
        console.log('🎉  FIRST-TIME SETUP COMPLETE')
        console.log('='.repeat(70))
        console.log('\nThe following files have been created for you:')

        for (const fileName of createdFiles) {
            console.log(`  ✓ ${fileName}`)
        }

        console.log('\n📝  NEXT STEPS:')
        console.log('  1. Edit src/accounts.jsonc to add your Microsoft accounts')
        console.log('  2. (Optional) Customize src/config.jsonc settings')
        console.log('  3. Run the bot again with: npm start')
        console.log('\n' + '='.repeat(70) + '\n')
    }
}

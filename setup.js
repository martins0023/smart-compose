#!/usr/bin/env bun
// Auto-setup script for AI Chat Co-Pilot extension

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message, color = "cyan") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function createDirectory(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    log(`✓ Created directory: ${path}`, "green");
    return true;
  } else {
    log(`→ Directory already exists: ${path}`, "yellow");
    return false;
  }
}

function createPlaceholderFile(path, content) {
  if (!existsSync(path)) {
    writeFileSync(path, content);
    log(`✓ Created file: ${path}`, "green");
    return true;
  } else {
    log(`→ File already exists: ${path}`, "yellow");
    return false;
  }
}

async function setup() {
  log("\n🚀 Setting up AI Chat Co-Pilot Extension...\n", "cyan");

  // Create directories
  log("📁 Creating directories...", "cyan");
  createDirectory("./src");
  createDirectory("./icons");

  // Check if source files need to be moved
  const filesToMove = [
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.js",
  ];

  log("\n📝 Checking source files...", "cyan");
  let needsMove = false;

  for (const file of filesToMove) {
    if (existsSync(`./${file}`) && !existsSync(`./src/${file}`)) {
      log(`⚠ Found ${file} in root - should be in src/`, "yellow");
      needsMove = true;
    } else if (existsSync(`./src/${file}`)) {
      log(`✓ ${file} is in src/`, "green");
    } else {
      log(`✗ ${file} not found`, "red");
    }
  }

  if (needsMove) {
    log(
      "\n⚠ Please move the above files from root to src/ folder",
      "yellow"
    );
    log("You can do this manually or run:", "yellow");
    log("  mv manifest.json background.js content.js content.css popup.html popup.js src/", "cyan");
    log("On Windows PowerShell:", "cyan");
    log("  Move-Item manifest.json,background.js,content.js,content.css,popup.html,popup.js src/", "cyan");
  }

  // Create README in icons folder
  const iconsReadme = `# Icons Folder

Place your extension icons here:
- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

If you don't add icons, the build script will auto-generate SVG placeholders.

## Quick Icon Creation:
- Use Favicon.io, Canva, or any image editor
- Recommended: Purple/blue gradient with ✨ sparkle symbol
- Keep designs simple for small sizes
`;

  createPlaceholderFile("./icons/README.md", iconsReadme);

  // Summary
  log("\n✅ Setup complete!", "green");
  log("\n📋 Next steps:", "cyan");
  log("1. Make sure all source files are in src/ folder", "reset");
  log("2. Run: bun run build", "reset");
  log("3. Load the dist/ folder in Chrome as an unpacked extension", "reset");
  log("4. Get your Gemini API key and configure the extension", "reset");
  log("\n💡 For development with auto-reload, run: bun run dev\n", "yellow");
}

setup().catch((error) => {
  log(`\n✗ Setup failed: ${error.message}`, "red");
  process.exit(1);
});
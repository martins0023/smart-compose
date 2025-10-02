//build.js

import { watch } from "fs";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "fs";
import { join, extname } from "path";

const isWatchMode = process.argv.includes("--watch");
const srcDir = "./src";
const distDir = "./dist";
const iconsDir = "./icons";

// Color codes for console output
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function log(message, color = "cyan") {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

function ensureDirectory(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log(`Created directory: ${dir}`, "green");
  }
}

function copyFile(src, dest) {
  try {
    copyFileSync(src, dest);
    log(`✓ Copied: ${src} → ${dest}`, "green");
    return true;
  } catch (error) {
    log(`✗ Error copying ${src}: ${error.message}`, "red");
    return false;
  }
}

function createPlaceholderIcon(size, outputPath) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#grad)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
        font-size="${size * 0.6}" fill="white" font-family="Arial, sans-serif">✨</text>
</svg>`;
  
  try {
    writeFileSync(outputPath, svg);
    log(`✓ Created placeholder icon: ${outputPath}`, "yellow");
    return true;
  } catch (error) {
    log(`✗ Error creating icon ${outputPath}: ${error.message}`, "red");
    return false;
  }
}

function processIcons() {
  const distIconsDir = join(distDir, "icons");
  ensureDirectory(distIconsDir);
  
  const iconSizes = [16, 48, 128];
  
  for (const size of iconSizes) {
    const pngName = `icon${size}.png`;
    const svgName = `icon${size}.svg`;
    const sourcePng = join(iconsDir, pngName);
    const destPng = join(distIconsDir, pngName);
    const destSvg = join(distIconsDir, svgName);
    
    // Check if PNG exists in icons folder
    if (existsSync(sourcePng)) {
      copyFile(sourcePng, destPng);
    } else {
      // Create SVG placeholder
      createPlaceholderIcon(size, destSvg);
      log(`ℹ Add ${pngName} to icons/ folder for custom icons`, "yellow");
    }
  }
}

function copyDirectory(src, dest, filter = null) {
  if (!existsSync(src)) {
    log(`⚠ Source directory not found: ${src}`, "yellow");
    return;
  }

  ensureDirectory(dest);
  
  const entries = readdirSync(src);
  
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    
    const stat = statSync(srcPath);
    
    if (stat.isDirectory()) {
      copyDirectory(srcPath, destPath, filter);
    } else if (stat.isFile()) {
      if (!filter || filter(entry)) {
        copyFile(srcPath, destPath);
      }
    }
  }
}

function validateManifest() {
  const manifestPath = join(distDir, "manifest.json");
  
  if (!existsSync(manifestPath)) {
    log("✗ manifest.json not found in dist/", "red");
    return false;
  }
  
  try {
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const content = JSON.parse(manifestContent);
    
    // Basic validation
    if (!content.manifest_version) {
      log("⚠ manifest.json missing manifest_version", "yellow");
    }
    if (!content.name) {
      log("⚠ manifest.json missing name", "yellow");
    }
    if (!content.version) {
      log("⚠ manifest.json missing version", "yellow");
    }
    
    log("✓ manifest.json validated", "green");
    return true;
  } catch (error) {
    // MODIFIED: Log a clearer error and the message. 
    // The previous 'require is not defined' was likely an environment artifact or unexpected content.
    log(`✗ Invalid manifest.json: JSON Parsing Error - ${error.message}`, "red");
    // To debug what content was read, you could temporarily log manifestContent here.
    return false;
  }
}

function build() {
  log("🔨 Building AI Chat Co-Pilot extension...", "cyan");
  
  // Ensure dist directory exists
  ensureDirectory(distDir);
  
  // Check if src directory exists
  if (!existsSync(srcDir)) {
    log("✗ src/ directory not found!", "red");
    log("ℹ Please create src/ folder and move your extension files there", "yellow");
    log("ℹ Run: mkdir src && mv *.js *.json *.html *.css src/", "cyan");
    process.exit(1);
  }
  
  try {
    // Copy all files from src to dist
    log("📦 Copying source files...", "cyan");
    copyDirectory(srcDir, distDir);
    
    // Process icons
    log("🎨 Processing icons...", "cyan");
    processIcons();
    
    // Validate manifest
    log("✅ Validating manifest...", "cyan");
    validateManifest();
    
    log("✅ Build completed successfully!", "green");
    log(`📂 Extension ready in: ${distDir}/`, "cyan");
    log("🚀 Load this folder in Chrome: chrome://extensions/", "cyan");
    
  } catch (error) {
    log(`✗ Build failed: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  }
}

function cleanBuild() {
  if (existsSync(distDir)) {
    log("🧹 Cleaning dist directory...", "yellow");
    rmSync(distDir, { recursive: true, force: true });
    log("✓ Cleaned", "green");
  }
}

// Handle clean command
if (process.argv.includes("--clean")) {
  cleanBuild();
  process.exit(0);
}

// Initial build
build();

// Watch mode
if (isWatchMode) {
  log("👀 Watching for changes... (Press Ctrl+C to stop)", "cyan");
  
  let buildTimeout;
  
  const triggerBuild = (filename) => {
    // Debounce builds
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(() => {
      log(`📝 Change detected: ${filename}`, "yellow");
      build();
    }, 100);
  };
  
  // Watch src directory
  if (existsSync(srcDir)) {
    watch(srcDir, { recursive: true }, (eventType, filename) => {
      if (filename) {
        triggerBuild(filename);
      }
    });
  } else {
    log("⚠ src/ directory not found. Create it to enable watch mode.", "yellow");
  }
  
  // Watch icons directory
  if (existsSync(iconsDir)) {
    watch(iconsDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.png')) {
        log(`🎨 Icon changed: ${filename}`, "yellow");
        processIcons();
      }
    });
  }
  
  // Keep process alive
  process.stdin.resume();
}
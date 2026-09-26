const fs = require('fs');
const path = require('path');

// Simple PNG optimization: create a script to resize via canvas (Node.js doesn't have native image processing)
// Instead, let's check what we can do with the raw file
const logoPath = path.join(__dirname, 'public', 'mce_logo.png');
const stats = fs.statSync(logoPath);
console.log(`Original logo size: ${(stats.size / 1024).toFixed(1)} KB`);

// Let's try to use sharp if available
try {
  const sharp = require('sharp');
  
  async function optimize() {
    // Create optimized versions
    const input = fs.readFileSync(logoPath);
    
    // Create a small optimized PNG (128x128 for sidebar/login icons)
    await sharp(input)
      .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 85, compressionLevel: 9 })
      .toFile(path.join(__dirname, 'public', 'mce_logo_128.png'));
    
    // Create a WebP version too (much smaller)
    await sharp(input)
      .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .webp({ quality: 85 })
      .toFile(path.join(__dirname, 'public', 'mce_logo_128.webp'));
    
    // Also create a medium size for login pages
    await sharp(input)
      .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 85, compressionLevel: 9 })
      .toFile(path.join(__dirname, 'public', 'mce_logo_256.png'));
    
    // Overwrite original with optimized version (keep original resolution but compress)
    const optimized = await sharp(input)
      .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 85, compressionLevel: 9 })
      .toBuffer();
    
    // Backup original
    fs.copyFileSync(logoPath, path.join(__dirname, 'public', 'mce_logo_original.png'));
    fs.writeFileSync(logoPath, optimized);
    
    const newStats = fs.statSync(logoPath);
    console.log(`Optimized logo size: ${(newStats.size / 1024).toFixed(1)} KB`);
    console.log(`Saved: ${((stats.size - newStats.size) / 1024).toFixed(1)} KB (${((1 - newStats.size / stats.size) * 100).toFixed(1)}% reduction)`);
  }
  
  optimize().catch(err => console.error('Sharp error:', err));
} catch (e) {
  console.log('Sharp not available. Installing...');
  const { execSync } = require('child_process');
  try {
    execSync('npm install sharp --save-dev', { cwd: __dirname, stdio: 'inherit' });
    console.log('Sharp installed. Re-run this script.');
  } catch (e2) {
    console.error('Could not install sharp. Please install manually: npm install sharp --save-dev');
  }
}

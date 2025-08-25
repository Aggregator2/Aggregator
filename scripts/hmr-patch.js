// HMR Patch for Next.js 15.x
// This patches the hot-reloader-client to handle isrManifest messages properly

const fs = require('fs');
const path = require('path');

const hotReloaderPath = path.join(
  process.cwd(),
  'node_modules/next/dist/client/components/react-dev-overlay/pages/hot-reloader-client.js'
);

if (fs.existsSync(hotReloaderPath)) {
  let content = fs.readFileSync(hotReloaderPath, 'utf8');
  
  // Patch the handleStaticIndicator function to check if window.__nextDevClientId exists
  const patchedContent = content.replace(
    'function handleStaticIndicator(message) {',
    `function handleStaticIndicator(message) {
      if (!window.__nextDevClientId || !window.__nextDevClientId.components) {
        console.warn('[HMR] Skipping isrManifest message - client not fully initialized');
        return;
      }`
  );
  
  if (content !== patchedContent) {
    fs.writeFileSync(hotReloaderPath, patchedContent);
    console.log('✅ Applied HMR patch for Next.js 15.x');
  }
}
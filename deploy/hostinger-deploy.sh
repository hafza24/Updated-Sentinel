#!/bin/bash
# Sentinel Net - Hostinger Deployment Script
# Usage: bash hostinger-deploy.sh

set -e

echo "=== Sentinel Net Hostinger Deployment ==="

# Build the project
echo "[1/5] Building project..."
npm run build

# Create deployment package
echo "[2/5] Creating deployment package..."
DEPLOY_DIR="sentinel-net-deploy"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Copy dist files
cp -r dist/client/* "$DEPLOY_DIR/"

# Copy API routes (if using Node adapter) or static files
cp -r dist/server "$DEPLOY_DIR/" 2>/dev/null || true

# Create .htaccess for SPA routing
cat > "$DEPLOY_DIR/.htaccess" << 'EOF'
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

# Enable gzip
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType image/png "access plus 1 month"
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
EOF

# Create environment template
cat > "$DEPLOY_DIR/.env.example" << 'EOF'
VITE_SUPABASE_URL=https://kwctyqxdiocjmsekymft.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_URL=https://kwctyqxdiocjmsekymft.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
EOF

echo "[3/5] Deployment package ready in: $DEPLOY_DIR/"
echo "[4/5] Files to upload via Hostinger File Manager:"
ls -la "$DEPLOY_DIR/"

echo ""
echo "[5/5] Upload instructions:"
echo "  1. Log in to Hostinger hPanel"
echo "  2. Go to Files > File Manager"
echo "  3. Navigate to public_html/"
echo "  4. Upload all files from $DEPLOY_DIR/"
echo "  5. Ensure .htaccess is uploaded (show hidden files)"
echo "  6. Set environment variables in .env file"
echo ""
echo "=== Deployment package ready ==="


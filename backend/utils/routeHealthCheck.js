const fs = require('fs');
const path = require('path');

/**
 * Recursively extracts all mounted routes from the Express app.
 */
function getExpressRoutes(app) {
  const routes = [];

  function cleanPrefix(regex) {
    // Converts express router regexp to readable paths
    const str = regex.toString();
    if (str === '/^\\/?$/i') return '';
    
    let match = str
      .replace('/^', '')
      .replace('\\/?(?=\\/|$)/i', '')
      .replace('\\/?$/i', '')
      .replace(/\\\//g, '/');
      
    // Strip group pattern checks like (?:\/(?=$))?
    match = match.replace(/\(\?:\\\/\(\?=\\\/\(\?=\$|[^)]*\)\)\)\?/g, '');
    
    if (match.startsWith('/')) return match;
    return '/' + match;
  }

  function traverse(stack, prefix = '') {
    if (!stack) return;
    
    stack.forEach(layer => {
      if (layer.route) {
        // Standard route layer
        const cleanPath = (prefix + layer.route.path).replace(/\/+/g, '/');
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        methods.forEach(method => {
          routes.push({ method, path: cleanPath });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // Nested router middleware layer
        let routerPrefix = '';
        if (layer.regexp) {
          routerPrefix = cleanPrefix(layer.regexp);
        }
        const cleanCombinedPrefix = (prefix + routerPrefix).replace(/\/+/g, '/');
        traverse(layer.handle.stack, cleanCombinedPrefix);
      }
    });
  }

  traverse(app._router.stack);
  return routes;
}

/**
 * Parses api-inventory.md to extract all expected endpoints.
 */
function parseExpectedRoutes() {
  try {
    const filePath = path.join(__dirname, '..', 'docs', 'api-inventory.md');
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  RouteHealthCheck: docs/api-inventory.md not found at ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const expected = [];

    lines.forEach(line => {
      // Look for rows in the markdown table starting with: | **GET** | `/api/...` |
      if (line.startsWith('| **') && line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length > 2) {
          const methodMatch = parts[1].match(/\*\*(GET|POST|PUT|PATCH|DELETE)\*\*/);
          const endpointMatch = parts[2].match(/`([^`]+)`/);
          
          if (methodMatch && endpointMatch) {
            expected.push({
              method: methodMatch[1],
              path: endpointMatch[1]
            });
          }
        }
      }
    });

    return expected;
  } catch (err) {
    console.error('❌ Failed to parse api-inventory.md:', err.message);
    return [];
  }
}

/**
 * Health check executor
 */
function runRouteHealthCheck(app) {
  console.log('\n🔍 Starting API Route Health Check...');
  
  const expectedRoutes = parseExpectedRoutes();
  const mountedRoutes = getExpressRoutes(app);
  
  // Create quick lookup set
  const mountedSet = new Set(
    mountedRoutes.map(r => `${r.method}:${r.path.replace(/\/$/, '')}`)
  );

  let missingCount = 0;
  const summary = [];

  expectedRoutes.forEach(expected => {
    const key = `${expected.method}:${expected.path.replace(/\/$/, '')}`;
    const cleanPath = expected.path;
    
    // Check if the expected route is mounted (ignoring trailing slashes)
    const isMounted = mountedSet.has(key);
    
    if (isMounted) {
      summary.push(`  ✓ ${expected.method} ${cleanPath} mounted`);
    } else {
      summary.push(`  ✗ MISSING: ${expected.method} ${cleanPath}`);
      missingCount++;
    }
  });

  // Print results summary
  console.log(summary.join('\n'));
  
  if (missingCount > 0) {
    console.error(`\n🚨 Route Health Check FAILED: ${missingCount} route(s) are missing!`);
    
    if (process.env.NODE_ENV === 'development') {
      console.error('💥 Fail-fast triggered in development mode. Exiting...');
      process.exit(1);
    }
  } else {
    console.log('✅ Route Health Check PASSED: All documented endpoints are mounted.\n');
  }
}

module.exports = runRouteHealthCheck;

# Dependency Proposal Template

**Package:** `<name>@<exact-version>`  
**Source URL / Tag:** `<tarball URL or Git tag>`  
**SHA256:** `<sha256-of-release-tarball>`  
**License:** `<license name>`  
**1-line justification:** `<why this cannot be solved with existing code>`

## Security checks / CVE
- CVE / advisories checked (links): `<link1>, <link2>`  
- Summary: `<short summary of any found CVEs or 'none found'>`

## Minimal API usage example
```js
// 3–6 lines showing required usage
const pkg = require('<name>');
// example usage of the exact functions you will call
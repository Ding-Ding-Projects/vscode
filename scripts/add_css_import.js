const fs = require('fs');
const f = 'src/vs/workbench/browser/parts/views/viewFilter.ts';
let c = fs.readFileSync(f, 'utf8');
if (c.includes('mdFilterWidget.css')) {
  console.log('CSS import already present');
  process.exit(0);
}
const target = "import { Codicon } from '../../../../base/common/codicons.js';";
const replacement = target + "\r\nimport './media/mdFilterWidget.css';";
c = c.replace(target, replacement);
fs.writeFileSync(f, c, 'utf8');
console.log('CSS import added to viewFilter.ts');

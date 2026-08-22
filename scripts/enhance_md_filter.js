const fs = require('fs');
const f = 'src/vs/workbench/browser/parts/views/viewFilter.ts';
let c = fs.readFileSync(f, 'utf8');
c = c.replace("this.element = DOM.$('.viewpane-filter');", "this.element = DOM.$('.viewpane-filter md3-search-filter');");
const beforeCreateInput = "this._register(toDisposable(() => this.delayedFilterUpdate.cancel()));";
const searchIconHTML = "\r\n\t\tconst searchIcon = DOM.append(this.element, DOM.$('.md3-search-icon'));\r\n\t\tDOM.addClass(searchIcon, Codicon.search.className);\r\n\t\tsearchIcon.setAttribute('aria-hidden', 'true');";
c = c.replace(beforeCreateInput, beforeCreateInput + searchIconHTML);
fs.writeFileSync(f, c, 'utf8');
console.log('MD3 filter widget enhanced');

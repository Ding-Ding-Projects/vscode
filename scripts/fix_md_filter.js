const fs = require('fs');
const f = 'src/vs/workbench/browser/parts/views/viewFilter.ts';
let c = fs.readFileSync(f, 'utf8');

// Remove the search icon from createInput and put it after element creation
const removedBlock = "\t\tthis._register(toDisposable(() => this.delayedFilterUpdate.cancel()));\r\n\t\tconst searchIcon = DOM.append(this.element, DOM.$('.md3-search-icon'));\r\n\t\tDOM.addClass(searchIcon, Codicon.search.className);\r\n\t\tsearchIcon.setAttribute('aria-hidden', 'true');";
c = c.replace(removedBlock, "\t\tthis._register(toDisposable(() => this.delayedFilterUpdate.cancel()));");

// Now add search icon right after element creation line
const oldElementLine = "this.element = DOM.$('.viewpane-filter md3-search-filter');";
const newElementLine = "this.element = DOM.$('.viewpane-filter md3-search-filter');\r\n\t\tconst searchIcon = DOM.append(this.element, DOM.$('.md3-search-icon'));\r\n\t\tDOM.addClass(searchIcon, Codicon.search.className);\r\n\t\tsearchIcon.setAttribute('aria-hidden', 'true');";
c = c.replace(oldElementLine, newElementLine);

fs.writeFileSync(f, c, 'utf8');
console.log('Fixed MD3 filter widget structure');

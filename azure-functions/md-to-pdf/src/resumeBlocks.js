'use strict';

/**
 * Wrap each experience role (h3 + ul) in a single-cell table AFTER markdown-it
 * renders. Injecting HTML tables in markdown source does NOT work: markdown-it
 * closes HTML blocks before ### headings, so bullets render OUTSIDE the table
 * and Chromium splits them across pages (the actual production bug).
 */

const SHELL_OPEN = '<div class="resume-block-shell"><table class="resume-block"><tr><td>';
const SHELL_CLOSE = '</td></tr></table></div>';

/**
 * @param {string} bodyHtml — output of markdown-it render()
 * @returns {string}
 */
function wrapExperienceRoleBlocks(bodyHtml) {
  return String(bodyHtml || '').replace(
    /<h3>[\s\S]*?<\/h3>\s*<ul>[\s\S]*?<\/ul>/g,
    (block) => `${SHELL_OPEN}${block}${SHELL_CLOSE}`,
  );
}

module.exports = { wrapExperienceRoleBlocks, SHELL_OPEN, SHELL_CLOSE };

'use strict';

/**
 * Inject unbreakable print blocks at the MARKDOWN layer (before markdown-it).
 * Each experience role, project, research blurb, and education entry becomes
 * a <table class="resume-block"> — Chromium honors page-break-inside:avoid
 * on tables far more reliably than on div+ul (see convertToPdf.js CSS).
 *
 * This replaces fragile post-render HTML regex patching.
 */

const BLOCK_OPEN = '<div class="resume-block-shell"><table class="resume-block"><tr><td>\n\n';
const BLOCK_CLOSE = '\n\n</td></tr></table></div>\n\n';

function isSectionHeading(line) {
  return /^##\s+/.test(line);
}

function isHr(line) {
  return /^---\s*$/.test(line.trim());
}

function sectionName(line) {
  return line.replace(/^##\s+/, '').trim().toLowerCase();
}

function collectBulletLines(lines, startIndex) {
  const out = [];
  let i = startIndex;
  while (i < lines.length && /^-\s/.test(lines[i])) {
    out.push(lines[i]);
    i++;
  }
  return { lines: out, nextIndex: i };
}

function skipBlankLines(lines, startIndex) {
  let i = startIndex;
  while (i < lines.length && lines[i].trim() === '') i++;
  return i;
}

function collectUntilSection(lines, startIndex) {
  const out = [];
  let i = startIndex;
  while (i < lines.length && !isSectionHeading(lines[i]) && !isHr(lines[i])) {
    out.push(lines[i]);
    i++;
  }
  return { lines: out, nextIndex: i };
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function injectResumeBlockTables(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let section = '';

  while (i < lines.length) {
    const line = lines[i];

    if (isSectionHeading(line)) {
      section = sectionName(line);
      out.push(line);
      i++;

      if (section === 'research') {
        const chunk = collectUntilSection(lines, i);
        if (chunk.lines.length) {
          out.push(BLOCK_OPEN);
          out.push(...chunk.lines);
          out.push(BLOCK_CLOSE);
        }
        i = chunk.nextIndex;
      }
      continue;
    }

    if (isHr(line)) {
      out.push(line);
      i++;
      continue;
    }

    if (section === 'experience' && /^###\s+/.test(line)) {
      out.push(BLOCK_OPEN);
      out.push(line);
      i++;
      i = skipBlankLines(lines, i);
      const bullets = collectBulletLines(lines, i);
      out.push(...bullets.lines);
      i = bullets.nextIndex;
      out.push(BLOCK_CLOSE);
      continue;
    }

    if (section.startsWith('project') && /^\*\*/.test(line)) {
      out.push(BLOCK_OPEN);
      out.push(line);
      i++;
      i = skipBlankLines(lines, i);
      const bullets = collectBulletLines(lines, i);
      if (bullets.lines.length) {
        out.push(...bullets.lines);
        i = bullets.nextIndex;
      } else {
        // Tailor sometimes emits paragraph lines instead of bullets — keep them
        // inside the same block so they cannot split across pages.
        while (i < lines.length && lines[i].trim() !== '' && !/^\*\*/.test(lines[i]) && !isSectionHeading(lines[i]) && !isHr(lines[i])) {
          out.push(lines[i]);
          i++;
        }
      }
      out.push(BLOCK_CLOSE);
      continue;
    }

    if (section === 'education' && /^\*\*/.test(line)) {
      out.push(BLOCK_OPEN);
      out.push(line);
      i++;
      if (i < lines.length && /^\*/.test(lines[i])) {
        out.push(lines[i]);
        i++;
      }
      out.push(BLOCK_CLOSE);
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join('\n');
}

module.exports = { injectResumeBlockTables, BLOCK_OPEN, BLOCK_CLOSE };
